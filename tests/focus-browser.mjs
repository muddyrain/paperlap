import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { keyboardFocus, pointerFocus } from "./fixtures/focus-feedback.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const phase = process.env.PAPERLAP_FOCUS_BASELINE === "1" ? "before" : "after";
const output = fileURLToPath(
  new URL(`../test-results/focus-review/${phase}/`, import.meta.url),
);
await mkdir(output, { recursive: true });
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const checks = [],
  errors = [],
  failedRequests = [];
const state = (p) => p.evaluate(() => window.paperlapDebug);
const wait = (p) => p.waitForTimeout(380);
const focus = (p) => p.evaluate(() => document.activeElement?.id);
const shot = (p, name) => p.screenshot({ path: `${output}${name}.png` });
const check = (name) => {
  const label =
    phase === "before" ? `baseline capture path ${checks.length + 1}` : name;
  checks.push(label);
  console.log(`PASS ${label}`);
};
const keyboard = async (p) => {
  if (phase === "after") await keyboardFocus(p);
  else
    assert.equal(
      await p.evaluate(() => document.querySelector(".board").dataset.input),
      "keyboard",
    );
};
const pointer = async (p) => {
  if (phase === "after") await pointerFocus(p);
};
async function isolated(
  run,
  viewport = { width: 1366, height: 768 },
  options = {},
) {
  const context = await browser.newContext({ viewport, ...options });
  const p = await context.newPage();
  const video = p.video();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("requestfailed", (r) => failedRequests.push(r.url()));
  try {
    await p.goto(`${base}/?debug=1`);
    await p.waitForFunction(
      () => window.paperlapDebug && document.querySelector("#game canvas"),
    );
    await run(p);
  } finally {
    await context.close();
    if (video) {
      await video.saveAs(`${output}focus-flow.webm`);
      await video.delete();
    }
  }
}
try {
  await isolated(
    async (p) => {
      // Real Save V3 with two equivalent routes: focus movement must never select one.
      await p.locator("#sound").click();
      await p.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("paperlap.save.v3"));
        s.tracks.push({
          ...structuredClone(s.tracks[0]),
          uid: "focus-second",
          geometryIdentity: `g-${crypto.randomUUID().replaceAll("-", "")}`,
          track: { ...s.tracks[0].track, name: "弯道练习" },
        });
        localStorage.setItem("paperlap.save.v3", JSON.stringify(s));
      });
      await p.reload();
      await p.waitForFunction(
        () => window.paperlapDebug && document.querySelector("#game canvas"),
      );
      await p.locator("#pause").click();
      await wait(p);
      await pointer(p);
      assert.equal(await focus(p), "menu-continue");
      await shot(p, "mouse-menu");
      await p.keyboard.press("Tab");
      await p.keyboard.press("Tab");
      await keyboard(p);
      assert.equal(await focus(p), "menu-book");
      await shot(p, "keyboard-menu");
      check(
        "pointer opens with real default focus; Tab reveals a non-enclosing keyboard location",
      );
      await p.keyboard.press("Enter");
      await wait(p);
      await keyboard(p);
      const selected = (await state(p)).activeTrackUid;
      const border = await p
        .locator(`[data-uid="${selected}"]`)
        .evaluate((el) => getComputedStyle(el).borderColor);
      await p.keyboard.press("ArrowDown");
      await keyboard(p);
      assert.equal((await state(p)).activeTrackUid, selected);
      assert.equal(
        await p
          .locator('[data-uid="focus-second"]')
          .getAttribute("aria-current"),
        null,
      );
      if (phase === "after") {
        assert.equal(
          await p
            .locator(`[data-uid="${selected}"]`)
            .evaluate((el) => getComputedStyle(el).borderColor),
          border,
          "moving focus cannot recolor the actual selected card",
        );
      }
      await shot(p, "keyboard-book");
      await p.keyboard.press("Space");
      assert.equal((await state(p)).activeTrackUid, "focus-second");
      assert.equal((await state(p)).mode, "ready");
      check(
        "focus and saved selection remain independent; native Space selects without starting",
      );
      await p.keyboard.press("Escape");
      await wait(p);
      await p.locator("#menu-book").click();
      await wait(p);
      await pointer(p);
      await p.keyboard.press("Escape");
      await wait(p);
      assert.equal(await focus(p), "menu-book");
      await keyboard(p);
      await shot(p, "mixed-return");
      check(
        "mouse book click then Esc returns to the correct button with only a pencil marker",
      );
      await p.locator("#menu-controls").click();
      await wait(p);
      await pointer(p);
      await p.keyboard.press("Tab");
      await keyboard(p);
      await p.keyboard.press("Shift+Tab");
      await keyboard(p);
      assert.equal(await focus(p), "controls-back");
      await shot(p, "keyboard-controls");
      await p.keyboard.press("Enter");
      await wait(p);
      await keyboard(p);
      assert.equal(await focus(p), "menu-controls");
      check(
        "controls page Tab/Shift+Tab and native Enter retain visible focus and one-level return",
      );
      await p.locator("#menu-edit").click();
      await wait(p);
      const r = await p.locator(".draw-surface").boundingBox();
      await p.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.4);
      await p.mouse.down();
      await p.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.45);
      await p.mouse.up();
      await p.locator("#cancel-edit").click();
      await wait(p);
      assert.equal(await focus(p), "keep-drawing");
      await pointer(p);
      await p.keyboard.press("Tab");
      await keyboard(p);
      assert.equal(await focus(p), "discard-drawing");
      await shot(p, "keyboard-discard");
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).mode, "editing");
      await p.keyboard.press("Escape");
      await p.keyboard.press("Enter");
      assert.equal((await state(p)).mode, "editing");
      await p.locator("#cancel-edit").click();
      await p.locator("#discard-drawing").click();
      await wait(p);
      await pointer(p);
      assert.equal(await focus(p), "menu-edit");
      check(
        "draft default, Esc and native Enter keep drawing; explicit discard restores the original menu focus",
      );
      await p.keyboard.press("Escape");
      await wait(p);
      await p.locator("#pause").click();
      await wait(p);
      await pointer(p);
      await p.keyboard.press("Tab");
      await keyboard(p);
      await p.emulateMedia({ reducedMotion: "reduce" });
      await p.waitForFunction(() => window.paperlapDebug.motion.active === 0);
      await keyboard(p);
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).mode, "ready");
      assert.equal(await focus(p), "game");
      assert.equal(await p.locator("dialog[open]").count(), 0);
      check(
        "reopen and live reduced-motion preserve keyboard visibility, modal cleanup and no automatic start",
      );
    },
    { width: 1366, height: 768 },
    {
      recordVideo: {
        dir: `${output}raw-video`,
        size: { width: 1366, height: 768 },
      },
    },
  );
  for (const width of [1280, 900])
    await isolated(
      async (p) => {
        await p.keyboard.press("Escape");
        await wait(p);
        await keyboard(p);
        await p.keyboard.press("Tab");
        await p.keyboard.press("Tab");
        await keyboard(p);
        await shot(p, `keyboard-${width}`);
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).mode, "ready");
        check(
          `${width}px: keyboard marker fits without changing game geometry or starting`,
        );
      },
      { width, height: width === 1280 ? 800 : 700 },
    );
  await isolated(
    async (p) => {
      await p.keyboard.press("Escape");
      await keyboard(p);
      assert.equal((await state(p)).motion.active, 0);
      await p.keyboard.press("Tab");
      await keyboard(p);
      await shot(p, "forced-colors");
      check(
        "initial reduced-motion and forced colors preserve a visible non-enclosing focus cue",
      );
    },
    { width: 900, height: 700 },
    { reducedMotion: "reduce", forcedColors: "active" },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify(
      {
        phase,
        visualAssertions: phase === "after",
        headless: true,
        checks,
        errors,
        failedRequests,
      },
      null,
      2,
    ),
  );
  await browser.close();
  console.log("Headless focus browsers and contexts closed");
}
