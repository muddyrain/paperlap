import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { launchHeadless, engineName } from "./fixtures/release-engine.mjs";
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:4220";
const output = process.env.PAPERLAP_RELEASE_OUTPUT || `test-results/release/${engineName}`;
await mkdir(output, { recursive: true });
const fixture = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
import {readFileSync} from 'node:fs';
import {migrateSave} from './src/game/save-v3.ts';
import {storageTextDigest} from './src/game/geometry-identity.ts';
const v2=readFileSync('./tests/fixtures/ux-legacy-save-v2.json','utf8').trimEnd(),s=JSON.parse(v2),e=s.tracks[0];
const v1=JSON.stringify({schemaVersion:1,rulesVersion:s.rulesVersion,muted:s.muted,track:e.track,records:Object.fromEntries(Object.entries(s.records).map(([k,v])=>[k.slice(e.uid.length+1),v]))});
const r=migrateSave(s,'v2',{v1:storageTextDigest(v1),v2:storageTextDigest(v2)});if(!r.ok)throw Error(r.error);
console.log(JSON.stringify({v1,v2,v3:JSON.stringify(r.save)}));`], { encoding: "utf8" }));
const keys = { v1: "paperlap.save.v1", v2: "paperlap.save.v2", v3: "paperlap.save.v3", draftV1: "paperlap.draft.v1", draftV2: "paperlap.draft.v2", localDraftV1: "paperlap.local-draft.v1" };
const seed = { [keys.v1]: fixture.v1, [keys.v2]: fixture.v2, [keys.v3]: fixture.v3,
  [keys.draftV1]: '{"schemaVersion":99,"raw":"旧整笔原文"} ', [keys.draftV2]: '{"schemaVersion":999,"raw":"未知整笔草稿"}\n', [keys.localDraftV1]: "未知局部原文\u0000\n" };
const browser = await launchHeadless();
const report = { engine: engineName, browser: browser.version(), headless: true, fixture: "controlled source/draft inputs in isolated contexts; no fake scores used for game-chain evidence", cases: [], errors: [] };
const state = p => p.evaluate(() => paperlapDebug);
const raw = (p, k = keys.v3) => p.evaluate(k => localStorage.getItem(k), k);
async function load(p) { await p.goto(`${base}/?debug=1`); await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas")); }
async function run(name, input, exercise, init) {
  let c, p; const began = Date.now();
  try {
    c = await browser.newContext({ viewport: { width: 900, height: 700 }, acceptDownloads: true,
      storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: Object.entries(input).map(([name, value]) => ({ name, value })) }] } });
    if (init) await c.addInitScript(init);
    p = await c.newPage(); p.on("pageerror", e => report.errors.push({ name, error: e.message })); await load(p);
    const detail = await exercise(p, c);
    report.cases.push({ name, status: "PASS", ms: Date.now() - began, ...detail }); console.log(`PASS ${engineName}: ${name}`);
  } catch (error) {
    report.cases.push({ name, status: "FAIL", ms: Date.now() - began, error: error.stack }); process.exitCode = 1;
    if (p && !p.isClosed()) await p.screenshot({ path: `${output}/safety-${name}-failure.png` }).catch(() => {});
    console.log(`FAIL ${engineName}: ${name}: ${error.message}`);
  } finally { await c?.close(); }
}
try {
  await run("writer-release-reload", { [keys.v2]: fixture.v2 }, async (p, c) => {
    assert.equal((await state(p)).storage.writable, true);
    const availability = await p.evaluate(async () => ({ available: !!navigator.locks, locks: navigator.locks?.query ? await navigator.locks.query() : null }));
    const before = await raw(p), other = await c.newPage(); await load(other);
    assert.equal((await state(other)).storage.error, "writer-busy"); assert.equal((await state(other)).storage.writable, false);
    await other.locator("#sound").click(); assert.equal(await raw(other), before);
    await p.close(); await load(other); assert.equal((await state(other)).storage.writable, true);
    await other.locator("#sound").click(); assert.notEqual(await raw(other), before);
    return availability;
  });
  await run("locks-unavailable-readonly", { [keys.v2]: fixture.v2 }, async p => {
    const s = await state(p); assert.equal(s.storage.writable, false); assert.equal(s.storage.error, "lock-unavailable");
    assert.equal(await raw(p), null); assert.equal(await raw(p, keys.v2), fixture.v2);
    assert.match(await p.locator("#storage-state").getAttribute("title"), /不支持安全写入锁/);
    await p.locator("#start").click(); await p.keyboard.down("ArrowUp"); await p.waitForFunction(() => paperlapDebug.car.speed > 20); await p.keyboard.up("ArrowUp"); await p.keyboard.press("Space");
    assert.equal(await raw(p), null); assert.equal(await raw(p, keys.v2), fixture.v2);
    await p.screenshot({ path: `${output}/locks-unavailable.png` });
    return { writes: "none", temporaryDriving: true, nativeLockFeatureIntentionallyRemoved: true };
  }, () => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }));
  await run("export-all-six-raw-keys", seed, async p => {
    assert.equal((await state(p)).storage.writable, true);
    await p.locator("#record-history-open").click();
    const [download] = await Promise.all([p.waitForEvent("download"), p.locator("#export-save").click()]);
    await download.saveAs(`${output}/six-key-backup.json`);
    const exported = JSON.parse(await readFile(`${output}/six-key-backup.json`, "utf8")); assert.equal(exported.format, "paperlap-backup-v1");
    for (const [field, key] of Object.entries(keys)) { assert.equal(exported[field], seed[key], field); assert.equal(await raw(p, key), seed[key]); }
    assert.equal(Object.keys(exported).length, 7);
    assert.equal(await p.getByRole("button", { name: /一键恢复|导入存档/ }).count(), 0);
    return { fields: Object.keys(exported), exactCodeUnitsPreserved: true, importFeature: "NOT TESTED: no one-click import exists" };
  });
  const backup = JSON.parse(await readFile(`${output}/six-key-backup.json`, "utf8"));
  const restoredRaw = Object.fromEntries(Object.entries(keys).map(([field, key]) => [key, backup[field]]));
  await run("exported-raw-restored-in-clean-context", restoredRaw, async p => {
    assert.equal((await state(p)).storage.writable, true);
    assert.equal((await state(p)).geometryIdentity, JSON.parse(backup.v3).tracks[0].geometryIdentity);
    for (const [field, key] of Object.entries(keys)) assert.equal(await raw(p, key), backup[field], field);
    return { isolatedContext: true, allSixRawKeysPreserved: true, restoration: "QA-only storageState reconstruction; product has no one-click import" };
  });
  await run("quota-upgrade-retry", { [keys.v2]: fixture.v2 }, async p => {
    const before = await state(p); assert.equal(before.storage.persisted, false); assert.equal(before.storage.writable, false);
    assert.equal(await raw(p), null); assert.equal(await raw(p, keys.v2), fixture.v2);
    assert.match(await p.locator("#storage-state").getAttribute("title"), /空间不足/);
    await p.evaluate(() => sessionStorage.setItem("qa-allow-v3", "1")); await load(p);
    const after = await state(p); assert.equal(after.storage.persisted, true); assert.equal(after.storage.writable, true); assert.equal(after.geometryIdentity, before.geometryIdentity);
    assert.equal(await raw(p, keys.v2), fixture.v2);
    return { stableMigrationIdentity: after.geometryIdentity, fault: "controlled setItem QuotaExceededError, not real disk exhaustion" };
  }, () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) { if (k === "paperlap.save.v3" && !sessionStorage.getItem("qa-allow-v3")) throw new DOMException("QA quota", "QuotaExceededError"); return set.call(this, k, v); };
  });
  for (const mode of ["readback-throw", "write-readback-conflict"]) await run(mode, seed, async p => {
    await p.evaluate(mode => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem; let written = false;
      window.qaWrites = 0;
      window.qaRaw = k => get.call(localStorage, k);
      window.qaRestore = () => { Storage.prototype.getItem = get; Storage.prototype.setItem = set; };
      Storage.prototype.setItem = function(k, v) { window.qaWrites++; const result = set.call(this, k, k === "paperlap.save.v3" && mode === "write-readback-conflict" ? v + " " : v); if (k === "paperlap.save.v3") written = true; return result; };
      Storage.prototype.getItem = function(k) { if (written && k === "paperlap.save.v3" && mode === "readback-throw") throw new DOMException("QA readback unavailable", "SecurityError"); return get.call(this, k); };
    }, mode);
    await p.locator("#sound").click();
    assert.equal(await p.locator("#toast").getAttribute("data-feedback"), "error");
    assert.equal(await p.locator("#storage-state").isVisible(), true);
    const durable = await p.evaluate(() => window.qaRaw("paperlap.save.v3"));
    const firstWrites = await p.evaluate(() => window.qaWrites);
    for (const key of Object.values(keys).filter(k => k !== keys.v3)) assert.equal(await p.evaluate(k => window.qaRaw(k), key), seed[key], key);
    await p.locator("#sound").click(); assert.equal(await p.evaluate(() => window.qaWrites), firstWrites);
    if (mode === "write-readback-conflict") assert.equal((await state(p)).storage.error, "conflict");
    await p.evaluate(() => window.qaRestore());
    assert.equal(await raw(p), durable); await load(p); assert.equal((await state(p)).storage.writable, true);
    return { firstWrites, laterWritesBlocked: true, allOtherRawKeysPreserved: true, durableV3ReadableAfterReload: true, fault: "controlled Storage API" };
  });
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  report.status = report.cases.some(c => c.status === "FAIL") || report.errors.length ? "FAIL" : "PASS";
  await writeFile(`${output}/safety.json`, JSON.stringify(report, null, 2));
}
