import { test } from "node:test";
import assert from "node:assert/strict";
import * as old from "../src/game/save.ts";
import * as v3 from "../src/game/save-v3.ts";
import {
  SaveSession,
  STORAGE_KEY,
  OLD_KEYS,
  type Store,
} from "../src/game/storage-v3.ts";
import { fingerprint } from "../src/game/geometry.ts";
import { geometryDigest } from "../src/game/geometry-identity.ts";
import { DraftStorage } from "../src/game/draft-storage.ts";
import { v3DraftPolicy, V3_DRAFT_KEY } from "../src/game/draft-storage-v3.ts";
import { draftSource } from "../src/game/draft.ts";
function value(r: v3.SaveResult): v3.Save {
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw Error(r.error);
  return r.save;
}
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)),
    writes: string[] = [];
  let reject = "";
  const store = {
    getItem: (k: string) => {
      if (reject === "read") throw Error("denied");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (reject === "quota")
        throw new DOMException("full", "QuotaExceededError");
      if (reject === "drop") return;
      data.set(k, v);
      writes.push(k);
    },
    removeItem: (k: string) => {
      data.delete(k);
      writes.push(k);
    },
  };
  return { data, writes, store, reject: (v: string) => (reject = v) };
}
const lease = () => ({
  owned: true,
  release() {
    this.owned = false;
  },
});
function source() {
  const save = old.freshSave();
  save.muted = false;
  save.tracks[0].track.name = "保留我的路线";
  save.records[old.recordKey(save.tracks[0])] = 24.68;
  save.records[old.recordKey(save.tracks[0], 1)] = 20.12;
  save.records[`${save.activeTrackUid}:track-deadbeef:rules-2`] = 21.1;
  save.legacyRecords["track-a:rules-1"] = 22.2;
  return save;
}
function loaded() {
  const oldSave = source(),
    raw = JSON.stringify(oldSave),
    m = memory({
      [OLD_KEYS.v2]: raw,
      [OLD_KEYS.v1]: "old untouched bytes",
      "paperlap.draft.v1": "old draft untouched",
    }),
    session = new SaveSession(m.store, lease()),
    load = session.open();
  assert.ok(load.persisted);
  return { oldSave, raw, m, session, save: load.save };
}
test("V2 upgrade preserves complete source bytes and archives every old record without authoritative PB", () => {
  const { oldSave, raw, m, save } = loaded();
  assert.equal(save.schemaVersion, 3);
  assert.deepEqual(
    save.tracks.map((e) => ({ uid: e.uid, track: e.track })),
    oldSave.tracks,
  );
  assert.equal(save.muted, false);
  assert.deepEqual(save.legacy.records, oldSave.records);
  assert.deepEqual(save.legacyRecords, oldSave.legacyRecords);
  assert.deepEqual(save.records, {});
  assert.equal(m.data.get(OLD_KEYS.v2), raw);
  assert.equal(m.data.get(OLD_KEYS.v1), "old untouched bytes");
  assert.equal(m.data.get("paperlap.draft.v1"), "old draft untouched");
  assert.deepEqual(m.writes, [STORAGE_KEY]);
});
test("stable identities survive quota migration retry and V1 directly upgrades without creating V2", () => {
  const before = source(),
    raw = JSON.stringify(before),
    m = memory({ [OLD_KEYS.v2]: raw });
  m.reject("quota");
  const first = new SaveSession(m.store, lease()).open();
  assert.equal(first.persisted, false);
  assert.equal(first.error, "quota");
  assert.equal(m.data.get(STORAGE_KEY), undefined);
  m.reject("");
  const second = new SaveSession(m.store, lease()).open();
  assert.ok(second.persisted);
  assert.equal(
    second.save.tracks[0].geometryIdentity,
    first.save.tracks[0].geometryIdentity,
  );
  const v1 = {
    schemaVersion: 1,
    rulesVersion: 1,
    track: before.tracks[0].track,
    muted: false,
    records: {
      [`${before.tracks[0].track.id}:rules-1`]: 24.5,
      "track-beef:rules-2": 29,
    },
  };
  const rawV1 = JSON.stringify(v1),
    one = memory({ [OLD_KEYS.v1]: rawV1 });
  const load = new SaveSession(one.store, lease()).open();
  assert.ok(load.persisted);
  assert.equal(load.source, "v1");
  assert.equal(load.save.legacy.sourceRulesVersion, 1);
  assert.equal(one.data.get(OLD_KEYS.v1), rawV1);
  assert.equal(one.data.get(OLD_KEYS.v2), undefined);
  assert.equal(Object.values(load.save.legacy.records)[0], 24.5);
  assert.equal(load.save.legacyRecords["track-beef:rules-2"], 29);
});
test("sub-0.1 changes with same old hash get a new identity and no inherited PB", () => {
  let save = value(v3.setBest(v3.freshSave(), "entry-default", 20));
  const original = v3.activeTrack(save),
    track = structuredClone(original.track);
  track.points[0].x += 0.001;
  assert.equal(fingerprint(track.points, track.width), track.id);
  save = value(v3.replaceTrack(save, original.uid, track));
  const edited = v3.activeTrack(save);
  assert.notEqual(edited.geometryIdentity, original.geometryIdentity);
  assert.notEqual(edited.geometryDigest, original.geometryDigest);
  assert.equal(save.records[v3.recordKey(edited)], undefined);
  assert.equal(save.records[v3.recordKey(original)], 20);
  save = value(v3.setBest(save, edited.uid, 25));
  assert.equal(save.records[v3.recordKey(edited)], 25);
  const stable = value(
    v3.replaceTrack(save, edited.uid, structuredClone(edited.track)),
  );
  assert.equal(
    v3.activeTrack(stable).geometryIdentity,
    edited.geometryIdentity,
  );
  const renamed = value(v3.renameTrack(stable, edited.uid, "新名字"));
  assert.equal(
    v3.activeTrack(renamed).geometryIdentity,
    edited.geometryIdentity,
  );
  assert.equal(renamed.records[v3.recordKey(edited)], 25);
  const added = value(v3.addTrack(renamed, edited.track, "copy"));
  assert.notEqual(
    v3.activeTrack(added).geometryIdentity,
    edited.geometryIdentity,
  );
  assert.equal(added.records[v3.recordKey(v3.activeTrack(added))], undefined);
});
test("invalid digest, duplicate UID/identity, geometry, records and capacities reject without cropping", () => {
  const save = loaded().save;
  for (const alter of [
    (s: v3.Save) =>
      (s.tracks[0].geometryDigest = "geom-v1-sha256-" + "0".repeat(64)),
    (s: v3.Save) => s.tracks.push(structuredClone(s.tracks[0])),
    (s: v3.Save) => {
      s.tracks[0].track.points[0].x = -500;
    },
    (s: v3.Save) => {
      s.records[v3.recordKey(s.tracks[0])] = Infinity;
    },
    (s: v3.Save) => {
      for (let i = 1; i <= 513; i++)
        s.legacy.records[`${s.activeTrackUid}:track-a:rules-${i}`] = 20;
    },
    (s: v3.Save) => {
      for (let i = 1; i <= 513; i++)
        s.records[v3.recordKey(s.tracks[0], i)] = 20;
    },
  ]) {
    const copy = structuredClone(save);
    alter(copy);
    assert.equal(v3.validateSave(copy).ok, false);
  }
  const both = value(v3.addTrack(save, save.tracks[0].track, "another"));
  both.tracks[1].geometryIdentity = both.tracks[0].geometryIdentity;
  assert.equal(v3.validateSave(both).ok, false);
  const large = memory({ [OLD_KEYS.v2]: JSON.stringify(source()) });
  large.reject("quota");
  assert.equal(new SaveSession(large.store, lease()).open().persisted, false);
  assert.equal(large.writes.length, 0);
});
test("corrupt/unknown V3 is preserved; no legacy fallback writer can overwrite it", () => {
  for (const raw of [
    "broken",
    JSON.stringify({ schemaVersion: 99 }),
    JSON.stringify({ ...loaded().save, tracks: [] }),
  ]) {
    const m = memory({
        [STORAGE_KEY]: raw,
        [OLD_KEYS.v2]: JSON.stringify(source()),
      }),
      s = new SaveSession(m.store, lease()),
      load = s.open();
    assert.equal(load.error, "invalid-v3");
    assert.equal(load.persisted, false);
    assert.equal(s.write(v3.freshSave()).ok, false);
    assert.equal(m.data.get(STORAGE_KEY), raw);
    assert.deepEqual(m.writes, []);
  }
});
test("writer lease, stale V3, old client changes and readback failure are protected", () => {
  const { save, m, session } = loaded();
  const other = new SaveSession(m.store, {
    owned: false,
    release() {},
    error: "writer-busy",
  }).open();
  assert.equal(other.error, "writer-busy");
  assert.ok(other.persisted);
  const renamed = value(
    v3.renameTrack(save, save.activeTrackUid, "will not write"),
  );
  m.data.set(OLD_KEYS.v2, JSON.stringify({ ...source(), muted: true }));
  assert.deepEqual(session.write(renamed), { ok: false, error: "conflict" });
  assert.notEqual(
    JSON.parse(m.data.get(STORAGE_KEY)!).tracks[0].track.name,
    "will not write",
  );
  const again = new SaveSession(m.store, lease()).open();
  assert.equal(again.error, "conflict");
  const b = loaded();
  b.m.data.set(STORAGE_KEY, b.m.data.get(STORAGE_KEY)! + " ");
  assert.equal(b.session.write(b.save).ok, false);
  const drop = memory();
  drop.reject("drop");
  assert.equal(new SaveSession(drop.store, lease()).open().error, "conflict");
  const race = memory();
  let watch = false,
    reads = 0;
  const racingStore = {
    ...race.store,
    getItem(key: string) {
      if (watch && key === STORAGE_KEY && ++reads === 3)
        race.data.set(key, race.data.get(key)! + " ");
      return race.store.getItem(key);
    },
  };
  const racing = new SaveSession(racingStore, lease());
  const initial = racing.open().save;
  watch = true;
  assert.equal(
    racing.write(value(v3.renameTrack(initial, initial.activeTrackUid, "race")))
      .ok,
    false,
  );
  assert.equal(racing.error, "conflict");
  const read = memory();
  read.reject("read");
  assert.equal(
    new SaveSession(read.store, lease()).open().error,
    "unavailable",
  );
});
test("public mutation cannot rebind an existing identity, erase archives or forge cached geometry", () => {
  const { save, session, m } = loaded();
  const raw = m.data.get(STORAGE_KEY);
  save.tracks[0].track.points[0].x += 0.001;
  save.tracks[0].geometryDigest = geometryDigest(
    save.tracks[0].track.points,
    108,
  );
  assert.deepEqual(session.write(save), {
    ok: false,
    error: "invalid-identity",
  });
  assert.equal(m.data.get(STORAGE_KEY), raw);
  const b = loaded();
  b.save.legacy.records = {};
  assert.equal(b.session.write(b.save).ok, false);
  const c = loaded();
  c.save.tracks[0].track.points[0].x = -200;
  assert.equal(c.session.write(c.save).ok, false);
});
test("new whole-stroke drafts bind the V3 revision, leaving v1 bytes untouched", () => {
  const { save, m, session } = loaded(),
    src = draftSource(save, "replace"),
    policy = v3DraftPolicy(() => session.writable),
    store = new DraftStorage(m.store, policy);
  assert.ok(store.open(src).ok);
  assert.ok(
    store.write({
      current: {
        phase: "complete",
        raw: [{ x: 400, y: 400 }],
        overflow: false,
      },
      retained: null,
    }).ok,
  );
  assert.equal(m.data.get("paperlap.draft.v1"), "old draft untouched");
  assert.equal(JSON.parse(m.data.get(V3_DRAFT_KEY)!).schemaVersion, 2);
  const wrong = { ...src, geometryIdentity: "g-" + "a".repeat(32) };
  assert.equal(new DraftStorage(m.store, policy).open(wrong).ok, false);
  assert.ok(new DraftStorage(m.store, policy).open(src).checkpoint);
  assert.ok(store.clear().ok);
  assert.equal(m.data.get("paperlap.draft.v1"), "old draft untouched");
});

