import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
});
const page = await context.newPage();
const root = fileURLToPath(new URL("../test-results/", import.meta.url));
await mkdir(root, { recursive: true });
const errors = [],
  checks = [],
  samples = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const state = () => page.evaluate(() => window.paperlapDebug);
const wait = (ms) => page.waitForTimeout(ms);
async function simulateFor(seconds) {
  const until = (await state()).lap.elapsed + seconds;
  await page.waitForFunction(
    (until) => window.paperlapDebug.lap.elapsed >= until,
    until,
    { timeout: 6000, polling: "raf" },
  );
}
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  await page.goto(
    `${process.env.PAPERLAP_URL || "http://127.0.0.1:5173"}/?debug=1`,
  );
  await page.waitForFunction(
    () => !!window.paperlapDebug && document.querySelector("#game canvas"),
  );
  const track = (await state()).track;
  const oldKey = `${track.id}:rules-1`;
  await page.evaluate(
    ({ track, oldKey }) =>
      localStorage.setItem(
        "paperlap.save.v1",
        JSON.stringify({
          schemaVersion: 1,
          rulesVersion: 1,
          track,
          muted: false,
          records: { [oldKey]: 24.68 },
        }),
      ),
    { track, oldKey },
  );
  await page.reload();
  await page.waitForFunction(
    () => !!window.paperlapDebug && document.querySelector("#game canvas"),
  );
  assert.equal((await state()).trackId, track.id);
  assert.equal(await page.locator("#best").innerText(), "--:--.--");
  assert.equal(await page.locator("#sound").getAttribute("aria-label"), "静音");
  await page.locator("#sound").click();
  check(
    "legacy save keeps track/preferences without applying the old physics record",
  );

  await page.locator("#start").click();
  await page.keyboard.down("ArrowUp");
  await simulateFor(1.7);
  await page.keyboard.down("ArrowRight");
  await simulateFor(0.14);
  const locked = await state();
  assert.ok(
    locked.car.steering > 0.9,
    "direction should build promptly through real input",
  );
  await page.keyboard.up("ArrowRight");
  await simulateFor(0.14);
  assert.ok(
    Math.abs((await state()).car.steering) < 0.05,
    "direction should release promptly",
  );
  await page.keyboard.up("ArrowUp");
  check("real direction input builds and releases promptly at driving speed");
  await page.keyboard.press("r");

  // A test driver observes state and sends keyboard events, never sets vehicle state.
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
  let completed = 0,
    coastSamples = 0,
    maxSpeed = 0;
  const deadline = Date.now() + 65000;
  while (Date.now() < deadline) {
    const s = await state(),
      car = s.car,
      points = s.track.points;
    if (s.lap.completed >= 2) {
      completed = s.lap.completed;
      break;
    }
    let index = 0,
      distance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.hypot(car.x - points[i].x, car.y - points[i].y);
      if (d < distance) {
        distance = d;
        index = i;
      }
    }
    const at = (offset) =>
      points[(index + offset + points.length) % points.length];
    const a = at(0),
      b = at(6),
      c = at(12),
      u = { x: b.x - a.x, y: b.y - a.y },
      v = { x: c.x - b.x, y: c.y - b.y };
    const bend = Math.abs(
      Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y),
    );
    const targetSpeed = bend > 0.42 ? 190 : 220;
    const target = at(Math.max(5, Math.round((car.speed * 0.29) / 8)));
    let angle = Math.atan2(target.y - car.y, target.x - car.x) - car.angle;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    const wanted = [];
    if (angle > 0.035) wanted.push("ArrowRight");
    if (angle < -0.035) wanted.push("ArrowLeft");
    if (car.speed < targetSpeed) wanted.push("ArrowUp");
    if (car.speed > targetSpeed + 18) wanted.push("ArrowDown");
    if (!wanted.includes("ArrowUp") && bend > 0.42) coastSamples++;
    maxSpeed = Math.max(maxSpeed, car.speed);
    samples.push({
      x: car.x,
      y: car.y,
      speed: car.speed,
      valid: s.lap.valid,
      lap: s.lap.completed,
    });
    assert.equal(
      s.lap.valid,
      true,
      "corner driver must stay on road through consecutive laps",
    );
    await keys(wanted);
    await wait(40);
  }
  await keys([]);
  assert.equal(completed, 2);
  assert.ok(maxSpeed > 210);
  assert.ok(coastSamples > 0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("paperlap.save.v1")),
  );
  assert.equal(saved.records[oldKey], 24.68);
  assert.ok(saved.records[`${track.id}:rules-2`] > 5);
  assert.equal(errors.length, 0);
  await page.screenshot({ path: `${root}handling-v2.png` });
  await page.keyboard.press("Escape");
  check(
    "two valid laps use higher speed on broad bends and lift before tighter turns",
  );
  check(
    "new best uses rules-2 while the original rules-1 record remains saved",
  );
} finally {
  await writeFile(
    `${root}handling-report.json`,
    JSON.stringify({ headless: true, checks, errors, samples }, null, 2),
  );
  await page.close();
  await context.close();
  await browser.close();
  console.log("Headless handling browser and context closed");
}
