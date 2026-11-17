import { test } from "node:test";
import assert from "node:assert/strict";
import * as v2 from "../src/game/save.ts";
import * as v3 from "../src/game/save-v3.ts";
import * as v4 from "../src/game/save-v4.ts";
import { SaveSession, STORAGE_KEY, OLD_KEYS, readV4Identity } from "../src/game/storage-v4.ts";
import { defaultTrack, longTrack, validate, derive, trackBounds, fromDrawing, fingerprint } from "../src/game/geometry.ts";
import { geometryDigest } from "../src/game/geometry-identity.ts";
import { moveCar, noInput, spawn } from "../src/game/vehicle.ts";
import { MAP, WORLD } from "../src/game/config.ts";

function value<T>(r: { ok: true; save: T } | { ok: false; error: string }): T {
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw Error(r.error);
  return r.save;
}
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)), writes: string[] = [];
  let mode = "";
  return {
    data, writes, mode: (next: string) => { mode = next; },
    store: {
      getItem(k: string) { if (mode === "read") throw Error("denied"); return data.get(k) ?? null; },
      setItem(k: string, raw: string) {
        if (mode === "quota") throw new DOMException("full", "QuotaExceededError");
        if (mode === "drop") return;
        data.set(k, raw); writes.push(k);
      },
    },
  };
}
const lease = (owned = true) => ({ owned, release() { this.owned = false; } });
function oldSource() {
  let save = v3.freshSave();
  save.tracks[0].track.name = "保留原尺寸";
  save = value(v3.setBest(save, save.activeTrackUid, 25.34));
  return save;
}

test("schema-2 paper is independent of viewport; legacy geometry remains strictly bounded", () => {
  const track = longTrack();
  assert.equal(track.schemaVersion, 2);
  assert.ok(track.points.some((p) => p.x > WORLD.width || p.y > WORLD.height));
  assert.equal(validate(track.points, track.width, 2), null);
  assert.ok(validate(track.points, track.width, 1));
  assert.equal(validate(defaultTrack().points), null);
  assert.ok(derive(track).length > 9000);
  assert.ok(derive(track).length < 15000);
  assert.ok(track.points.length <= 900);
  assert.equal(trackBounds(track).maxX, MAP.width - 24);
  assert.equal(trackBounds(defaultTrack()).maxX, WORLD.width - 24);
  const outside = structuredClone(track.points);
  outside[0].x = MAP.width + 1;
  assert.match(validate(outside, track.width, 2)!.reason, /边界/);
  const drawn = fromDrawing([...track.points, track.points[0]], 2);
  assert.equal(drawn.ok, true);
  if (drawn.ok) assert.equal(drawn.track.schemaVersion, 2);
});

test("large-track movement crosses the legacy screen boundary without changing old movement", () => {
  const car = spawn(derive(longTrack()));
  Object.assign(car, { x: WORLD.width + 500, y: 1500, vx: 100, vy: 0, angle: 0 });
  moveCar(car, noInput(), 1 / 120, true, trackBounds(longTrack()));
  assert.ok(car.x > WORLD.width);
  const legacy = { ...car };
  moveCar(legacy, noInput(), 1 / 120, true);
  assert.equal(legacy.x, WORLD.width - 24);
});

test("fresh V4 opens a long sample and writes only its independent key", () => {
  const m = memory(), session = new SaveSession(m.store, lease());
  const opened = session.open();
  assert.ok(opened.persisted);
  assert.equal(opened.save.schemaVersion, 4);
  assert.equal(v4.activeTrack(opened.save).track.schemaVersion, 2);
  assert.deepEqual(m.writes, [STORAGE_KEY]);
  assert.equal(v3.parseSave(m.data.get(STORAGE_KEY)!), null);
  assert.equal(new SaveSession(m.store, lease()).open().source, "v4");
  assert.ok(readV4Identity(m.store, m.data.get(STORAGE_KEY)!, opened.save.activeTrackUid).valid);
});

test("V3 migration preserves exact tracks, identities, records, dimensions, and all old bytes", () => {
  const previous = oldSource(), raw = JSON.stringify(previous);
  const m = memory({ [OLD_KEYS.v3]: raw, "paperlap.draft.v2": "old whole draft", "paperlap.local-draft.v1": "old local draft" });
  const session = new SaveSession(m.store, lease()), opened = session.open();
  assert.ok(opened.persisted);
  assert.equal(opened.source, "v3");
  assert.deepEqual(opened.save.tracks, previous.tracks);
  assert.deepEqual(opened.save.records, previous.records);
  assert.equal(v4.recordKey(v4.activeTrack(opened.save)), v3.recordKey(v3.activeTrack(previous)));
  assert.equal(m.data.get(OLD_KEYS.v3), raw);
  assert.deepEqual(m.writes, [STORAGE_KEY]);
  const added = value(v4.addTrack(opened.save, longTrack(), "long-work"));
  assert.ok(session.write(added).ok);
  const loaded = new SaveSession(m.store, lease()).open();
  assert.ok(loaded.persisted);
  assert.equal(loaded.save.tracks.length, 2);
  assert.deepEqual(loaded.save.tracks[0], previous.tracks[0]);
  const backup = JSON.parse(session.backup());
  assert.equal(backup.v3, raw);
  assert.equal(backup.v4, m.data.get(STORAGE_KEY));
  assert.equal(backup.draftV2, "old whole draft");
  assert.equal(backup.localDraftV1, "old local draft");
});

