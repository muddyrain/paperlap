import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { wobblyLoop } from "./fixtures/editor-paths.mjs";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = fileURLToPath(new URL("../test-results/menu/", import.meta.url));
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const state = (page) => page.evaluate(() => window.paperlapDebug);
const raw = (page) =>
  page.evaluate(() => localStorage.getItem("paperlap.save.v2"));
const focus = (page) => page.evaluate(() => document.activeElement?.id);
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function load(page) {
  await page.goto(`${base}/?debug=1`);
  await page.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function seed(page, save) {
  await page.evaluate(
    (save) => localStorage.setItem("paperlap.save.v2", JSON.stringify(save)),
    save,
  );
  await load(page);
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
    await load(page);
    await run(page);
  } finally {
    await context.close();
  }
}
async function simulate(page, seconds) {
  const until = (await state(page)).lap.elapsed + seconds;
  await page.waitForFunction(
    (until) => window.paperlapDebug.lap.elapsed >= until,
    until,
    { timeout: 20000, polling: "raf" },
  );
}
async function draw(page) {
  const r = await page.locator(".draw-surface").boundingBox();
  const at = (p) => ({
    x: r.x + (p.x * r.width) / 1440,
    y: r.y + (p.y * r.height) / 860,
  });
  const first = at(wobblyLoop()[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of wobblyLoop().slice(1)) {
    const q = at(p);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();
}
const menu = (page) => page.locator('#game-menu[data-layer="menu"]');
async function bookReady(page) {
  await page.locator('#trackbook[data-motion="open"]').waitFor();
}
async function oneModal(page) {
  assert.equal(await page.locator("dialog[open]").count(), 1);
}
async function frozen(page) {
  const s = await state(page);
  await page.waitForTimeout(180);
  assert.deepEqual((await state(page)).car, s.car);
  assert.deepEqual((await state(page)).lap, s.lap);
  assert.deepEqual(s.keys, []);
  return s;
}
let ab;
try {
  await isolated(async (page) => {
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    assert.equal(await page.locator("#menu-title").innerText(), "游戏菜单");
    assert.match(await page.locator("#menu-continue").innerText(), /开始试跑/);
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "ready");
    assert.equal(await focus(page), "game");
    await page.keyboard.press("Space");
    await page.keyboard.down("ArrowUp");
    await simulate(page, 0.3);
    await page.keyboard.down("Escape");
    await menu(page).waitFor();
    await page.keyboard.down("Escape");
    await page.keyboard.up("Escape");
    await oneModal(page);
    const paused = await frozen(page);
    await page.screenshot({ path: `${output}menu-running-1366.png` });
    assert.equal(paused.mode, "paused");
    assert.equal(
      await page.locator("#menu-time").innerText(),
      `本圈 ${await page.locator("#timer").innerText()}`,
    );
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "running");
    assert.equal(await focus(page), "game");
    await page.keyboard.down("ArrowUp"); // Still physically held: repeated keydown must not restore throttle.
    assert.deepEqual((await state(page)).keys, []);
    await simulate(page, 0.15);
    assert.ok((await state(page)).car.speed < paused.car.speed);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.down("ArrowUp");
    assert.deepEqual((await state(page)).keys, ["ArrowUp"]);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("Space");
    assert.equal((await state(page)).mode, "paused");
    assert.equal(await page.locator("#game-menu").isVisible(), false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "paused");
    await page.keyboard.press("Space");
    await page.locator("#pause").click();
    await menu(page).waitFor();
    assert.equal((await state(page)).mode, "paused");
    await page.locator("#menu-continue").click();
    assert.equal((await state(page)).mode, "running");
    check(
      "ready/paused never auto-start; running Esc and pause button share menu; qualified Esc resumes without held-repeat throttle; Space stays quick",
    );
  });

  await isolated(async (page) => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    await bookReady(page);
    await oneModal(page);
    await page.keyboard.press("n");
    await draw(page);
    await page.keyboard.press("Enter");
    assert.equal((await state(page)).mode, "ready");
    ab = JSON.parse(await raw(page));
    const [a, b] = ab.tracks;
    ab.records[`${a.uid}:${a.track.id}:rules-2`] = 24.68;
    ab.records[`${b.uid}:${b.track.id}:rules-2`] = 35;
    await seed(page, ab);
    await page.keyboard.press("Space");
    await page.keyboard.down("ArrowUp");
    await simulate(page, 0.2);
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    await bookReady(page);
    await page.locator(`[data-uid="${a.uid}"] [data-action="rename"]`).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#trackbook-list").isVisible(), true);
    await page.locator(`[data-uid="${a.uid}"] [data-action="select"]`).click();
    assert.equal((await state(page)).activeTrackUid, a.uid);
    assert.equal((await state(page)).mode, "ready");
    assert.equal(await page.locator("#best").innerText(), "00:24.68");
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    await oneModal(page);
    assert.equal(await focus(page), "menu-book");
    await page.screenshot({ path: `${output}book-return-1366.png` });
    assert.equal(await page.locator("#menu-track").innerText(), a.track.name);
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "ready");
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("t");
    await bookReady(page);
    await page.keyboard.press("Escape");
    await page.locator("#trackbook").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#game-menu").isVisible(), false);
    assert.equal(await focus(page), "game");
    await load(page);
    assert.equal((await state(page)).activeTrackUid, a.uid);
    assert.equal(await page.locator("#best").innerText(), "00:24.68");
    check(
      "menu→book→real A/B selection returns to menu and stays ready; direct T returns to game; best and selection survive refresh",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    const saved = await raw(page);
    await page.keyboard.press("Space");
    await page.keyboard.down("ArrowUp");
    await simulate(page, 0.2);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("Space");
    const original = await state(page);
    const originalTime = await page.locator("#timer").innerText();
    await page.keyboard.press("Escape");
    await page.keyboard.press("e");
    assert.equal((await state(page)).mode, "editing");
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    assert.equal(await focus(page), "menu-edit");
    await page.keyboard.press("e");
    await draw(page);
    const draft = await page
      .locator(".draw-surface")
      .evaluate((el) => el.toDataURL());
    await page.keyboard.press("Escape");
    await page.locator('#game-menu[data-layer="discard"]').waitFor();
    await oneModal(page);
    assert.equal(await focus(page), "keep-drawing");
    assert.equal(
      await page.locator("#menu-time").innerText(),
      `本圈 ${originalTime}`,
    );
    assert.equal((await state(page)).mode, "editing");
    assert.equal(await raw(page), saved);
    await page.keyboard.press("Escape");
    assert.equal(
      await focus(page),
      (await page.locator(".draw-surface").getAttribute("id")) || "",
    );
    assert.equal(
      await page.locator(".draw-surface").evaluate((el) => el.toDataURL()),
      draft,
    );
    assert.equal(await page.locator("#drive-drawing").isEnabled(), true);
    await page.locator("#cancel-edit").click();
    await page.locator("#discard-drawing").click();
    await menu(page).waitFor();
    assert.equal(await raw(page), saved);
    assert.equal((await state(page)).mode, "paused");
    assert.deepEqual((await state(page)).car, original.car);
    assert.deepEqual((await state(page)).lap, original.lap);
    await page.keyboard.press("t");
    await bookReady(page);
    await page.keyboard.press("n");
    await draw(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter"); // Safe default continues drawing.
    assert.equal((await state(page)).mode, "editing");
    assert.equal(await page.locator("#drive-drawing").isEnabled(), true);
    await page.keyboard.press("Escape");
    await page.locator("#discard-drawing").click();
    await bookReady(page);
    await oneModal(page);
    assert.equal(await raw(page), saved);
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "paused");
    assert.deepEqual((await state(page)).car, original.car);
    assert.deepEqual((await state(page)).lap, original.lap);
    check(
      "empty cancel returns to menu; valid drafts survive Esc/default Enter confirmation; explicit discard returns through menu/book without writes",
    );
  });

  await isolated(async (page) => {
    await page.keyboard.press("Space");
    await page.keyboard.down("ArrowUp");
    await simulate(page, 0.2);
    await page.keyboard.press("Escape");
    await page.keyboard.up("ArrowUp");
    await page.locator("#menu-controls").click();
    assert.equal(await page.locator("#menu-controls-page").isVisible(), true);
    await page.keyboard.press("t");
    assert.equal(await page.locator("#trackbook").isVisible(), false);
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    assert.equal(await focus(page), "menu-controls");
    await page.keyboard.press("Tab");
    assert.equal(await focus(page), "menu-back");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await focus(page), "menu-controls");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
      assert.equal(
        await page
          .locator("#game-menu")
          .evaluate((el) => el.contains(document.activeElement)),
        true,
      );
    }
    await page.locator("#menu-sound").focus();
    const saved = JSON.parse(await raw(page));
    await page.keyboard.press("Space");
    assert.equal((await state(page)).sound.muted, !saved.muted);
    await oneModal(page);
    assert.equal((await state(page)).mode, "paused");
    assert.equal(await focus(page), "menu-sound");
    await page.keyboard.press("Enter");
    assert.equal((await state(page)).sound.muted, saved.muted);
    assert.equal((await state(page)).mode, "paused");
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
      { repeat: true },
    ])
      await page.locator("#menu-sound").evaluate(
        (el, extra) =>
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              code: "KeyR",
              bubbles: true,
              ...extra,
            }),
          ),
        extra,
      );
    await menu(page).waitFor();
    await frozen(page);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "menu-test-input";
      document.querySelector("#game-menu").append(input);
    });
    await page.locator("#menu-test-input").focus();
    await page.keyboard.type("rte ");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#menu-test-input").inputValue(), "rte ");
    await menu(page).waitFor();
    await page.locator("#menu-test-input").evaluate((el) => el.remove());
    await page.locator("#menu-restart").focus();
    await page.keyboard.press("r");
    assert.equal((await state(page)).mode, "running");
    assert.equal(await focus(page), "game");
    check(
      "controls is one-level return; modal Tab, native sound Space/Enter, IME/modifiers/text/repeat protection and real menu R work",
    );
  });

  for (const lifecycle of ["blur", "visibilitychange", "resize"])
    await isolated(async (page) => {
      await page.keyboard.press("Space");
      await page.keyboard.press("Escape");
      await menu(page).waitFor();
      if (lifecycle === "resize")
        await page.setViewportSize({ width: 1280, height: 800 });
      else
        await page.evaluate((lifecycle) => {
          if (lifecycle === "blur") window.dispatchEvent(new Event("blur"));
          else {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              get: () => true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
            delete document.hidden;
          }
        }, lifecycle);
      await page.waitForFunction(() =>
        document.querySelector("#menu-hint").textContent.includes("不会起跑"),
      );
      await page.keyboard.press("Escape");
      assert.equal((await state(page)).mode, "paused");
      await frozen(page);
      await page.keyboard.press("Space");
      assert.equal((await state(page)).mode, "running");
      check(
        `${lifecycle} revokes menu resume eligibility; focus/close cannot start until explicit Space`,
      );
    });

  await isolated(async (page) => {
    await seed(page, ab);
    const saved = await raw(page);
    await page.keyboard.press("Space");
    await page.keyboard.down("ArrowUp");
    await simulate(page, 0.2);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      window.restoreMenuStorage = () => {
        Storage.prototype.setItem = set;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "paperlap.save.v2")
          throw new DOMException("injected", "QuotaExceededError");
        return set.call(this, key, value);
      };
    });
    await page.locator("#menu-sound").click();
    assert.match(await page.locator("#menu-status").innerText(), /未能保存/);
    assert.equal(await raw(page), saved);
    assert.equal((await state(page)).mode, "paused");
    await page.keyboard.press("t");
    await bookReady(page);
    await page
      .locator(`[data-uid="${ab.tracks[0].uid}"] [data-action="select"]`)
      .click();
    assert.match(
      await page.locator("#trackbook-status").innerText(),
      /未能保存/,
    );
    assert.equal((await state(page)).activeTrackUid, ab.activeTrackUid);
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "paused");
    await page.evaluate(() => window.restoreMenuStorage());
    check(
      "menu sound and track selection write failures stay visible, preserve durable data and cannot restore stale driving",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    await bookReady(page);
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        set.call(this, key, value);
        Storage.prototype.setItem = set;
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function () {
          HTMLCanvasElement.prototype.getContext = get;
          throw Error("injected canvas failure");
        };
      };
    });
    await page
      .locator(`[data-uid="${ab.tracks[0].uid}"] [data-action="select"]`)
      .click();
    assert.equal(await page.locator("#recovery").isVisible(), true);
    assert.equal(
      await page.locator(".motion-sheet,.motion-crease,.motion-echo").count(),
      0,
    );
    assert.equal(
      await page
        .locator(".motion-shade")
        .evaluate((el) => getComputedStyle(el).opacity),
      "0",
    );
    assert.equal(await page.locator("dialog[open]").count(), 0);
    // Space on the focused reload button is an explicit native reload, not a game shortcut.
    for (const key of ["Escape", "r", "t", "e"]) await page.keyboard.press(key);
    await page.locator("#game").evaluate((el) => {
      for (const code of ["Escape", "Space", "KeyR", "KeyT", "KeyE"])
        el.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    });
    assert.equal((await state(page)).mode, "paused");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.deepEqual((await state(page)).keys, []);
    await page.locator("#reload").click();
    await page.waitForFunction(() => window.paperlapDebug?.mode === "ready");
    assert.equal((await state(page)).activeTrackUid, ab.tracks[0].uid);
    check(
      "post-write scene failure clears modal/return stack; every shortcut stays blocked until durable reload",
    );
  });

  await isolated(async (page) => {
    const long = structuredClone(ab);
    long.tracks[1].track.name = "清晨绕湖的纸上飞驰练习赛道"
      .repeat(3)
      .slice(0, 40);
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1280, height: 800 },
      { width: 900, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await seed(page, long);
      const canvas = await page.locator("#game canvas").boundingBox();
      await page.keyboard.press("Escape");
      assert.deepEqual(
        await page.locator("#game canvas").boundingBox(),
        canvas,
      );
      await oneModal(page);
      assert.equal(
        await page.locator("#menu-track").getAttribute("title"),
        long.tracks[1].track.name,
      );
      for (const button of await page
        .locator("#game-menu button:visible")
        .all()) {
        await button.scrollIntoViewIfNeeded();
        const r = await button.boundingBox();
        assert.ok(
          r.x >= 0 &&
            r.y >= 0 &&
            r.x + r.width <= viewport.width &&
            r.y + r.height <= viewport.height,
        );
        if (await button.locator("kbd").count())
          assert.ok(
            (await button.locator("svg").count()) &&
              (await button.getAttribute("aria-keyshortcuts")),
          );
      }
      await page.screenshot({ path: `${output}menu-${viewport.width}.png` });
      await page.locator("#menu-controls").click();
      await page.screenshot({
        path: `${output}controls-${viewport.width}.png`,
      });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("e");
      await draw(page);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${output}discard-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      await page.keyboard.press("r");
      await page.keyboard.press("Escape"); // Empty draft safely exits.
      check(
        `${viewport.width}×${viewport.height}: long name, all menu buttons/keycaps, controls and discard confirmation fit without changing canvas`,
      );
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("Escape");
    await menu(page).waitFor();
    assert.equal(
      await page
        .locator("#game-menu")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    await page.screenshot({ path: `${output}reduced-motion-900.png` });
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "ready");
    check(
      "reduced-motion menu is immediately usable, no delayed close or automatic start",
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
  console.log("Headless menu browser and all contexts closed");
}
