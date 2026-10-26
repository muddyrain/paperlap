import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = resolve("test-results/storage-performance");
// Baseline sources are produced by bench:storage, without replacing the checkout.
await access(resolve(output, "baseline-93165ce/src/game/save.ts"));
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "benchmark.html"),
  "<!doctype html><title>Paperlap storage benchmark</title>",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const errors = [];
const report = {
  browser: browser.version(),
  cpu: cpus()[0]?.model,
  storage: "real isolated localStorage",
  samples: 5,
  results: [],
  errors,
};
try {
  for (const version of ["baseline-93165ce", "current"]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(
        `${base}/test-results/storage-performance/benchmark.html`,
      );
      for (const points of [350, 900]) {
        const result = await page.evaluate(
          async ({ version, points }) => {
            const root =
              version === "current"
                ? "/src/game"
                : `/test-results/storage-performance/${version}/src/game`;
            const model = await import(`${root}/save.ts`);
            const persistence = await import(`${root}/storage.ts`);
            const { benchmarkStorage } = await import(
              "/tests/fixtures/storage-performance.ts"
            );
            localStorage.clear(); // This context belongs only to this benchmark.
            const result = benchmarkStorage(
              model,
              persistence,
              points,
              5,
              localStorage,
            );
            const reloaded = persistence.loadSave(localStorage);
            if (!reloaded.persisted || reloaded.save.tracks.length !== 20)
              throw Error("Benchmark storage did not round-trip");
            return result;
          },
          { version, points },
        );
        report.results.push({ version, ...result });
        console.log(`${version}: 20 x ${points}`);
        for (const [name, timing] of Object.entries(result.operations))
          console.log(
            `${name}: median=${timing.medianMs.toFixed(3)}ms p95=${timing.p95Ms.toFixed(3)}ms`,
          );
      }
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    resolve(output, "browser.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log("Headless performance browser and contexts closed");
}