test("old V3 source changes block both live writes and reopening, without merging branches", () => {
  const m = memory({ [OLD_KEYS.v3]: JSON.stringify(oldSource()) });
  const session = new SaveSession(m.store, lease()), opened = session.open();
  const saved = m.data.get(STORAGE_KEY);
  m.data.set(OLD_KEYS.v3, JSON.stringify(value(v3.renameTrack(oldSource(), "entry-default", "changed elsewhere"))));
  assert.deepEqual(session.write(opened.save), { ok: false, error: "conflict" });
  assert.equal(m.data.get(STORAGE_KEY), saved);
  const reloaded = new SaveSession(m.store, lease()).open();
  assert.equal(reloaded.error, "conflict");
});

test("V4 quota retries preserve V3 PB; denied and lost reads never acknowledge writes", () => {
  const previous = oldSource(), raw = JSON.stringify(previous), m = memory({ [OLD_KEYS.v3]: raw });
  m.mode("quota");
  const failed = new SaveSession(m.store, lease()).open();
  assert.equal(failed.error, "quota");
  assert.equal(failed.persisted, false);
  assert.equal(m.data.has(STORAGE_KEY), false);
  assert.deepEqual(failed.save.tracks, previous.tracks);
  m.mode("");
  const session = new SaveSession(m.store, lease()), opened = session.open();
  assert.ok(opened.persisted);
  assert.deepEqual(opened.save.records, previous.records);
  const candidate = value(v4.renameTrack(opened.save, opened.save.activeTrackUid, "next"));
  const official = m.data.get(STORAGE_KEY);
  m.mode("drop");
  assert.deepEqual(session.write(candidate), { ok: false, error: "conflict" });
  assert.equal(m.data.get(STORAGE_KEY), official);
});

test("unknown/corrupt V4, broken V3, and no writer lease cannot overwrite source data", () => {
  for (const broken of ['{"schemaVersion":5}', "broken"]) {
    const m = memory({ [STORAGE_KEY]: broken, [OLD_KEYS.v3]: JSON.stringify(oldSource()) });
    const session = new SaveSession(m.store, lease()), opened = session.open();
    assert.equal(opened.error, "invalid-v4");
    assert.equal(session.writable, false);
    assert.equal(m.data.get(STORAGE_KEY), broken);
    assert.deepEqual(m.writes, []);
  }
  const corrupt = memory({ [OLD_KEYS.v3]: "broken" });
  assert.equal(new SaveSession(corrupt.store, lease()).open().error, "invalid-v3");
  assert.deepEqual(corrupt.writes, []);
  const readOnly = memory({ [OLD_KEYS.v3]: JSON.stringify(oldSource()) });
  assert.equal(new SaveSession(readOnly.store, lease(false)).open().error, "writer-busy");
  assert.deepEqual(readOnly.writes, []);
});

test("V4 inherits strict V1/V2 migration and never creates an intermediate V3", () => {
  const old = v2.freshSave();
  old.records[v2.recordKey(old.tracks[0])] = 31.25;
  const raw = JSON.stringify(old), m = memory({ [OLD_KEYS.v2]: raw });
  const opened = new SaveSession(m.store, lease()).open();
  assert.ok(opened.persisted);
  assert.deepEqual(opened.save.legacy.records, old.records);
  assert.equal(m.data.has(OLD_KEYS.v3), false);
  assert.equal(m.data.get(OLD_KEYS.v2), raw);
  assert.deepEqual(m.writes, [STORAGE_KEY]);
});

test("schema changes cannot rebind an existing geometry identity; V3 cannot adopt large geometry", () => {
  const previous = oldSource(), m = memory({ [OLD_KEYS.v3]: JSON.stringify(previous) });
  const session = new SaveSession(m.store, lease()), opened = session.open();
  const rebound = structuredClone(opened.save);
  rebound.tracks[0].track.schemaVersion = 2;
  assert.deepEqual(session.write(rebound), { ok: false, error: "invalid-identity" });
  const replaced = value(v4.replaceTrack(opened.save, opened.save.activeTrackUid, { ...previous.tracks[0].track, schemaVersion: 2 }));
  assert.notEqual(replaced.tracks[0].geometryIdentity, previous.tracks[0].geometryIdentity);
  assert.ok(session.write(replaced).ok);
  assert.equal(v3.addTrack(previous, longTrack(), "large").ok, false);
  const mutated = longTrack();
  const good = value(v4.addTrack(replaced, mutated, "large"));
  mutated.points[0].x = MAP.width + 200;
  mutated.id = fingerprint(mutated.points, mutated.width);
  const forged = structuredClone(good);
  forged.tracks[1].track = mutated;
  forged.tracks[1].geometryDigest = geometryDigest(mutated.points, mutated.width);
  assert.equal(v4.validateSave(forged).ok, false);
});
