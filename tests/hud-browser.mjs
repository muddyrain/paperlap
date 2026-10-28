import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

delete process.env.PWDEBUG;
const fixture = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import * as v2 from './src/game/save.ts';
import * as v3 from './src/game/save-v3.ts';
import {storageTextDigest} from './src/game/geometry-identity.ts';
const old=v2.freshSave();old.tracks[0].track.name='清晨绕湖练习·保留历史与当前纪录的长名称赛道'.repeat(2).slice(0,40);
old.records[v2.recordKey(old.tracks[0],1)]=20.12;
old.records[v2.recordKey(old.tracks[0],2)]=24.68;
const raw=JSON.stringify(old), migrated=v3.migrateSave(old,'v2',{v1:null,v2:storageTextDigest(raw)});
if(!migrated.ok)throw Error(migrated.error);
const best=v3.setBest(migrated.save,migrated.save.activeTrackUid,34.56);
if(!best.ok)throw Error(best.error);
console.log(JSON.stringify({v2:raw,v3:JSON.stringify(best.save)}));`,
    ],
    { encoding: "utf8" },
  ),
);
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = "test-results/hud-review";
await mkdir(output, { recursive: true });
const report = {
  headless: true,
  checks: [],
  layouts: [],
  errors: [],
  failedRequests: [],
};
const intersects = (a, b) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
const contains = (a, b) =>
  b.left >= a.left - 0.5 &&
  b.right <= a.right + 0.5 &&
  b.top >= a.top - 0.5 &&
  b.bottom <= a.bottom + 0.5;
async function layout(page, name) {
  // Measure settled layout without disabling the existing pause/card motion.
  await page.locator(".timing").evaluate(async (e) => {
    await Promise.all(e.getAnimations().map((a) => a.finished.catch(() => {})));
  });
  const measured = await page.evaluate(() => {
    const rect = (e) => e.getBoundingClientRect().toJSON();
    const part = (selector) => {
      const e = document.querySelector(selector),
        box = rect(e);
      const range = document.createRange();
      range.selectNodeContents(e);
      const ink = range.getBoundingClientRect().toJSON();
      const exposed = [0.15, 0.5, 0.85].every((x) =>
        [0.2, 0.5, 0.8].every((y) => {
          const hit = document.elementFromPoint(
            box.left + box.width * x,
            box.top + box.height * y,
          );
          return hit === e || e.contains(hit);
        }),
      );
      return {
        box,
        ink,
        exposed,
        text: e.textContent,
        clipped: e.scrollWidth > e.clientWidth + 1,
      };
    };
    return {
      board: rect(document.querySelector(".board")),
      canvas: rect(document.querySelector("#game canvas")),
      timing: rect(document.querySelector(".timing")),
      actions: rect(document.querySelector(".top-actions")),
      title: rect(document.querySelector(".mode-note")),
      current: rect(document.querySelector(".current")),
      bestRow: rect(document.querySelector(".best")),
      timer: part("#timer"),
      best: part("#best"),
      history: part("#record-history-open"),
      viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
    };
  });
  report.layouts.push({ name, ...measured });
  const m = measured;
  assert.ok(
    !intersects(m.timing, m.actions),
    `${name}: timing overlaps top actions: ${JSON.stringify(m)}`,
  );
  assert.ok(
    !intersects(m.timing, m.title),
    `${name}: timing overlaps track title`,
  );
  assert.ok(
    Math.abs(
      (m.timing.left + m.timing.right) / 2 -
        (m.canvas.left + m.canvas.right) / 2,
    ) <= 1,
    `${name}: timer card must be centered on the game canvas`,
  );
  assert.ok(
    contains(m.board, m.timing) && contains(m.viewport, m.timing),
    `${name}: timing outside board/viewport`,
  );
  assert.ok(
    contains(m.timing, m.current) && contains(m.timing, m.bestRow),
    `${name}: timing rows outside card`,
  );
  for (const key of ["timer", "best", "history"]) {
    const p = m[key];
    assert.ok(
      p.box.width > 0 && p.box.height > 0,
      `${name}: ${key} has no visible bounds`,
    );
    assert.ok(
      contains(m.board, p.box) && contains(m.viewport, p.box),
      `${name}: ${key} outside board/viewport`,
    );
    assert.ok(
      contains(key === "history" ? p.box : m.timing, p.ink) &&
        contains(m.viewport, p.ink) &&
        !p.clipped,
      `${name}: ${key} text is clipped`,
    );
    assert.ok(p.exposed, `${name}: ${key} is occluded`);
    assert.ok(
      !intersects(p.box, m.actions) && !intersects(p.box, m.title),
      `${name}: ${key} overlaps header controls`,
    );
  }
  assert.ok(
    !intersects(m.history.box, m.current) &&
      !intersects(m.history.box, m.bestRow),
    `${name}: history overlaps timing text`,
  );
  return m.timing;
}
try {
  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
    [900, 700],
  ]) {
    for (const kind of ["fresh", "legacy", "current", "quota"]) {
      const context = await browser.newContext({ viewport: { width, height } });
      try {
        await context.addInitScript(
          ({ fixture, kind }) => {
            if (!/^https?:$/.test(location.protocol)) return;
            if (kind !== "fresh")
              localStorage.setItem("paperlap.save.v2", fixture.v2);
            if (kind === "current")
              localStorage.setItem("paperlap.save.v3", fixture.v3);
            if (kind === "quota") {
              const set = Storage.prototype.setItem;
              Storage.prototype.setItem = function (key, value) {
                if (key === "paperlap.save.v3")
                  throw new DOMException("test quota", "QuotaExceededError");
                return set.call(this, key, value);
              };
            }
          },
          { fixture, kind },
        );
        const page = await context.newPage();
        page.on("pageerror", (e) => report.errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") report.errors.push(m.text());
        });
        page.on("requestfailed", (r) => report.failedRequests.push(r.url()));
        await page.goto(`${base}/?debug=1`);
        await page.waitForFunction(
          () => window.paperlapDebug && document.querySelector("#game canvas"),
        );
        const name = `${width}x${height} ${kind}`;
        assert.equal(await page.locator("#timer").innerText(), "00:00.00");
        assert.equal(
          await page.locator("#best").innerText(),
          kind === "current" ? "00:34.56" : "--:--.--",
        );
        assert.equal(
          await page.locator("#storage-state").isVisible(),
          kind === "quota",
        );
        const before = await layout(page, `${name} ready`);
        if (kind === "current")
          await page.screenshot({ path: `${output}/hud-ready-${width}.png` });
        await page.locator("#record-history-open").click();
        await page.locator("#save-history[open]").waitFor();
        if (kind !== "fresh")
          assert.match(
            await page.locator("#record-history-list").innerText(),
            /rules-1[\s\S]*rules-2/,
          );
        await page.keyboard.press("Escape");
        assert.equal(
          await page
            .locator("#record-history-open")
            .evaluate((e) => e === document.activeElement),
          true,
        );
        const returned = await layout(page, `${name} ready after history`);
        assert.deepEqual(
          returned,
          before,
          `${name}: history close moved timing card`,
        );
        await page.locator("#start").click();
        await page.waitForFunction(
          () =>
            window.paperlapDebug.mode === "running" &&
            window.paperlapDebug.lap.elapsed > 0.15,
        );
        await layout(page, `${name} running`);
        assert.notEqual(await page.locator("#timer").innerText(), "00:00.00");
        if (kind === "current")
          await page.screenshot({ path: `${output}/hud-running-${width}.png` });
        await page.locator("#record-history-open").click();
        assert.equal(
          await page.evaluate(() => window.paperlapDebug.mode),
          "paused",
        );
        const stopped = await page.evaluate(
          () => window.paperlapDebug.lap.elapsed,
        );
        await page.keyboard.press("Escape");
        await layout(page, `${name} paused after history`);
        assert.equal(
          await page.evaluate(() => window.paperlapDebug.mode),
          "paused",
        );
        assert.equal(
          await page.evaluate(() => window.paperlapDebug.lap.elapsed),
          stopped,
        );
        report.checks.push(name);
        console.log(
          `PASS ${name}: centered, unclipped, unoccluded HUD; history return stable`,
        );
      } finally {
        await context.close();
      }
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
