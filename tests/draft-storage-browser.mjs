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
    const context = await browser.newContext({
      viewport: { width: 900, height: 700 },
    });
    try {
      await context.addInitScript((denied) => {
        window.testStorage = window.localStorage;
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
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      p.on("requestfailed", (request) => failedRequests.push(request.url()));
      await p.goto(`${base}/?debug=1`);
      await p.waitForFunction(
        () => window.paperlapDebug && document.querySelector("#game canvas"),
      );
      await p.locator("#edit").click();
      assert.match(
        await p.locator("#draft-backup").innerText(),
        /存储空间不足或不可用/,
      );
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).mode, "ready");
      await p.locator("#edit").click();
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
      await p.screenshot({ path: `${output}${denied}.png` });
      check(
        `${denied}: empty editor can leave safely, real drawing and undo work, and read denial retains the correct unbacked cause`,
      );
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
console.log(`Passed ${checks.length} storage read rejection browser checks`);
