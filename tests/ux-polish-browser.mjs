import assert from "node:assert/strict";
import { launchHeadless, engineName } from "./fixtures/release-engine.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
delete process.env.PWDEBUG;
const { expect } = await import("@playwright/test");
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const phase = process.env.PAPERLAP_UX_PHASE || "after";
const output = process.env.PAPERLAP_UX_OUTPUT || `test-results/ux-polish/${phase}`;
// Seed one original V2 save; let the app migrate and archive it through the real protocol.
const legacySave = JSON.parse(await readFile(new URL("./fixtures/ux-legacy-save-v2.json", import.meta.url), "utf8"));
const legacy = { cookies: [], origins: [{ origin: new URL(base).origin,
  localStorage: [{ name: "paperlap.save.v2", value: JSON.stringify(legacySave) }] }] };
await mkdir(output, { recursive: true });
const browser = await launchHeadless();
const report = { phase, engine: engineName, headless: true, browser: browser.version(), checks: [], failures: [], errors: [], screens: [], busy: [], accessibility: [], help: [], media: [], notTested: [], nativeFocus: [], fixture: "tests/fixtures/ux-legacy-save-v2.json" };
const verify = (name, ok, detail) => {
  report.checks.push({ name, ok, detail });
  if (!ok)
    report.failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const raw = (p, key = "paperlap.save.v3") => p.evaluate(k => localStorage.getItem(k), key);
const state = p => p.evaluate(() => paperlapDebug);
async function settled(p) {
  await p.waitForFunction(() => !paperlapDebug.local.busy &&
    (!paperlapDebug.local.active || document.querySelector("#local-editor").getAttribute("aria-busy") === "false"));
  await p.evaluate(async () => Promise.all(document.getAnimations().map(a => a.finished.catch(() => { }))));
}
async function load(p) {
  await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas"));
  await settled(p);
}
async function create(width, height, history = true) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...(history ? { storageState: legacy } : {}) });
  c.on("page", p => p.on("pageerror", e => report.errors.push(e.message)));
  const p = await c.newPage();
  await load(p);
  if (history) {
    assert.equal((await state(p)).storage.writable, true);
    const migrated = JSON.parse(await raw(p));
    assert.equal(migrated.schemaVersion, 3);
    assert.deepEqual(migrated.legacy.records, legacySave.records);
  }
  return { p, c };
}
async function gameFocus(p) {
  for (let i = 0; i < 30 && await p.evaluate(() => document.activeElement.id) !== "game"; i++)
    await p.keyboard.press("Shift+Tab");
  assert.equal(await p.evaluate(() => document.activeElement.id), "game");
}
async function rename(p, name) {
  await p.locator("#trackbook-open").click();
  await p.locator('[data-action="rename"]').first().click();
  await p.locator("#track-name-input").fill(name);
  await p.locator("#rename-save").click();
  await p.keyboard.press("Escape");
  await gameFocus(p);
}
async function drag(p, dx = -12) {
  const points = (await state(p)).local.current;
  const q = points.reduce((a, b) => b.x < a.x ? b : a), b = await p.locator(".local-surface").boundingBox();
  const at = x => ({ x: b.x + x / 1440 * b.width, y: b.y + q.y / 860 * b.height });
  const a = at(q.x), z = at(q.x + dx);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  assert.equal((await state(p)).local.dragging, true);
  await p.mouse.move(z.x, z.y, { steps: 12 });
  await p.mouse.up();
  await settled(p);
}
async function adopt(p) {
  await drag(p);
  assert.equal((await state(p)).local.pending.error, null);
  await p.keyboard.press("Enter");
  await settled(p);
  assert.equal((await state(p)).local.dirty, true);
}
async function block(p, key, method) {
  await p.evaluate(({ key, method }) => {
    const old = Storage.prototype[method];
    window.restoreUXStorage = () => Storage.prototype[method] = old;
    Storage.prototype[method] = function (k, ...args) {
      if (k === key)
        throw new DOMException("UX controlled storage failure", "QuotaExceededError");
      return old.call(this, k, ...args);
    };
  }, { key, method });
}
const restore = p => p.evaluate(() => window.restoreUXStorage?.());
async function measure(p) {
  return p.evaluate(() => {
    const visible = e => !!e?.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
    const rect = e => e.getBoundingClientRect().toJSON();
    const selectors = [".board", ".mode-note", ".timing", "#track-name", "#record-history-open", "#storage-state", ".local-heading", ".local-title h2", ".local-title > span", "#local-track-name", "#local-backup", "#local-status", ".local-footer", "#local-help", "#save-history", "#local-cleanup-description", "#game-menu", "#trackbook", "#local-recovery", "#toast"];
    const elements = selectors.flatMap(selector => {
      const e = document.querySelector(selector);
      if (!visible(e))
        return [];
      const r = document.createRange();
      r.selectNodeContents(e);
      return [{ selector, box: rect(e), ink: r.getBoundingClientRect().toJSON(), text: e.textContent, title: e.title,
          label: e.getAttribute("aria-label"), role: e.getAttribute("role"), clientWidth: e.clientWidth, scrollWidth: e.scrollWidth }];
    });
    const controls = [...document.querySelectorAll("button,#local-track-name")].filter(visible).map(e => {
      const box = rect(e), css = getComputedStyle(e), pencil = getComputedStyle(e, "::after"), range = document.createRange();
      range.selectNodeContents(e);
      return { id: e.id || e.dataset.action, box, ink: range.getBoundingClientRect().toJSON(), text: e.textContent,
        disabled: !!e.disabled, busy: e.getAttribute("aria-busy"), shortcuts: e.getAttribute("aria-keyshortcuts"),
        keycaps: [...e.querySelectorAll("kbd")].filter(visible).map(k => k.textContent),
        hits: [.15, .5, .85].flatMap(x => [.2, .5, .8].map(y => { const h = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y); return { x, y, hit: h?.id || h?.className?.baseVal || h?.className || h?.tagName, own: h === e || e.contains(h) }; })),
        focus: e === document.activeElement,
        style: { outline: css.outlineStyle, outlineWidth: css.outlineWidth, outlineColor: css.outlineColor, background: css.backgroundColor, color: css.color,
          transform: css.transform, scale: css.scale, translate: css.translate, opacity: css.opacity, boxShadow: css.boxShadow,
          pencil: { content: pencil.content, background: pencil.backgroundColor, width: pencil.width, height: pencil.height } } };
    });
    const local = paperlapDebug.local, canvas = document.querySelector(local.active ? ".local-surface" : "#game canvas"), b = rect(canvas);
    const scale = b.width / 1440, R = 54 * scale, points = (local.current || paperlapDebug.track.points).map(q => ({ x: b.x + q.x * scale, y: b.y + q.y * scale }));
    const distance = (q, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy); };
    const roadText = [];
    if (local.active)
      for (const selector of ["#local-status", "#local-backup"]) {
        const e = document.querySelector(selector);
        if (!visible(e))
          continue;
        const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        let n;
        const chars = [];
        while (n = walker.nextNode())
          for (let i = 0; i < n.length; i++) {
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const box = r.getBoundingClientRect();
            const d = Math.min(...[0, .5, 1].flatMap(x => [0, .5, 1].map(y => Math.min(...points.map((a, j) => distance({ x: box.x + box.width * x, y: box.y + box.height * y }, a, points[(j + 1) % points.length]))))));
            chars.push({ char: n.textContent[i], box: box.toJSON(), nearestRoadCenter: d, intersects: d < R });
          }
        roadText.push({ selector, R, intersections: chars.filter(x => x.intersects), characters: chars });
      }
    return { viewport: { width: innerWidth, height: innerHeight }, elements, controls, roadText, focus: document.activeElement.id || document.activeElement.className,
      overflow: document.documentElement.scrollWidth > innerWidth, state: { mode: paperlapDebug.mode, storage: paperlapDebug.storage, local: { active: local.active, busy: local.busy, dirty: local.dirty, pending: !!local.pending, error: local.pending?.error }, motion: paperlapDebug.motion } };
  });
}
async function shot(p, label) {
  await settled(p);
  const data = await measure(p), name = `${label}-${p.viewportSize().width}`;
  await p.screenshot({ path: `${output}/${name}.png` });
  await writeFile(`${output}/${name}.json`, JSON.stringify(data, null, 2));
  report.screens.push(name);
  return data;
}
function buttonsFit(name, data) {
  const buttons = data.controls.filter(b => ["local-cancel", "local-undo", "local-redo", "local-adopt", "local-save"].includes(b.id));
  const board = data.elements.find(e => e.selector === ".board").box;
  const fits = buttons.every(b =>
    b.box.left >= board.left && b.box.right <= board.right + .5 &&
    b.box.top >= board.top && b.box.bottom <= board.bottom + .5 &&
    b.hits.every(h => h.own) && b.ink.left >= b.box.left - .5 &&
    b.ink.right <= b.box.right + .5 && b.ink.top >= b.box.top - .5 &&
    b.ink.bottom <= b.box.bottom + .5);
  const separate = buttons.every((b, i) => i === 0 || b.box.left >= buttons[i - 1].box.right);
  verify(`${name}: five buttons, text and nine-point hit areas fit`, buttons.length === 5 && fits && separate);
}
function caps(name, data) {
  const buttons = data.controls.filter(b => ["local-cancel", "local-undo", "local-redo", "local-adopt", "local-save"].includes(b.id));
  verify(`${name}: F-06 disabled actions have no executable keycap`,
    buttons.every(b => b.disabled
      ? b.keycaps.length === 0 && b.shortcuts === null
      : b.keycaps.length === 1 && !!b.shortcuts));
}
async function badgeName(p, context) {
  const button = p.locator("#storage-state");
  await expect(button).toBeVisible();
  const visible = (await button.innerText()).trim(), description = await button.getAttribute("title");
  assert.ok(visible && description);
  await expect(button).toHaveAccessibleName(visible);
  await expect(button).toHaveAccessibleDescription(description);
  report.accessibility.push({ context, visible, description, snapshot: await button.ariaSnapshot() });
  verify(`${context}: status accessible name matches visible text, detail remains accessible`, true);
}
async function edgeHelp(p) {
  const official = await raw(p), backup = await raw(p, "paperlap.local-draft.v1");
  const current = (await state(p)).local.current;
  await p.locator("#local-help-toggle").click();
  assert.equal(await p.locator("#local-help").isVisible(), true);
  await shot(p, "edge-help-open");
  const geometry = await p.evaluate(() => {
    const panel = document.querySelector("#local-help"), help = panel.getBoundingClientRect(), css = getComputedStyle(panel);
    const canvas = document.querySelector(".local-surface"), box = canvas.getBoundingClientRect();
    const scale = box.width / 1440, radius = 54 * scale;
    const points = paperlapDebug.local.current.map(q => ({ x: box.x + q.x * scale, y: box.y + q.y * scale }));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const inBox = q => ({ x: clamp(q.x, help.left, help.right), y: clamp(q.y, help.top, help.bottom) });
    const corners = [help.left, help.right].flatMap(x => [help.top, help.bottom].map(y => ({ x, y })));
    let best = { distance: Infinity };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y;
      const at = t => ({ x: a.x + t * dx, y: a.y + t * dy });
      const candidates = [a, b, ...corners.map(q => at(clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1)))];
      // Exact segment/rectangle intersection as well as endpoint/corner distances.
      let lo = 0, hi = 1;
      for (const [start, delta, low, high] of [[a.x, dx, help.left, help.right], [a.y, dy, help.top, help.bottom]]) {
        if (delta === 0) {
          if (start < low || start > high) hi = -1;
        } else {
          const u = (low - start) / delta, v = (high - start) / delta;
          lo = Math.max(lo, Math.min(u, v));
          hi = Math.min(hi, Math.max(u, v));
        }
      }
      if (lo <= hi) candidates.push(at(lo));
      for (const center of candidates) {
        const q = inBox(center), distance = Math.hypot(q.x - center.x, q.y - center.y);
        if (distance < best.distance) best = { distance, center, q };
      }
    }
    // A paper corner is clipped: its enclosing rectangle is not its painted/hit shape.
    const rectangleClearance = best.distance - radius;
    const radii = [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius].map(parseFloat);
    const centers = [[help.left + radii[0], help.top + radii[0]], [help.right - radii[1], help.top + radii[1]],
      [help.right - radii[2], help.bottom - radii[2]], [help.left + radii[3], help.bottom - radii[3]]];
    const boundary = centers.flatMap(([x, y], i) => Array.from({ length: 17 }, (_, j) => {
      const a = Math.PI + i * Math.PI / 2 + j * Math.PI / 32;
      return { x: x + radii[i] * Math.cos(a), y: y + radii[i] * Math.sin(a) };
    }));
    const roundingError = Math.max(...radii) * (1 - Math.cos(Math.PI / 64));
    const path = new Path2D(); path.roundRect(help.x, help.y, help.width, help.height, radii);
    const context = document.createElement("canvas").getContext("2d");
    const project = (q, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      return { x: a.x + t * dx, y: a.y + t * dy };
    };
    const cross = (a, b) => a.x * b.y - a.y * b.x;
    best = { distance: Infinity };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (context.isPointInPath(path, a.x, a.y)) { best = { distance: 0, center: a, q: a }; break; }
      for (let j = 0; j < boundary.length; j++) {
        const c = boundary[j], d = boundary[(j + 1) % boundary.length];
        const candidates = [[a, project(a, c, d)], [b, project(b, c, d)], [project(c, a, b), c], [project(d, a, b), d]];
        const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: d.x - c.x, y: d.y - c.y }, w = { x: c.x - a.x, y: c.y - a.y }, denominator = cross(u, v);
        if (denominator) {
          const t = cross(w, v) / denominator, h = cross(w, u) / denominator;
          if (t >= 0 && t <= 1 && h >= 0 && h <= 1) {
            const q = { x: a.x + t * u.x, y: a.y + t * u.y }; candidates.push([q, q]);
          }
        }
        for (const [center, q] of candidates) {
          const distance = Math.hypot(q.x - center.x, q.y - center.y);
          if (distance < best.distance) best = { distance, center, q };
        }
      }
    }
    const fraction = best.distance ? (radius - .25) / best.distance : 0;
    const start = { x: best.center.x + (best.q.x - best.center.x) * fraction,
      y: best.center.y + (best.q.y - best.center.y) * fraction };
    const hit = document.elementFromPoint(start.x, start.y);
    const hits = [-.1, 0, .1].flatMap(dx => [-.1, 0, .1].map(dy => {
      const target = document.elementFromPoint(start.x + dx, start.y + dy);
      return { dx, dy, canvasHit: target === canvas, target: target?.id || target?.className };
    }));
    return { help: help.toJSON(), radii, radius, rectangleClearance, roundingError, roadClearance: best.distance - radius, nearest: best, start,
      hit: hit?.id || hit?.className, canvasHit: hit === canvas, hits };
  });
  verify("900x700 edge: expanded help stays outside the road stroke", geometry.roadClearance > geometry.roundingError, geometry);
  await p.mouse.move(geometry.start.x, geometry.start.y);
  await p.mouse.down();
  const dragging = (await state(p)).local.dragging;
  await p.mouse.move(geometry.start.x, geometry.start.y + 6, { steps: 8 });
  await p.mouse.up();
  await settled(p);
  const candidate = (await state(p)).local.pending;
  verify("900x700 edge: nearest road edge receives native drag with help open", geometry.canvasHit && geometry.hits.every(h => h.canvasHit) && dragging && !!candidate && !candidate.error);
  report.help.push({ ...geometry, dragging, candidateError: candidate?.error ?? null });
  await shot(p, "edge-help-drag");
  assert.deepEqual((await state(p)).local.current, current);
  assert.equal(await raw(p), official);
  assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
  if (candidate) await p.keyboard.press("Escape");
  await p.locator("#local-help-toggle").click();
  assert.equal(await p.locator("#local-help").isVisible(), false);
}
async function monitor(p) {
  await p.evaluate(() => {
    window.uxBusy = [];
    const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
    new MutationObserver(() => {
      const root = document.querySelector("#local-editor");
      if (root.getAttribute("aria-busy") !== "true")
        return;
      window.uxBusy.push({ kind: paperlapDebug.local.busy, buttons: [...root.querySelectorAll(".local-actions button")].map(b => ({ id: b.id, disabled: b.disabled, keycaps: [...b.querySelectorAll("kbd")].filter(visible).map(k => k.textContent) })) });
    }).observe(document.querySelector("#local-editor"), { subtree: true, attributes: true, childList: true });
  });
}
async function conflict(p, c, label) {
  const other = await c.newPage();
  await load(other);
  await other.evaluate(() => localStorage.setItem("paperlap.save.v3", localStorage.getItem("paperlap.save.v3") + " "));
  await p.waitForFunction(() => paperlapDebug.storage.error === "conflict");
  const old = await raw(p, "paperlap.local-draft.v1");
  await p.keyboard.press("Control+Enter");
  assert.equal(await raw(p, "paperlap.local-draft.v1"), old);
  assert.equal(await p.locator("#local-save").isDisabled(), true);
  const data = await shot(p, label);
  verify(`${label} ${p.viewportSize().width}: F-02 warning Range stays outside road`, data.roadText.every(r => r.intersections.length === 0));
  caps(label, data);
  buttonsFit(label, data);
  await other.close();
}
try {
  for (const [width, height] of [[1366, 768], [1280, 800], [900, 700]]) {
    const { p, c } = await create(width, height);
    const tag = `${width}x${height}`;
    try {
      await shot(p, "hud-normal");
      await rename(p, "晨光绕湖连续弯道局部调整与历史纪录保护的长名称赛道".repeat(2).slice(0, 40));
      await shot(p, "hud-long");
      await p.keyboard.press("l");
      await monitor(p);
      let data = await shot(p, "local-empty");
      buttonsFit(tag, data);
      caps(`${tag} empty`, data);
      await p.keyboard.press("Tab");
      data = await shot(p, "name-focus");
      const name = data.controls.find(b => b.id === "local-track-name");
      verify(`${tag}: F-01 name uses pencil instead of enclosing outline`, name.focus && (name.style.outline === "none" || name.style.outlineWidth === "0px") && name.style.pencil.content !== "none");
      await p.keyboard.press("Tab");
      await p.keyboard.press("Shift+Tab");
      verify(`${tag}: F-01 Shift+Tab returns to the full name`,
        await p.evaluate(() => document.activeElement.id === "local-track-name"));
      const heading = data.elements.find(e => e.selector === ".local-title h2"), target = data.elements.find(e => e.selector === ".local-title > span"), full = data.elements.find(e => e.selector === "#local-track-name");
      verify(`${tag}: F-05 independent title/name with accessible full name`, heading.box.bottom <= target.box.top + .5 && full.title === full.text && full.text.length === 40 && (width !== 900 || full.scrollWidth > full.clientWidth));
      const before = await p.locator("#local-save").evaluate(e => getComputedStyle(e).backgroundColor);
      await p.locator("#local-save").hover();
      data = await shot(p, "disabled-hover");
      const save = data.controls.find(b => b.id === "local-save");
      verify(`${tag}: F-07 disabled primary hover keeps readable background`, save.disabled && save.style.background === before && save.style.transform === "none" && save.style.scale === "1");
      await p.mouse.down();
      const pressed = await measure(p);
      await p.mouse.up();
      const disabledPressed = pressed.controls.find(b => b.id === "local-save");
      verify(`${tag}: F-07 disabled pointer press stays inert`, disabledPressed.disabled && disabledPressed.style.boxShadow === save.style.boxShadow && disabledPressed.style.transform === "none" && disabledPressed.style.scale === "1");
      if (await p.locator("#local-help-toggle").count()) {
        await p.locator("#local-help-toggle").focus();
        await p.keyboard.press("Enter");
        verify(`${tag}: native Enter opens operation help`, await p.locator("#local-help").isVisible());
        await shot(p, "local-help");
        await p.keyboard.press("Space");
        assert.equal(await p.locator("#local-help").isVisible(), false);
      }
      const original = await raw(p);
      await drag(p);
      data = await shot(p, "local-valid");
      caps(`${tag} valid`, data);
      assert.equal((await state(p)).local.pending.error, null);
      await p.locator("#local-adopt").focus();
      await p.keyboard.press("Space");
      await settled(p);
      assert.equal(await raw(p), original);
      assert.equal((await state(p)).local.dirty, true);
      await shot(p, "local-adopted");
      await p.locator("#local-save").hover();
      await settled(p);
      verify(`${tag}: enabled primary keeps its normal hover`, await p.locator("#local-save").evaluate(e => !e.disabled && getComputedStyle(e).backgroundColor === "rgb(183, 68, 34)"));
      const backup = await raw(p, "paperlap.local-draft.v1");
      await block(p, "paperlap.local-draft.v1", "setItem");
      await drag(p, -13);
      await p.keyboard.press("Enter");
      await settled(p);
      assert.match(await p.locator("#local-backup").innerText(), /未备份/);
      assert.equal(await raw(p, "paperlap.local-draft.v1"), backup);
      data = await shot(p, "draft-quota");
      caps(`${tag} draft failure`, data);
      await restore(p);
      const accepted = (await state(p)).local.current;
      // Keep the illegal gesture inside the viewport; Firefox cancels off-window capture.
      await drag(p, 360);
      assert.ok((await state(p)).local.pending.error);
      await p.keyboard.press("Enter");
      await settled(p);
      assert.deepEqual((await state(p)).local.current, accepted);
      data = await shot(p, "local-invalid");
      caps(`${tag} invalid`, data);
      await p.keyboard.press("Escape");
      await p.keyboard.press("Control+z");
      await p.keyboard.press("Control+Shift+z");
      await settled(p);
      await block(p, "paperlap.save.v3", "setItem");
      await p.keyboard.press("Control+Enter");
      await settled(p);
      assert.equal(await raw(p), original);
      assert.equal((await state(p)).local.active, true);
      await shot(p, "save-quota");
      await restore(p);
      await p.keyboard.press("Escape");
      assert.equal(await p.locator("#game-menu").getAttribute("data-layer"), "discard");
      await shot(p, "discard-confirm");
      await p.keyboard.press("Escape");
      const editingBusy = await p.evaluate(() => window.uxBusy);
      report.busy.push({ width, stage: "editing", samples: editingBusy });
      verify(`${tag}: F-06 validating/adopting keep cancel Esc`, editingBusy.some(s => s.kind === "validating") && editingBusy.some(s => s.kind === "adopting") && editingBusy.every(s => s.buttons.every(b => b.id === "local-cancel" ? !b.disabled && b.keycaps.includes("Esc") : b.disabled && b.keycaps.length === 0)));
      const current = (await state(p)).local.current;
      await p.reload();
      await p.waitForFunction(() => window.paperlapDebug);
      await p.keyboard.press("l");
      await p.locator("#local-recovery[open]").waitFor();
      await shot(p, "draft-recovery");
      await p.locator("#local-continue").click();
      assert.deepEqual((await state(p)).local.current, current);
      await shot(p, "local-restored");
      await monitor(p);
      await block(p, "paperlap.local-draft.v1", "removeItem");
      const kept = await raw(p, "paperlap.local-draft.v1");
      await p.keyboard.press("Meta+Enter");
      await settled(p);
      assert.equal((await state(p)).mode, "ready");
      assert.notEqual(await raw(p), original);
      assert.equal(await raw(p, "paperlap.local-draft.v1"), kept);
      await shot(p, "saved-cleanup");
      await p.waitForFunction(() => !document.querySelector("#toast").textContent);
      data = await shot(p, "cleanup-persistent");
      await badgeName(p, `${tag} cleanup`);
      const badge = data.elements.find(e => e.selector === "#storage-state");
      verify(`${tag}: F-03 saved/draft-retained warning outlives toast`, !!badge && /赛道已保存/.test(badge.text) && /草稿/.test(badge.text));
      await p.locator("#record-history-open").click();
      data = await shot(p, "cleanup-history");
      const notice = data.elements.find(e => e.selector === "#local-cleanup-description");
      verify(`${tag}: F-03 history explains saved, retained, incomplete cleanup`, !!notice && /赛道已保存/.test(notice.text) && /保留/.test(notice.text) && /未.*清理|清理未/.test(notice.text));
      if (await p.locator("#acknowledge-local-notice").isVisible()) {
        const formalSaved = await raw(p);
        await p.locator("#acknowledge-local-notice").focus();
        await p.keyboard.press("Space");
        assert.equal(await raw(p), formalSaved);
        assert.equal(await raw(p, "paperlap.local-draft.v1"), kept);
        assert.equal(await p.locator("#local-cleanup-notice").isVisible(), false);
        verify(`${tag}: F-03 acknowledgement changes UI only`, true);
      }
      await p.keyboard.press("Escape");
      const historyReturnFocus = await p.evaluate(() => document.activeElement.id);
      verify(`${tag}: pointer history returns focus to its entry`, historyReturnFocus === "record-history-open", { actual: historyReturnFocus });
      // Keep the focus failure red, then recover through native keys to exercise independent cases.
      if (historyReturnFocus !== "record-history-open") await gameFocus(p);
      await restore(p);
      await p.keyboard.press("Escape");
      await shot(p, "esc-menu");
      await p.keyboard.press("t");
      await shot(p, "trackbook");
      await p.keyboard.press("Escape");
      assert.equal(await p.locator("#game-menu").isVisible(), true);
      await p.keyboard.press("Escape");
      const busy = await p.evaluate(() => window.uxBusy);
      report.busy.push({ width, samples: busy });
      verify(`${tag}: F-06 busy keeps only cancel Esc`, busy.length > 0 && busy.every(s => s.buttons.every(b => b.id === "local-cancel" ? !b.disabled && b.keycaps.includes("Esc") : b.disabled && b.keycaps.length === 0)));
      const other = await c.newPage();
      await load(other);
      assert.equal((await state(other)).storage.writable, false);
      data = await shot(other, "readonly");
      await badgeName(other, `${tag} readonly`);
      const warn = data.controls.find(b => b.id === "storage-state");
      verify(`${tag}: F-04 warning nine-point hit test`, warn.hits.every(h => h.own));
      let native = true;
      const pointerChecks = [];
      for (const x of [.15, .5, .85])
        for (const y of [.2, .5, .8]) {
          await settled(other);
          const b = await other.locator("#storage-state").boundingBox();
          await other.mouse.click(b.x + b.width * x, b.y + b.height * y);
          const opened = await other.locator("#save-history").isVisible();
          native &&= opened;
          if (opened) {
            await other.keyboard.press("Escape");
            const returned = await other.evaluate(() => document.activeElement.id);
            pointerChecks.push({ x, y, opened, returned });
            native = native && returned === "storage-state";
          }
        }
      report.nativeFocus.push({ width, pointerChecks });
      verify(`${tag}: F-04 all nine native clicks open the panel`, pointerChecks.length === 9 && pointerChecks.every(x => x.opened));
      verify(`${tag}: F-04 all nine native clicks and focus return`, native, pointerChecks);
      for (const key of ["Enter", "Space"]) {
        await other.locator("#storage-state").focus();
        await other.keyboard.press(key);
        assert.equal(await other.locator("#save-history").isVisible(), true);
        await shot(other, `readonly-${key.toLowerCase()}`);
        await other.keyboard.press("Escape");
        assert.equal(await other.evaluate(() => document.activeElement.id), "storage-state");
      }
      await other.close();
      await gameFocus(p);
      await p.keyboard.press("l");
      await adopt(p);
      await conflict(p, c, "default-conflict");
    }
    finally {
      await c.close();
    }
    const { p: edge, c: ec } = await create(width, height, false);
    try {
      await edge.locator("#trackbook-open").click();
      await edge.locator("#new-track").click();
      const b = await edge.locator(".draw-surface").boundingBox();
      const points = Array.from({ length: 181 }, (_, i) => ({ x: 720 + 440 * Math.cos(i / 180 * Math.PI * 2), y: 442 + 257 * Math.sin(i / 180 * Math.PI * 2) }));
      const at = q => ({ x: b.x + q.x / 1440 * b.width, y: b.y + q.y / 860 * b.height });
      const first = at(points[0]);
      await edge.mouse.move(first.x, first.y);
      await edge.mouse.down();
      for (const q of points.slice(1)) {
        const a = at(q);
        await edge.mouse.move(a.x, a.y);
      }
      await edge.mouse.up();
      await edge.waitForFunction(() => paperlapDebug.draft.valid);
      await edge.keyboard.press("Enter");
      assert.equal((await state(edge)).mode, "ready");
      await edge.keyboard.press("l");
      await adopt(edge);
      if (width === 900) await edgeHelp(edge);
      await edge.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      await edge.locator(".local-surface").focus();
      await edge.keyboard.press("Tab");
      let data = await shot(edge, "forced-name-focus");
      const name = data.controls.find(b => b.id === "local-track-name");
      const forcedColorsActive = await edge.evaluate(() => matchMedia("(forced-colors: active)").matches);
      report.media.push({ width, forcedColorsActive, reducedMotion: (await state(edge)).motion.reduced });
      if (forcedColorsActive) verify(`${tag}: F-01 forced-colors retains visible pencil`, name.focus && name.style.pencil.content !== "none" && name.style.pencil.background !== "rgba(0, 0, 0, 0)");
      else { report.notTested.push(`${tag}: forced-colors unavailable in this engine/runtime`); console.log(`NOT TESTED ${tag}: forced-colors media did not activate`); }
      assert.equal((await state(edge)).motion.reduced, true);
      await edge.emulateMedia({ forcedColors: "none" });
      await conflict(edge, ec, "edge-conflict");
    }
    finally {
      await ec.close();
    }
  }
}
finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log("Headless UX contexts and browser closed");
}
assert.deepEqual(report.errors, []);
assert.deepEqual(report.failures, [], "UI regression findings remain");
