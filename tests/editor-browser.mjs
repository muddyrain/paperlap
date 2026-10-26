import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { screenshotLoop, wobblyLoop } from "./fixtures/editor-paths.mjs";

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
const output = fileURLToPath(
  new URL("../test-results/editor/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("requestfailed", (request) => failedRequests.push(request.url()));
const state = () => page.evaluate(() => window.paperlapDebug);
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const shot = (name) => page.screenshot({ path: `${output}${name}.png` });
async function draw(points, beforeRelease) {
  const r = await page.locator(".draw-surface").boundingBox();
  const at = (p) => ({
    x: r.x + (p.x * r.width) / 1440,
    y: r.y + (p.y * r.height) / 860,
  });
  const first = at(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const p = at(point);
    await page.mouse.move(p.x, p.y);
  }
  if (beforeRelease) await beforeRelease();
  await page.mouse.up();
}
try {
  await page.goto(
    `${process.env.PAPERLAP_URL || "http://127.0.0.1:5173"}/?debug=1`,
  );
  await page.waitForFunction(
    () => !!window.paperlapDebug && document.querySelector("#game canvas"),
  );
  const original = (await state()).trackId;
  await page.locator("#edit").click();
  await page.keyboard.press("Enter");
  assert.equal((await state()).mode, "editing");
  assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
  for (const [id, key] of [
    ["redraw", "R"],
    ["drive-drawing", "Enter"],
    ["cancel-edit", "Escape"],
  ]) {
    assert.equal(
      await page.locator(`#${id}`).getAttribute("aria-keyshortcuts"),
      key,
    );
    assert.ok(await page.locator(`#${id} kbd`).isVisible());
  }
  await shot("empty-shortcuts");
  check("editor shows keycaps; Enter cannot start an empty draft");
  await draw(screenshotLoop, async () => {
    assert.match(
      await page.locator("#editor-status").innerText(),
      /已回到起点.*松开/,
    );
    await shot("ready-to-close");
  });
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await shot("screenshot-loop-valid");
  check(
    "real pointer draws screenshot-style loop and shows closure guidance before release",
  );

  await page.keyboard.down("r");
  assert.ok(await page.locator("#draw-intro").isVisible());
  await draw(wobblyLoop());
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await page.keyboard.down("r"); // Repeated keydown must not destroy the new draft.
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await page.keyboard.up("r");
  check("R redraws a preview; held-key repeats preserve the next draft");

  // Browser/text editing shortcuts keep their ordinary behavior inside the board.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "test-input";
    input.setAttribute("aria-label", "测试输入框");
    input.style.cssText = "position:absolute;z-index:10;top:120px;left:30px";
    document.querySelector(".board").append(input);
  });
  await page.locator("#test-input").focus();
  await page.keyboard.type("r");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#test-input").inputValue(), "r");
  assert.equal((await state()).mode, "editing");
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await page.locator(".draw-surface").focus();
  assert.equal(
    await page.locator(".draw-surface").evaluate((canvas) =>
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyR",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
    true,
  );
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await page.locator("#test-input").evaluate((input) => input.remove());
  check("text fields and modified shortcuts do not trigger editor actions");
  await page.locator("#cancel-edit").focus();
  await page.keyboard.press("Enter");
  assert.equal((await state()).trackId, original);
  assert.equal((await state()).mode, "ready");
  check(
    "Enter on a focused button retains its native action; cancelling restores old track",
  );

  await page.locator("#edit").click();
  await draw(wobblyLoop().slice(0, 145));
  assert.match(await page.locator("#editor-status").innerText(), /终点/);
  await page.keyboard.press("Enter");
  assert.equal((await state()).mode, "editing");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("paperlap.save.v1")),
    null,
  );
  await page.keyboard.press("r");
  // Interrupt a captured drag and then draw again, using only page API events.
  let rect = await page.locator(".draw-surface").boundingBox();
  await page.mouse.move(
    rect.x + rect.width * 0.35,
    rect.y + rect.height * 0.45,
  );
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width * 0.45,
    rect.y + rect.height * 0.35,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  assert.match(await page.locator("#editor-status").innerText(), /中断/);
  await draw(screenshotLoop);
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await page.keyboard.press("r");
  rect = await page.locator(".draw-surface").boundingBox();
  await page.mouse.move(
    rect.x + rect.width * 0.35,
    rect.y + rect.height * 0.45,
  );
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width * 0.45,
    rect.y + rect.height * 0.35,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.mouse.up();
  assert.match(await page.locator("#editor-status").innerText(), /中断/);
  await draw(screenshotLoop);
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  await page.keyboard.press("r");
  rect = await page.locator(".draw-surface").boundingBox();
  await page.mouse.move(
    rect.x + rect.width * 0.35,
    rect.y + rect.height * 0.45,
  );
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width * 0.45,
    rect.y + rect.height * 0.35,
  );
  await page.keyboard.press("r");
  await page.mouse.up();
  assert.ok(await page.locator("#draw-intro").isVisible());
  await draw(screenshotLoop);
  assert.ok(await page.locator("#drive-drawing").isEnabled());
  check(
    "invalid drafts cannot start/save; blur, resize and R during drag recover without stuck capture",
  );
  await page.keyboard.press("Enter");
  assert.equal((await state()).mode, "running");
  const accepted = (await state()).trackId;
  assert.notEqual(accepted, original);
  const car = (await state()).car;
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowUp");
  assert.ok(
    Math.hypot((await state()).car.x - car.x, (await state()).car.y - car.y) >
      5,
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.paperlapDebug.mode === "paused");
  const paused = await state();
  await page.locator("#edit").click();
  await draw(wobblyLoop());
  await page.keyboard.press("Escape");
  const restored = await state();
  assert.equal(restored.trackId, accepted);
  assert.deepEqual(restored.car, paused.car);
  assert.deepEqual(restored.lap, paused.lap);
  assert.equal(restored.mode, "paused");
  check(
    "Enter starts an accepted track with keyboard control; Esc restores prior driving state",
  );

  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
    [900, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("#edit").click();
    await draw(wobblyLoop(Math.PI / 2));
    assert.ok(await page.locator("#drive-drawing").isEnabled());
    const bounds = await page.locator("#editor-footer").evaluate((footer) =>
      [...footer.querySelectorAll("button")].map((button) => {
        const r = button.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (const box of bounds) {
      assert.ok(
        box.left >= 0 &&
          box.right <= width &&
          box.top >= 0 &&
          box.bottom <= height,
      );
    }
    assert.ok(
      bounds[0].right < bounds[1].left && bounds[1].right < bounds[2].left,
    );
    await shot(`shortcuts-${width}`);
    await page.keyboard.press("Escape");
  }
  check(
    "hand-drawn wobble and shortcut buttons work at all three desktop sizes",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  check("no console errors or failed resource requests");
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify({ headless: true, checks, errors, failedRequests }, null, 2),
  );
  await page.close();
  await context.close();
  await browser.close();
  console.log("Headless editor browser and context closed");
}
