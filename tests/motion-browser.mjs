import { keyboardFocus, pointerFocus } from "./fixtures/focus-feedback.mjs";
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
const output = fileURLToPath(
  new URL("../test-results/motion/", import.meta.url),
);
await mkdir(output, { recursive: true });
const record = process.env.PAPERLAP_RECORD === "1";
const checks = [],
  errors = [],
  failedRequests = [],
  clips = [],
  performanceSamples = [];
const state = (p) => p.evaluate(() => window.paperlapDebug);
const focus = (p) => p.evaluate(() => document.activeElement?.id);
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const raw = (p) => p.evaluate(() => localStorage.getItem("paperlap.save.v2"));
const wait = (p, ms = 440) => p.waitForTimeout(ms);
async function load(p) {
  await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function seed(p, save) {
  await p.evaluate(
    (s) => localStorage.setItem("paperlap.save.v2", JSON.stringify(s)),
    save,
  );
  await load(p);
}
async function isolated(
  name,
  run,
  viewport = { width: 1366, height: 768 },
  reducedMotion = "no-preference",
) {
  const context = await browser.newContext({
    viewport,
    reducedMotion,
    ...(record && name
      ? { recordVideo: { dir: `${output}raw-video`, size: viewport } }
      : {}),
  });
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("requestfailed", (r) => failedRequests.push(r.url()));
  const video = p.video();
  try {
    await load(p);
    await run(p);
  } finally {
    await context.close();
    if (video) {
      await video.saveAs(`${output}${name}.webm`);
      await video.delete();
      clips.push(`${name}.webm`);
    }
  }
}
async function draw(p) {
  const r = await p.locator(".draw-surface").boundingBox();
  const at = (a) => ({
    x: r.x + (a.x * r.width) / 1440,
    y: r.y + (a.y * r.height) / 860,
  });
  const points = wobblyLoop(),
    start = at(points[0]);
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  for (const point of points.slice(1)) {
    const a = at(point);
    await p.mouse.move(a.x, a.y);
  }
  await p.mouse.up();
  assert.equal(await p.locator("#drive-drawing").isEnabled(), true);
}
async function settled(p) {
  await p.waitForFunction(() => window.paperlapDebug.motion.active === 0);
  assert.equal(await p.locator(".motion-sheet,.motion-echo").count(), 0);
}
async function modal(p) {
  assert.equal(await p.locator("dialog[open]").count(), 1);
}
async function keyframes(p, name, selector, duration) {
  // Only pause presentation clocks for deterministic stills; videos below run real-time.
  for (const [phase, time] of [
    ["start", 0],
    ["middle", duration * 0.32],
    ["end", duration],
  ]) {
    await p.locator(selector).evaluate((el, time) => {
      for (const a of [
        ...el.getAnimations({ subtree: true }),
        ...[...document.querySelectorAll(".motion-crease")].flatMap((e) =>
          e.getAnimations(),
        ),
      ]) {
        a.pause();
        a.currentTime = time;
      }
    }, time);
    await p.screenshot({ path: `${output}${name}-${phase}.png` });
  }
  await p.locator(selector).evaluate((el) => {
    for (const a of [
      ...el.getAnimations({ subtree: true }),
      ...[...document.querySelectorAll(".motion-crease")].flatMap((e) =>
        e.getAnimations(),
      ),
    ])
      a.play();
  });
  await settled(p);
}
async function blockWrites(p) {
  await p.evaluate(() => {
    window.motionSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "paperlap.save.v2")
        throw new DOMException("full", "QuotaExceededError");
      return window.motionSetItem.call(this, k, v);
    };
  });
}
async function restoreWrites(p) {
  await p.evaluate(() => {
    Storage.prototype.setItem = window.motionSetItem;
  });
}
let ab;
try {
  await isolated("01-menu", async (p) => {
    const box = await p.locator("#game canvas").boundingBox();
    await p.keyboard.press("Space");
    await p.keyboard.down("ArrowUp");
    await wait(p, 600);
    await p.keyboard.press("Escape");
    await p.keyboard.up("ArrowUp");
    const frozen = await state(p);
    assert.equal(frozen.mode, "paused");
    await wait(p, 500);
    assert.deepEqual((await state(p)).car, frozen.car);
    assert.deepEqual((await state(p)).lap, frozen.lap);
    await p.keyboard.press("Escape");
    assert.equal((await state(p)).mode, "running");
    await wait(p, 400);
    await p.keyboard.press("Escape");
    await wait(p, 400);
    await p.locator("#menu-controls").click();
    await wait(p, 350);
    await p.keyboard.press("Escape");
    await wait(p, 350);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Space"); // quick pause
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press("Escape");
      await modal(p);
      await p.keyboard.press("Escape");
    }
    await settled(p);
    assert.equal(await focus(p), "game");
    assert.equal((await state(p)).mode, "paused");
    assert.deepEqual(await p.locator("#game canvas").boundingBox(), box);
    check(
      "menu choreography preserves immediate pause/resume, controls scope, repeated Esc and fixed Canvas geometry",
    );
  });
  await isolated("02-editor-return", async (p) => {
    await p.keyboard.press("Escape");
    await wait(p);
    await p.locator("#menu-edit").click();
    assert.equal((await state(p)).mode, "editing");
    assert.equal(await p.locator("#editor-title").innerText(), "编辑当前赛道");
    assert.equal(await focus(p), ""); // Canvas has no id; real editing target is focused.
    await wait(p, 700);
    await p.keyboard.press("Escape");
    await modal(p);
    await wait(p, 600);
    await p.keyboard.press("t");
    await wait(p);
    await p.keyboard.press("n");
    assert.equal(await p.locator("#editor-title").innerText(), "新建赛道");
    await wait(p, 600);
    await p.keyboard.press("Escape");
    await modal(p);
    await wait(p, 500);
    await p.keyboard.press("Escape");
    await modal(p);
    await p.keyboard.press("Escape");
    await settled(p);
    assert.equal((await state(p)).mode, "ready");
    check(
      "both edit intents reveal paper and cancel to the correct menu/book origin without writing",
    );
  });
  await isolated("03-save-discard", async (p) => {
    await p.keyboard.press("t");
    await wait(p);
    await p.keyboard.press("n");
    await wait(p);
    await draw(p);
    await wait(p, 500);
    await p.keyboard.press("Enter");
    assert.equal((await state(p)).mode, "ready");
    await wait(p, 750);
    assert.equal(
      await p.locator("#toast").getAttribute("data-feedback"),
      "saved",
    );
    ab = JSON.parse(await raw(p));
    assert.equal(ab.tracks.length, 2);
    await p.keyboard.press("e");
    await wait(p);
    await draw(p);
    await wait(p, 400);
    const saved = await raw(p);
    await p.keyboard.press("Escape");
    await wait(p, 450);
    assert.equal(await focus(p), "keep-drawing");
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#drive-drawing").isEnabled(), true);
    await wait(p, 350);
    await p.keyboard.press("Escape");
    await p.locator("#discard-drawing").click();
    await wait(p, 600);
    assert.equal(await raw(p), saved);
    assert.equal((await state(p)).mode, "ready");
    await p.keyboard.press("e");
    await wait(p);
    await draw(p);
    await p.keyboard.press("Enter");
    assert.equal((await state(p)).mode, "running");
    await wait(p, 600);
    await p.keyboard.press("Space");
    check(
      "new save stays ready, replace runs immediately, confirmation keeps candidate and explicit discard never writes",
    );
  });
  await isolated("04-track-switch", async (p) => {
    await seed(p, ab);
    await p.keyboard.press("Escape");
    await wait(p);
    await p.keyboard.press("t");
    await wait(p);
    for (const entry of [ab.tracks[0], ab.tracks[1], ab.tracks[0]]) {
      await p
        .locator(`[data-uid="${entry.uid}"] [data-action="select"]`)
        .click();
      assert.equal((await state(p)).activeTrackUid, entry.uid);
      assert.equal((await state(p)).mode, "ready");
      await wait(p, 650);
    }
    await p.keyboard.press("Escape");
    await modal(p);
    await wait(p, 500);
    await p.keyboard.press("Escape");
    await settled(p);
    check(
      "A/B changes celebrate committed tracks only and return to menu without automatic start",
    );
  });
  await isolated(null, async (p) => {
    await seed(p, ab);
    await p.keyboard.press("t");
    await wait(p);
    const before = await raw(p),
      s = await state(p);
    await blockWrites(p);
    const other = ab.tracks.find((t) => t.uid !== s.activeTrackUid);
    await p.locator(`[data-uid="${other.uid}"] [data-action="select"]`).click();
    assert.equal(await raw(p), before);
    assert.equal((await state(p)).activeTrackUid, s.activeTrackUid);
    assert.equal(await p.locator(".motion-sheet").count(), 0);
    assert.equal(
      await p.locator("#trackbook-status").getAttribute("data-kind"),
      "error",
    );
    await restoreWrites(p);
    await p.keyboard.press("Escape");
    await p.keyboard.press("e");
    await draw(p);
    await blockWrites(p);
    await p.keyboard.press("Enter"); // Existing replacement failure is playable but must not claim success.
    assert.equal(
      await p.locator("#toast").getAttribute("data-feedback"),
      "error",
    );
    assert.equal(
      await p
        .locator("#toast")
        .evaluate((el) => el.classList.contains("stamp")),
      false,
    );
    assert.equal(await raw(p), before);
    await restoreWrites(p);
    await settled(p);
    check(
      "failed switch/save preserve durable data and show no success stamp or switch sheet",
    );
  });
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 900, height: 700 },
  ])
    await isolated(
      null,
      async (p) => {
        const long = structuredClone(ab);
        long.tracks[0].track.name = "清晨绕湖的纸上飞驰练习赛道"
          .repeat(3)
          .slice(0, 40);
        long.activeTrackUid = long.tracks[0].uid;
        await seed(p, long);
        const canvas = await p.locator("#game canvas").boundingBox();
        await p.keyboard.press("Escape");
        await keyframes(p, `menu-${viewport.width}`, "#game-menu", 300);
        for (const id of [
          "menu-back",
          "menu-continue",
          "menu-restart",
          "menu-book",
          "menu-edit",
          "menu-sound",
          "menu-controls",
        ]) {
          const r = await p.locator(`#${id}`).boundingBox();
          assert.ok(
            r.x >= 0 &&
              r.y >= 0 &&
              r.x + r.width <= viewport.width + 1 &&
              r.y + r.height <= viewport.height + 1,
            id,
          );
        }
        await p.keyboard.press("e");
        assert.equal(await p.locator(".motion-sheet").count(), 1);
        await keyframes(p, `editor-${viewport.width}`, ".motion-sheet", 380);
        assert.deepEqual(await p.locator("#game canvas").boundingBox(), canvas);
        const r = await p.locator(".draw-surface").boundingBox();
        await p.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.4);
        await p.mouse.down();
        await p.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.4);
        await p.mouse.up();
        await p.keyboard.press("Escape");
        await modal(p);
        await keyframes(p, `discard-${viewport.width}`, "#game-menu", 300);
        await p.keyboard.press("Escape");
        assert.equal(
          await p
            .locator(".draw-surface")
            .evaluate((el) => el === document.activeElement),
          true,
        );
        check(
          `${viewport.width}x${viewport.height}: keyframes, long name, visible keycaps, fixed world geometry and safe discard focus`,
        );
      },
      viewport,
    );
  await isolated(null, async (p) => {
    await p.keyboard.press("e");
    const r = await p.locator(".draw-surface").boundingBox();
    await p.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.4);
    await p.mouse.down();
    assert.equal(await p.locator(".motion-sheet").count(), 0);
    await p.mouse.up();
    await p.keyboard.press("Escape");
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.waitForFunction(
      () =>
        window.paperlapDebug.motion.reduced &&
        window.paperlapDebug.motion.active === 0,
    );
    assert.equal((await state(p)).motion.active, 0);
    assert.equal(await p.locator(".motion-echo,.motion-sheet").count(), 0);
    await p.keyboard.press("Escape");
    await p.keyboard.press("r");
    assert.equal(await p.locator(".motion-sheet").count(), 0);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await modal(p);
    assert.equal(
      await p
        .locator("#game-menu")
        .evaluate((el) => el.getAnimations({ subtree: true }).length),
      0,
    );
    await p.screenshot({ path: `${output}reduced-motion-1366.png` });
    await p.keyboard.press("Escape");
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.waitForFunction(() => !window.paperlapDebug.motion.reduced);
    await p.keyboard.press("t");
    await p.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal((await state(p)).motion.active, 0);
    await modal(p);
    await p.keyboard.press("Escape");
    await settled(p);
    check(
      "touching drawing cancels old paper; live reduced-motion/blur settles visuals without changing modal intent",
    );
  });
  await isolated(null, async (p) => {
    await p.keyboard.press("Escape");
    await wait(p);
    await p.locator("#menu-sound").focus();
    await p.keyboard.down("Space");
    assert.equal(
      await p.locator("#menu-sound").getAttribute("data-pressed"),
      "true",
    );
    await p.keyboard.up("Space");
    await modal(p);
    await wait(p);
    await p.keyboard.press("Escape");
    await p
      .locator("#sound")
      .dispatchEvent("pointerdown", { pointerType: "touch", button: 0 });
    assert.equal(
      await p.locator("#sound").getAttribute("data-pressed"),
      "true",
    );
    await p.locator("#sound").dispatchEvent("pointercancel");
    await settled(p);
    for (let i = 0; i < 20; i++) {
      await p.keyboard.press("r");
      await p.keyboard.press("Escape");
      await p.keyboard.press("t");
      await p.keyboard.press("Escape");
      await p.keyboard.press("e");
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
    }
    await settled(p);
    assert.equal(await p.locator("dialog[open]").count(), 0);
    assert.equal(await focus(p), "game");
    assert.equal(await p.locator("[data-pressed]").count(), 0);
    check(
      "native keyboard/touch press feedback and 20 rapid route cycles leave no stale animation, focus or overlay",
    );
  });
  await isolated(
    null,
    async (p) => {
      assert.equal((await state(p)).motion.reduced, true);
      await p.keyboard.press("Escape");
      await modal(p);
      await p.keyboard.press("e");
      assert.equal(
        await p.locator(".motion-sheet,.motion-crease,.motion-echo").count(),
        0,
      );
      await draw(p);
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      assert.equal(await p.locator("#drive-drawing").isEnabled(), true);
      assert.equal((await state(p)).motion.active, 0);
      check(
        "initial reduced-motion keeps all menu/editor actions and candidate preservation without transient layers",
      );
    },
    { width: 1366, height: 768 },
    "reduce",
  );
  await isolated("06-focus-inputs", async (p) => {
    const pointerCue = () => pointerFocus(p);
    const keyboardCue = () => keyboardFocus(p);
    await p.locator("#pause").click();
    await wait(p);
    await pointerCue();
    assert.equal(await focus(p), "menu-continue");
    await p.screenshot({ path: `${output}focus-mouse.png` });
    await p.locator("#menu-controls").click();
    await wait(p);
    await pointerCue();
    await p.keyboard.press("Tab");
    await keyboardCue();
    await p.keyboard.press("Shift+Tab");
    await keyboardCue();
    await p.keyboard.press("Enter");
    await wait(p);
    await keyboardCue();
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await wait(p);
    await keyboardCue();
    await p.screenshot({ path: `${output}focus-keyboard.png` });
    await p.locator("#menu-book").click();
    await wait(p);
    await pointerCue();
    await p.keyboard.press("Escape");
    await wait(p);
    assert.equal(await focus(p), "menu-book");
    await keyboardCue();
    await p.keyboard.press("t");
    await wait(p);
    await keyboardCue();
    const selected = await p.locator("[aria-current]").getAttribute("data-uid");
    await p.locator("#new-track").click();
    await wait(p);
    await draw(p);
    await p.locator("#cancel-edit").click();
    await wait(p);
    await pointerCue();
    assert.equal(await focus(p), "keep-drawing");
    await p.keyboard.press("Tab");
    await keyboardCue();
    await p.keyboard.press("Shift+Tab");
    await keyboardCue();
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#drive-drawing").isEnabled(), true);
    await p.locator("#cancel-edit").click();
    await p.locator("#discard-drawing").click();
    await wait(p);
    await pointerCue();
    assert.equal(
      await p.locator("[aria-current]").getAttribute("data-uid"),
      selected,
    );
    await p.keyboard.press("Escape");
    await wait(p);
    await keyboardCue();
    await p.locator("#menu-back").click();
    await wait(p);
    await p.locator("#pause").click();
    await wait(p);
    await pointerCue();
    await p.keyboard.press("Tab");
    await keyboardCue();
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.waitForFunction(() => window.paperlapDebug.motion.active === 0);
    await keyboardCue();
    await p.keyboard.press("Escape");
    await settled(p);
    check(
      "mouse/keyboard focus stays distinct from press/selection across menu, controls, book, draft, reopen and reduced-motion",
    );
  });
  // Comparable foreground-page rAF samples; isolated headless, never OS foreground input.
  for (const rate of [1, 4])
    for (const reduced of ["no-preference", "reduce"])
      await isolated(null, async (p) => {
        const cdp = await p.context().newCDPSession(p);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        await p.emulateMedia({ reducedMotion: reduced });
        await settled(p);
        await p.evaluate(() => {
          window.motionPerf = {
            frames: [],
            inputs: [],
            firstFrame: [],
            max: 0,
          };
          let previous = performance.now();
          window.motionMeasure = true;
          const frame = (now) => {
            if (!window.motionMeasure) return;
            window.motionPerf.frames.push(now - previous);
            previous = now;
            window.motionPerf.max = Math.max(
              window.motionPerf.max,
              window.paperlapDebug.motion.active,
            );
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
          const starts = new WeakMap();
          window.motionListener = (event) =>
            starts.set(event, performance.now());
          window.motionEnd = (event) => {
            const begin = starts.get(event);
            if (begin === undefined) return;
            window.motionPerf.inputs.push(performance.now() - begin);
            requestAnimationFrame((now) =>
              window.motionPerf.firstFrame.push(performance.now() - begin),
            );
          };
          // End listeners run AFTER the actual handlers, including stopPropagation in dialog.
          window.addEventListener("keydown", window.motionListener, true);
          document
            .querySelector(".board")
            .addEventListener("keydown", window.motionEnd);
          document
            .querySelector("#game-menu")
            .addEventListener("keydown", window.motionEnd);
        });
        await wait(p, 800);
        const baseline = await p.evaluate(() => {
          const a = window.motionPerf.frames.splice(0);
          return a;
        });
        for (let i = 0; i < 10; i++) {
          await p.keyboard.press("Escape");
          await wait(p, 80);
          await p.keyboard.press("Escape");
          await wait(p, 80);
        }
        await settled(p);
        const menuInputs = await p.evaluate(() =>
          window.motionPerf.inputs.splice(0),
        );
        assert.equal(menuInputs.length, 20);
        for (let i = 0; i < 5; i++) {
          await p.keyboard.press("e");
          await wait(p, 100);
          await p.keyboard.press("Escape");
          await wait(p, 100);
        }
        await settled(p);
        const result = await p.evaluate(() => {
          window.motionMeasure = false;
          window.removeEventListener("keydown", window.motionListener, true);
          document
            .querySelector(".board")
            .removeEventListener("keydown", window.motionEnd);
          document
            .querySelector("#game-menu")
            .removeEventListener("keydown", window.motionEnd);
          return window.motionPerf;
        });
        const stats = (a) => {
          const s = a.slice().sort((x, y) => x - y);
          return {
            count: s.length,
            p50: s[Math.floor(s.length * 0.5)] || 0,
            p95: s[Math.floor(s.length * 0.95)] || 0,
            max: s.at(-1) || 0,
            over50: s.filter((x) => x > 50).length,
          };
        };
        performanceSamples.push({
          cpuRate: rate,
          reduced,
          baseline: stats(baseline),
          motion: stats(result.frames),
          menuInputMs: stats(menuInputs),
          editorInputMs: stats(result.inputs),
          firstFrameMs: stats(result.firstFrame),
          maxAnimations: result.max,
        });
        assert.equal(result.inputs.length, 10);
        assert.ok(result.max <= 18, "visual resources stay bounded");
        assert.ok(
          menuInputs.every((v) => v < 150),
          "menu input never waits for a 300ms animation",
        );
        await cdp.detach();
      });
  check(
    "normal/reduced at 1x/4x CPU: measured rAF/input latency and bounded resources, no animation waits",
  );
  await isolated("05-record", async (p) => {
    await p.keyboard.press("Space");
    const held = new Set();
    const until = Date.now() + 100000;
    const keys = async (wanted) => {
      for (const k of [...held])
        if (!wanted.includes(k)) {
          await p.keyboard.up(k);
          held.delete(k);
        }
      for (const k of wanted)
        if (!held.has(k)) {
          await p.keyboard.down(k);
          held.add(k);
        }
    };
    while (Date.now() < until) {
      const s = await state(p);
      if (s.lap.completed >= 1) break;
      assert.equal(s.lap.valid, true, "record uses real valid driving");
      const car = s.car,
        pts = s.track.points;
      let index = 0,
        distance = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(car.x - pts[i].x, car.y - pts[i].y);
        if (d < distance) {
          distance = d;
          index = i;
        }
      }
      const at = (o) => pts[(index + o + pts.length) % pts.length],
        a = at(0),
        b = at(6),
        c = at(12),
        u = { x: b.x - a.x, y: b.y - a.y },
        v = { x: c.x - b.x, y: c.y - b.y };
      const bend = Math.abs(
        Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y),
      );
      const speed = bend > 0.42 ? 190 : 220,
        target = at(Math.max(5, Math.round((car.speed * 0.29) / 8)));
      let angle = Math.atan2(target.y - car.y, target.x - car.x) - car.angle;
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      const wanted = [];
      if (angle > 0.035) wanted.push("ArrowRight");
      if (angle < -0.035) wanted.push("ArrowLeft");
      if (car.speed < speed) wanted.push("ArrowUp");
      if (car.speed > speed + 18) wanted.push("ArrowDown");
      await keys(wanted);
      await wait(p, 40);
    }
    await keys([]);
    assert.ok((await state(p)).lap.completed >= 1);
    assert.equal(
      await p.locator("#toast").getAttribute("data-feedback"),
      "record",
    );
    assert.ok(
      Object.values(JSON.parse(await raw(p)).records).some((t) => t > 5),
    );
    await p.screenshot({ path: `${output}record.png` });
    await wait(p, 900);
    await p.keyboard.press("Space");
    await settled(p);
    check(
      "real driven valid lap persists a new record, rewards HUD/star/stamp and keeps input usable",
    );
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify(
      {
        headless: true,
        record,
        checks,
        errors,
        failedRequests,
        clips,
        performanceSamples,
      },
      null,
      2,
    ),
  );
  if (record && clips.length) {
    const labels = [
      "驾驶中 Esc 菜单进出",
      "编辑与新建：进入、取消返回",
      "有效草稿：保存、继续与放弃",
      "A/B 真实赛道切换",
      "真实驾驶产生新纪录",
      "鼠标与键盘：焦点、按压与返回",
    ];
    const ordered = clips.slice().sort();
    await writeFile(
      `${output}review.html`,
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Paperlap P1-04B 动效实拍</title><style>body{font:16px/1.6 system-ui;background:#f9f1e2;color:#374553;max-width:1100px;margin:24px auto;padding:0 18px}video{width:100%;height:auto;background:#374553}section{margin:32px 0}h2{font-size:20px}a{color:#9d3d20}</style><h1>Paperlap · P1-04B 动效实拍</h1><p>真实生产构建与页面键鼠，独立无头 Chromium 录制。视频无自动播放，鼠标和 Tab 焦点采用不同反馈。请重点试玩菜单、编辑翻页、按压与纪录奖励，再决定是否合并。</p>${ordered.map((clip, i) => `<section><h2>${labels[i]}</h2><video controls loop muted playsinline preload="metadata" src="${clip}"></video><p><a href="${clip}">原始 WebM</a></p></section>`).join("")}<p><a href="report.json">专项检查与性能数据</a> · 重录：PAPERLAP_URL=http://127.0.0.1:4175 npm run record:motion</p></html>`,
    );
  }
  await browser.close();
  console.log("Headless motion browsers and contexts closed");
}
