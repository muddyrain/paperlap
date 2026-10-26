import { test } from "node:test";
import assert from "node:assert/strict";
import * as model from "../src/game/save.ts";
import * as storage from "../src/game/storage.ts";
import { benchmarkStorage } from "./fixtures/storage-performance.ts";

for (const points of [350, 900])
  test(`20 x ${points} point metadata/write operations avoid full geometry cost`, (t) => {
    const result = benchmarkStorage(model, storage, points, 3);
    const cold = result.operations.parseUntrusted.medianMs;
    for (const name of [
      "setBest",
      "renameTrack",
      "selectTrack",
      "writeSave",
      "bestAndWrite",
      "mutedAndWrite",
    ]) {
      const hot = result.operations[name].medianMs;
      t.diagnostic(
        `${name}=${hot.toFixed(3)}ms, untrusted parse=${cold.toFixed(3)}ms`,
      );
      assert.ok(
        hot < cold * 0.5,
        `${name} must stay below half a full untrusted parse (${hot.toFixed(3)}ms / ${cold.toFixed(3)}ms)`,
      );
    }
  });
