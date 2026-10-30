import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { localGameFixtures } from "./fixtures/local-game.mjs";
import { keyboardFocus } from "./fixtures/focus-feedback.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:4186",
  output = "test-results/local-game";
await mkdir(`${output}/video`, { recursive: true });
const report = {
  headless: true,
  checks: [],
  errors: [],
  failedRequests: [],
  layouts: [],
  video: null,
};
const check = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const state = async (p) => {
  const { value, ariaBusy } = await p.evaluate(() => ({
    value: window.paperlapDebug,
    ariaBusy: document.querySelector("#local-editor").getAttribute("aria-busy"),
  }));
  if (!value.local.busy && (!value.local.active || ariaBusy === "false"))
    return value;
  await p.waitForFunction(
    () =>
      !paperlapDebug.local.busy &&
      (!paperlapDebug.local.active ||
        document.querySelector("#local-editor").getAttribute("aria-busy") ===
          "false"),
  );
  return p.evaluate(() => window.paperlapDebug);
};
const raw = (p, key = "paperlap.save.v3") =>
  p.evaluate((k) => localStorage.getItem(k), key);
async function load(p) {
  await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function isolated(
  run,
  {
    shape = "wide",
    width = 1366,
    height = 768,
    record = false,
    reduced = false,
    extra = {},
  } = {},
) {
  const seed = { ...localGameFixtures[shape], ...extra },
    c = await browser.newContext({
      viewport: { width, height },
      reducedMotion: reduced ? "reduce" : "no-preference",
      ...(record
        ? { recordVideo: { dir: `${output}/video`, size: { width, height } } }
        : {}),
    });
  let video;
  try {
    await c.addInitScript((seed) => {
      if (
        !/^https?:$/.test(location.protocol) ||
        localStorage.getItem("local-game-test-seeded")
      )
        return;
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      localStorage.setItem("local-game-test-seeded", "1");
    }, seed);
    c.on("page", (p) => {
      p.on("pageerror", (e) => report.errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") report.errors.push(m.text());
      });
      p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
    });
    const p = await c.newPage();
    if (record) video = p.video();
    await load(p);
    await run(p, c, seed);
  } finally {
    await c.close();
    if (video) {
      await video.saveAs(`${output}/local-game-playthrough.webm`);
      report.video = `${output}/local-game-playthrough.webm`;
    }
  }
}
async function enter(p) {
  await p.locator("#local-edit").click();
  assert.equal((await state(p)).local.active, true);
}
const left = (s) =>
  s.local.current.reduce((a, p, i) => (p.x < s.local.current[a].x ? i : a), 0);
const top = (s) =>
  s.local.current.reduce((a, p, i) => (p.y < s.local.current[a].y ? i : a), 0);
async function at(p, q) {
  const r = await p.locator(".local-surface").boundingBox();
  return { x: r.x + (q.x * r.width) / 1440, y: r.y + (q.y * r.height) / 860 };
}
async function begin(p, index) {
  const q = (await state(p)).local.current[index],
    a = await at(p, q);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  assert.equal((await state(p)).local.dragging, true);
  return q;
}
async function move(p, q, delta, steps = 16) {
  const a = await at(p, { x: q.x + delta.x, y: q.y + delta.y });
  await p.mouse.move(a.x, a.y, { steps });
}
async function drag(p, index, delta) {
  const count = (await state(p)).local.metrics.validations,
    q = await begin(p, index);
  await move(p, q, delta);
  assert.equal((await state(p)).local.metrics.validations, count);
  await p.mouse.up();
  assert.equal((await state(p)).local.metrics.validations, count + 1);
  return state(p);
}
const modifier = (p) =>
  p.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));
