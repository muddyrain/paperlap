import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeTrack,
  addTrack,
  deleteTrack,
  freshSave,
  migrateV1,
  parseSave,
  recordKey,
  renameTrack,
  replaceTrack,
  SAVE_LIMITS,
  selectTrack,
  setBest,
  validateSave,
  type Save,
  type SaveResult,
} from "../src/game/save.ts";
import {
  loadSave,
  STORAGE_KEY,
  V1_STORAGE_KEY,
  writeSave,
} from "../src/game/storage.ts";
import { defaultTrack, fingerprint } from "../src/game/geometry.ts";
import { RULES_VERSION } from "../src/game/config.ts";

function value(result: SaveResult): Save {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw Error(result.error);
  return result.save;
}
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    items,
    writes,
    getItem: (key: string) => items.get(key) ?? null,
    setItem(key: string, raw: string) {
      writes.push(key);
      items.set(key, raw);
    },
  };
}
function v1() {
  const track = { ...defaultTrack(), name: "原来的赛道" };
  return {
    schemaVersion: 1,
    rulesVersion: 2,
    track,
    muted: false,
    records: {
      [`${track.id}:rules-1`]: 24.68,
      [`${track.id}:rules-2`]: 23.45,
      "track-deadbeef:rules-1": 32.1,
      "track-deadbeef:rules-2": 30.2,
    },
  };
}
const raw = (save: unknown) => JSON.stringify(save);

test("fresh V2 has one default entry and round-trips without changing identity", () => {
  const save = freshSave();
  assert.equal(save.schemaVersion, 2);
  assert.equal(save.tracks.length, 1);
  assert.deepEqual(activeTrack(save).track, defaultTrack());
  assert.deepEqual(parseSave(raw(save)), save);
  const storage = memory();
  const loaded = loadSave(storage);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.persisted, true);
  assert.deepEqual(loadSave(storage).save, loaded.save);
  assert.deepEqual(storage.writes, [STORAGE_KEY]);
});

test("V1 migration preserves geometry/name/preferences, both rules and archives orphan records", () => {
  const old = v1();
  const save = migrateV1(raw(old))!;
  assert.ok(save);
  assert.deepEqual(activeTrack(save).track, old.track);
  assert.equal(save.muted, false);
  assert.equal(save.records[recordKey(activeTrack(save), 1)], 24.68);
  assert.equal(save.records[recordKey(activeTrack(save), 2)], 23.45);
  assert.deepEqual(save.legacyRecords, {
    "track-deadbeef:rules-1": 32.1,
    "track-deadbeef:rules-2": 30.2,
  });
  assert.deepEqual(migrateV1(raw(old)), save);
  assert.deepEqual(parseSave(raw(save)), save);
});

test("V1 migration writes only V2, then repeated loads prefer persisted V2", () => {
  const original = raw(v1());
  const storage = memory({ [V1_STORAGE_KEY]: original });
  const first = loadSave(storage);
  assert.equal(first.source, "v1");
  assert.equal(first.persisted, true);
  const renamed = value(
    renameTrack(first.save, first.save.activeTrackUid, "新名称"),
  );
  assert.equal(writeSave(storage, renamed).ok, true);
  assert.deepEqual(loadSave(storage).save, renamed);
  assert.equal(storage.getItem(V1_STORAGE_KEY), original);
  assert.ok(storage.writes.every((key) => key === STORAGE_KEY));
});

test("same geometry with different UIDs has independent bests and survives switching/reload", () => {
  let save = freshSave();
  const a = save.activeTrackUid;
  save = value(setBest(save, a, 25));
  save = value(addTrack(save, activeTrack(save).track, "entry-b"));
  assert.equal(save.activeTrackUid, "entry-b");
  assert.equal(save.records[recordKey(activeTrack(save))], undefined);
  save = value(setBest(save, "entry-b", 35));
  save = value(selectTrack(save, a));
  assert.equal(save.records[recordKey(activeTrack(save))], 25);
  const storage = memory();
  assert.equal(writeSave(storage, save).ok, true);
  const loaded = loadSave(storage).save;
  assert.equal(loaded.tracks.length, 2);
  assert.equal(
    loaded.records[
      recordKey(activeTrack(value(selectTrack(loaded, "entry-b"))))
    ],
    35,
  );
  assert.deepEqual(loaded, save);
});

