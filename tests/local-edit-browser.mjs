import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const output = "test-results/local-edit";
await mkdir(`${output}/video`, { recursive: true });
const origin = process.env.PAPERLAP_URL || "http://127.0.0.1:5174";
const url = `${origin}/prototypes/local-edit.html?debug=1`;
const saved = execFileSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    'import {freshSave} from "./src/game/save.ts"; console.log(JSON.stringify(freshSave()));',
  ],
  { encoding: "utf8" },
).trim();
const report = {
  environment: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    browser: browser.version(),
  },
  checks: [],
  errors: [],
  failedRequests: [],
  performance: [],
  resources: [],
};
const contexts = [];
async function context(options = {}) {
  const c = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ...options,
  });
  contexts.push(c);
  await c.addInitScript((saved) => {
    if (!/^https?:$/.test(location.protocol)) return;
    if (!sessionStorage.getItem("local-edit-seeded")) {
      localStorage.setItem("paperlap.save.v2", saved);
      localStorage.setItem("paperlap.save.v1", "unknown-v1-preserve");
      localStorage.setItem("paperlap.draft.v1", "unknown-draft-preserve");
      sessionStorage.setItem("local-edit-seeded", "1");
    }
    window.demoWrites = [];
    for (const name of ["setItem", "removeItem", "clear"]) {
      const old = Storage.prototype[name];
      Storage.prototype[name] = function (...args) {
        window.demoWrites.push({ name, key: args[0] });
        return old.apply(this, args);
      };
    }
  }, saved);
  c.on("page", (p) => {
    p.on("pageerror", (e) => report.errors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") report.errors.push(m.text());
    });
    p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
  });
  return c;
}
const check = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const state = (p) => p.evaluate(() => window.localEditDebug);
const hold = (p, ms) =>
  process.env.PAPERLAP_RECORD === "1"
    ? p.waitForTimeout(ms)
    : Promise.resolve();
async function open(p, target = url) {
  await p.goto(target);
  await p.waitForFunction(() => !!window.localEditDebug);
}
async function at(p, point) {
  const r = await p.locator("#local-canvas").boundingBox();
  return {
    x: r.x + (point.x * r.width) / 1440,
    y: r.y + (point.y * r.height) / 860,
  };
}
async function begin(p, index) {
  const s = await state(p),
    point = s.current[index];
  const a = await at(p, point);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  assert.equal((await state(p)).dragging, true);
  return point;
}
async function move(p, point, delta, steps = 25) {
  const b = await at(p, { x: point.x + delta.x, y: point.y + delta.y });
  await p.mouse.move(b.x, b.y, { steps });
}
async function finish(p, index, delta) {
  const a = await begin(p, index);
  await move(p, a, delta);
  await p.mouse.up();
  return state(p);
}
const leftIndex = (s) =>
  s.current.reduce((best, p, i) => (p.x < s.current[best].x ? i : best), 0);
const topIndex = (s) =>
  s.current.reduce((best, p, i) => (p.y < s.current[best].y ? i : best), 0);
