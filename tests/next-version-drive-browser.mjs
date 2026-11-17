import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const out = new URL("../test-results/next-version/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], checks = [], samples = [];
const report = { headless: true, checks, errors, samples };
page.on("pageerror", e => errors.push(e.message));
const state = () => page.evaluate(() => window.paperlapDebug);
const shot = name => page.screenshot({ path: new URL(name + ".png", out).pathname });
const check = name => { checks.push(name); console.log("PASS " + name); };
const held = new Set();
async function keys(wanted) {
  for (const key of [...held]) if (!wanted.includes(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of wanted) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
function nextPoint(points, index, distance) {
  let a = points[index];
  for (let k = 1; k <= points.length; k++) {
    const b = points[(index + k) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= length) return { x: a.x + (b.x - a.x) * distance / length, y: a.y + (b.y - a.y) * distance / length };
    distance -= length; a = b;
  }
  return a;
}
try {
  const url = `${process.env.PAPERLAP_URL || "http://127.0.0.1:5173"}/?debug=1`;
  await page.goto(url);
  await page.waitForFunction(() => window.paperlapDebug?.renderer?.ready);
  let s = await state();
  assert.equal(s.track.schemaVersion, 2);
  assert.equal(s.storage.writable, true);
  assert.equal(s.renderer.kind, "three-webgl");
  assert.equal(await page.locator("canvas.race-view").count(), 1);
  for (const viewport of [{width:1366,height:768},{width:1280,height:800},{width:900,height:700}]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    await shot(`drive-ready-${viewport.width}`);
    assert.equal((await state()).renderer.ready, true);
  }
  await page.setViewportSize({width:1366,height:768});
  check("3D long sample renders at three desktop sizes");
  await page.locator("#start").click();
  await keys(["ArrowUp"]);
  await page.waitForFunction(() => window.paperlapDebug.lap.elapsed > 1);
  await keys([]);
  await page.keyboard.press("Space");
  const paused = await state();
  await page.waitForTimeout(250);
  const still = await state();
  assert.deepEqual(still.car, paused.car);
  assert.deepEqual(still.renderer.camera, paused.renderer.camera);
  assert.equal(still.lap.elapsed, paused.lap.elapsed);
  check("pause freezes vehicle, lap time and chase camera");
  await page.keyboard.press("r");
  await page.evaluate(() => {
    window.paperlapFrameSamples = [];
    let last;
    const tick = t => {
      if (last !== undefined && window.paperlapDebug?.mode === "running") window.paperlapFrameSamples.push(t - last);
      last = t;
      if (window.paperlapFrameSamples.length < 10000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const deadline = Date.now() + 150000;
  let captured = false;
  while (Date.now() < deadline) {
    s = await state();
    if (s.lap.completed >= 1) break;
    assert.equal(s.mode, "running");
    assert.equal(s.lap.valid, true, "real keyboard driver must stay within the road");
    const { car, track } = s, points = track.points;
    let index = 0, distance = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - car.x, p.y - car.y);
      if (d < distance) { distance = d; index = i; }
    });
    const a = nextPoint(points, index, 0), b = nextPoint(points, index, 80), c = nextPoint(points, index, 160);
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const bend = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    const targetSpeed = bend > .42 ? 190 : bend > .25 ? 220 : 255;
    const target = nextPoint(points, index, Math.max(45, car.speed * .29));
    const error = Math.atan2(Math.sin(Math.atan2(target.y - car.y, target.x - car.x) - car.angle), Math.cos(Math.atan2(target.y - car.y, target.x - car.x) - car.angle));
    const wanted = [];
    if (error > .035) wanted.push("ArrowRight");
    if (error < -.035) wanted.push("ArrowLeft");
    if (car.speed < targetSpeed) wanted.push("ArrowUp");
    if (car.speed > targetSpeed + 15) wanted.push("ArrowDown");
    await keys(wanted);
    if (samples.length % 5 === 0) report.latest = s;
    samples.push({ time:s.lap.elapsed,x:car.x,y:car.y,speed:car.speed,gate:s.lap.nextGate });
    if (!captured && s.lap.elapsed > 8) { await shot("drive-running"); captured = true; }
    await page.waitForTimeout(40);
  }
  await keys([]);
  s = await state();
  assert.ok(s.lap.completed >= 1, "finish the long sample via real keyboard input");
  report.lapSeconds = s.lap.last;
  assert.ok(s.lap.last >= 30 && s.lap.last <= 60, `sample lap target: ${s.lap.last}`);
  await page.keyboard.press("Space");
  await shot("drive-record");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("paperlap.save.v4")));
  assert.ok(Object.values(saved.records).some(t => Math.abs(t - s.lap.last) < .001));
  const identity = s.geometryIdentity;
  check("real keyboard completes a valid 30–60 second lap and persists its PB");
  const frames = (await page.evaluate(() => window.paperlapFrameSamples)).filter(t => t > 0 && t < 1000).sort((a,b)=>a-b);
  report.performance = { frameCount:frames.length, medianMs:frames[Math.floor(frames.length*.5)], p95Ms:frames[Math.floor(frames.length*.95)], renderer:s.renderer, browser:browser.version(), platform:process.platform, arch:process.arch };
  await page.reload();
  await page.waitForFunction(() => window.paperlapDebug?.renderer?.ready);
  assert.equal((await state()).geometryIdentity, identity);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("paperlap.save.v4")).records), saved.records);
  check("reload retains track identity and PB");
  assert.deepEqual(errors, []);
  await page.evaluate(() => document.querySelector("canvas.race-view").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await page.locator("#recovery").waitFor({state:"visible"});
  assert.equal((await state()).mode, "paused");
  check("WebGL context loss while ready enters explicit recovery");
} catch (error) {
  report.failure = error.stack;
  await shot("drive-failure").catch(()=>{});
  throw error;
} finally {
  await writeFile(new URL("drive-report.json", out), JSON.stringify(report,null,2));
  await context.close();
  await browser.close();
}
