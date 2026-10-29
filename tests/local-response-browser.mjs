import assert from "node:assert/strict";
import { performanceFixtures } from "./fixtures/local-performance.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const context = await browser.newContext({ reducedMotion: "reduce" });
try {
  await context.addInitScript((seed) => {
    if (!/^https?:$/.test(location.protocol)) return;
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, performanceFixtures["900-1"]);
  const p = await context.newPage();
  await p.goto(
    `${process.env.PAPERLAP_URL || "http://127.0.0.1:4188"}/?debug=1`,
  );
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
  const cdp = await context.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.locator("#local-edit").click();
  const q = await p.evaluate(() =>
    paperlapDebug.local.current.reduce((a, b) => (b.x < a.x ? b : a)),
  );
  const r = await p.locator(".local-surface").boundingBox();
  await p.mouse.move(
    r.x + (q.x * r.width) / 1440,
    r.y + (q.y * r.height) / 860,
  );
  await p.mouse.down();
  await p.mouse.move(
    r.x + ((q.x - 3) * r.width) / 1440,
    r.y + (q.y * r.height) / 860,
    { steps: 8 },
  );
  await p.mouse.up();
  await p.waitForFunction(
    () => paperlapDebug.local.pending && !paperlapDebug.local.busy,
  );
  const feedback = await p.locator("#local-adopt").evaluate((el) => {
    el.click();
    return {
      busy: document.querySelector("#local-editor").getAttribute("aria-busy"),
      text: el.textContent,
    };
  });
  assert.equal(
    feedback.busy,
    "true",
    `adopt must announce busy before doing synchronous work: ${JSON.stringify(feedback)}`,
  );
  assert.match(feedback.text, /正在/);
  console.log("PASS adopt announces processing before blocking work");
} finally {
  await context.close();
  await browser.close();
}
