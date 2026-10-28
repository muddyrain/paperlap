import assert from "node:assert/strict";
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { deformLocal, prepareLocalDrag } from "../src/game/local-edit.ts";
import { ellipseTrack } from "../src/prototypes/local-edit-fixtures.ts";
import { validate } from "../src/game/geometry.ts";
import { measure } from "./fixtures/storage-performance.ts";
const report = {
  environment: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    node: process.version,
  },
  results: [] as unknown[],
};
for (const count of [200, 450, 900]) {
  const points = ellipseTrack(count).points,
    start = prepareLocalDrag(points, points[Math.floor(count / 4)], 240);
  assert.ok(start.ok);
  if (!start.ok) throw Error(start.reason);
  const candidate = deformLocal(start.drag, { x: -25, y: 10 });
  assert.equal(validate(candidate), null);
  report.results.push({
    points: count,
    selection: measure(
      () => prepareLocalDrag(points, points[Math.floor(count / 4)], 240),
      30,
    ),
    preview: measure(() => deformLocal(start.drag, { x: -25, y: 10 }), 300),
    releaseValidation: measure(() => validate(candidate), 15),
  });
}
mkdirSync("test-results/local-edit", { recursive: true });
writeFileSync(
  "test-results/local-edit/node-performance.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
