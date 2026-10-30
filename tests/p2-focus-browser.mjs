import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { launchHeadless, engineName } from "./fixtures/release-engine.mjs";
import { decodeScreenshot } from "./fixtures/release-png.mjs";

const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = process.env.PAPERLAP_P2_OUTPUT || `test-results/p2-focus/${engineName}`;
await mkdir(output, { recursive: true });
const browser = await launchHeadless();
const report = { engine: engineName, browser: browser.version(), headless: true, checks: [], traces: [], screens: [], errors: [], notTested: [] };
const state = p => p.evaluate(() => paperlapDebug);
const raw = p => p.evaluate(() => localStorage.getItem("paperlap.save.v3"));
const focus = p => p.evaluate(() => document.activeElement.id);
function verify(name, ok, detail) {
  report.checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${engineName}: ${name}`);
}
async function settled(p) {
  await p.evaluate(async () => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
}
async function load(p) {
  p.on("pageerror", e => report.errors.push(e.message));
  await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas"));
}
async function snapshot(p, label, screenshot = false) {
  await settled(p);
  const data = await p.evaluate(() => {
    const e = document.activeElement, css = getComputedStyle(e), mark = getComputedStyle(e, "::after");
    const range = document.createRange(); range.selectNodeContents(e);
    return { id: e.id, tag: e.tagName, connected: e.isConnected, visible: e.getClientRects().length > 0, disabled: !!e.disabled,
      box: e.getBoundingClientRect().toJSON(), range: range.getBoundingClientRect().toJSON(), text: e.textContent, title: e.title,
      outline: css.outlineStyle, outlineWidth: css.outlineWidth, background: css.backgroundColor,
      mark: { content: mark.content, width: mark.width, height: mark.height, background: mark.backgroundColor, forcedAdjust: mark.forcedColorAdjust },
      input: document.querySelector(".board").dataset.input, forced: matchMedia("(forced-colors: active)").matches,
      forcedAdjustSupported: CSS.supports("forced-color-adjust", "none"),
      reduced: paperlapDebug.motion.reduced, mode: paperlapDebug.mode,
      historyOpen: document.querySelector("#save-history").open, menuOpen: document.querySelector("#game-menu").open,
      parentDialog: e.closest("dialog") ? { id: e.closest("dialog").id, open: e.closest("dialog").open } : null };
  });
  report.traces.push({ label, ...data });
  if (screenshot) { await p.screenshot({ path: `${output}/${label}.png` }); report.screens.push(`${label}.png`); }
  return data;
}
function pencil(data) {
  return (data.outline === "none" || parseFloat(data.outlineWidth) === 0) && data.mark.content !== "none" &&
    parseFloat(data.mark.width) >= 20 && parseFloat(data.mark.height) <= 4 && data.mark.background !== "rgba(0, 0, 0, 0)";
}
async function tabTo(p, id) {
  await p.locator("#game").focus();
  // This macOS WebKit runtime uses Option+Tab for native buttons; never pass it off as plain Tab.
  const key = engineName === "webkit" ? "Alt+Tab" : "Tab";
  for (let i = 0; i < 24 && await focus(p) !== id; i++) await p.keyboard.press(key);
  assert.equal(await focus(p), id, `native ${key} reaches ${id}`);
}
async function paintedPencil(p, data) {
  const image = decodeScreenshot(await p.locator("#track-name").screenshot());
  const rgba = data.mark.background.match(/[\d.]+/g)?.map(Number);
  const bg = data.background.match(/[\d.]+/g)?.map(Number);
  if (!rgba || !bg) return { matchedPixels: 0 };
  const alpha = rgba[3] ?? 1, expected = rgba.slice(0, 3).map((v, i) => alpha * v + (1 - alpha) * bg[i]);
  let matchedPixels = 0;
  for (let x = 3; x < 27; x++) for (let y = image.height - 5; y < image.height; y++) {
    const pixel = image.pixel(x, y);
    if (Math.hypot(...expected.map((v, i) => v - pixel[i])) < 45 && Math.hypot(...bg.slice(0, 3).map((v, i) => v - pixel[i])) > 15) matchedPixels++;
  }
  return { matchedPixels, expected, screenshotSize: [image.width, image.height] };
}
async function history(p, trigger, openBy, closeBy, tag, shot) {
  const original = await raw(p);
  if (openBy === "pointer") await p.locator(`#${trigger}`).click();
  else { await tabTo(p, trigger); await p.keyboard.press(openBy); }
  assert.equal(await p.locator("#save-history").isVisible(), true);
  const paused = await state(p);
  assert.notEqual(paused.mode, "running"); assert.deepEqual(paused.keys, []);
  await snapshot(p, `${tag}-opened`);
  if (closeBy === "pointer") await p.locator("#history-close").click();
  else await p.keyboard.press("Escape");
  const returned = await snapshot(p, `${tag}-returned`, shot);
  verify(`${tag}: return to actual trigger`, returned.id === trigger && returned.connected && returned.visible && !returned.disabled && !returned.parentDialog && !returned.historyOpen && !returned.menuOpen, returned);
  await p.keyboard.press("Escape");
  const menu = await snapshot(p, `${tag}-next-esc`);
  verify(`${tag}: exactly one Esc opens game menu without driving`, menu.menuOpen && !menu.historyOpen && menu.mode === paused.mode, menu);
  if (menu.menuOpen) {
    await p.keyboard.press("t"); assert.equal(await p.locator("#trackbook").isVisible(), true);
    await p.keyboard.press("Escape"); assert.equal(await p.locator("#game-menu").isVisible(), true);
    assert.equal(await focus(p), "menu-book");
    await p.keyboard.press("Escape"); assert.equal(await p.locator("#game-menu").isVisible(), false);
    verify(`${tag}: book / menu / game return`, await focus(p) === "game", { focus: await focus(p) });
  } else {
    // Retain the failed path, then establish a known focus for the next independent case.
    await p.locator("#game").focus();
  }
  const after = await state(p);
  assert.equal(after.mode, paused.mode); assert.equal(after.lap.elapsed, paused.lap.elapsed); assert.deepEqual(after.car, paused.car);
  assert.equal(await raw(p), original);
}
async function hiddenNoticeReturn(p, width) {
  await p.locator("#local-edit").click();
  const idle = () => p.waitForFunction(() => !paperlapDebug.local.busy && document.querySelector("#local-editor").getAttribute("aria-busy") === "false");
  await idle();
  const points = (await state(p)).local.current, q = points.reduce((a, b) => b.x < a.x ? b : a), box = await p.locator(".local-surface").boundingBox();
  await p.mouse.move(box.x + q.x / 1440 * box.width, box.y + q.y / 860 * box.height); await p.mouse.down();
  await p.mouse.move(box.x + (q.x - 8) / 1440 * box.width, box.y + q.y / 860 * box.height, { steps: 12 }); await p.mouse.up(); await idle();
  assert.equal((await state(p)).local.pending.error, null); await p.keyboard.press("Enter"); await idle();
  const official = await raw(p), draft = await p.evaluate(() => localStorage.getItem("paperlap.local-draft.v1"));
  await p.evaluate(() => {
    const remove = Storage.prototype.removeItem; window.qaRestoreRemove = () => Storage.prototype.removeItem = remove;
    Storage.prototype.removeItem = function(key) { if (key === "paperlap.local-draft.v1") throw new DOMException("P2 controlled cleanup failure", "QuotaExceededError"); return remove.call(this, key); };
  });
  try {
    await p.locator("#local-save").click(); await p.waitForFunction(() => paperlapDebug.mode === "ready" && !paperlapDebug.local.busy);
    const saved = await raw(p); assert.notEqual(saved, official);
    await p.locator("#storage-state").click(); await p.locator("#acknowledge-local-notice").click();
    assert.equal(await p.locator("#storage-state").isVisible(), false);
    await p.locator("#history-close").click(); const returned = await snapshot(p, `${width}-hidden-notice-returned`);
    verify(`${width}: acknowledged hidden badge returns to history entry`, returned.id === "record-history-open" && returned.visible && !returned.parentDialog, returned);
    await p.keyboard.press("Escape");
    verify(`${width}: Esc after hidden badge opens menu without driving`, await p.locator("#game-menu").isVisible() && (await state(p)).mode === "ready");
    if (await p.locator("#game-menu").isVisible()) await p.keyboard.press("Escape");
    assert.equal(await raw(p), saved); assert.equal(await p.evaluate(() => localStorage.getItem("paperlap.local-draft.v1")), draft);
  } finally { await p.evaluate(() => window.qaRestoreRemove()); }
}
try {
  for (const [width, height] of [[1366, 768], [1280, 800], [900, 700]]) {
    const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    try {
      const p = await c.newPage(); await load(p);
      const normal = (await state(p)).track.name;
      const long = "焦点精准修复四十字赛道名称键盘鼠标全文与存档保护".repeat(2).slice(0, 40);
      for (const [kind, name] of [["normal", normal], ["long", long]]) {
        if (kind === "long") {
          await p.locator("#trackbook-open").click(); await p.locator('[data-action="rename"]').first().click();
          await p.locator("#track-name-input").fill(name); await p.locator("#rename-save").click(); await p.keyboard.press("Escape");
        }
        await p.locator("#game").focus(); await p.keyboard.press("Tab");
        const d = await snapshot(p, `${width}-${kind}-keyboard`, true);
        verify(`${width} ${kind}: HUD paper wash and pencil, full name`, d.id === "track-name" && d.title === name && d.text === name && pencil(d) && d.background !== "rgba(0, 0, 0, 0)", d);
        await p.keyboard.press("Shift+Tab"); assert.equal(await focus(p), "game");
        await p.locator("#track-name").click();
        const pointer = await snapshot(p, `${width}-${kind}-pointer`, kind === "long");
        const nameStyle = await p.locator("#track-name").evaluate(e => ({ background: getComputedStyle(e).backgroundColor, mark: getComputedStyle(e, "::after").content }));
        verify(`${width} ${kind}: pointer has no keyboard pencil`, pointer.input === "pointer" && nameStyle.mark === "none" && nameStyle.background === "rgba(0, 0, 0, 0)", nameStyle);
      }
      await p.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await p.waitForFunction(() => paperlapDebug.motion.reduced);
      await p.locator("#game").focus(); await p.keyboard.press("Tab");
      const forced = await snapshot(p, `${width}-long-forced`, true);
      const painted = await paintedPencil(p, forced);
      if (!forced.forcedAdjustSupported) report.notTested.push(`${width}: forced-color-adjust CSS property unsupported; media and painted pencil tested, native OS high contrast not tested`);
      verify(`${width}: forced-colors pencil and reduced-motion`, forced.forced && forced.reduced && pencil(forced) && painted.matchedPixels >= 10 && (!forced.forcedAdjustSupported || forced.mark.forcedAdjust === "none"), { ...forced, painted });
      await p.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
      for (const openBy of ["pointer", "Enter", "Space"]) for (const closeBy of ["pointer", "Escape"])
        await history(p, "record-history-open", openBy, closeBy, `${width}-hud-${openBy}-${closeBy}`, openBy === "pointer" && closeBy === "pointer");
      // Opening history while actually driving must pause and may never resume on dismissal.
      await p.locator("#start").click(); await p.keyboard.down("ArrowUp"); await p.waitForFunction(() => paperlapDebug.car.speed > 20);
      await history(p, "record-history-open", "pointer", "pointer", `${width}-driving`, false); await p.keyboard.up("ArrowUp");
      const reader = await c.newPage(); await load(reader); assert.equal((await state(reader)).storage.writable, false);
      await reader.emulateMedia({ reducedMotion: "reduce" }); await reader.waitForFunction(() => paperlapDebug.motion.reduced);
      for (const openBy of ["pointer", "Enter", "Space"]) for (const closeBy of ["pointer", "Escape"])
        await history(reader, "storage-state", openBy, closeBy, `${width}-readonly-${openBy}-${closeBy}`, openBy === "pointer" && closeBy === "pointer");
      await hiddenNoticeReturn(p, width);
      console.log(`DONE ${engineName}: ${width}x${height}`);
    } finally { await c.close(); }
  }
  assert.deepEqual(report.errors, []);
} catch (error) { report.error = error.stack; process.exitCode = 1; console.log(`FAIL ${engineName}: ${error.message}`); }
finally {
  await browser.close();
  report.status = report.error || report.errors.length || report.checks.some(c => c.status === "FAIL") ? "FAIL" : "PASS";
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
