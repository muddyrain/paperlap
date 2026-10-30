import assert from "node:assert/strict";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { performanceFixtures } from "./fixtures/local-performance.mjs";
import { launchHeadless, engineName } from "./fixtures/release-engine.mjs";
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:4220";
const output = process.env.PAPERLAP_RELEASE_OUTPUT || `test-results/release/${engineName}`;
await mkdir(output, { recursive: true });
const browser = await launchHeadless();
const seed = performanceFixtures["900-20"];
const report = { engine: engineName, browser: browser.version(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model,
  headless: true, scale: "20 tracks x 900 validated points, seeded V3 with matching legacy source; fixture records are controlled performance input, not gameplay evidence",
  coldDefinition: "new isolated context + new document; browser/server/OS caches may be warm; fixture generation excluded", samples: [], errors: [],
  cpu4x: engineName === "chromium" ? "available via target CDP emulation" : "NOT TESTED: no equivalent CDP emulation on this engine", heap: engineName === "chromium" ? "CDP forced-GC JS heap only, not GPU/native memory" : "NOT TESTED: no equivalent heap API" };
const state = p => p.evaluate(() => paperlapDebug);
const raw = p => p.evaluate(() => localStorage.getItem("paperlap.save.v3"));
const idle = p => p.waitForFunction(() => !paperlapDebug.local.busy && (!paperlapDebug.local.active || document.querySelector("#local-editor").getAttribute("aria-busy") === "false"));
async function settled(p) { await idle(p); await p.evaluate(async () => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); await p.waitForFunction(() => !paperlapDebug.motion.active); }
const stats = values => {
  const a = [...values].sort((a, b) => a - b);
  return { n: a.length, samples: values, median: a[Math.floor(a.length / 2)], p95: a[Math.min(a.length - 1, Math.floor(a.length * .95))], max: a.at(-1) };
};
async function resources(p, cdp) {
  await settled(p);
  let heap = null;
  if (cdp) { await cdp.send("HeapProfiler.collectGarbage"); heap = (await cdp.send("Runtime.getHeapUsage")).usedSize; }
  return p.evaluate(heap => ({ canvas: document.querySelectorAll("canvas").length, textures: paperlapDebug.local.textureCount,
    animations: document.getAnimations().filter(a => a.playState === "running").length, motionSlots: paperlapDebug.motion.active,
    feedbackEchoes: document.querySelectorAll(".motion-echo").length, effects: paperlapDebug.effects, forcedGCHeapBytes: heap }), heap);
}
async function dragAdopt(p, delta = -3) {
  const s = await state(p), q = s.local.current.reduce((a, b) => b.x < a.x ? b : a), box = await p.locator(".local-surface").boundingBox();
  await p.mouse.move(box.x + q.x / 1440 * box.width, box.y + q.y / 860 * box.height); await p.mouse.down();
  await p.mouse.move(box.x + (q.x + delta) / 1440 * box.width, box.y + q.y / 860 * box.height, { steps: 16 });
  await p.mouse.up(); await idle(p); assert.equal((await state(p)).local.pending.error, null);
  await p.locator("#local-adopt").click(); await idle(p); assert.equal((await state(p)).local.pending, null);
}
async function lifecycle(p, c, cdp) {
  const detail = {};
  await p.locator("#start").click(); await p.keyboard.down("ArrowUp"); await p.waitForFunction(() => paperlapDebug.car.speed > 20);
  const other = await c.newPage(); await other.goto("about:blank"); await other.bringToFront();
  let hidden = await p.evaluate(() => document.hidden), windowId;
  if (!hidden && cdp) {
    try {
      windowId = (await cdp.send("Browser.getWindowForTarget")).windowId;
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
      await p.waitForFunction(() => document.hidden, null, { timeout: 2000 }); hidden = true;
    } catch (e) { detail.visibilityProbe = e.message; }
  }
  if (hidden) {
    await p.waitForFunction(() => paperlapDebug.mode !== "running" && paperlapDebug.keys.length === 0);
    const frozen = await state(p), began = Date.now();
    while (Date.now() - began < 300) await p.evaluate(() => Promise.resolve());
    const after = await state(p); assert.notEqual(after.mode, "running"); assert.deepEqual(after.keys, []); assert.equal(after.lap.elapsed, frozen.lap.elapsed);
    detail.hidden = { status: "PASS", nativeDocumentHidden: true, mode: after.mode };
  } else detail.hidden = { status: "NOT TESTED", reason: "headless tab/virtual window did not produce a native hidden document; synthetic existing regressions do not count as native OS background" };
  await p.keyboard.up("ArrowUp");
  if (windowId) await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }).catch(() => {});
  await p.bringToFront(); await other.close();
  if (hidden) { await p.waitForFunction(() => !document.hidden); assert.notEqual((await state(p)).mode, "running"); }
  if ((await state(p)).mode === "running") await p.keyboard.press("Space");
  await p.locator("#local-edit").click(); await idle(p); await dragAdopt(p);
  const current = (await state(p)).local.current, formal = await raw(p);
  await p.evaluate(() => window.addEventListener("pagehide", () => sessionStorage.setItem("qa-native-pagehide", "yes"), { once: true }));
  await p.goto(`${base}/?debug=1&profile=1&qa=pagehide`); await p.waitForFunction(() => window.paperlapDebug);
  assert.equal(await p.evaluate(() => sessionStorage.getItem("qa-native-pagehide")), "yes"); assert.equal((await state(p)).storage.writable, true);
  await p.locator("#local-edit").click(); await p.locator("#local-recovery[open]").waitFor(); await p.locator("#local-continue").click(); await idle(p);
  assert.deepEqual((await state(p)).local.current, current); assert.equal(await raw(p), formal);
  detail.pagehideReload = { status: "PASS", realNavigation: true, writerReacquired: true, localCheckpointRecovered: true, officialRawUnchanged: true };
  return detail;
}
try {
  for (const rate of engineName === "chromium" ? [1, 4] : [1]) {
    const sample = { cpuRate: rate, status: "BLOCKED", coldLoadMs: [], source: "v3", operations: [], resources: [] };
    report.samples.push(sample);
    for (let i = 0; i < 3; i++) {
      let c;
      try {
        c = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "no-preference",
          storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: Object.entries(seed).map(([name, value]) => ({ name, value })) }] } });
        const p = await c.newPage(); p.on("pageerror", e => report.errors.push(e.message));
        const cdp = engineName === "chromium" ? await c.newCDPSession(p) : null;
        if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        const began = performance.now(); await p.goto(`${base}/?debug=1&profile=1`);
        await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas"));
        sample.coldLoadMs.push(performance.now() - began);
        const loaded = await state(p); assert.equal(loaded.storage.source, "v3"); assert.equal(loaded.storage.writable, true);
        const save = JSON.parse(await raw(p)); assert.equal(save.tracks.length, 20); assert.ok(save.tracks.every(t => t.track.points.length === 900));
        sample.lastColdProfile = loaded.profile;
        if (i === 2) {
          sample.resources.push({ cycle: 0, ...await resources(p, cdp) });
          await p.evaluate(() => { window.qaFrameTimes = []; window.qaFramesOn = true; let last = performance.now(); const tick = now => { qaFrameTimes.push(now-last); last=now; if (qaFramesOn) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
          for (let round = 0; round < 3; round++) {
            const begin = performance.now(); await p.locator("#local-edit").click(); await idle(p);
            const entryMs = performance.now() - begin, official = await raw(p), adoptedAt = performance.now();
            await dragAdopt(p); const adopted = await state(p); assert.equal(await raw(p), official);
            const saveAt = performance.now(); await p.locator("#local-save").click(); await idle(p); await p.waitForFunction(() => !paperlapDebug.local.active);
            const done = await state(p); assert.equal(done.mode, "ready");
            sample.operations.push({ round, entryWallMs: entryMs, dragValidateAdoptWallMs: saveAt - adoptedAt, saveWallMs: performance.now() - saveAt,
              previewMs: adopted.local.metrics.previewMs, releaseMs: adopted.local.metrics.releaseMs, adoptMs: adopted.local.metrics.adoptMs, saveMs: done.local.metrics.saveMs,
              profile: done.profile });
          }
          for (let cycle = 1; cycle <= 20; cycle++) {
            await p.locator("#local-edit").click(); await idle(p); await p.keyboard.press("Escape"); assert.equal((await state(p)).local.active, false);
            if (cycle % 5 === 0) sample.resources.push({ cycle, ...await resources(p, cdp) });
          }
          const baseline = sample.resources[0];
          for (const row of sample.resources) { assert.ok(Number.isFinite(row.textures) && row.textures > 0); assert.ok(row.canvas > 0); assert.equal(row.canvas, baseline.canvas); assert.equal(row.textures, baseline.textures); assert.equal(row.motionSlots, 0); assert.equal(row.animations, 0); }
          sample.heapSamples = sample.resources.map(x => x.forcedGCHeapBytes).filter(x => x !== null);
          const frames = await p.evaluate(() => { qaFramesOn = false; return qaFrameTimes; }); sample.raf = stats(frames);
          sample.motionMode = "normal motion; actual animations enabled during resource cycles";
          sample.lifecycle = await lifecycle(p, c, cdp);
          await p.screenshot({ path: `${output}/performance-${rate}x.png` });
        }
      } finally { await c?.close(); }
    }
    sample.cold = stats(sample.coldLoadMs); sample.entry = stats(sample.operations.map(x => x.entryWallMs)); sample.save = stats(sample.operations.map(x => x.saveWallMs));
    sample.status = "PASS"; await writeFile(`${output}/performance.json`, JSON.stringify(report, null, 2));
    console.log(`PASS ${engineName}: 20x900 V3 cold n=3, complex native saves, 20 editor cycles / ${rate}x`);
  }
  assert.deepEqual(report.errors, []); report.status = "PASS";
} catch (error) { report.status = "FAIL"; if (report.samples.length) report.samples.at(-1).status = "FAIL"; report.error = error.stack; process.exitCode = 1; console.log(`FAIL ${engineName}: performance/resources: ${error.message}`); }
finally { await browser.close(); await writeFile(`${output}/performance.json`, JSON.stringify(report, null, 2)); }