test("rename retains UID/records; geometry and rules changes isolate historical bests", () => {
  let save = value(setBest(freshSave(), freshSave().activeTrackUid, 25));
  const before = structuredClone(save);
  const input = save;
  save = value(renameTrack(save, save.activeTrackUid, "保留名称"));
  assert.equal(save.activeTrackUid, before.activeTrackUid);
  assert.deepEqual(save.records, before.records);
  assert.equal(
    save.records[recordKey(activeTrack(save), RULES_VERSION + 1)],
    undefined,
  );
  const track = structuredClone(activeTrack(save).track);
  track.points.forEach((p) => {
    p.x += 1;
  });
  track.id = fingerprint(track.points, track.width);
  save = value(replaceTrack(save, save.activeTrackUid, track));
  assert.equal(activeTrack(save).track.name, "保留名称");
  assert.equal(save.records[recordKey(activeTrack(save))], undefined);
  assert.deepEqual(save.records, before.records);
  assert.deepEqual(parseSave(raw(save)), save);
  assert.deepEqual(input, before);
});

test("best updates never replace a faster result", () => {
  const save = value(setBest(freshSave(), freshSave().activeTrackUid, 25));
  assert.deepEqual(value(setBest(save, save.activeTrackUid, 30)), save);
  assert.equal(
    value(setBest(save, save.activeTrackUid, 20)).records[
      recordKey(activeTrack(save))
    ],
    20,
  );
  for (const time of [NaN, Infinity, 0, 2, 3600, -1])
    assert.equal(setBest(save, save.activeTrackUid, time).ok, false);
});

test("delete removes only the selected entry and its records, switches active, refuses last track", () => {
  let save = migrateV1(raw(v1()))!;
  const first = save.activeTrackUid;
  save = value(addTrack(save, defaultTrack(), "entry-b"));
  save = value(setBest(save, "entry-b", 28));
  const result = value(deleteTrack(save, first));
  assert.equal(result.activeTrackUid, "entry-b");
  assert.equal(Object.keys(result.records).length, 1);
  assert.deepEqual(result.legacyRecords, save.legacyRecords);
  assert.deepEqual(deleteTrack(result, "entry-b"), {
    ok: false,
    error: "last-track",
  });
  assert.equal(value(deleteTrack(save, "entry-b")).activeTrackUid, first);
  assert.equal(deleteTrack(save, "missing").ok, false);
});

test("invalid names, missing/duplicate UID and track capacities fail without mutating input", () => {
  let save = freshSave();
  const original = structuredClone(save);
  for (const name of ["", "   ", "x".repeat(SAVE_LIMITS.name + 1)])
    assert.equal(renameTrack(save, save.activeTrackUid, name).ok, false);
  for (const uid of ["", "bad:uid", save.activeTrackUid])
    assert.equal(addTrack(save, defaultTrack(), uid).ok, false);
  assert.equal(selectTrack(save, "missing").ok, false);
  assert.equal(replaceTrack(save, "missing", defaultTrack()).ok, false);
  assert.equal(renameTrack(save, "missing", "新名称").ok, false);
  assert.deepEqual(save, original);
  for (let i = 1; i < SAVE_LIMITS.tracks; i++)
    save = value(addTrack(save, defaultTrack(), `entry-${i}`));
  assert.equal(parseSave(raw(save))?.tracks.length, SAVE_LIMITS.tracks);
  assert.deepEqual(addTrack(save, defaultTrack(), "overflow"), {
    ok: false,
    error: "track-limit",
  });
});

