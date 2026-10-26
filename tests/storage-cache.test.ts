import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeTrack,
  addTrack,
  freshSave,
  parseSave,
  recordKey,
  renameTrack,
  replaceTrack,
  selectTrack,
  setBest,
  validateSave,
} from "../src/game/save.ts";
import { loadSave, STORAGE_KEY, writeSave } from "../src/game/storage.ts";
import { fingerprint } from "../src/game/geometry.ts";
import { saved } from "./fixtures/storage-performance.ts";

function memory() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

test("a previously validated mutable route cannot bypass geometry validation", () => {
  for (const action of [
    (save: ReturnType<typeof freshSave>) =>
      setBest(save, save.activeTrackUid, 20),
    (save: ReturnType<typeof freshSave>) =>
      renameTrack(save, save.activeTrackUid, "改名"),
    (save: ReturnType<typeof freshSave>) =>
      selectTrack(save, save.activeTrackUid),
    (save: ReturnType<typeof freshSave>) => writeSave(memory(), save),
  ]) {
    const save = saved(validateSave(freshSave()));
    const track = activeTrack(save).track;
    track.points[10].x = 0;
    track.id = fingerprint(track.points, track.width);
    assert.equal(action(save).ok, false);
  }
});

test("frozen arrays do not make their mutable points safe, and sparse arrays are rejected", () => {
  const save = saved(validateSave(freshSave()));
  const track = activeTrack(save).track;
  Object.freeze(track.points);
  track.points[5].y = 0;
  assert.equal(writeSave(memory(), save).ok, false);
  const sparse = saved(validateSave(freshSave()));
  delete activeTrack(sparse).track.points[4];
  assert.equal(selectTrack(sparse, sparse.activeTrackUid).ok, false);
});

test("exact coordinates are retained even when a change keeps the same quantized fingerprint", () => {
  const save = saved(validateSave(freshSave()));
  const track = activeTrack(save).track;
  const id = track.id;
  track.points[0].x += 0.000001;
  assert.equal(fingerprint(track.points, track.width), id);
  const changed = saved(setBest(save, save.activeTrackUid, 20));
  assert.equal(activeTrack(changed).track.points[0].x, track.points[0].x);
  // A caller must not be able to alter the private validation snapshot through a returned Save.
  activeTrack(changed).track.points[0].x = -1;
  assert.equal(writeSave(memory(), changed).ok, false);
  assert.equal(writeSave(memory(), save).ok, true);
});

test("metadata and record edits are checked even for an unchanged validated route", () => {
  for (const corrupt of [
    (save: ReturnType<typeof freshSave>) => {
      activeTrack(save).track.id = "track-a";
    },
    (save: ReturnType<typeof freshSave>) => {
      activeTrack(save).track.width = 100;
    },
    (save: ReturnType<typeof freshSave>) => {
      save.activeTrackUid = "missing";
    },
    (save: ReturnType<typeof freshSave>) => {
      save.records[recordKey(activeTrack(save))] = Infinity;
    },
    (save: ReturnType<typeof freshSave>) => {
      activeTrack(save).track.name = "x".repeat(41);
    },
  ]) {
    const save = saved(validateSave(freshSave()));
    corrupt(save);
    assert.equal(writeSave(memory(), save).ok, false);
  }
});

test("add and replace reject altered routes after an earlier successful validation", () => {
  const save = saved(validateSave(freshSave()));
  const other = saved(validateSave(freshSave()));
  const route = activeTrack(other).track;
  route.points[10] = { x: 0, y: 0 };
  route.id = fingerprint(route.points, route.width);
  assert.equal(addTrack(save, route, "new-entry").ok, false);
  assert.equal(replaceTrack(save, save.activeTrackUid, route).ok, false);
  assert.ok(parseSave(JSON.stringify(save)));
});

test("every write reads storage again and rejects externally corrupted raw data", () => {
  for (const corrupt of [
    "{broken",
    JSON.stringify({ schemaVersion: 99 }),
    "geometry",
  ]) {
    const storage = memory();
    const save = freshSave();
    assert.equal(writeSave(storage, save).ok, true);
    let raw = corrupt;
    if (corrupt === "geometry") {
      const invalid = JSON.parse(storage.getItem(STORAGE_KEY)!);
      invalid.tracks[0].track.points[0].x = 0;
      raw = JSON.stringify(invalid);
    }
    storage.items.set(STORAGE_KEY, raw);
    assert.equal(writeSave(storage, save).ok, false);
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});

test("a changed valid storage string is fully checked and cache state is isolated per store", () => {
  const storage = memory(),
    separate = memory();
  const save = freshSave();
  assert.equal(writeSave(storage, save).ok, true);
  const external = saved(renameTrack(save, save.activeTrackUid, "外部改名"));
  storage.items.set(STORAGE_KEY, JSON.stringify(external));
  assert.equal(writeSave(storage, external).ok, true);
  const invalid = JSON.parse(storage.getItem(STORAGE_KEY)!);
  invalid.tracks[0].track.id = "track-a";
  const raw = JSON.stringify(invalid);
  separate.items.set(STORAGE_KEY, raw);
  assert.equal(writeSave(separate, save).ok, false);
  assert.equal(separate.getItem(STORAGE_KEY), raw);
});

test("failed writes never cause an invalid stored snapshot to become trusted", () => {
  const storage = memory();
  const commit = storage.setItem;
  let quota = false;
  storage.setItem = (key, value) => {
    if (quota) throw new DOMException("full", "QuotaExceededError");
    commit(key, value);
  };
  assert.equal(writeSave(storage, freshSave()).ok, true);
  const next = saved(
    setBest(loadSave(storage).save, freshSave().activeTrackUid, 20),
  );
  quota = true;
  assert.equal(writeSave(storage, next).ok, false);
  quota = false;
  const invalid = JSON.parse(JSON.stringify(next));
  invalid.activeTrackUid = "missing";
  const raw = JSON.stringify(invalid);
  storage.items.set(STORAGE_KEY, raw);
  assert.equal(writeSave(storage, next).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
});