async function noWrites(p) {
  assert.deepEqual(await p.evaluate(() => window.demoWrites), []);
  assert.deepEqual(
    await p.evaluate(() => [
      localStorage.getItem("paperlap.save.v2"),
      localStorage.getItem("paperlap.save.v1"),
      localStorage.getItem("paperlap.draft.v1"),
    ]),
    [saved, "unknown-v1-preserve", "unknown-draft-preserve"],
  );
}
let video;
try {
  const c = await context({
      recordVideo: {
        dir: `${output}/video`,
        size: { width: 1366, height: 768 },
      },
    }),
    p = await c.newPage();
  video = p.video();
  await open(p);
  assert.equal(
    await p.evaluate(() => !!window.paperlapDebug || !!window.Phaser),
    false,
  );
  check("independent page has no driving scene or game debug API");
  const modifier = await p.evaluate(() =>
    /Mac/.test(navigator.platform) ? "Meta" : "Control",
  );
  for (const [shape, width, height] of [
    [0, 1366, 768],
    [1, 1280, 800],
    [2, 900, 700],
  ]) {
    await p.setViewportSize({ width, height });
    await p.locator("#route").selectOption(String(shape));
    const original = (await state(p)).current,
      i = leftIndex(await state(p));
    const rects = await p.evaluate(() =>
      ["local-canvas", "route", "adopt", "status"].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { id, left: r.left, right: r.right, width: innerWidth };
      }),
    );
    assert.ok(rects.every((r) => r.left >= 0 && r.right <= r.width));
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await p.screenshot({ path: `${output}/shape-${shape}-before.png` });
    await hold(p, 700);
    const checks = (await state(p)).metrics.fullChecks;
    const a = await begin(p, i);
    await move(p, a, { x: shape === 1 ? -20 : -30, y: 8 });
    const drawing = await state(p);
    assert.equal(
      drawing.metrics.fullChecks,
      checks,
      "pointermove never validates",
    );
    assert.ok(drawing.metrics.previewFrames > 0);
    assert.ok(drawing.preview);
    await p.mouse.up();
    const preview = await state(p);
    assert.equal(preview.metrics.fullChecks, checks + 1);
    assert.equal(
      preview.pending.error,
      null,
      JSON.stringify(preview.pending.error),
    );
    assert.deepEqual(preview.current, original);
    let changed = 0;
    preview.pending.points.forEach((point, index) => {
      if (preview.selection.weights[index] === 0)
        assert.deepEqual(point, original[index]);
      else changed++;
    });
    assert.ok(changed > 0 && changed < original.length / 3);
    assert.deepEqual(preview.pending.points[0], original[0]);
    assert.deepEqual(preview.pending.points[1], original[1]);
    assert.deepEqual(preview.pending.points.at(-1), original.at(-1));
    await p.screenshot({ path: `${output}/shape-${shape}-valid.png` });
    await hold(p, 1200);
    await p.keyboard.press("Enter");
    assert.deepEqual((await state(p)).current, preview.pending.points);
    await p.keyboard.press(`${modifier}+z`);
    assert.deepEqual((await state(p)).current, original);
    await p.keyboard.press(`${modifier}+Shift+z`);
    assert.deepEqual((await state(p)).current, preview.pending.points);
    await p.locator("#radius").focus();
    await p.keyboard.press(`${modifier}+z`);
    assert.deepEqual(
      (await state(p)).current,
      preview.pending.points,
      "input keeps native shortcut",
    );
    await p.locator("#reset").click();
    assert.deepEqual((await state(p)).current, original);
    check(
      `shape ${shape} ${width}x${height}: real drag local exactness, explicit adopt, keyboard undo/redo and reset`,
    );
    await finish(p, topIndex(await state(p)), { x: 0, y: -100 });
    assert.ok((await state(p)).pending.error);
    assert.equal(await p.locator("#adopt").isDisabled(), true);
    await p.keyboard.press("Enter");
    assert.deepEqual((await state(p)).current, original);
    assert.equal((await state(p)).history, 0);
    await p.screenshot({ path: `${output}/shape-${shape}-invalid.png` });
    await hold(p, 1200);
    await p.keyboard.press("Escape");
    assert.equal((await state(p)).pending, null);
    assert.deepEqual((await state(p)).current, original);
    check(
      `shape ${shape}: illegal preview explains reason and refuses adopt; Esc restores exact route`,
    );
  }
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.locator("#route").selectOption("0");
  const original = (await state(p)).current;
  const stationary = await at(p, original[leftIndex(await state(p))]);
  const checksBeforeClick = (await state(p)).metrics.fullChecks;
  await p.mouse.click(stationary.x, stationary.y);
  assert.equal((await state(p)).pending, null);
  assert.equal((await state(p)).metrics.fullChecks, checksBeforeClick);
  assert.equal(await p.locator("#adopt").isDisabled(), true);
  check(
    "selection without displacement does not create a candidate, history or full validation",
  );
  const start = await at(p, original[0]);
  await p.mouse.click(start.x, start.y);
  assert.equal((await state(p)).dragging, false);
  assert.match(await p.locator("#status").innerText(), /起点.*保护/);
  check(
    "start and seam reject selection instead of moving the start direction",
  );
  await finish(p, leftIndex(await state(p)), { x: -20, y: 0 });
  await p.locator("#adopt").focus();
  await p.keyboard.press("Enter");
  const accepted = (await state(p)).current;
  assert.notDeepEqual(accepted, original);
  for (const interrupt of [
    "Escape",
    "pointercancel",
    "lostpointercapture",
    "blur",
    "resize",
    "pagehide",
  ]) {
    const before = (await state(p)).metrics.fullChecks;
    const a = await begin(p, leftIndex(await state(p)));
    await move(p, a, { x: -10, y: 4 }, 8);
    if (interrupt === "Escape") await p.keyboard.press("Escape");
    else if (interrupt === "resize")
      await p.setViewportSize({ width: 1280, height: 800 });
    else if (interrupt === "pointercancel")
      await p.evaluate(() => {
        document.querySelector("canvas").dispatchEvent(
          new PointerEvent("pointercancel", {
            pointerId: window.localEditDebug.pointer,
          }),
        );
      });
    else if (interrupt === "lostpointercapture") {
      await p.evaluate(() =>
        document
          .querySelector("canvas")
          .releasePointerCapture(window.localEditDebug.pointer),
      );
      // Chrome delivers the pending capture change before the next pointer event.
      await move(p, a, { x: -11, y: 5 }, 1);
    } else
      await p.evaluate(
        (type) => window.dispatchEvent(new Event(type)),
        interrupt,
      );
    await p.waitForFunction(() => !window.localEditDebug.dragging);
    await p.mouse.up();
    const s = await state(p);
    assert.deepEqual(s.current, accepted);
    assert.equal(s.pending, null);
    assert.equal(s.pointer, null);
    assert.equal(s.queuedFrame, false);
    assert.equal(s.metrics.fullChecks, before);
    check(
      `${interrupt} aborts live gesture without validation, capture or adopted-history loss`,
    );
  }
  await p.keyboard.press("Escape");
  assert.deepEqual((await state(p)).current, original);
  await noWrites(p);
  check(
    "all edit, interruption, reset and history actions preserve all formal storage bytes with zero writes",
  );
  await p.locator("#route").focus();
  await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => document.activeElement.id), "read-saved");
  await p.keyboard.press("Enter");
  assert.equal((await state(p)).route, "方格本环线");
  const savedPoints = (await state(p)).current;
  await finish(p, leftIndex(await state(p)), { x: -15, y: 5 });
  assert.equal((await state(p)).pending.error, null);
  await p.locator("#adopt").click();
  await noWrites(p);
  assert.notDeepEqual((await state(p)).current, savedPoints);
  check(
    "explicit read-only Save V2 loads an actual saved route; adopting stays memory-only",
  );
  await p.reload();
  await p.waitForFunction(() => !!window.localEditDebug);
  assert.equal((await state(p)).history, 0);
  await noWrites(p);
  check(
    "reload discards experimental edits and preserves saved tracks, records and legacy drafts",
  );
  const reduced = await context({
      viewport: { width: 900, height: 700 },
      reducedMotion: "reduce",
    }),
    rp = await reduced.newPage();
  await open(rp);
  await finish(rp, leftIndex(await state(rp)), { x: -20, y: 5 });
  await rp.keyboard.press("Enter");
  await rp.keyboard.press(`${modifier}+z`);
  assert.deepEqual((await state(rp)).current, (await state(rp)).original);
  assert.equal(
    await rp
      .locator("#adopt")
      .evaluate((b) => getComputedStyle(b).transitionDuration),
    "0s",
  );
  await noWrites(rp);
  check("reduced-motion preserves mouse, keyboard and exact undo at 900x700");
  await reduced.close();
  contexts.splice(contexts.indexOf(reduced), 1);
  const denied = await context();
  await denied.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    }),
  );
  const dp = await denied.newPage();
  await open(dp);
  await dp.locator("#read-saved").click();
  assert.match(await dp.locator("#status").innerText(), /拒绝读取/);
  await finish(dp, leftIndex(await state(dp)), { x: -20, y: 0 });
  assert.equal((await state(dp)).pending.error, null);
  assert.deepEqual(await dp.evaluate(() => window.demoWrites), []);
  check(
    "unavailable storage leaves samples playable and does not attempt writes",
  );
  await denied.close();
  contexts.splice(contexts.indexOf(denied), 1);

  await p.close();
  await video.saveAs(`${output}/local-edit-playthrough.webm`);
  // Browser timings include actual drawing work, not only the pure deformation.
  for (const count of [200, 450, 900]) {
    const bp = await c.newPage();
    await open(bp, `${url}&points=${count}`);
    for (let trial = 0; trial < 3; trial++) {
      await finish(bp, leftIndex(await state(bp)), { x: -25, y: 10 });
      await bp.keyboard.press("Escape");
    }
    const s = await state(bp);
    assert.equal(s.original.length, count);
    assert.equal(s.metrics.fullChecks, 3);
    const stats = (a) => {
      const values = [...a].sort((a, b) => a - b);
      return {
        samples: a.length,
        medianMs: values[Math.floor(values.length / 2)],
        p95Ms: values[Math.ceil(values.length * 0.95) - 1],
        maxMs: values.at(-1),
      };
    };
    report.performance.push({
      points: count,
      previewAndDraw: stats(s.metrics.previewMs),
      eventToDraw: stats(s.metrics.eventToPaintMs),
      releaseValidation: stats(s.metrics.validateMs),
      previewFrames: s.metrics.previewFrames,
      fullChecks: s.metrics.fullChecks,
    });
    assert.ok(s.metrics.previewMs.length >= 30);
    assert.ok(
      report.performance.at(-1).previewAndDraw.p95Ms < 100,
      "detect pathological preview work, no FPS guarantee",
    );
    await noWrites(bp);
    await bp.close();
  }
  check(
    "200/450/900 points measured with real pointermove, one strict check per release and no writes",
  );
  const memoryPage = await c.newPage(),
    cdp = await c.newCDPSession(memoryPage);
  for (let i = 0; i < 11; i++) {
    await open(memoryPage, `${url}&points=900`);
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage"),
      dom = await cdp.send("Memory.getDOMCounters");
    report.resources.push({
      open: i + 1,
      usedHeap: heap.usedSize,
      ...dom,
      ...(await memoryPage.evaluate(() => ({
        canvases: document.querySelectorAll("canvas").length,
        queued: window.localEditDebug.queuedFrame,
        dragging: window.localEditDebug.dragging,
      }))),
    });
  }
  assert.ok(
    report.resources.every((r) => r.canvases === 1 && !r.queued && !r.dragging),
  );
  assert.ok(
    report.resources.at(-1).jsEventListeners <=
      report.resources[0].jsEventListeners + 10,
  );
  assert.ok(
    report.resources.at(-1).usedHeap < report.resources[0].usedHeap + 2_000_000,
  );
  await memoryPage.close();
  check(
    "11 repeated opens retain one canvas, bounded heap/listeners and no idle animation loop",
  );
  const stress = await c.newPage();
  await open(stress, `${url}&points=900`);
  const stressCdp = await c.newCDPSession(stress);
  const steady = [];
  for (let i = 0; i < 50; i++) {
    const point = await begin(stress, leftIndex(await state(stress)));
    await move(stress, point, { x: -0.5, y: 0 }, 3);
    await stress.mouse.up();
    await stress.keyboard.press("Enter");
    assert.equal((await state(stress)).pending, null);
    if ([24, 49].includes(i)) {
      await stressCdp.send("HeapProfiler.collectGarbage");
      steady.push({
        operations: i + 1,
        ...(await stressCdp.send("Runtime.getHeapUsage")),
        ...(await stressCdp.send("Memory.getDOMCounters")),
      });
    }
  }
  const stressState = await state(stress);
  assert.equal(stressState.history, 24);
  assert.equal(stressState.metrics.fullChecks, 50);
  assert.ok(!stressState.dragging && !stressState.queuedFrame);
  assert.ok(steady[1].usedSize < steady[0].usedSize + 1_000_000);
  assert.equal(steady[0].jsEventListeners, steady[1].jsEventListeners);
  report.continuousDragging = {
    samples: steady,
    history: stressState.history,
    fullChecks: stressState.metrics.fullChecks,
    previewFrames: stressState.metrics.previewFrames,
  };
  await noWrites(stress);
  await stress.close();
  check(
    "50 consecutive real 900-point drag/adopt operations bound history, heap, listeners and storage writes",
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  console.log(`PASS ${report.checks.length} browser checks`);
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await writeFile(
    `${output}/browser-report.json`,
    JSON.stringify(report, null, 2),
  );
}
