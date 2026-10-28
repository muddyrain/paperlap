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
  new URL("../test-results/draft/interruption/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const state = (p) => p.evaluate(() => window.paperlapDebug);
const backup = (p) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("paperlap.draft.v2")));
const saved = (p) => p.evaluate(() => localStorage.getItem("paperlap.save.v3"));
async function ready(p, reload = false) {
  if (reload) await p.reload();
  else await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function stroke(p, points, release = true) {
  const r = await p.locator(".draw-surface").boundingBox();
  const at = (q) => ({
    x: r.x + (q.x * r.width) / 1440,
    y: r.y + (q.y * r.height) / 860,
  });
  const first = at(points[0]);
  await p.mouse.move(first.x, first.y);
  await p.mouse.down();
  for (const point of points.slice(1)) {
    const q = at(point);
    await p.mouse.move(q.x, q.y);
  }
  if (release) await p.mouse.up();
  else {
    await p.waitForTimeout(1100);
    const last = at({ ...points.at(-1), x: points.at(-1).x + 8 });
    await p.mouse.move(last.x, last.y);
  }
}
try {
  for (const event of [
    "reload",
    "pagehide",
    "blur",
    "resize",
    "pointercancel",
  ]) {
    const context = await browser.newContext({
      viewport:
        event === "resize"
          ? { width: 1280, height: 800 }
          : { width: 900, height: 700 },
      reducedMotion: event === "pagehide" ? "reduce" : "no-preference",
    });
    try {
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      p.on("requestfailed", (r) => failedRequests.push(r.url()));
      await ready(p);
      const official = await saved(p);
      await p.locator("#edit").click();
      await stroke(p, wobblyLoop());
      assert.equal((await state(p)).draft.valid, true);
      const a = (await backup(p)).entries[0].current;
      const trackA = (await state(p)).trackId;
      await p.keyboard.press("r");
      await stroke(p, wobblyLoop(Math.PI).slice(0, 45), false);
      const partial = (await backup(p)).entries[0];
      assert.equal(partial.current.phase, "interrupted");
      assert.deepEqual(
        partial.retained,
        a,
        "periodic B checkpoint must retain complete A before any interruption",
      );
      if (event === "reload") await ready(p, true);
      else {
        if (event === "resize")
          await p.setViewportSize({ width: 900, height: 700 });
        else if (event === "pointercancel")
          await p
            .locator(".draw-surface")
            .dispatchEvent("pointercancel", { pointerId: 1 });
        else
          await p.evaluate(
            (event) =>
              window.dispatchEvent(
                event === "pagehide"
                  ? new PageTransitionEvent("pagehide")
                  : new Event("blur"),
              ),
            event,
          );
        await p.waitForFunction(
          () => window.paperlapDebug.draft.phase === "interrupted",
        );
        assert.equal((await state(p)).draft.phase, "interrupted");
        assert.deepEqual((await backup(p)).entries[0].retained, a);
        await ready(p, true);
      }
      await p.mouse.up();
      await p.locator("#edit").click();
      await p.locator("#draft-recovery[open]").waitFor();
      assert.match(
        await p.locator("#draft-range").innerText(),
        /完整.*笔迹.*撤销|撤销.*完整.*笔迹/,
      );
      await p.locator("#continue-draft").click();
      assert.equal((await state(p)).draft.valid, false);
      assert.equal(await p.locator("#drive-drawing").isEnabled(), false);
      const modifier = await p.evaluate(() =>
        /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
      );
      await p.keyboard.press(`${modifier}+z`);
      assert.equal((await state(p)).draft.valid, true);
      assert.equal((await state(p)).trackId, trackA);
      assert.deepEqual((await backup(p)).entries[0].current, a);
      assert.equal((await state(p)).mode, "editing");
      assert.equal(await saved(p), official);
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${output}${event}-restored-a.png` });
      checks.push(
        `${event}: unfinished B retains completed A through periodic checkpoint, interruption, reload and undo without official writes`,
      );
      console.log(`PASS ${checks.at(-1)}`);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify({ checks, errors, failedRequests }, null, 2),
  );
  await browser.close();
}
console.log(`Passed ${checks.length} interruption browser checks`);
