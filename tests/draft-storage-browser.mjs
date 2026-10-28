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
  new URL("../test-results/draft/read-rejection/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const state = (p) => p.evaluate(() => window.paperlapDebug);
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  for (const denied of ["draft-read", "storage-getter"]) {
    for (const intent of ["replace", "create"]) {
      const context = await browser.newContext({
        viewport: { width: 900, height: 700 },
      });
      try {
        const p = await context.newPage();
        await p.goto(`${base}/?debug=1`);
        await p.waitForFunction(
          () => window.paperlapDebug && document.querySelector("#game canvas"),
        );
        const official = await p.evaluate(() =>
          localStorage.getItem("paperlap.save.v2"),
        );
        await context.addInitScript((denied) => {
          window.testStorage = window.localStorage;
          window.testGet = Storage.prototype.getItem;
          const originalSet = Storage.prototype.setItem,
            originalRemove = Storage.prototype.removeItem;
          originalSet.call(
            window.testStorage,
            "paperlap.draft.v1",
            '{"schemaVersion":99,"unknown":"keep original bytes"}',
          );
          window.draftWrites = 0;
          window.draftDeletes = 0;
          Storage.prototype.setItem = function (k, v) {
            if (k === "paperlap.draft.v1") window.draftWrites++;
            return originalSet.call(this, k, v);
          };
          Storage.prototype.removeItem = function (k) {
            if (k === "paperlap.draft.v1") window.draftDeletes++;
            return originalRemove.call(this, k);
          };
          if (denied === "storage-getter")
            Object.defineProperty(window, "localStorage", {
              get() {
                throw new DOMException("test denied", "SecurityError");
              },
            });
          else {
            const get = Storage.prototype.getItem;
            Storage.prototype.getItem = function (k) {
              if (k === "paperlap.draft.v1")
                throw new DOMException("test denied", "SecurityError");
              return get.call(this, k);
            };
          }
        }, denied);
        p.on("pageerror", (e) => errors.push(e.message));
        p.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        p.on("requestfailed", (request) => failedRequests.push(request.url()));
        await p.reload();
        await p.waitForFunction(
          () => window.paperlapDebug && document.querySelector("#game canvas"),
        );
        if (intent === "create") {
          await p.keyboard.press("Escape");
          await p.keyboard.press("t");
          await p.locator('#trackbook[data-motion="open"]').waitFor();
          await p.locator("#new-track").click();
        } else await p.locator("#edit").click();
        assert.match(
          await p.locator("#draft-backup").innerText(),
          /存储空间不足或不可用/,
        );
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).mode, "ready");
        if (intent === "create") {
          await p.keyboard.press("Escape");
          await p.keyboard.press("Escape");
        }
        const fromRunning = denied === "storage-getter" && intent === "replace";
        if (fromRunning) {
          await p.keyboard.press("Space");
          await p.keyboard.down("ArrowUp");
          await p.waitForFunction(
            () => window.paperlapDebug.lap.elapsed >= 0.2,
          );
          await p.keyboard.up("ArrowUp");
          await p.keyboard.press("Escape");
        }
        const before = await state(p);
        if (intent === "create") {
          await p.keyboard.press("Escape");
          await p.keyboard.press("t");
          await p.locator('#trackbook[data-motion="open"]').waitFor();
          await p.locator("#new-track").click();
        } else if (fromRunning) await p.keyboard.press("e");
        else await p.locator("#edit").click();
        const r = await p.locator(".draw-surface").boundingBox();
        const at = (q) => ({
          x: r.x + (q.x * r.width) / 1440,
          y: r.y + (q.y * r.height) / 860,
        });
        const start = at(wobblyLoop()[0]);
        await p.mouse.move(start.x, start.y);
        await p.mouse.down();
        for (const point of wobblyLoop().slice(1)) {
          const q = at(point);
          await p.mouse.move(q.x, q.y);
        }
        await p.mouse.up();
        assert.equal((await state(p)).draft.valid, true);
        assert.match(
          await p.locator("#draft-backup").innerText(),
          /存储空间不足或不可用/,
        );
        assert.doesNotMatch(
          await p.locator("#draft-backup").innerText(),
          /数据损坏/,
        );
        await p.keyboard.press("r");
        await p.locator("#undo-drawing").click();
        assert.equal((await state(p)).draft.valid, true);
        await p.keyboard.press("Escape");
        assert.equal(
          await p.evaluate(() => document.activeElement.id),
          "keep-drawing",
        );
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).draft.valid, true);
        await p.keyboard.press("Escape");
        const warning = await p.locator("#menu-discard > p").innerText();
        const label = await p.locator("#discard-drawing").innerText();
        await p.screenshot({
          path: `${output}${denied}-${intent}-confirm.png`,
        });
        await p.locator("#discard-drawing").click();
        assert.equal(
          (await state(p)).mode,
          before.mode,
          "explicit memory discard must not trap a player in editing",
        );
        assert.match(warning, /本次.*未.*备份/);
        assert.match(warning, /旧备份.*不.*删除|不.*删除.*旧备份/);
        assert.match(label, /仅放弃本次/);
        if (intent === "create") {
          assert.equal(await p.locator("#trackbook").isVisible(), true);
          await p.keyboard.press("Escape");
          assert.equal(
            await p.locator('#game-menu[data-layer="menu"]').isVisible(),
            true,
          );
          await p.keyboard.press("Escape");
        }
        if (fromRunning) {
          assert.equal(
            await p.locator('#game-menu[data-layer="menu"]').isVisible(),
            true,
          );
          await p.keyboard.press("Escape");
        }
        const restored = await state(p);
        assert.equal(restored.mode, before.mode);
        assert.deepEqual(restored.car, before.car);
        assert.deepEqual(restored.lap, before.lap);
        assert.deepEqual(restored.keys, []);
        assert.equal(restored.sound.running, false);
        assert.equal(await p.evaluate(() => document.activeElement.id), "game");
        const retained = await p.evaluate(() => ({
          official: window.testGet.call(window.testStorage, "paperlap.save.v2"),
          unknown: window.testGet.call(window.testStorage, "paperlap.draft.v1"),
          writes: window.draftWrites,
          deletes: window.draftDeletes,
        }));
        assert.equal(retained.official, official);
        assert.equal(
          retained.unknown,
          '{"schemaVersion":99,"unknown":"keep original bytes"}',
        );
        assert.equal(retained.writes, 0);
        assert.equal(retained.deletes, 0);
        check(
          `${denied}/${intent}: explicit confirmation leaves a nonempty editor through the original route without touching unknown backups`,
        );
      } finally {
        await context.close();
      }
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
console.log(`Passed ${checks.length} storage read rejection browser checks`);