test("V2 rejects malformed JSON, geometry, IDs, metadata and invalid record associations", () => {
  const mutations: ((s: any) => void)[] = [
    (s) => {
      s.schemaVersion = 3;
    },
    (s) => {
      s.rulesVersion = 0;
    },
    (s) => {
      s.muted = "false";
    },
    (s) => {
      s.activeTrackUid = "missing";
    },
    (s) => {
      s.tracks = [];
    },
    (s) => {
      s.tracks.push(structuredClone(s.tracks[0]));
    },
    (s) => {
      s.tracks[0].uid = "bad:uid";
    },
    (s) => {
      s.tracks[0].track.id = "track-deadbeef";
    },
    (s) => {
      s.tracks[0].track.points[0] = null;
    },
    (s) => {
      s.tracks[0].track.points[0].x = "0";
    },
    (s) => {
      s.tracks[0].track.points = Array(901).fill({ x: 500, y: 500 });
    },
    (s) => {
      s.tracks[0].track.width = 109;
    },
    (s) => {
      s.tracks[0].track.name = "x".repeat(41);
    },
    (s) => {
      s.records = [];
    },
    (s) => {
      s.records = { "missing:track-a:rules-2": 20 };
    },
    (s) => {
      s.records[recordKey(s.tracks[0])] = -1;
    },
    (s) => {
      s.legacyRecords = { "bad-key": 20 };
    },
  ];
  for (const mutate of mutations) {
    const save = freshSave();
    mutate(save);
    assert.equal(parseSave(raw(save)), null, mutate.toString());
  }
  for (const input of [
    null,
    "",
    "null",
    "[]",
    "{}",
    "{oops",
    " ".repeat(SAVE_LIMITS.characters + 1),
  ])
    assert.equal(parseSave(input), null);
});

test("record limits return failure; never evict valid records to make room", () => {
  const save = freshSave();
  const entry = activeTrack(save);
  for (let i = 1; i <= SAVE_LIMITS.records; i++)
    save.records[recordKey(entry, i)] = 20;
  assert.ok(parseSave(raw(save)));
  assert.equal(setBest(save, entry.uid, 19, SAVE_LIMITS.records + 1).ok, false);
  assert.equal(
    value(setBest(save, entry.uid, 19)).records[recordKey(entry)],
    19,
  );
  save.records[recordKey(entry, SAVE_LIMITS.records + 1)] = 20;
  const storage = memory({ [STORAGE_KEY]: raw(freshSave()) });
  const before = storage.getItem(STORAGE_KEY);
  assert.equal(writeSave(storage, save).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.deepEqual(storage.writes, []);
});

test("V1 preserves more than the old 32-record read window; over-limit migration does not truncate", () => {
  const old = v1();
  old.records = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [
      `track-${i.toString(16)}:rules-1`,
      20,
    ]),
  );
  const save = migrateV1(raw(old))!;
  assert.equal(
    Object.keys(save.records).length + Object.keys(save.legacyRecords).length,
    40,
  );
  old.records = Object.fromEntries(
    Array.from({ length: SAVE_LIMITS.legacyRecords + 1 }, (_, i) => [
      `track-${i.toString(16)}:rules-1`,
      20,
    ]),
  );
  const storage = memory({ [V1_STORAGE_KEY]: raw(old) });
  assert.equal(loadSave(storage).persisted, false);
  assert.equal(storage.getItem(V1_STORAGE_KEY), raw(old));
  assert.deepEqual(storage.writes, []);
});

test("legacy invalid values are ignored; a forged geometry ID never acquires current best", () => {
  const old = v1();
  old.track.id = "track-deadbeef";
  old.records = {
    "track-deadbeef:rules-2": 30,
    "bad-key": 10,
    "track-a:rules-2": -1,
  };
  const save = migrateV1(raw(old))!;
  assert.equal(activeTrack(save).track.id, defaultTrack().id);
  assert.deepEqual(save.records, {});
  assert.deepEqual(save.legacyRecords, { "track-deadbeef:rules-2": 30 });
});

test("quota failure leaves V1 bytes intact; retry is stable and only successful V2 becomes authoritative", () => {
  const original = raw(v1());
  const storage = memory({ [V1_STORAGE_KEY]: original });
  let blocked = true;
  const constrained = {
    ...storage,
    setItem(key: string, input: string) {
      if (blocked) throw new DOMException("full", "QuotaExceededError");
      storage.setItem(key, input);
    },
  };
  const first = loadSave(constrained),
    second = loadSave(constrained);
  assert.equal(first.source, "v1");
  assert.equal(first.persisted, false);
  assert.equal(first.error, "quota");
  assert.deepEqual(first.save, second.save);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  blocked = false;
  assert.equal(loadSave(constrained).persisted, true);
  assert.deepEqual(loadSave(constrained).save, first.save);
  assert.equal(storage.getItem(V1_STORAGE_KEY), original);
});