test("maximum readable legacy records all survive and explicit scene failures preserve transaction order", async () => {
  const oldSave = old.freshSave();
  oldSave.records = {};
  oldSave.legacyRecords = {};
  for (let i = 1; i <= 512; i++)
    oldSave.records[old.recordKey(oldSave.tracks[0], i)] = 20 + i * 0.001;
  for (let i = 0; i < 128; i++)
    oldSave.legacyRecords[`track-${i.toString(16)}:rules-1`] = 25;
  const m = memory({ [OLD_KEYS.v2]: JSON.stringify(oldSave) }),
    session = new SaveSession(m.store, lease()),
    loaded = session.open();
  assert.ok(loaded.persisted);
  assert.equal(Object.keys(loaded.save.legacy.records).length, 512);
  assert.equal(Object.keys(loaded.save.legacyRecords).length, 128);
  const { Trackbook } = await import("../src/game/trackbook.ts");
  for (const stage of ["prepare", "apply"]) {
    const b = memory(),
      s = new SaveSession(b.store, lease()),
      initial = s.open().save;
    let recovered = false;
    const before = b.data.get(STORAGE_KEY);
    const book = new Trackbook(initial, {
      uid: () => "another",
      write: (c) =>
        c.schemaVersion === 3
          ? s.write(c)
          : { ok: false, error: "invalid-save" },
      stop() {},
      prepare() {
        if (stage === "prepare") throw Error("prepare");
        return () => {
          throw Error("apply");
        };
      },
      recover() {
        recovered = true;
      },
    });
    book.beginEdit("create");
    const r = book.acceptDrawing(initial.tracks[0].track);
    assert.equal(r.ok, false);
    if (stage === "prepare") {
      assert.equal(b.data.get(STORAGE_KEY), before);
      assert.equal(recovered, false);
    } else {
      assert.notEqual(b.data.get(STORAGE_KEY), before);
      assert.equal(recovered, true);
      assert.equal(book.reloadRequired, true);
    }
  }
});

test("V1 truncation or filtered records cannot silently become a successful V3 upgrade", () => {
  const base = {
    schemaVersion: 1,
    rulesVersion: 1,
    track: old.freshSave().tracks[0].track,
    records: {},
    muted: true,
  };
  for (const source of [
    { ...base, track: { ...base.track, name: "旧名字".repeat(20) } },
    { ...base, records: { "track-beef:rules-1": -1 } },
    { ...base, muted: "false" },
  ]) {
    const raw = JSON.stringify(source),
      m = memory({ [OLD_KEYS.v1]: raw });
    const loaded = new SaveSession(m.store, lease()).open();
    assert.equal(loaded.persisted, false);
    assert.equal(m.data.get(STORAGE_KEY), undefined);
    assert.equal(m.data.get(OLD_KEYS.v1), raw);
    assert.equal(m.writes.length, 0);
  }
});