async function originals(p, seed) {
  for (const k of [
    "paperlap.save.v1",
    "paperlap.save.v2",
    "paperlap.draft.v1",
    "paperlap.draft.v2",
  ])
    assert.equal(await raw(p, k), seed[k], k);
}
async function layout(p, name) {
  await p
    .locator("#local-editor")
    .evaluate(async (e) =>
      Promise.all(
        e
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      ),
    );
  const r = await p.evaluate(() => {
    const rect = (s) =>
      document.querySelector(s).getBoundingClientRect().toJSON();
    return {
      board: rect(".board"),
      heading: rect(".local-heading"),
      footer: rect(".local-footer"),
      buttons: [...document.querySelectorAll(".local-actions button")].map(
        (e) => ({ id: e.id, ...e.getBoundingClientRect().toJSON() }),
      ),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(r.overflow, false);
  for (const b of [r.heading, r.footer, ...r.buttons])
    assert.ok(
      b.left >= r.board.left - 0.5 &&
        b.right <= r.board.right + 0.5 &&
        b.top >= r.board.top - 0.5 &&
        b.bottom <= r.board.bottom + 0.5,
      `${name} within board ${JSON.stringify(b)}`,
    );
  for (let i = 1; i < r.buttons.length; i++)
    assert.ok(
      r.buttons[i].left >= r.buttons[i - 1].right - 1,
      `${name} controls overlap`,
    );
  report.layouts.push({ name, ...r });
}
async function choose(p, uid) {
  await p.locator("#trackbook-open").click();
  await p.locator(`[data-uid="${uid}"] [data-action="select"]`).click();
  await p.keyboard.press("Escape");
}
async function block(p, key, method = "setItem") {
  await p.evaluate(
    ({ key, method }) => {
      const old = Storage.prototype[method];
      window.restoreLocalTest = () => (Storage.prototype[method] = old);
      Storage.prototype[method] = function (k, ...args) {
        if (k === key)
          throw new DOMException("test failure", "QuotaExceededError");
        return old.call(this, k, ...args);
      };
    },
    { key, method },
  );
}
async function restore(p) {
  await p.evaluate(() => window.restoreLocalTest?.());
}
async function adoptOne(p) {
  await drag(p, left(await state(p)), { x: -12, y: 0 });
  await p.keyboard.press("Enter");
  assert.equal((await state(p)).local.dirty, true);
}
async function completeLap(p) {
  await p.locator("#start").click();
  const held = new Set();
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
  try {
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      const s = await state(p);
      if (
        s.lap.completed >= 1 &&
        (await p.locator("#best").innerText()) !== "--:--.--"
      )
        return;
      const points = s.track.points,
        car = s.car;
      let index = 0,
        d = Infinity;
      points.forEach((p, i) => {
        const n = Math.hypot(car.x - p.x, car.y - p.y);
        if (n < d) {
          d = n;
          index = i;
        }
      });
      const target =
          points[
            (index + Math.max(5, Math.round((car.speed * 0.32) / 8))) %
              points.length
          ],
        angle = Math.atan2(
          Math.sin(Math.atan2(target.y - car.y, target.x - car.x) - car.angle),
          Math.cos(Math.atan2(target.y - car.y, target.x - car.x) - car.angle),
        ),
        wanted = [];
      if (angle > 0.035) wanted.push("ArrowRight");
      if (angle < -0.035) wanted.push("ArrowLeft");
      if (car.speed < 165) wanted.push("ArrowUp");
      if (car.speed > 180) wanted.push("ArrowDown");
      await keys(wanted);
      await p.waitForTimeout(45);
    }
    assert.fail("new local revision did not complete a real valid lap");
  } finally {
    await keys([]);
  }
  await p.keyboard.press("Space");
}
try {
  for (const [shape, width, height] of [
    ["wide", 1366, 768],
    ["s", 1280, 800],
    ["tight", 900, 700],
  ])
    await isolated(
      async (p, c, seed) => {
        const original = await raw(p),
          before = await state(p),
          old = JSON.parse(original),
          oldEntry = old.tracks[0];
        await p.screenshot({ path: `${output}/before-${width}.png` });
        await enter(p);
        const frozen = await state(p),
          start = frozen.local.current;
        await layout(p, `${width} before drag`);
        const i = left(frozen),
          a = await drag(p, i, { x: -12, y: 0 });
        assert.equal(a.local.pending.error, null);
        assert.equal(await raw(p), original);
        assert.equal(await raw(p, "paperlap.local-draft.v1"), null);
        assert.deepEqual(a.track, frozen.track);
        assert.deepEqual(a.car, frozen.car);
        assert.deepEqual(a.lap, frozen.lap);
        assert.equal(a.sound.running, false);
        assert.deepEqual(a.keys, []);
        for (const j of [0, 1, start.length - 1])
          assert.deepEqual(a.local.pending.points[j], start[j]);
        // A distant arc stays bit-for-bit unchanged, rather than merely looking close.
        const distant = (i + Math.floor(start.length / 2)) % start.length;
        assert.deepEqual(a.local.pending.points[distant], start[distant]);
        await p.screenshot({ path: `${output}/preview-${width}.png` });
        await p.keyboard.press("Enter");
        const one = (await state(p)).local.current;
        const second = await drag(p, top(await state(p)), {
          x: 0,
          y: shape === "s" ? 8 : -8,
        });
        assert.equal(second.local.pending.error, null);
        await p.locator("#local-adopt").click();
        const two = (await state(p)).local.current;
        assert.notDeepEqual(one, two);
        assert.equal(await raw(p), original);
        const mod = await modifier(p);
        await p.keyboard.press(`${mod}+z`);
        assert.deepEqual((await state(p)).local.current, one);
        await p.keyboard.press(`${mod}+Shift+z`);
        assert.deepEqual((await state(p)).local.current, two);
        await layout(p, `${width} adopted`);
        await p.screenshot({ path: `${output}/adopted-${width}.png` });
        await p.keyboard.press(`${mod}+Enter`);
        assert.equal((await state(p)).mode, "ready");
        assert.equal((await state(p)).local.active, false);
        const saved = JSON.parse(await raw(p)),
          entry = saved.tracks.find((e) => e.uid === oldEntry.uid);
        assert.equal(entry.track.name, oldEntry.track.name);
        assert.deepEqual(entry.track.points, two);
        assert.notEqual(entry.geometryIdentity, oldEntry.geometryIdentity);
        assert.notEqual(entry.geometryDigest, oldEntry.geometryDigest);
        assert.deepEqual(saved.legacy, old.legacy);
        assert.equal(
          saved.records[`${entry.uid}:${oldEntry.geometryIdentity}:rules-2`],
          8.5,
        );
        assert.equal(
          saved.records[`${entry.uid}:${entry.geometryIdentity}:rules-2`],
          undefined,
        );
        assert.equal(await p.locator("#best").innerText(), "--:--.--");
        assert.equal(await raw(p, "paperlap.local-draft.v1"), null);
        await originals(p, seed);
        await load(p);
        assert.equal((await state(p)).geometryIdentity, entry.geometryIdentity);
        assert.deepEqual((await state(p)).track.points, two);
        assert.equal((await state(p)).mode, "ready");
        await choose(p, "entry-B");
        assert.equal(await p.locator("#best").innerText(), "00:35.00");
        await choose(p, entry.uid);
        assert.equal(await p.locator("#best").innerText(), "--:--.--");
        await p.screenshot({ path: `${output}/saved-${width}.png` });
        if (width === 1366) {
          await completeLap(p);
          const pb = JSON.parse(await raw(p)).records[
            `${entry.uid}:${entry.geometryIdentity}:rules-2`
          ];
          assert.ok(pb > 8.5 && pb < 3600);
          await p.keyboard.press("Space");
          if ((await state(p)).mode === "running")
            await p.keyboard.press("Space");
          await p.screenshot({ path: `${output}/new-best.png` });
        }
        await enter(p);
        const good = (await state(p)).local.current;
        const bad = await drag(p, left(await state(p)), { x: -360, y: 0 });
        assert.ok(bad.local.pending.error);
        assert.equal(await p.locator("#local-adopt").isDisabled(), true);
        await p.keyboard.press("Enter");
        assert.deepEqual((await state(p)).local.current, good);
        await p.screenshot({ path: `${output}/invalid-${width}.png` });
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).local.pending, null);
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).local.active, false);
        await originals(p, seed);
        check(
          `${shape} ${width}: two real bends, exact remote/seam points, undo/redo, reliable save/reload, A/B PB, illegal rejection`,
        );
      },
      { shape, width, height, record: width === 1366 },
    );
  for (const origin of ["menu", "book-game", "book-menu"])
    await isolated(async (p) => {
      if (origin.includes("menu")) await p.keyboard.press("Escape");
      if (origin.startsWith("book")) await p.keyboard.press("t");
      await p.keyboard.press("l");
      assert.equal((await state(p)).local.active, true);
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).local.active, false);
      if (origin.startsWith("book")) {
        assert.equal(await p.locator("#trackbook").isVisible(), true);
        await p.keyboard.press("Escape");
      }
      if (origin.includes("menu")) {
        assert.equal(
          await p.locator('#game-menu[data-layer="menu"]').isVisible(),
          true,
        );
        if (origin === "menu")
          assert.equal(
            await p.evaluate(() => document.activeElement.id),
            "menu-local",
          );
        await p.keyboard.press("Escape");
      }
      assert.equal((await state(p)).mode, "ready");
      assert.equal(await p.evaluate(() => document.activeElement.id), "game");
      check(
        `${origin}: L entry, safe parent return and focus without starting`,
      );
    });
  await isolated(async (p, c, seed) => {
    await p.locator("#sound").click();
    const formal = await raw(p);
    await p.locator("#start").click();
    await p.keyboard.down("ArrowUp");
    await p.waitForFunction(
      () =>
        paperlapDebug.lap.elapsed > 0.4 &&
        paperlapDebug.sound.motorGain > 0.0001,
    );
    await p.keyboard.press("l");
    await p.keyboard.up("ArrowUp");
    await p.waitForFunction(() => paperlapDebug.sound.motorGain < 0.0005);
    const frozen = await state(p);
    assert.equal(frozen.mode, "editing");
    assert.equal(frozen.local.active, true);
    assert.deepEqual(frozen.keys, []);
    assert.equal(frozen.sound.running, false);
    assert.ok(
      frozen.sound.motorGain < 0.0005,
      "existing audio envelope fades to silence",
    );
    await p.waitForTimeout(180);
    assert.deepEqual((await state(p)).car, frozen.car);
    assert.deepEqual((await state(p)).lap, frozen.lap);
    await p.keyboard.press("Escape");
    assert.equal((await state(p)).mode, "paused");
    assert.deepEqual((await state(p)).car, frozen.car);
    assert.deepEqual((await state(p)).lap, frozen.lap);
    assert.equal(await raw(p), formal);
    assert.deepEqual((await state(p)).keys, []);
    await originals(p, seed);
    check(
      "running L freezes vehicle/time/audio/input; cancel preserves exact paused state without starting",
    );
  });
  await isolated(async (p, c, seed) => {
    const formal = await raw(p);
    await enter(p);
    await adoptOne(p);
    const a = (await state(p)).local.current;
    await drag(p, top(await state(p)), { x: 0, y: -8 });
    await p.keyboard.press("Escape");
    assert.equal((await state(p)).local.pending, null);
    assert.deepEqual((await state(p)).local.current, a);
    await p.keyboard.press("Escape");
    assert.equal(
      await p.locator('#game-menu[data-layer="discard"]').isVisible(),
      true,
    );
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "keep-drawing",
    );
    await p.keyboard.press("Escape");
    assert.equal((await state(p)).local.active, true);
    await p.keyboard.press("Escape");
    await p.locator("#discard-drawing").click();
    assert.equal((await state(p)).mode, "ready");
    assert.equal(await raw(p), formal);
    assert.equal(await raw(p, "paperlap.local-draft.v1"), null);
    await originals(p, seed);
    check(
      "Esc cancels preview first, defaults to keep, explicitly discards only local edits",
    );
  });
  await isolated(
    async (p, c, seed) => {
      await enter(p);
      await adoptOne(p);
      const a = (await state(p)).local.current,
        backup = await raw(p, "paperlap.local-draft.v1");
      for (const interrupt of ["blur", "resize", "pointercancel", "hidden"]) {
        const q = await begin(p, top(await state(p)));
        await move(p, q, { x: 0, y: -8 });
        if (interrupt === "resize") {
          const v = p.viewportSize();
          await p.setViewportSize({ width: v.width - 2, height: v.height });
        } else
          await p.evaluate((kind) => {
            if (kind === "blur") window.dispatchEvent(new Event("blur"));
            if (kind === "pointercancel")
              document.querySelector(".local-surface").dispatchEvent(
                new PointerEvent("pointercancel", {
                  pointerId: 1,
                  bubbles: true,
                }),
              );
            if (kind === "hidden") {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                get: () => true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
              delete document.hidden;
            }
          }, interrupt);
        await p.waitForFunction(() => !paperlapDebug.local.dragging);
        await p.mouse.up();
        assert.deepEqual((await state(p)).local.current, a);
        assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
      }
      const q = await begin(p, top(await state(p)));
      await move(p, q, { x: 0, y: -8 });
      await load(p);
      await enter(p);
      assert.equal(await p.locator("#local-recovery").isVisible(), true);
      await p.screenshot({ path: `${output}/recovery.png` });
      await p.locator("#local-continue").click();
      assert.deepEqual((await state(p)).local.current, a);
      await p.keyboard.press(`${await modifier(p)}+z`);
      assert.equal((await state(p)).local.dirty, false);
      await p.keyboard.press(`${await modifier(p)}+Shift+z`);
      assert.deepEqual((await state(p)).local.current, a);
      const restoredBackup = await raw(p, "paperlap.local-draft.v1");
      await load(p);
      await enter(p);
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).local.active, false);
      assert.equal(await raw(p, "paperlap.local-draft.v1"), restoredBackup);
      await enter(p);
      await p.locator("#local-discard").click();
      assert.equal((await state(p)).local.dirty, false);
      assert.equal(await raw(p, "paperlap.local-draft.v1"), null);
      await originals(p, seed);
      check(
        "adopted A survives partial B, blur/resize/pointercancel/hidden/reload; recovery/later/discard and exact history work",
      );
    },
    { width: 900, height: 700, reduced: true },
  );
  for (const field of [
    "uid",
    "geometryIdentity",
    "geometryDigest",
    "algorithmVersion",
  ])
    await isolated(async (p) => {
      await enter(p);
      await adoptOne(p);
      await p.evaluate((field) => {
        const doc = JSON.parse(localStorage.getItem("paperlap.local-draft.v1"));
        doc.entries[0].source[field] =
          field === "uid"
            ? "entry-B"
            : field === "geometryIdentity"
              ? "g-" + "a".repeat(32)
              : field === "geometryDigest"
                ? "geom-v1-sha256-" + "a".repeat(64)
                : 2;
        localStorage.setItem("paperlap.local-draft.v1", JSON.stringify(doc));
      }, field);
      const stale = await raw(p, "paperlap.local-draft.v1");
      await load(p);
      await enter(p);
      assert.equal(await p.locator("#local-recovery").isVisible(), false);
      assert.equal((await state(p)).local.dirty, false);
      await p.keyboard.press("Escape");
      assert.equal(await raw(p, "paperlap.local-draft.v1"), stale);
      check(`${field}: stale local draft stays untouched and never attaches`);
    });
  await isolated(async (p) => {
    await enter(p);
    await adoptOne(p);
    const formal = await raw(p),
      backup = await raw(p, "paperlap.local-draft.v1"),
      candidate = (await state(p)).local.current;
    await block(p, "paperlap.save.v3");
    await p.keyboard.press(`${await modifier(p)}+Enter`);
    assert.equal((await state(p)).local.active, true);
    assert.equal(await raw(p), formal);
    assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
    assert.deepEqual(
      (await state(p)).track,
      JSON.parse(formal).tracks[0].track,
    );
    assert.notEqual(
      await p.locator("#toast").getAttribute("data-feedback"),
      "saved",
    );
    assert.match(await p.locator("#local-status").innerText(), /未能保存/);
    await restore(p);
    await p.keyboard.press(`${await modifier(p)}+Enter`);
    assert.equal((await state(p)).mode, "ready");
    assert.deepEqual((await state(p)).track.points, candidate);
    check(
      "formal quota failure preserves geometry/identity/PB/candidate/draft without success; retry commits",
    );
  });
  await isolated(async (p) => {
    await enter(p);
    await adoptOne(p);
    const backup = await raw(p, "paperlap.local-draft.v1");
    await block(p, "paperlap.local-draft.v1");
    await drag(p, top(await state(p)), { x: 0, y: -8 });
    await p.keyboard.press("Enter");
    const adopted = await state(p);
    assert.equal(adopted.local.dirty, true);
    assert.equal(adopted.local.pending, null);
    assert.match(await p.locator("#local-backup").innerText(), /未备份/);
    assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
    await restore(p);
    await block(p, "paperlap.local-draft.v1", "removeItem");
    await p.keyboard.press("Escape");
    const beforeDiscard = await raw(p, "paperlap.local-draft.v1");
    await p.locator("#discard-drawing").click();
    assert.equal((await state(p)).local.active, true);
    assert.equal(
      await p.locator('#game-menu[data-layer="discard"]').isVisible(),
      true,
    );
    assert.equal(await raw(p, "paperlap.local-draft.v1"), beforeDiscard);
    await restore(p);
    await p.locator("#discard-drawing").click();
    assert.equal((await state(p)).mode, "ready");
    check(
      "draft quota preserves earlier accepted backup; known cleanup failure cannot silently discard",
    );
  });
  await isolated(async (p) => {
    await p.evaluate(() =>
      localStorage.setItem("paperlap.local-draft.v1", "unknown backup raw"),
    );
    await block(p, "paperlap.local-draft.v1", "getItem");
    await enter(p);
    await adoptOne(p);
    await p.keyboard.press("Escape");
    assert.match(await p.locator("#discard-description").innerText(), /不删除/);
    await p.locator("#discard-drawing").click();
    assert.equal((await state(p)).mode, "ready");
    await restore(p);
    assert.equal(await raw(p, "paperlap.local-draft.v1"), "unknown backup raw");
    check(
      "initial local draft read denial permits explicit memory-only discard without deleting unknown backup",
    );
  });
  for (const stage of ["prepare", "apply"])
    await isolated(async (p) => {
      await enter(p);
      await adoptOne(p);
      const formal = await raw(p),
        backup = await raw(p, "paperlap.local-draft.v1");
      await p.evaluate((stage) => {
        const fail = () => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (...args) {
            if (this.classList.contains("motion-sheet"))
              return get.apply(this, args);
            HTMLCanvasElement.prototype.getContext = get;
            throw Error("test canvas failure");
          };
        };
        if (stage === "prepare") fail();
        else {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (k, v) {
            set.call(this, k, v);
            if (k === "paperlap.save.v3") {
              Storage.prototype.setItem = set;
              fail();
            }
          };
        }
      }, stage);
      await p.keyboard.press(`${await modifier(p)}+Enter`);
      await state(p);
      assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
      assert.notEqual(
        await p.locator("#toast").getAttribute("data-feedback"),
        "saved",
      );
      if (stage === "prepare") {
        assert.equal(await raw(p), formal);
        assert.equal((await state(p)).local.active, true);
      } else {
        assert.notEqual(await raw(p), formal);
        assert.equal(await p.locator("#recovery").isVisible(), true);
        await load(p);
        assert.equal((await state(p)).mode, "ready");
        await enter(p);
        assert.equal(await p.locator("#local-recovery").isVisible(), false);
        assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
      }
      check(
        `${stage} scene failure preserves draft and safely keeps old state or reloads durable new revision`,
      );
    });
  await isolated(async (p, c) => {
    const other = await c.newPage();
    await load(other);
    assert.equal((await state(other)).storage.writable, false);
    assert.equal(await other.locator("#local-edit").isDisabled(), true);
    await other.keyboard.press("l");
    assert.equal((await state(other)).local.active, false);
    await other.keyboard.press("Escape");
    assert.equal(await other.locator("#menu-local").isDisabled(), true);
    assert.match(await other.locator("#menu-status").innerText(), /只读/);
    await p.close();
    await load(other);
    assert.equal((await state(other)).storage.writable, true);
    await enter(other);
    check(
      "real second tab cannot edit without Web Lock; reload after owner close acquires it",
    );
  });
  await isolated(async (p, c) => {
    await enter(p);
    await adoptOne(p);
    const backup = await raw(p, "paperlap.local-draft.v1"),
      other = await c.newPage();
    await load(other);
    await other.evaluate(() =>
      localStorage.setItem(
        "paperlap.save.v3",
        localStorage.getItem("paperlap.save.v3") + " ",
      ),
    );
    await p.waitForFunction(() => paperlapDebug.storage.error === "conflict");
    const external = await raw(p);
    assert.equal(await p.locator("#local-save").isDisabled(), true);
    await p.keyboard.press(`${await modifier(p)}+Enter`);
    assert.equal(await raw(p), external);
    assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
    assert.match(await p.locator("#local-status").innerText(), /其他标签/);
    check(
      "real external V3 conflict disables formal local save and preserves both branches",
    );
  });
  await isolated(
    async (p) => {
      await enter(p);
      const original = await raw(p),
        index = left(await state(p));
      await drag(p, index, { x: 0, y: 0 });
      await p.keyboard.press("Enter");
      assert.equal((await state(p)).local.dirty, false);
      assert.equal(await p.locator("#local-save").isDisabled(), true);
      assert.equal(await p.locator("#local-adopt").isDisabled(), true);
      for (const key of ["r", "t", "e", "l", "Space"])
        await p.keyboard.press(key);
      assert.equal((await state(p)).local.active, true);
      assert.equal(await raw(p), original);
      await p.locator(".local-surface").focus();
      await p.keyboard.press("Tab");
      await p.keyboard.press("Tab");
      await keyboardFocus(p);
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).mode, "ready");
      await p.keyboard.press("e");
      assert.equal(await p.locator(".draw-surface").isVisible(), true);
      assert.equal((await state(p)).local.active, false);
      check(
        "no-op avoids writes; local scope blocks game keys, keyboard pencil focus works, E remains whole redraw",
      );
    },
    { width: 900, height: 700, reduced: true },
  );
  await isolated(async (p) => {
    await p.keyboard.press("t");
    await p.locator('[data-action="rename"]').first().click();
    await p.locator("#track-name-input").fill("快捷键输入");
    await p.keyboard.press("l");
    assert.equal(
      await p.locator("#track-name-input").inputValue(),
      "快捷键输入l",
    );
    assert.equal((await state(p)).local.active, false);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    for (const flag of [
      "ctrlKey",
      "metaKey",
      "altKey",
      "isComposing",
      "repeat",
    ]) {
      await p.evaluate(
        (flag) =>
          document.querySelector("#game").dispatchEvent(
            new KeyboardEvent("keydown", {
              code: "KeyL",
              key: "l",
              bubbles: true,
              [flag]: true,
            }),
          ),
        flag,
      );
      assert.equal((await state(p)).local.active, false);
    }
    await p.keyboard.press("l");
    assert.equal((await state(p)).local.active, true);
    await drag(p, left(await state(p)), { x: -5, y: 0 });
    await p.locator("#local-adopt").focus();
    await p.keyboard.press("Space");
    assert.equal((await state(p)).local.dirty, true);
    await p.keyboard.press("Escape");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "keep-drawing",
    );
    await p.keyboard.press("Enter");
    assert.equal((await state(p)).local.active, true);
    assert.equal(await p.locator("dialog[open]").count(), 0);
    check(
      "L respects native text/modifier/IME/repeat guards; Space adopts and native Enter keeps local edits",
    );
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