test("corrupt V2 falls back to V1 without overwriting either key", () => {
  const storage = memory({
    [STORAGE_KEY]: "{broken",
    [V1_STORAGE_KEY]: raw(v1()),
  });
  const loaded = loadSave(storage);
  assert.equal(loaded.source, "v1");
  assert.equal(loaded.error, "invalid-v2");
  assert.equal(loaded.persisted, false);
  assert.deepEqual(loaded.save, migrateV1(raw(v1())));
  assert.equal(writeSave(storage, loaded.save).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), "{broken");
  assert.deepEqual(storage.writes, []);
});

test("invalid V1 and blocked storage remain playable but are never automatically rewritten", () => {
  for (const input of [
    "broken",
    "null",
    raw({ ...v1(), track: { points: [null] } }),
    " ".repeat(SAVE_LIMITS.v1Characters + 1),
  ]) {
    const storage = memory({ [V1_STORAGE_KEY]: input });
    const loaded = loadSave(storage);
    assert.deepEqual(loaded.save, freshSave());
    assert.equal(loaded.error, "invalid-v1");
    assert.equal(loaded.persisted, false);
    assert.equal(writeSave(storage, loaded.save).ok, false);
    assert.deepEqual(storage.writes, []);
  }
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  assert.deepEqual(loadSave(blocked).save, freshSave());
  assert.equal(loadSave(blocked).error, "unavailable");
  assert.equal(writeSave(blocked, freshSave()).ok, false);
});

test("valid V2 is authoritative without reading or migrating V1", () => {
  const save = value(setBest(freshSave(), freshSave().activeTrackUid, 20));
  const storage = {
    getItem(key: string) {
      assert.equal(
        key,
        STORAGE_KEY,
        "must not access legacy storage for a valid V2",
      );
      return raw(save);
    },
    setItem() {
      assert.fail("loading valid V2 must not rewrite it");
    },
  };
  assert.deepEqual(loadSave(storage), { save, source: "v2", persisted: true });
});

test("write failures preserve an existing V2 snapshot and the caller's in-memory data", () => {
  const persisted = raw(freshSave());
  const storage = memory({ [STORAGE_KEY]: persisted });
  const next = value(setBest(freshSave(), freshSave().activeTrackUid, 20));
  const before = structuredClone(next);
  for (const error of [
    Error("denied"),
    new DOMException("full", "QuotaExceededError"),
  ]) {
    const result = writeSave(
      {
        ...storage,
        setItem() {
          throw error;
        },
      },
      next,
    );
    assert.equal(result.ok, false);
    assert.equal(storage.getItem(STORAGE_KEY), persisted);
    assert.deepEqual(next, before);
  }
  assert.deepEqual(storage.writes, []);
});

test("archive and serialized data ceilings fail explicitly without trimming", () => {
  const save = freshSave();
  for (let i = 0; i < SAVE_LIMITS.legacyRecords; i++)
    save.legacyRecords[`track-${i.toString(16)}:rules-1`] = 20;
  assert.ok(parseSave(raw(save)));
  save.legacyRecords["track-ffff:rules-1"] = 20;
  assert.deepEqual(validateSave(save), {
    ok: false,
    error: "legacy-record-limit",
  });
  const oversized = freshSave();
  oversized.legacyRecords[
    `track-${"a".repeat(SAVE_LIMITS.characters)}:rules-1`
  ] = 20;
  assert.deepEqual(validateSave(oversized), { ok: false, error: "data-limit" });
  const storage = memory({ [STORAGE_KEY]: raw(freshSave()) });
  const previous = storage.getItem(STORAGE_KEY);
  assert.equal(writeSave(storage, oversized).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), previous);
  assert.deepEqual(storage.writes, []);
});

test("invalid V2 without V1 remains a read-only playable fallback", () => {
  const storage = memory({ [STORAGE_KEY]: "null" });
  assert.deepEqual(loadSave(storage), {
    save: freshSave(),
    source: "default",
    persisted: false,
    error: "invalid-v2",
  });
  assert.equal(writeSave(storage, freshSave()).ok, false);
  assert.equal(storage.getItem(STORAGE_KEY), "null");
  assert.deepEqual(storage.writes, []);
});

test("legacy empty names remain round-trippable; new entries cannot acquire empty names", () => {
  const old = v1();
  old.track.name = "";
  const save = migrateV1(raw(old))!;
  assert.equal(activeTrack(save).track.name, "");
  assert.deepEqual(parseSave(raw(save)), save);
  assert.equal(addTrack(freshSave(), old.track, "empty-name").ok, false);
});
