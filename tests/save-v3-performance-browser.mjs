import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
delete process.env.PWDEBUG;
const raw = execFileSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    'import {storageFixture} from "./tests/fixtures/storage-performance.ts";process.stdout.write(JSON.stringify(storageFixture(900)));',
  ],
  { encoding: "utf8", maxBuffer: 2_000_000 },
);
const { chromium } = await import("@playwright/test"),
  browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: "reduce",
  }),
  output = "test-results/save-v3";
await mkdir(output, { recursive: true });
const report = {
  environment: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    browser: browser.version(),
  },
  tracks: 20,
  points: 900,
  sourceCharacters: raw.length,
  coldLoadMs: [],
  errors: [],
  failedRequests: [],
  operations: {},
};
try {
  await context.addInitScript((raw) => {
    if (
      /^https?:$/.test(location.protocol) &&
      localStorage.getItem("paperlap.save.v2") === null
    )
      localStorage.setItem("paperlap.save.v2", raw);
  }, raw);
  const p = await context.newPage();
  p.on("pageerror", (e) => report.errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
  const url =
    (process.env.PAPERLAP_URL || "http://127.0.0.1:5173") + "/?debug=1";
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await p.goto(url);
    await p.waitForFunction(
      () => window.paperlapDebug && document.querySelector("#game canvas"),
    );
    report.coldLoadMs.push(performance.now() - start);
    assert.equal(
      await p.evaluate(() => window.paperlapDebug.storage.writable),
      true,
    );
  }
  await p.evaluate(() => {
    window.hotTimes = { sound: [], edit: [], rename: [] };
    for (const [id, name] of [
      ["sound", "sound"],
      ["edit", "edit"],
      ["rename-form", "rename"],
    ]) {
      const b = document.getElementById(id);
      const event = name === "rename" ? "submit" : "click";
      b.addEventListener(
        event,
        () => (window.started = performance.now()),
        true,
      );
      b.addEventListener(event, () =>
        window.hotTimes[name].push(performance.now() - window.started),
      );
    }
  });
  for (let i = 0; i < 5; i++) {
    await p.locator("#sound").click();
    await p.locator("#edit").click();
    assert.equal(await p.evaluate(() => window.paperlapDebug.mode), "editing");
    await p.keyboard.press("Escape");
    await p.locator("#trackbook-open").click();
    await p.locator('[data-action="rename"]').first().click();
    await p.locator("#track-name-input").fill(`性能命名 ${i}`);
    await p.locator("#rename-save").click();
    await p.keyboard.press("Escape");
  }
  const stats = (a) => {
    const v = [...a].sort((a, b) => a - b);
    return {
      samples: a,
      medianMs: v[Math.floor(v.length / 2)],
      maxMs: v.at(-1),
    };
  };
  report.operations = Object.fromEntries(
    Object.entries(await p.evaluate(() => window.hotTimes)).map(([k, v]) => [
      k,
      stats(v),
    ]),
  );
  assert.equal(
    await p.evaluate(() => localStorage.getItem("paperlap.save.v2")),
    raw,
  );
  report.v3Characters = await p.evaluate(
    () => localStorage.getItem("paperlap.save.v3").length,
  );
  for (const result of Object.values(report.operations)) {
    assert.ok(result.medianMs > 0, "measure actual handler work");
    assert.ok(result.medianMs < Math.min(...report.coldLoadMs) * 0.5);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(
    `${output}/browser-performance.json`,
    JSON.stringify(report, null, 2),
  );
  await context.close();
  await browser.close();
}
