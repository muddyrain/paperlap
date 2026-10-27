import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = fileURLToPath(
  new URL("../test-results/sound/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const state = (page) => page.evaluate(() => window.paperlapDebug);
const focus = (page) => page.evaluate(() => document.activeElement?.id);
const muted = (page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("paperlap.save.v2")).muted,
  );
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function simulateFor(page, seconds) {
  const until = (await state(page)).lap.elapsed + seconds;
  await page.waitForFunction(
    (until) => window.paperlapDebug.lap.elapsed >= until,
    until,
    { timeout: 20000, polling: "raf" },
  );
}
async function isolated(run) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("requestfailed", (r) => failedRequests.push(r.url()));
    await page.goto(`${base}/?debug=1`);
    await page.waitForFunction(
      () => window.paperlapDebug && document.querySelector("#game canvas"),
    );
    await run(page);
  } finally {
    await context.close();
  }
}
try {
  await isolated(async (page) => {
    await page.keyboard.press("Space");
    await page.keyboard.down("ArrowUp");
    await simulateFor(page, 0.3);
    for (const wantMuted of [false, true]) {
      const before = await state(page);
      await page.locator("#sound").click(); // Real pointerdown → focus → click sequence.
      const clicked = await state(page);
      assert.equal(
        clicked.mode,
        "running",
        "sound click must not pause driving",
      );
      assert.equal(await focus(page), "game");
      assert.deepEqual(clicked.keys, ["ArrowUp"]);
      assert.equal(clicked.sound.muted, wantMuted);
      assert.equal(clicked.sound.running, !wantMuted);
      assert.equal(await muted(page), wantMuted);
      assert.equal(
        await page.locator("#sound").getAttribute("aria-pressed"),
        String(!wantMuted),
      );
      await page.waitForFunction(
        (wantMuted) =>
          wantMuted
            ? window.paperlapDebug.sound.motorGain < 0.001
            : window.paperlapDebug.sound.motorGain > 0.001,
        wantMuted,
      );
      await simulateFor(page, 0.15);
      const after = await state(page);
      assert.equal(after.mode, "running");
      assert.ok(after.lap.elapsed > before.lap.elapsed);
      assert.ok(
        Math.hypot(after.car.x - before.car.x, after.car.y - before.car.y) > 0,
      );
      assert.ok(after.car.speed > before.car.speed);
      assert.equal(after.activeTrackUid, before.activeTrackUid);
      assert.equal(after.lap.completed, before.lap.completed);
    }
    const angle = (await state(page)).car.angle;
    await page.keyboard.down("ArrowRight");
    assert.deepEqual((await state(page)).keys.sort(), [
      "ArrowRight",
      "ArrowUp",
    ]);
    await simulateFor(page, 0.12);
    assert.ok(Math.abs((await state(page)).car.angle - angle) > 0.01);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowUp");
    const released = await state(page);
    await simulateFor(page, 0.15);
    const coasted = await state(page);
    assert.deepEqual(coasted.keys, []);
    assert.ok(
      coasted.car.speed < released.car.speed,
      "released throttle cannot stick after sound clicks",
    );
    assert.equal(coasted.mode, "running");
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "paused");
    check(
      "held throttle survives pointer sound on/off; timer/car/motor/preferences continue, steering and key release still work",
    );
  });

  await isolated(async (page) => {
    const ready = await state(page);
    await page.locator("#sound").click();
    assert.equal(await focus(page), "sound");
    assert.equal((await state(page)).mode, "ready");
    assert.deepEqual((await state(page)).car, ready.car);
    assert.equal((await state(page)).lap.elapsed, ready.lap.elapsed);
    for (const [key, wantMuted] of [
      ["Enter", true],
      ["Space", false],
    ]) {
      await page.keyboard.press(key);
      assert.equal((await state(page)).sound.muted, wantMuted);
      assert.equal(await muted(page), wantMuted);
      assert.equal((await state(page)).mode, "ready");
      assert.equal(await focus(page), "sound");
    }
    await page.locator("#start").click();
    await page.keyboard.down("ArrowUp");
    await simulateFor(page, 0.2);
    // Tab intentionally leaves the game; ordinary focus-loss protection must remain.
    for (let i = 0; i < 12 && (await focus(page)) !== "sound"; i++)
      await page.keyboard.press("Tab");
    assert.equal(await focus(page), "sound");
    const paused = await state(page);
    assert.equal(paused.mode, "paused");
    assert.deepEqual(paused.keys, []);
    await page.keyboard.up("ArrowUp");
    for (const [key, wantMuted] of [
      ["Enter", true],
      ["Space", false],
    ]) {
      await page.keyboard.press(key);
      assert.equal((await state(page)).sound.muted, wantMuted);
      assert.equal(await muted(page), wantMuted);
      assert.equal((await state(page)).mode, "paused");
      assert.equal(await focus(page), "sound");
    }
    assert.deepEqual((await state(page)).car, paused.car);
    assert.equal((await state(page)).lap.elapsed, paused.lap.elapsed);
    await page.locator("#resume").click();
    await page.keyboard.down("ArrowUp");
    await simulateFor(page, 0.15);
    assert.equal((await state(page)).mode, "running");
    assert.deepEqual((await state(page)).keys, ["ArrowUp"]);
    await page.keyboard.up("ArrowUp");
    check(
      "ready mouse toggle permits starting; Tab still pauses driving and native Enter/Space toggle once without starting or stealing button focus",
    );
  });

  for (const lifecycle of ["blur", "visibilitychange"])
    await isolated(async (page) => {
      await page.keyboard.press("Space");
      await page.keyboard.down("ArrowUp");
      await simulateFor(page, 0.2);
      await page.locator("#sound").click();
      assert.equal((await state(page)).mode, "running");
      // Deliver lifecycle events through the page API, without changing desktop focus.
      await page.evaluate((lifecycle) => {
        if (lifecycle === "blur") window.dispatchEvent(new Event("blur"));
        else {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            get: () => true,
          });
          try {
            document.dispatchEvent(new Event("visibilitychange"));
          } finally {
            delete document.hidden;
          }
        }
      }, lifecycle);
      const paused = await state(page);
      assert.equal(paused.mode, "paused");
      assert.deepEqual(paused.keys, []);
      assert.equal(paused.sound.running, false);
      await page.keyboard.up("ArrowUp");
      await page.waitForTimeout(220);
      assert.deepEqual((await state(page)).car, paused.car);
      assert.equal((await state(page)).lap.elapsed, paused.lap.elapsed);
      await page.waitForFunction(
        () => window.paperlapDebug.sound.motorGain < 0.001,
      );
      await page.keyboard.press("Space");
      assert.equal((await state(page)).mode, "running");
      assert.deepEqual((await state(page)).keys, []);
      await simulateFor(page, 0.1);
      check(
        `${lifecycle} after sound click still freezes timer/car, clears held input and silences motor until explicit resume`,
      );
    });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify({ headless: true, checks, errors, failedRequests }, null, 2),
  );
  await browser.close();
  console.log("Headless sound browser and all contexts closed");
}
