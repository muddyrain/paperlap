import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftStorage } from "../src/game/draft-storage.ts";
import { draftSource } from "../src/game/draft.ts";
import { loadSave, STORAGE_KEY } from "../src/game/storage.ts";
import { storageFixture, measure } from "./fixtures/storage-performance.ts";

test("20×900 hot draft opens reuse exact validated bytes; cold external bytes remain fully checked", (t) => {
  const save = storageFixture(900);
  const raw = JSON.stringify(save);
  const backing = () => ({
    getItem: (key: string) => (key === STORAGE_KEY ? raw : null),
    setItem() {},
    removeItem() {},
  });
  const source = draftSource(save, "replace");
  const cold = measure(() => {
    assert.equal(new DraftStorage(backing()).open(source).ok, true);
  }, 3);
  const store = backing();
  assert.equal(loadSave(store).persisted, true);
  const hot = measure(() => {
    assert.equal(new DraftStorage(store).open(source).ok, true);
  }, 5);
  t.diagnostic(
    JSON.stringify({
      tracks: 20,
      points: 900,
      characters: raw.length,
      cold,
      hot,
    }),
  );
  assert.ok(
    hot.medianMs < cold.medianMs * 0.5,
    `hot ${hot.medianMs}ms must stay below half of cold ${cold.medianMs}ms`,
  );
});
