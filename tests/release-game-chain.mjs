import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { launchHeadless, engineName } from "./fixtures/release-engine.mjs";
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:4220";
const output = process.env.PAPERLAP_RELEASE_OUTPUT || `test-results/release/${engineName}`;
await mkdir(output, { recursive: true });
const browser = await launchHeadless();
const report = { engine: engineName, browser: browser.version(), headless: true, status: "BLOCKED", steps: [], errors: [], drive: [], video: null };
let context;
let page, video;
const state = p => p.evaluate(() => paperlapDebug);
const raw = (p, key = "paperlap.save.v3") => p.evaluate(k => localStorage.getItem(k), key);
const idle = p => p.waitForFunction(() => !paperlapDebug.local.busy && (!paperlapDebug.local.active || document.querySelector("#local-editor").getAttribute("aria-busy") === "false"));
async function load(p) {
  await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas"));
  await idle(p);
}
async function shot(name, detail = {}) {
  await idle(page);
  await page.evaluate(async () => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
  await page.screenshot({ path: `${output}/${name}.png` });
  report.steps.push({ name, status: "PASS", ...detail });
  console.log(`PASS ${engineName}: ${name}`);
}
async function gameFocus(p) {
  await p.locator("#game").focus();
  assert.equal(await p.evaluate(() => document.activeElement.id), "game");
}
async function createTrack(name, rx, ry) {
  await page.locator("#trackbook-open").click();
  await page.locator("#new-track").click();
  const box = await page.locator(".draw-surface").boundingBox();
  const points = Array.from({ length: 181 }, (_, i) => ({ x: 720 + rx * Math.cos(i / 180 * Math.PI * 2), y: 442 + ry * Math.sin(i / 180 * Math.PI * 2) }));
  const at = q => ({ x: box.x + q.x / 1440 * box.width, y: box.y + q.y / 860 * box.height });
  const first = at(points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const q of points.slice(1)) { const a = at(q); await page.mouse.move(a.x, a.y); }
  await page.mouse.up();
  await page.waitForFunction(() => paperlapDebug.draft.valid);
  await page.keyboard.press("Enter");
  assert.equal((await state(page)).mode, "ready");
  const uid = (await state(page)).activeTrackUid;
  await page.locator("#trackbook-open").click();
  await page.locator(`[data-uid="${uid}"] [data-action="rename"]`).click();
  await page.locator("#track-name-input").fill(name);
  await page.locator("#rename-save").click();
  await page.keyboard.press("Escape");
  await gameFocus(page);
  return uid;
}
async function driveLap(label) {
  const began = Date.now(), held = new Set();
  const keys = async wanted => {
    for (const k of [...held]) if (!wanted.includes(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  await page.locator("#start").click();
  let result;
  try {
    while (Date.now() - began < 180000) {
      const s = await state(page);
      if (s.lap.completed >= 1 && await page.locator("#best").innerText() !== "--:--.--") {
        const save = JSON.parse(await raw(page)), entry = save.tracks.find(e => e.uid === save.activeTrackUid);
        const key = `${entry.uid}:${entry.geometryIdentity}:rules-${save.rulesVersion}`;
        assert.ok(save.records[key] > 2 && save.records[key] < 3600);
        result = { label, completed: s.lap.completed, lap: s.lap, key, pb: save.records[key], wallMs: Date.now() - began, input: "native held Arrow keys; telemetry read-only" };
        break;
      }
      const points = s.track.points, car = s.car;
      let index = 0, distance = Infinity;
      points.forEach((q, i) => { const d = Math.hypot(car.x - q.x, car.y - q.y); if (d < distance) { distance = d; index = i; } });
      const target = points[(index + Math.max(5, Math.round(car.speed * .32 / 8))) % points.length];
      const angle = Math.atan2(Math.sin(Math.atan2(target.y - car.y, target.x - car.x) - car.angle), Math.cos(Math.atan2(target.y - car.y, target.x - car.x) - car.angle));
      const wanted = [];
      if (angle > .035) wanted.push("ArrowRight");
      if (angle < -.035) wanted.push("ArrowLeft");
      if (car.speed < 165) wanted.push("ArrowUp");
      if (car.speed > 180) wanted.push("ArrowDown");
      await keys(wanted);
      // Driver sampling interval, never used as a save/assertion completion barrier.
      await page.waitForTimeout(45);
    }
    assert.ok(result, `${label}: no real valid PB within the existing 180s driver deadline`);
  } finally { await keys([]); }
  await page.keyboard.press("Space");
  report.drive.push(result);
  return result;
}
async function bend(axis, delta) {
  const s = await state(page), points = s.local.current;
  const q = points.reduce((a, b) => b[axis] < a[axis] ? b : a);
  const box = await page.locator(".local-surface").boundingBox();
  const a = { x: box.x + q.x / 1440 * box.width, y: box.y + q.y / 860 * box.height };
  await page.mouse.move(a.x, a.y); await page.mouse.down(); assert.equal((await state(page)).local.dragging, true);
  await page.mouse.move(a.x + (axis === "x" ? delta / 1440 * box.width : 0), a.y + (axis === "y" ? delta / 860 * box.height : 0), { steps: 12 });
  await page.mouse.up(); await idle(page);
  assert.equal((await state(page)).local.pending.error, null);
}
try {
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1,
  acceptDownloads: true, recordVideo: { dir: `${output}/video`, size: { width: 1024, height: 576 } } });
  context.on("page", p => p.on("pageerror", e => report.errors.push(e.message)));
  page = await context.newPage(); video = page.video(); await load(page);
  if (!(await state(page)).storage.writable) {
    report.reason = "engine currently has no writer capability; full persisted chain unavailable";
  } else {
    const aUid = await createTrack("A 真实驾驶与两弯局部修订", 460, 230);
    const originalEntry = JSON.parse(await raw(page)).tracks.find(e => e.uid === aUid);
    await shot("01-created-a", { uid: aUid, identity: originalEntry.geometryIdentity });
    const oldPB = await driveLap("A before local edit");
    await shot("02-a-real-pb", oldPB);
    const bUid = await createTrack("B 独立赛道切换验证", 415, 245);
    assert.notEqual(aUid, bUid); await shot("03-created-b", { uid: bUid });
    await page.locator("#trackbook-open").click();
    await page.locator(`[data-uid="${aUid}"] [data-action="select"]`).click();
    await page.keyboard.press("Escape"); await gameFocus(page);
    assert.equal((await state(page)).activeTrackUid, aUid);
    assert.notEqual(await page.locator("#best").innerText(), "--:--.--");
    const original = await raw(page);
    await page.keyboard.press("l"); await idle(page);
    await bend("x", -12); await page.keyboard.press("Enter"); await idle(page);
    const first = (await state(page)).local.current;
    await bend("y", -8); await page.locator("#local-adopt").focus(); await page.keyboard.press("Space"); await idle(page);
    const second = (await state(page)).local.current;
    assert.notDeepEqual(first, second); assert.equal(await raw(page), original);
    await page.locator(".local-surface").focus();
    const mod = await page.evaluate(() => /Mac/.test(navigator.platform) ? "Meta" : "Control");
    await page.keyboard.press(`${mod}+z`); await idle(page); assert.deepEqual((await state(page)).local.current, first);
    await page.keyboard.press(`${mod}+Shift+z`); await idle(page); assert.deepEqual((await state(page)).local.current, second);
    await shot("04-two-bends-undo-redo");
    await page.reload(); await page.waitForFunction(() => window.paperlapDebug); await page.keyboard.press("l");
    await page.locator("#local-recovery[open]").waitFor(); await page.locator("#local-continue").click(); await idle(page);
    assert.deepEqual((await state(page)).local.current, second); assert.equal(await raw(page), original);
    await shot("05-real-local-recovery");
    await page.locator(".local-surface").focus(); await page.keyboard.press(`${mod}+Enter`); await idle(page);
    assert.equal((await state(page)).mode, "ready");
    const saved = JSON.parse(await raw(page)), changed = saved.tracks.find(e => e.uid === aUid);
    assert.notEqual(changed.geometryIdentity, originalEntry.geometryIdentity); assert.equal(saved.records[oldPB.key], oldPB.pb);
    assert.equal(await page.locator("#best").innerText(), "--:--.--"); await shot("06-new-geometry-empty-pb", { oldIdentity: originalEntry.geometryIdentity, newIdentity: changed.geometryIdentity });
    await page.reload(); await page.waitForFunction(() => window.paperlapDebug);
    assert.equal((await state(page)).geometryIdentity, changed.geometryIdentity); assert.equal(await page.locator("#best").innerText(), "--:--.--");
    await page.locator("#record-history-open").click(); const history = await page.locator("#record-history-list").innerText();
    assert.ok(history.includes(oldPB.key)); await shot("07-old-record-history", { history });
    await page.keyboard.press("Escape");
    const newPB = await driveLap("A after two-bend revision"); assert.notEqual(newPB.key, oldPB.key);
    const final = JSON.parse(await raw(page)); assert.equal(final.records[oldPB.key], oldPB.pb); assert.equal(final.records[newPB.key], newPB.pb);
    assert.equal(final.tracks.find(e => e.uid === bUid).track.name, "B 独立赛道切换验证"); await shot("08-new-real-pb", newPB);
    const keys = { v1: "paperlap.save.v1", v2: "paperlap.save.v2", v3: "paperlap.save.v3", draftV1: "paperlap.draft.v1", draftV2: "paperlap.draft.v2", localDraftV1: "paperlap.local-draft.v1" };
    const expected = Object.fromEntries(await Promise.all(Object.entries(keys).map(async ([name, key]) => [name, await raw(page, key)])));
    await page.locator("#record-history-open").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-save").click()]);
    await download.saveAs(`${output}/game-chain-backup.json`);
    const exported = JSON.parse(await readFile(`${output}/game-chain-backup.json`, "utf8"));
    assert.equal(exported.format, "paperlap-backup-v1"); for (const [key, value] of Object.entries(expected)) assert.equal(exported[key], value, key);
    await shot("09-export-complete", { backup: "game-chain-backup.json", exportedKeys: Object.keys(exported) });
    assert.deepEqual(report.errors, []); report.status = "PASS";
  }
} catch (error) {
  report.status = "FAIL"; report.error = error.stack;
  if (page && !page.isClosed()) { report.lastState = await state(page).catch(() => null); await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); }
  process.exitCode = 1;
} finally {
  await context?.close();
  if (video) { await video.saveAs(`${output}/game-chain.webm`); report.video = "game-chain.webm"; }
  await browser.close();
  await writeFile(`${output}/game-chain.json`, JSON.stringify(report, null, 2));
  console.log(`${report.status} ${engineName}: complete native A/PB/B/A/two-bend/recovery/new-PB/export chain`);
}
