import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { localGameFixtures } from "./fixtures/local-game.mjs";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = fileURLToPath(new URL("../test-results/next-version/", import.meta.url));
await mkdir(output, { recursive: true });
const report = {
  headless: true,
  scenario: "segmented drawing, recovery, V4 save and local edit",
  checks: [], screenshots: [], errors: [], failedRequests: [], layouts: [],
  views: [], outcome: "running", failure: null,
};
let browser, context, page;
const check = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
const state = (p) => p.evaluate(() => window.paperlapDebug);
const stored = (p, key) => p.evaluate((k) => localStorage.getItem(k), key);
const official = async (p) => JSON.parse(await stored(p, "paperlap.save.v4"));
const draft = async (p) => JSON.parse(await stored(p, "paperlap.draft.v3"));
const settle = (p) => p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const shot = async (p, name) => {
  const file = `${name}.png`;
  await settle(p);
  await p.screenshot({ path: `${output}${file}` });
  report.screenshots.push(file);
};
async function openContext(seed) {
  context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1, reducedMotion: "reduce",
  });
  if (seed) await context.addInitScript((data) => {
    if (!/^https?:$/.test(location.protocol) || localStorage.getItem("next-version-test-seeded")) return;
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value);
    localStorage.setItem("next-version-test-seeded", "1");
  }, seed);
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text()); });
  page.on("requestfailed", (r) => report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
  await load(page);
  return page;
}
async function load(p, reload = false) {
  if (reload) await p.reload();
  else await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas"));
  await p.waitForFunction(() => paperlapDebug.renderer?.available || !document.querySelector("#recovery").hidden);
  const s = await state(p);
  assert.equal(s.renderer.available, true, "real 3D renderer must initialize");
  assert.equal(s.storage.writable, true, `expected isolated writer: ${s.storage.error}`);
}
async function create(p) {
  await p.locator("#trackbook-open").click();
  await p.locator("#new-track").click();
  await p.locator(".draw-surface").waitFor({ state: "visible" });
  await settle(p);
}
const layer = (kind) => kind === "local" ? ".local-surface" : ".draw-surface";
const viewOf = (s, kind) => kind === "local" ? s.local.viewport : s.draft.viewport;
async function pixels(p, q, kind = "draft") {
  const [s, r] = await Promise.all([state(p), p.locator(layer(kind)).boundingBox()]);
  assert.ok(r, `${kind} canvas visible`);
  const v = viewOf(s, kind);
  return { x: r.x + ((q.x - v.x) * v.zoom * r.width) / 1440,
    y: r.y + ((q.y - v.y) * v.zoom * r.height) / 860 };
}
async function screenPixels(p, q, kind = "draft") {
  const r = await p.locator(layer(kind)).boundingBox();
  return { x: r.x + q.x * r.width / 1440, y: r.y + q.y * r.height / 860 };
}
async function zoomTo(p, target, kind = "draft") {
  const factor = kind === "local" ? 0.002 : 0.0025;
  for (let i = 0; i < 10; i++) {
    const v = viewOf(await state(p), kind);
    if (Math.abs(v.zoom - target) < 0.012) return;
    const center = await screenPixels(p, { x: 720, y: 440 }, kind);
    await p.mouse.move(center.x, center.y);
    await p.mouse.wheel(0, Math.max(-120, Math.min(120, -Math.log(target / v.zoom) / factor)));
    await settle(p);
  }
  assert.ok(Math.abs(viewOf(await state(p), kind).zoom - target) < 0.025, `zoom ${kind} reaches target`);
}
async function panTo(p, worldCenter, kind = "draft") {
  // These are genuine captured right-button drags. No viewport setters are used.
  for (let i = 0; i < 25; i++) {
    const v = viewOf(await state(p), kind);
    const dx = 720 - (worldCenter.x - v.x) * v.zoom;
    const dy = 440 - (worldCenter.y - v.y) * v.zoom;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const from = await screenPixels(p, { x: 720, y: 440 }, kind);
    const to = await screenPixels(p, { x: 720 + Math.max(-380, Math.min(380, dx)),
      y: 440 + Math.max(-130, Math.min(130, dy)) }, kind);
    await p.mouse.move(from.x, from.y);
    await p.mouse.down({ button: "right" });
    await p.mouse.move(to.x, to.y, { steps: 4 });
    await p.mouse.up({ button: "right" });
  }
  throw Error(`could not pan ${kind} to requested world position`);
}
async function frameStroke(p, points) {
  const xs = points.map((q) => q.x), ys = points.map((q) => q.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const target = Math.min(0.62, 1100 / Math.max(1, box.maxX - box.minX), 340 / Math.max(1, box.maxY - box.minY));
  await zoomTo(p, target);
  await panTo(p, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
  report.views.push({ ...(await state(p)).draft.viewport });
}
async function stroke(p, points) {
  await frameStroke(p, points);
  const before = (await state(p)).draft.segmentEnds.length;
  const first = await pixels(p, points[0]);
  await p.mouse.move(first.x, first.y);
  await p.mouse.down();
  assert.equal((await state(p)).draft.phase, "drawing", "pointer starts a drawing gesture");
  try {
    for (const point of points.slice(1)) {
      const at = await pixels(p, point);
      await p.mouse.move(at.x, at.y);
    }
  } finally { await p.mouse.up(); }
  await p.waitForFunction((count) => paperlapDebug.draft.segmentEnds.length === count + 1, before);
  return state(p);
}
async function layout(p, width, height) {
  await p.setViewportSize({ width, height });
  await settle(p);
  const info = await p.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    const visibleButtons = [...document.querySelectorAll(".editor-map-tools:not([hidden]) button")]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => ({ label: b.textContent, ...b.getBoundingClientRect().toJSON() }));
    return { width: innerWidth, height: innerHeight,
      board: rect(".board"), canvas: rect(".draw-surface"), tools: rect(".editor-map-tools:not([hidden])"),
      buttons: visibleButtons, overflow: document.documentElement.scrollWidth > innerWidth,
      segmentCount: paperlapDebug.draft.segmentEnds.length };
  });
  assert.equal(info.overflow, false, `no horizontal overflow at ${width}`);
  for (const b of [info.tools, ...info.buttons]) {
    assert.ok(b.left >= info.board.left - 1 && b.right <= info.board.right + 1 &&
      b.top >= info.board.top - 1 && b.bottom <= info.board.bottom + 1,
    `editor tool stays inside board at ${width}: ${JSON.stringify(b)}`);
  }
  report.layouts.push(info);
  await shot(p, `editor-${width}`);
}
async function localIdle(p) {
  await p.waitForFunction(() => !paperlapDebug.local.busy &&
    (!paperlapDebug.local.active || document.querySelector("#local-editor").getAttribute("aria-busy") === "false"));
  return state(p);
}
async function localDrag(p, point, delta) {
  await panTo(p, point, "local");
  await zoomTo(p, 0.8, "local");
  await panTo(p, point, "local");
  const from = await pixels(p, point, "local");
  const to = await pixels(p, { x: point.x + delta.x, y: point.y + delta.y }, "local");
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  assert.equal((await state(p)).local.dragging, true, "real pointer grabs saved road");
  await p.mouse.move(to.x, to.y, { steps: 14 });
  await p.mouse.up();
  await localIdle(p);
  assert.equal(await p.locator("#local-adopt").isEnabled(), true,
    await p.locator("#local-status").innerText());
}
async function cancelLocal(p) {
  await p.locator("#local-cancel").click();
  if (await p.locator("#discard-drawing").isVisible()) await p.locator("#discard-drawing").click();
  await p.waitForFunction(() => !paperlapDebug.local.active);
}
function nextPoint(points, index, distance) {
  let a = points[index];
  for (let k = 1; k <= points.length; k++) {
    const b = points[(index + k) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= length) return { x: a.x + (b.x - a.x) * distance / length,
      y: a.y + (b.y - a.y) * distance / length };
    distance -= length;
    a = b;
  }
  return a;
}
async function keyboardLap(p) {
  // The only control channel is real keyboard input. Telemetry selects an aim
  // point; it never sets the car, lap, clock, checkpoints or stored results.
  const held = new Set(), samples = [];
  const keys = async (wanted) => {
    for (const key of [...held]) if (!wanted.includes(key)) {
      await p.keyboard.up(key); held.delete(key);
    }
    for (const key of wanted) if (!held.has(key)) {
      await p.keyboard.down(key); held.add(key);
    }
  };
  assert.equal((await state(p)).mode, "ready");
  await p.locator("#start").click();
  const deadline = Date.now() + 150000;
  let s;
  try {
    while (Date.now() < deadline) {
      s = await state(p);
      if (s.lap.completed >= 1) break;
      assert.equal(s.mode, "running");
      assert.equal(s.lap.valid, true, "keyboard driver must keep the hand-drawn lap valid");
      const { car, track } = s, points = track.points;
      let index = 0, distance = Infinity;
      points.forEach((point, i) => {
        const d = Math.hypot(point.x - car.x, point.y - car.y);
        if (d < distance) { distance = d; index = i; }
      });
      const a = nextPoint(points, index, 0), b = nextPoint(points, index, 80), c = nextPoint(points, index, 160);
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
      const bend = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
      const targetSpeed = bend > 0.42 ? 190 : bend > 0.25 ? 220 : 255;
      const target = nextPoint(points, index, Math.max(45, car.speed * 0.29));
      const difference = Math.atan2(target.y - car.y, target.x - car.x) - car.angle;
      const error = Math.atan2(Math.sin(difference), Math.cos(difference));
      const wanted = [];
      if (error > 0.035) wanted.push("ArrowRight");
      if (error < -0.035) wanted.push("ArrowLeft");
      if (car.speed < targetSpeed) wanted.push("ArrowUp");
      if (car.speed > targetSpeed + 15) wanted.push("ArrowDown");
      await keys(wanted);
      samples.push({ time: s.lap.elapsed, x: car.x, y: car.y, speed: car.speed, gate: s.lap.nextGate });
      await p.waitForTimeout(40);
    }
    s = await state(p);
    assert.ok(s.lap.completed >= 1, "finish a hand-drawn valid lap through actual keyboard driving");
    assert.ok(Number.isFinite(s.lap.last) && s.lap.last > 0);
    return { lapSeconds: s.lap.last, samples };
  } finally {
    await keys([]);
    if ((await state(p)).mode === "running") await p.keyboard.press("Space");
  }
}
async function closeReturnLayers(p) {
  if (await p.locator("#trackbook").isVisible()) {
    await p.locator("#trackbook-close").click();
    await p.locator("#trackbook").waitFor({ state: "hidden" });
  }
  if (await p.locator("#game-menu[open]").isVisible()) await p.keyboard.press("Escape");
}
async function resourceSnapshot(p, phase) {
  await settle(p);
  const s = await state(p), r = s.renderer;
  assert.equal(s.mode, "ready", `${phase}: return to ready`);
  assert.equal(r.available, true);
  assert.equal(r.pendingTracks, 0, `${phase}: no prepared track remains pending`);
  return { phase, geometries: r.geometries, textures: r.textures, pendingTracks: r.pendingTracks };
}
try {
  browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });

  // This pre-existing fixture is the only seeded game data. The drawing scenario
  // below starts in a separate, empty browser context and uses real input only.
  const seed = localGameFixtures.wide;
  await openContext(seed);
  const old = JSON.parse(seed["paperlap.save.v3"]), migrated = await official(page);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.activeTrackUid, old.activeTrackUid);
  assert.deepEqual(migrated.tracks, old.tracks);
  assert.deepEqual(migrated.records, old.records);
  for (const [key, raw] of Object.entries(seed)) assert.equal(await stored(page, key), raw, `${key} byte preservation`);
  check("old V3作品、几何身份与PB完整迁入V4，旧存档和草稿原文保留");
  await shot(page, "legacy-track-3d");
  await page.locator("#trackbook-open").click();
  await page.locator("#sample-track").click();
  await page.locator("#trackbook").waitFor({ state: "hidden" });
  const withSample = await official(page);
  assert.equal(withSample.tracks.length, migrated.tracks.length + 1);
  const sample = withSample.tracks.find((t) => t.uid === withSample.activeTrackUid);
  assert.equal(sample.track.schemaVersion, 2);
  assert.ok(Math.max(...sample.track.points.map((p) => p.y)) > 860, "sample extends beyond old world");
  for (const oldEntry of migrated.tracks) assert.deepEqual(withSample.tracks.find((t) => t.uid === oldEntry.uid), oldEntry);
  assert.deepEqual(withSample.records, migrated.records);
  await page.locator("#trackbook-open").click();
  await page.locator("#sample-track").click();
  await page.locator("#trackbook").waitFor({ state: "hidden" });
  const repeatedSample = await official(page);
  assert.equal(repeatedSample.tracks.length, withSample.tracks.length);
  assert.equal(repeatedSample.activeTrackUid, sample.uid);
  assert.deepEqual(repeatedSample.tracks, withSample.tracks);
  assert.deepEqual(repeatedSample.records, withSample.records);
  for (const [key, raw] of Object.entries(seed)) assert.equal(await stored(page, key), raw, `${key} after sample selection`);
  check("旧作品用户从赛道本加入长样例，原作品与PB保留，重复使用不重复创建");
  await shot(page, "legacy-user-long-sample");
  await context.close(); context = null;

  await openContext();
  const original = await official(page);
  const originalRaw = await stored(page, "paperlap.save.v4");
  await create(page);
  const initialView = { ...(await state(page)).draft.viewport };
  const points = Array.from({ length: 181 }, (_, i) => ({
    x: 2880 + 1000 * Math.cos(i * Math.PI * 2 / 180),
    y: 1720 + 1000 * Math.sin(i * Math.PI * 2 / 180),
  }));
  const segments = Array.from({ length: 12 }, (_, i) => points.slice(i * 15, i * 15 + 16));
  await stroke(page, segments[0]);
  await stroke(page, segments[1]);
  assert.equal((await state(page)).draft.phase, "open");
  assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
  assert.equal(await stored(page, "paperlap.save.v4"), originalRaw);
  const checkpoint = (await draft(page)).entries[0].current;
  assert.equal(checkpoint.segmentEnds.length, 2);
  const end = checkpoint.raw.at(-1);
  const crossAt = { x: (points[7].x + points[8].x) / 2, y: (points[7].y + points[8].y) / 2 };
  const beyond = { x: end.x + (crossAt.x - end.x) * 1.35, y: end.y + (crossAt.y - end.y) * 1.35 };
  const bad = Array.from({ length: 30 }, (_, i) => ({ x: end.x + (beyond.x - end.x) * i / 29,
    y: end.y + (beyond.y - end.y) * i / 29 }));
  await stroke(page, bad);
  assert.equal(await page.locator("#editor-status").getAttribute("data-kind"), "error");
  assert.equal((await state(page)).draft.valid, false);
  await shot(page, "invalid-segment");
  await page.locator("#undo-drawing").click();
  assert.deepEqual((await draft(page)).entries[0].current, checkpoint);
  check("真实分段绘制、右键平移与滚轮缩放；交叉段可见并按段撤销，原作品不变");

  await load(page, true);
  await create(page);
  await page.locator("#draft-recovery[open]").waitFor();
  await page.locator("#continue-draft").click();
  await page.waitForFunction(() => paperlapDebug.draft.segmentEnds.length === 2);
  assert.deepEqual((await draft(page)).entries[0].current, checkpoint);
  await page.locator("#undo-drawing").click();
  assert.equal((await state(page)).draft.segmentEnds.length, 1);
  await page.locator("#redo-drawing").click();
  assert.equal((await state(page)).draft.segmentEnds.length, 2);
  check("刷新恢复未闭合两段草稿，恢复后撤销/重做仍按段工作");

  for (const [width, height] of [[1366, 768], [1280, 800], [900, 700]]) await layout(page, width, height);
  await page.setViewportSize({ width: 1366, height: 768 });
  await settle(page);
  for (const segment of segments.slice(2)) await stroke(page, segment);
  const complete = await state(page);
  assert.equal(complete.draft.valid, true, await page.locator("#editor-status").innerText());
  assert.equal(complete.draft.segmentEnds.length, 12);
  assert.ok(Math.max(...points.map((p) => p.y)) > initialView.y + 860 / initialView.zoom,
    "drawn route genuinely extends beyond the initial view");
  await page.getByRole("button", { name: "查看全图", exact: true }).click();
  await shot(page, "closed-large-track");
  await page.locator("#drive-drawing").click();
  await page.waitForFunction(() => paperlapDebug.mode !== "editing");
  const created = await official(page), savedState = await state(page);
  assert.equal(savedState.mode, "ready", "saving a newly drawn track waits for explicit start");
  assert.equal(created.schemaVersion, 4);
  assert.equal(created.tracks.length, original.tracks.length + 1);
  assert.notEqual(created.activeTrackUid, original.activeTrackUid);
  const entry = created.tracks.find((t) => t.uid === created.activeTrackUid);
  assert.equal(entry.track.schemaVersion, 2);
  assert.equal(entry.track.width, 108);
  assert.ok(Math.max(...entry.track.points.map((p) => p.y)) - Math.min(...entry.track.points.map((p) => p.y)) > 1900);
  assert.equal(savedState.trackId, entry.track.id);
  await load(page, true);
  assert.equal((await state(page)).trackId, entry.track.id);
  assert.equal((await state(page)).activeTrackUid, entry.uid);
  check("十二段跨屏路线真实闭合保存V4，旧作品保留，新路线刷新仍可用");
  await shot(page, "drawn-track-3d");

  report.keyboardLap = await keyboardLap(page);
  const oldRecordKey = `${entry.uid}:${entry.geometryIdentity}:rules-${created.rulesVersion}`;
  const afterLap = await official(page), oldBest = afterLap.records[oldRecordKey];
  assert.ok(Math.abs(oldBest - report.keyboardLap.lapSeconds) < 0.001, "real hand-drawn lap persists its exact PB");
  await shot(page, "drawn-track-personal-best");
  await load(page, true);
  assert.equal((await official(page)).records[oldRecordKey], oldBest);
  check("自绘长赛道通过真实键盘完成有效圈，个人最佳保存并刷新保留");

  await page.locator("#local-edit").click();
  await page.waitForFunction(() => paperlapDebug.local.active);
  await page.locator("#local-fit").click();
  const local = await localIdle(page);
  const bottom = local.local.current.reduce((a, b) => b.y > a.y ? b : a);
  await localDrag(page, bottom, { x: 0, y: 18 });
  await shot(page, "local-preview");
  await page.locator("#local-adopt").click();
  await localIdle(page);
  assert.equal((await state(page)).local.dirty, true);
  assert.equal((await official(page)).tracks.find((t) => t.uid === entry.uid).geometryIdentity, entry.geometryIdentity);
  await page.locator("#local-save").click();
  await page.waitForFunction(() => !paperlapDebug.local.active);
  const changed = await official(page), edited = changed.tracks.find((t) => t.uid === entry.uid);
  assert.notEqual(edited.geometryIdentity, entry.geometryIdentity);
  assert.notEqual(edited.track.id, entry.track.id);
  assert.equal(edited.track.name, entry.track.name);
  await load(page, true);
  assert.equal((await state(page)).trackId, edited.track.id);
  const afterLocalReload = await official(page);
  const newRecordKey = `${edited.uid}:${edited.geometryIdentity}:rules-${afterLocalReload.rulesVersion}`;
  assert.equal(afterLocalReload.records[oldRecordKey], oldBest, "old geometry PB remains in history");
  assert.equal(Object.hasOwn(afterLocalReload.records, newRecordKey), false, "new geometry starts without a PB");
  assert.equal(await page.locator("#best").innerText(), "--:--.--");
  check("长赛道真实拖弯采用保存后建立新身份，当前PB为空，旧几何PB完整保留");

  const beforeCancel = await stored(page, "paperlap.save.v4");
  await page.locator("#local-edit").click();
  await page.waitForFunction(() => paperlapDebug.local.active);
  const current = (await localIdle(page)).local.current;
  const top = current.reduce((a, b) => b.y < a.y ? b : a);
  await localDrag(page, top, { x: 0, y: -16 });
  await page.locator("#local-adopt").click();
  await localIdle(page);
  await cancelLocal(page);
  assert.equal(await stored(page, "paperlap.save.v4"), beforeCancel);
  assert.equal((await state(page)).trackId, edited.track.id);
  assert.notEqual((await state(page)).mode, "running");
  check("放弃已采用的局部修改沿原路返回，正式作品和驾驶状态不被覆盖");
  await closeReturnLayers(page);
  report.resources = [await resourceSnapshot(page, "baseline")];
  const baseline = report.resources[0];
  for (let i = 1; i <= 3; i++) {
    await page.locator("#edit").click();
    await page.locator(".draw-surface").waitFor({ state: "visible" });
    await page.locator("#cancel-edit").click();
    await closeReturnLayers(page);
    report.resources.push(await resourceSnapshot(page, `whole-edit-cancel-${i}`));
    await page.locator("#local-edit").click();
    await page.waitForFunction(() => paperlapDebug.local.active);
    await cancelLocal(page);
    await closeReturnLayers(page);
    report.resources.push(await resourceSnapshot(page, `local-edit-cancel-${i}`));
  }
  for (const sample of report.resources.slice(1)) {
    assert.equal(sample.geometries, baseline.geometries, `${sample.phase}: geometry count returns to baseline`);
    assert.equal(sample.textures, baseline.textures, `${sample.phase}: texture count returns to baseline`);
    assert.equal(sample.pendingTracks, 0);
  }
  assert.equal(await stored(page, "paperlap.save.v4"), beforeCancel);
  check("三轮普通编辑与局部调整进入/取消后，3D几何、纹理与待提交资源回稳无增长");
  await shot(page, "final-ready");
  report.savedTrack = { uid: entry.uid, initialGeometry: entry.geometryIdentity, finalGeometry: edited.geometryIdentity,
    width: edited.track.width, points: edited.track.points.length, oldRecordKey, oldBest, newRecordKey };
  assert.deepEqual(report.errors, [], "page and console errors");
  assert.deepEqual(report.failedRequests.filter((r) => r.error !== "net::ERR_ABORTED"), [], "failed resource requests");
  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.failure = error.stack || String(error);
  console.error(report.failure);
  if (page && !page.isClosed()) {
    try { await shot(page, "editor-failure"); } catch {}
    try {
      report.failureState = await state(page);
      report.failureText = await page.locator("body").innerText();
    } catch {}
  }
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await writeFile(`${output}editor-browser-report.json`, JSON.stringify(report, null, 2));
}
