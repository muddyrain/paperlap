import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

delete process.env.PWDEBUG;
const raw = execFileSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    'import { storageFixture } from "./tests/fixtures/storage-performance.ts"; process.stdout.write(JSON.stringify(storageFixture(900)));',
  ],
  { encoding: "utf8", maxBuffer: 2_000_000 },
);
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  reducedMotion: "reduce",
});
const output = fileURLToPath(
  new URL("../test-results/draft-review/", import.meta.url),
);
await mkdir(output, { recursive: true });
const report = {
  tracks: 20,
  pointsPerTrack: 900,
  characters: raw.length,
  errors: [],
  failedRequests: [],
  cold: [],
  hot: [],
};
try {
  await context.addInitScript((raw) => {
    if (!localStorage.getItem("draft-perf-seeded")) {
      localStorage.setItem("paperlap.save.v2", raw);
      localStorage.setItem("draft-perf-seeded", "1");
    }
  }, raw);
  const p = await context.newPage();
  p.on("pageerror", (e) => report.errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
  const load = performance.now();
  await p.goto(
    `${process.env.PAPERLAP_URL || "http://127.0.0.1:5173"}/?debug=1`,
  );
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
  report.coldPageLoadMs = performance.now() - load;
  await p.evaluate(() => {
    const edit = document.getElementById("edit");
    window.draftEntryTimes = [];
    edit.addEventListener(
      "click",
      () => (window.draftEntryStart = performance.now()),
      true,
    );
    edit.addEventListener("click", () =>
      window.draftEntryTimes.push(performance.now() - window.draftEntryStart),
    );
  });
  for (const kind of ["hot", "cold"])
    for (let i = 0; i < 3; i++) {
      if (kind === "cold")
        await p.evaluate((i) => {
          const s = JSON.parse(localStorage.getItem("paperlap.save.v3"));
          s.tracks[1].track.name = `external valid metadata ${i}`;
          localStorage.setItem("paperlap.save.v3", JSON.stringify(s));
        }, i);
      await p.locator("#edit").click();
      assert.equal(
        await p.evaluate(() => window.paperlapDebug.mode),
        "editing",
      );
      assert.equal(
        await p.evaluate(() => document.activeElement.className),
        "draw-surface",
      );
      report[kind].push(await p.evaluate(() => window.draftEntryTimes.at(-1)));
      await p.keyboard.press("Escape");
      assert.equal(await p.evaluate(() => window.paperlapDebug.mode), "ready");
    }
  const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  report.hotMedianMs = median(report.hot);
  report.coldMedianMs = median(report.cold);
  assert.ok(
    report.hotMedianMs < report.coldMedianMs * 0.5,
    JSON.stringify(report),
  );
  assert.equal(
    await p.evaluate(() => localStorage.getItem("paperlap.draft.v2")),
    null,
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(
    `${output}browser-performance.json`,
    JSON.stringify(report, null, 2),
  );
  await context.close();
  await browser.close();
}
