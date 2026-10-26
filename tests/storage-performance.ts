import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { benchmarkStorage } from "./fixtures/storage-performance.ts";

const baselineIndex = process.argv.indexOf("--baseline-ref");
const baseline =
  baselineIndex === -1 ? undefined : process.argv[baselineIndex + 1];
if (baseline !== undefined && !/^[a-f\d]{7,40}$/.test(baseline))
  throw Error("--baseline-ref must be a commit SHA");
const output = resolve("test-results/storage-performance");
const moduleRoot = baseline
  ? resolve(output, `baseline-${baseline}`, "src/game")
  : resolve("src/game");
await mkdir(output, { recursive: true });
if (baseline) {
  await mkdir(moduleRoot, { recursive: true });
  for (const file of ["save.ts", "storage.ts", "geometry.ts", "config.ts"])
    await writeFile(
      resolve(moduleRoot, file),
      execFileSync("git", ["show", `${baseline}:src/game/${file}`]),
    );
}
const model = await import(pathToFileURL(resolve(moduleRoot, "save.ts")).href);
const persistence = await import(
  pathToFileURL(resolve(moduleRoot, "storage.ts")).href
);
const report = {
  baseline: baseline ?? null,
  node: process.version,
  v8: process.versions.v8,
  platform: `${platform()}-${arch()}`,
  cpu: cpus()[0]?.model,
  measuredAt: new Date().toISOString(),
  samples: 5,
  results: [] as ReturnType<typeof benchmarkStorage>[],
};
for (const points of [350, 900]) {
  const result = benchmarkStorage(model, persistence, points, report.samples);
  report.results.push(result);
  console.log(`20 tracks x ${points} points`);
  for (const [name, timing] of Object.entries(result.operations))
    console.log(
      `${name}: median=${timing.medianMs.toFixed(3)}ms p95=${timing.p95Ms.toFixed(3)}ms`,
    );
}
const target = resolve(
  output,
  baseline ? `before-${baseline}.json` : "after.json",
);
await writeFile(target, JSON.stringify(report, null, 2));
console.log(`Report: ${target}`);
