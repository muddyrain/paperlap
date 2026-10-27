import { cancelDrawing } from "./fixtures/editor-actions.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Ignore an inherited interactive-debug setting before Playwright initializes.
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");

// Separate, headless browser. Never connects to a user's browser or CDP session.
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--mute-audio"],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}test-results/screenshots`, { recursive: true });
await mkdir(`${root}test-results`, { recursive: true });
const errors = [],
  failures = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("requestfailed", (r) =>
  failures.push(`${r.url()} ${r.failure()?.errorText}`),
);
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const state = () => page.evaluate(() => window.paperlapDebug);
const shot = (name) =>
  page.screenshot({ path: `${root}test-results/screenshots/${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
// Headless render speed varies by host; driving duration is game time, not wall time.
async function simulateFor(seconds) {
  const until = (await state()).lap.elapsed + seconds;
  await page.waitForFunction(
    (until) => window.paperlapDebug.lap.elapsed >= until,
    until,
    { timeout: 20000, polling: "raf" },
  );
}
async function ready() {
  await page.goto(`${base}/?debug=1`);
  await page.locator("#game canvas").waitFor();
  await page.waitForFunction(() => !!window.paperlapDebug);
  await wait(200);
}
async function draw(points) {
  const r = await page.locator(".draw-surface").boundingBox();
  const at = (p) => ({
    x: r.x + (p.x * r.width) / 1440,
    y: r.y + (p.y * r.height) / 860,
  });
  const first = at(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const q = at(p);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();
  await wait(80);
}
const ellipse = (n = 180) =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: 720 + 440 * Math.cos((i / n) * Math.PI * 2),
    y: 430 + 215 * Math.sin((i / n) * Math.PI * 2),
  }));
try {
  await ready();
  await shot("welcome-1366");
  const start = (await state()).car;
  await page.locator("#start").click();
  await page.keyboard.down("ArrowUp");
  await simulateFor(1.4);
  await page.keyboard.down("ArrowRight");
  await simulateFor(0.25);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowUp");
  const driven = await state();
  assert.ok(Math.hypot(driven.car.x - start.x, driven.car.y - start.y) > 60);
  assert.ok(Math.abs(driven.car.angle - start.angle) > 0.1);
  check("real keyboard accelerates and steers");
  await page.keyboard.press("Space");
  await wait(100);
  const paused = await state();
  await wait(250);
  assert.equal((await state()).lap.elapsed, paused.lap.elapsed);
  assert.deepEqual((await state()).car, paused.car);
  assert.ok(await page.locator("#pause-panel").isVisible());
  await page.locator("#resume").click();
  // Observe immediately after the game's key handler, before rendering can advance time.
  await page.evaluate(() => {
    document.querySelector(".board").addEventListener(
      "keydown",
      () => {
        window.paperlapTestReset = window.paperlapDebug;
      },
      { once: true },
    );
  });
  await page.keyboard.press("r");
  const reset = await page.evaluate(() => {
    const snapshot = window.paperlapTestReset;
    delete window.paperlapTestReset;
    return snapshot;
  });
  assert.equal(reset.lap.elapsed, 0);
  assert.ok(Math.hypot(reset.car.x - start.x, reset.car.y - start.y) < 0.01);
  check("pause freezes timer and vehicle; resume and R reset work");
  await page.keyboard.down("ArrowUp");
  await simulateFor(0.2);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("ArrowUp");
  await wait(100);
  assert.equal((await state()).mode, "paused");
  const blurPos = (await state()).car;
  await wait(250);
  assert.deepEqual((await state()).car, blurPos);
  check("window blur pauses and clears held input");
  await page.locator("#resume").click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  assert.equal((await state()).mode, "paused");
  await wait(120);
  const hiddenTime = (await state()).lap.elapsed;
  await wait(120);
  assert.equal((await state()).lap.elapsed, hiddenTime);
  check("hidden-tab lifecycle pauses until explicit resume");
  await page.locator("#sound").click();
  assert.equal(await page.locator("#sound").getAttribute("aria-label"), "静音");
  await ready();
  assert.equal(await page.locator("#sound").getAttribute("aria-label"), "静音");
  await page.locator("#sound").click();
  assert.equal(
    await page.locator("#sound").getAttribute("aria-label"),
    "开启声音",
  );
  check("sound toggle and preference survive reload");
  await page.locator("#edit").click();
  await draw(ellipse());
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await shot("editor-valid");
  await page.locator("#drive-drawing").click();
  const custom = await state();
  assert.notEqual(custom.trackId, driven.trackId);
  await page.keyboard.down("w");
  await simulateFor(0.5);
  await page.keyboard.up("w");
  assert.ok((await state()).car.speed > 20);
  check("real pointer creates track; custom track is keyboard-drivable");
  const savedId = (await state()).trackId;
  await ready();
  assert.equal((await state()).trackId, savedId);
  assert.equal((await state()).mode, "ready");
  check("refresh restores accepted custom track");
  await page.locator("#edit").click();
  await draw(ellipse().slice(0, 125));
  assert.match(await page.locator("#editor-status").innerText(), /终点/);
  assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
  await shot("editor-invalid");
  await page.locator("#redraw").click();
  assert.ok(await page.locator("#draw-intro").isVisible());
  const crossing = Array.from({ length: 181 }, (_, i) => {
    const a = (i / 180) * Math.PI * 2;
    return { x: 720 + 430 * Math.sin(a), y: 430 + 210 * Math.sin(a * 2) };
  });
  await draw(crossing);
  assert.match(await page.locator("#editor-status").innerText(), /交叉|太近/);
  await cancelDrawing(page, "button");
  assert.equal((await state()).trackId, savedId);
  check(
    "open/crossing drafts show errors; redraw and cancel preserve saved track",
  );
  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
    [900, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await wait(150);
    const layout = await page.evaluate(() => {
      const sels = [
        ".mode-note",
        ".timing",
        ".top-actions",
        ".controls",
        ".bottom-actions",
      ];
      const boxes = sels.map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { s, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      return {
        boxes,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(layout.overflow, false);
    for (const b of layout.boxes) {
      assert.ok(
        b.x >= 0 && b.x + b.w <= width + 1,
        `${b.s} within viewport ${width}`,
      );
      assert.ok(b.y >= 0 && b.y + b.h <= height + 1);
    }
    await shot(`layout-${width}`);
    // Re-draw at this scale, ensuring pointer/world mapping stays aligned.
    await page.locator("#edit").click();
    await draw(ellipse());
    assert.ok(await page.locator("#drive-drawing").isEnabled());
    await cancelDrawing(page, "button");
  }
  check("1366x768, 1280x800, 900x700 layouts and scaled drawing align");
  await page.setViewportSize({ width: 1366, height: 768 });
  // Restore the default via storage deletion, through the real reload path.
  await page.evaluate(() => {
    localStorage.removeItem("paperlap.save.v2");
    localStorage.removeItem("paperlap.save.v1");
  });
  await ready();
  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
    [900, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await wait(120);
    const overlaps = await page.evaluate(() => {
      const r = document.querySelector(".board").getBoundingClientRect();
      const track = window.paperlapDebug.track;
      return [
        ".mode-note",
        ".timing",
        ".top-actions",
        ".controls",
        ".bottom-actions",
      ].filter((selector) => {
        const b = document.querySelector(selector).getBoundingClientRect();
        const x0 = ((b.left - r.left) * 1440) / r.width,
          x1 = ((b.right - r.left) * 1440) / r.width,
          y0 = ((b.top - r.top) * 860) / r.height,
          y1 = ((b.bottom - r.top) * 860) / r.height;
        return track.points.some(
          (p) =>
            Math.hypot(
              Math.max(x0 - p.x, 0, p.x - x1),
              Math.max(y0 - p.y, 0, p.y - y1),
            ) <
            track.width / 2,
        );
      });
    });
    assert.deepEqual(overlaps, [], `HUD clear of default road at ${width}`);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  check("HUD remains outside the default driving road at all three sizes");
  await page.locator("#start").click();
  // Keyboard driver reads telemetry and sends actual key events; it never writes game state.
  const pressed = new Set();
  async function keys(wanted) {
    for (const key of [...pressed])
      if (!wanted.includes(key)) {
        await page.keyboard.up(key);
        pressed.delete(key);
      }
    for (const key of wanted)
      if (!pressed.has(key)) {
        await page.keyboard.down(key);
        pressed.add(key);
      }
  }
  const deadline = Date.now() + 180000;
  let last;
  while (Date.now() < deadline) {
    const s = await state();
    last = s;
    if (s.lap.completed >= 1) break;
    const ps = s.track.points,
      c = s.car;
    let index = 0,
      best = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const d = Math.hypot(c.x - ps[i].x, c.y - ps[i].y);
      if (d < best) {
        best = d;
        index = i;
      }
    }
    const target =
      ps[(index + Math.max(5, Math.round((c.speed * 0.32) / 8))) % ps.length];
    let angle = Math.atan2(target.y - c.y, target.x - c.x) - c.angle;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    const wanted = [];
    if (angle > 0.035) wanted.push("ArrowRight");
    if (angle < -0.035) wanted.push("ArrowLeft");
    if (c.speed < 165) wanted.push("ArrowUp");
    if (c.speed > 180) wanted.push("ArrowDown");
    await keys(wanted);
    await wait(45);
  }
  await keys([]);
  assert.ok(
    last.lap.completed >= 1,
    `keyboard lap completion: ${JSON.stringify(last.lap)}`,
  );
  assert.ok(last.lap.last > 5);
  assert.ok(
    (await page.locator("#best").innerText()) !== "--:--.--",
    `valid lap must set record ${JSON.stringify(last.lap)}`,
  );
  await shot("race-record");
  const record = await page.locator("#best").innerText();
  await page.keyboard.press("Space");
  await ready();
  assert.equal(await page.locator("#best").innerText(), record);
  check(
    "full valid lap with keyboard events records best; record survives refresh",
  );
  // Force an offroad excursion with real steering/acceleration.
  await page.locator("#start").click();
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("ArrowRight");
  await simulateFor(2.6);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowUp");
  assert.equal((await state()).lap.valid, false);
  assert.match(await page.locator("#lap-status").innerText(), /不计成绩/);
  await page.keyboard.press("r");
  await wait(80);
  assert.equal((await state()).lap.valid, true);
  check("offroad invalidates lap; R restores validity");
  await page.keyboard.press("Space");
  for (let i = 0; i < 4; i++) {
    await page.locator("#edit").click();
    await cancelDrawing(page, "button");
    await page.locator("#resume").click();
    await page.keyboard.press("r");
    await page.keyboard.press("Space");
  }
  assert.equal(await page.locator("#game canvas").count(), 1);
  assert.equal(await page.locator(".draw-surface").count(), 1);
  assert.ok((await state()).effects <= 140);
  check("repeated editing/restart keeps one engine canvas and bounded effects");
  await page.evaluate(() => {
    localStorage.setItem("paperlap.save.v2", "broken json");
    localStorage.setItem("paperlap.save.v1", "broken json");
  });
  await ready();
  assert.ok(await page.locator("#start").isVisible());
  assert.equal((await state()).trackId, driven.trackId);
  check("corrupt storage falls back to playable default");
  await page.locator("#start").click();
  await page.keyboard.down("ArrowUp");
  await simulateFor(0.9);
  await page.keyboard.up("ArrowUp");
  await shot("final-game");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  check("no console errors or failed resources");
} finally {
  await writeFile(
    `${root}test-results/browser-report.json`,
    JSON.stringify(
      { headless: true, checks, errors, failedRequests: failures },
      null,
      2,
    ),
  );
  await page.close();
  await context.close();
  await browser.close();
  console.log("Headless browser and context closed");
}
