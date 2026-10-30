import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { launchHeadless, engineName } from "./fixtures/release-engine.mjs";
import { decodeScreenshot } from "./fixtures/release-png.mjs";
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:4220", output = process.env.PAPERLAP_RELEASE_OUTPUT || `test-results/release/${engineName}`;
await mkdir(output, { recursive: true }); const browser = await launchHeadless();
const report = { engine: engineName, browser: browser.version(), headless: true, viewports: [], errors: [], consoleErrors: [], failedRequests: [] };
const state = p => p.evaluate(() => paperlapDebug);
const idle = p => p.waitForFunction(() => !paperlapDebug.local.busy && (!paperlapDebug.local.active || document.querySelector("#local-editor").getAttribute("aria-busy") === "false"));
async function settled(p) { await idle(p); await p.evaluate(async () => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); }
async function drag(p, dx) {
  const points = (await state(p)).local.current, q = points.reduce((a, b) => b.x < a.x ? b : a), b = await p.locator(".local-surface").boundingBox();
  await p.mouse.move(b.x + q.x / 1440 * b.width, b.y + q.y / 860 * b.height); await p.mouse.down(); assert.equal((await state(p)).local.dragging, true);
  await p.mouse.move(b.x + (q.x + dx) / 1440 * b.width, b.y + q.y / 860 * b.height, { steps: 12 }); await p.mouse.up(); await idle(p);
}
try {
 for (const [width, height] of [[1366, 768], [1280, 800], [900, 700]]) {
  let c, p; const item = { width, height, status: "FAIL" };
  try {
   c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }); p = await c.newPage(); p.on("pageerror", e => report.errors.push(e.message)); p.on("console", m => { if (m.type() === "error") report.consoleErrors.push(m.text()); }); p.on("requestfailed", r => report.failedRequests.push(r.url()));
   await p.goto(`${base}/?debug=1`); await p.waitForFunction(() => window.paperlapDebug && document.querySelector("#game canvas"));
   const canvas = await p.locator("#game canvas").boundingBox(); assert.ok(canvas.x >= -.5 && canvas.y >= -.5 && canvas.x + canvas.width <= width + .5 && canvas.y + canvas.height <= height + .5);
   assert.ok(Math.abs(canvas.width / 1440 - canvas.height / 860) < .002);
   const image = decodeScreenshot(await p.locator("#game canvas").screenshot());
   const points = (await state(p)).track.points, testPoints = [points.reduce((a, b) => b.x < a.x ? b : a), points.reduce((a, b) => b.x > a.x ? b : a), points.reduce((a, b) => b.y < a.y ? b : a)];
   const painted = testPoints.map(q => {
    const x = Math.round(q.x / 1440 * image.width), y = Math.round(q.y / 860 * image.height); let dark = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const [r, g, b, a] = image.pixel(x + dx, y + dy); if (a > 200 && r > 70 && g > 70 && b > 70 && r < 220 && g < 220 && b < 220) dark++; }
    return { q, darkPixelsOf49: dark };
   }); assert.ok(painted.filter(p => p.darkPixelsOf49 >= 25).length >= 2, JSON.stringify(painted));
   const paperX = Math.round(30 / 1440 * image.width), paperY = Math.round(430 / 860 * image.height); let paperPixels = 0;
   for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { const [r,g,b,a] = image.pixel(paperX+dx,paperY+dy); if (a>200 && r>220 && g>210 && b>180) paperPixels++; }
   assert.ok(paperPixels >= 25, "canvas must paint paper as well as road, not uniform blank/black");
   const backend = await p.evaluate(() => { const c = document.querySelector("#game canvas"), gl = c.getContext("webgl2") || c.getContext("webgl"); return gl ? gl.getParameter(gl.VERSION) : "Canvas2D"; });
   item.canvas = { box: canvas, backend, painted, paperPixelsOf49: paperPixels };
   const first = (await state(p)).car; await p.locator("#start").click(); await p.keyboard.down("ArrowUp"); await p.waitForFunction(() => paperlapDebug.car.speed > 50 && paperlapDebug.lap.elapsed > .4); await p.keyboard.up("ArrowUp");
   const driven = await state(p); assert.ok(Math.hypot(driven.car.x - first.x, driven.car.y - first.y) > 10);
   await p.keyboard.press("Tab"); assert.notEqual((await state(p)).mode, "running");
   const focus = await p.evaluate(() => { const e = document.activeElement, css = getComputedStyle(e), pencil = getComputedStyle(e, "::after"); return { id: e.id, outline: css.outlineStyle, outlineWidth: css.outlineWidth, mark: pencil.content, markWidth: pencil.width, markHeight: pencil.height }; });
   item.focus = focus;
   try { assert.ok(focus.outline === "none" || parseFloat(focus.outlineWidth) === 0, "focus must not have a visible enclosing outline"); assert.notEqual(focus.mark, "none"); assert.ok(parseFloat(focus.markWidth) >= 20 && parseFloat(focus.markHeight) <= 4); item.focusStyleStatus = "PASS"; }
   catch (error) { item.focusStyleStatus = "FAIL"; item.focusStyleError = error.message; process.exitCode = 1; }
   await settled(p); await p.screenshot({ path: `${output}/hud-focus-${width}.png` });
   await p.keyboard.press("Shift+Tab"); assert.equal(await p.evaluate(() => document.activeElement.id), "game");
   await p.keyboard.press("Escape"); assert.equal(await p.locator("#game-menu").isVisible(), true); await p.keyboard.press("Enter"); assert.equal((await state(p)).mode, "running");
   await p.keyboard.press("Space"); await p.keyboard.press("r"); assert.equal((await state(p)).mode, "running"); await p.keyboard.press("Space"); assert.equal((await state(p)).mode, "paused");
   await p.keyboard.press("t"); assert.equal(await p.locator("#trackbook").isVisible(), true); await p.locator("#trackbook-close").focus(); await p.keyboard.press("Space"); assert.equal(await p.locator("#trackbook").isVisible(), false);
   const muted = (await state(p)).sound.muted; await p.locator("#sound").focus(); await p.keyboard.press("Enter"); assert.equal((await state(p)).sound.muted, !muted); await p.keyboard.press("Space"); assert.equal((await state(p)).sound.muted, muted); assert.notEqual((await state(p)).mode, "running");
   await p.locator("#trackbook-open").click(); await p.locator('[data-action="rename"]').first().click();
   const longName = "最终验收长名称赛道键盘鼠标与原文保护".repeat(3).slice(0, 40); await p.locator("#track-name-input").fill(longName); await p.locator("#rename-save").click(); await p.keyboard.press("Escape"); await p.locator("#game").focus();
   await settled(p); await p.screenshot({ path: `${output}/hud-${width}.png` });
   await p.keyboard.press("l"); await idle(p); assert.equal(await p.locator("#local-track-name").getAttribute("title"), longName);
   await p.keyboard.press("Tab"); assert.equal(await p.evaluate(() => document.activeElement.id), "local-track-name"); await p.keyboard.press("Tab"); await p.keyboard.press("Shift+Tab"); assert.equal(await p.evaluate(() => document.activeElement.id), "local-track-name");
   await p.locator(".local-surface").focus(); const original = await p.evaluate(() => localStorage.getItem("paperlap.save.v3"));
   await drag(p, -8); assert.equal((await state(p)).local.pending.error, null); await p.keyboard.press("Escape");
   await drag(p, 360); assert.ok((await state(p)).local.pending.error); await p.keyboard.press("Enter"); await idle(p); assert.equal((await state(p)).local.dirty, false); assert.equal(await p.evaluate(() => localStorage.getItem("paperlap.save.v3")), original); await p.keyboard.press("Escape");
   await settled(p); await p.screenshot({ path: `${output}/local-${width}.png` });
   await p.keyboard.press("Escape"); await p.emulateMedia({ reducedMotion: "reduce" }); await p.waitForFunction(() => paperlapDebug.motion.reduced);
   await p.locator("#game").focus(); await p.keyboard.press("Escape"); assert.equal(await p.locator("#game-menu").isVisible(), true); assert.equal((await state(p)).motion.active, 0); await p.keyboard.press("Escape");
   const dom = await p.evaluate(() => {
    const boxes = [".timing", ".mode-note", ".top-actions"].map(selector => { const e = document.querySelector(selector), r = document.createRange();r.selectNodeContents(e);return { selector, box:e.getBoundingClientRect().toJSON(), range:r.getBoundingClientRect().toJSON(), text:e.textContent }; });
    const controls = [...document.querySelectorAll("button")].filter(e => e.getClientRects().length).map(e => { const b=e.getBoundingClientRect();return { id:e.id, box:b.toJSON(), disabled:e.disabled, hits:[.15,.5,.85].flatMap(x=>[.2,.5,.8].map(y=>{const h=document.elementFromPoint(b.x+x*b.width,b.y+y*b.height);return h===e||e.contains(h);} )) }; });
    return { boxes, controls, focus:document.activeElement.id };
   }); item.dom = dom; item.focus = focus; item.functionalStatus = "PASS"; item.status = item.focusStyleStatus === "PASS" ? "PASS" : "FAIL";
   await writeFile(`${output}/smoke-${width}.json`,JSON.stringify(item,null,2)); console.log(`${item.status} ${engineName}: functional=${item.functionalStatus}, focus-style=${item.focusStyleStatus}, painted Phaser/FIT and native interactions ${width}x${height}`);
  } catch (error) { item.error=error.stack;process.exitCode=1; if(p&&!p.isClosed())await p.screenshot({path:`${output}/smoke-${width}-failure.png`}).catch(()=>{});console.log(`FAIL ${engineName}: smoke ${width}: ${error.message}`); }
  finally { await c?.close(); report.viewports.push(item); }
 }
 report.status = report.viewports.every(x=>x.status==="PASS")&&!report.errors.length ? "PASS" : "FAIL";
} finally { await browser.close(); await writeFile(`${output}/smoke.json`,JSON.stringify(report,null,2)); }
