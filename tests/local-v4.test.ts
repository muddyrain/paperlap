import { test } from "node:test";
import assert from "node:assert/strict";
import * as v3 from "../src/game/save-v3.ts";
import * as v4 from "../src/game/save-v4.ts";
import { SaveSession, STORAGE_KEY, OLD_KEYS } from "../src/game/storage-v4.ts";
import { LocalDraftStorage, LOCAL_DRAFT_KEY, LOCAL_DRAFT_V2_KEY } from "../src/game/local-draft-storage.ts";
import { LocalGeometryProof, localSource, sameLocalSource } from "../src/game/local-source.ts";
import { LocalEditModel } from "../src/game/local-edit.ts";
import { Trackbook } from "../src/game/trackbook.ts";
import type { Point } from "../src/game/geometry.ts";

function value<T>(r: { ok: true; save: T } | { ok: false; error: string }): T {
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw Error(r.error);
  return r.save;
}
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)), writes: string[] = [];
  let failKey = "", dropKey = "", beforeRead: ((key: string) => void) | undefined;
  const store = {
    getItem(key: string) { beforeRead?.(key); return data.get(key) ?? null; },
    setItem(key: string, raw: string) {
      if (key === failKey) throw new DOMException("quota", "QuotaExceededError");
      if (key === dropKey) return;
      data.set(key, raw); writes.push(key);
    },
    removeItem(key: string) { data.delete(key); writes.push(key); },
  };
  const lease = { owned: true, release() { this.owned = false; } };
  const session = new SaveSession(store, lease), save = session.open().save;
  return { data, writes, store, lease, session, save,
    fail: (key: string) => { failKey = key; },
    drop: (key: string) => { dropKey = key; },
    beforeRead: (hook: typeof beforeRead) => { beforeRead = hook; } };
}
function changed(base: readonly Point[]) {
  const points = structuredClone([...base]);
  points[20].x += 0.001;
  return points;
}
function modelFor(entry: v4.TrackEntry | v3.TrackEntry) {
  const source = localSource(entry), proof = new LocalGeometryProof(source, entry.track.points);
  const model = new LocalEditModel(entry.track.points, { source, proof });
  assert.equal(model.preview(changed(entry.track.points)), null);
  assert.ok(model.adopt());
  return { source, proof, model };
}
function migrated() {
  const previous = v3.freshSave(), oldEntry = v3.activeTrack(previous);
  const { source, model } = modelFor(oldEntry);
  const oldDraft = JSON.stringify({ schemaVersion: 1, entries: [{ source, checkpoint: model.checkpoint, updatedAt: 1 }] });
  const m = memory({ [OLD_KEYS.v3]: JSON.stringify(previous), [LOCAL_DRAFT_KEY]: oldDraft });
  return { ...m, oldDraft, source, model, entry: v4.activeTrack(m.save) };
}

test("V4 large-track local save retains work and historical PB, isolates the new revision", () => {
  const m = memory();
  const save = value(v4.setBest(m.save, m.save.activeTrackUid, 55.6));
  assert.ok(m.session.write(save).ok);
  const before = v4.activeTrack(save), { source, proof, model } = modelFor(before);
  let applied = 0;
  const book = new Trackbook(save, {
    uid: () => "unused", stop() {}, check: () => m.session.check(),
    write: (s) => s.schemaVersion === 4 ? m.session.write(s) : { ok: false, error: "invalid-save" },
    prepare: () => () => { applied++; }, recover() { assert.fail("unexpected recovery"); },
  });
  assert.ok(book.beginLocal().ok);
  assert.equal(book.localSource?.spaceVersion, 2);
  assert.ok(book.commitLocal(source, model.current, proof).ok);
  const after = v4.activeTrack(book.save as v4.Save);
  assert.equal(applied, 1);
  assert.equal(after.uid, before.uid);
  assert.equal(after.track.name, before.track.name);
  assert.equal(after.track.schemaVersion, 2);
  assert.notEqual(after.geometryIdentity, before.geometryIdentity);
  assert.equal(book.save.records[v4.recordKey(before)], 55.6);
  assert.equal(book.save.records[v4.recordKey(after)], undefined);
  const restored = new SaveSession(m.store, m.lease).open().save;
  assert.deepEqual(v4.activeTrack(restored).track.points, model.current);
});

test("V4 local checkpoints restore large coordinates and a previous undo step", () => {
  const m = memory(), entry = v4.activeTrack(m.save), { source, proof, model } = modelFor(entry);
  const backup = new LocalDraftStorage(m.store, () => m.session.check().ok, proof, 4);
  assert.ok(backup.open(source, entry.track.points).ok);
  assert.ok(backup.write(model.checkpoint).ok);
  const restored = new LocalDraftStorage(m.store, () => m.session.check().ok, undefined, 4).open(source, entry.track.points);
  assert.ok(restored.ok && restored.checkpoint);
  if (!restored.ok || !restored.checkpoint) throw Error("missing draft");
  const nextModel = new LocalEditModel(entry.track.points, { source, proof });
  nextModel.restore(restored.checkpoint);
  assert.deepEqual(nextModel.current, model.current);
  nextModel.undo();
  assert.deepEqual(nextModel.current, entry.track.points);
  assert.equal(m.data.has(LOCAL_DRAFT_KEY), false);
});

test("local source space must match the official track even when coordinates and digest match", () => {
  for (const legacy of [false, true]) {
    const m = legacy ? migrated() : memory(), entry = v4.activeTrack(m.save);
    const source = localSource(entry), forged = { ...source, spaceVersion: (legacy ? 2 : 1) as 1 | 2 };
    const count = m.writes.length;
    const backup = new LocalDraftStorage(m.store, () => true, undefined, 4);
    assert.deepEqual(backup.open(forged, entry.track.points), { ok: false, error: "conflict" });
    assert.equal(backup.confirmed, false);
    assert.equal(m.writes.length, count);
    assert.equal(sameLocalSource(source, forged), false);
  }
});

test("legacy local draft copies once, preserves bytes, and an empty V2 tombstone prevents reimport", () => {
  const m = migrated();
  const backup = new LocalDraftStorage(m.store, () => m.session.check().ok, undefined, 4);
  const opened = backup.open(m.source, m.entry.track.points);
  assert.ok(opened.ok && opened.checkpoint);
  if (opened.ok) assert.deepEqual(opened.checkpoint, m.model.checkpoint);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), m.oldDraft);
  assert.equal(JSON.parse(m.data.get(LOCAL_DRAFT_V2_KEY)!).schemaVersion, 2);
  assert.ok(backup.clear().ok);
  const empty = m.data.get(LOCAL_DRAFT_V2_KEY)!;
  assert.deepEqual(JSON.parse(empty).entries, []);
  const again = new LocalDraftStorage(m.store, () => m.session.check().ok, undefined, 4).open(m.source, m.entry.track.points);
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.checkpoint, undefined);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), m.oldDraft);
  assert.equal(m.data.get(LOCAL_DRAFT_V2_KEY), empty);
});

test("invalid matching legacy geometry cannot be promoted into the V2 draft key", () => {
  const m = migrated(), doc = JSON.parse(m.oldDraft);
  doc.entries[0].checkpoint.current[0].x += 1;
  const invalid = JSON.stringify(doc);
  m.data.set(LOCAL_DRAFT_KEY, invalid);
  const backup = new LocalDraftStorage(m.store, () => m.session.check().ok, undefined, 4);
  assert.deepEqual(backup.open(m.source, m.entry.track.points), { ok: false, error: "invalid" });
  assert.equal(backup.confirmed, false);
  assert.equal(m.data.has(LOCAL_DRAFT_V2_KEY), false);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), invalid);
});

test("readonly, quota, lost-readback and concurrently changed legacy draft never claim copy success", () => {
  for (const kind of ["readonly", "quota", "drop", "change"]) {
    const m = migrated(), baselineWrites = m.writes.length;
    if (kind === "readonly") m.lease.release();
    if (kind === "quota") m.fail(LOCAL_DRAFT_V2_KEY);
    if (kind === "drop") m.drop(LOCAL_DRAFT_V2_KEY);
    if (kind === "change") {
      let reads = 0;
      m.beforeRead((key) => {
        if (key === LOCAL_DRAFT_KEY && ++reads === 2) m.data.set(key, m.oldDraft + " ");
      });
    }
    const backup = new LocalDraftStorage(m.store, () => m.session.check().ok, undefined, 4);
    assert.equal(backup.open(m.source, m.entry.track.points).ok, false, kind);
    assert.equal(backup.confirmed, false, kind);
    assert.equal(m.data.has(LOCAL_DRAFT_V2_KEY), false, kind);
    assert.equal(m.writes.length, baselineWrites, kind);
    assert.equal(m.data.get(LOCAL_DRAFT_KEY), m.oldDraft + (kind === "change" ? " " : ""));
  }
});

test("quota and external V2 changes preserve the last acknowledged local draft", () => {
  const m = memory(), entry = v4.activeTrack(m.save), { source, proof, model } = modelFor(entry);
  const backup = new LocalDraftStorage(m.store, () => m.session.check().ok, proof, 4);
  assert.ok(backup.open(source, entry.track.points).ok);
  assert.ok(backup.write(model.checkpoint).ok);
  const raw = m.data.get(LOCAL_DRAFT_V2_KEY)!;
  m.fail(LOCAL_DRAFT_V2_KEY);
  assert.equal(backup.clear().ok, false);
  assert.equal(m.data.get(LOCAL_DRAFT_V2_KEY), raw);
  m.fail("");
  m.data.set(LOCAL_DRAFT_V2_KEY, raw + " ");
  assert.deepEqual(backup.clear(), { ok: false, error: "conflict" });
  assert.equal(m.data.get(LOCAL_DRAFT_V2_KEY), raw + " ");
});

test("prepared render resources dispose on failed writes and apply failures without hiding durable state", () => {
  for (const stage of ["write", "dispose", "apply"]) {
    const m = memory(), entry = v4.activeTrack(m.save), { source, model } = modelFor(entry);
    const original = m.data.get(STORAGE_KEY);
    let applied = 0, disposed = 0, recovered = 0;
    const book = new Trackbook(m.save, {
      uid: () => "unused", stop() {}, check: () => m.session.check(),
      write: (s) => s.schemaVersion === 4 ? m.session.write(s) : { ok: false, error: "invalid-save" },
      prepare() {
        const apply = () => { if (stage === "apply") throw Error("render"); applied++; };
        apply.dispose = () => { disposed++; if (stage === "dispose") throw Error("dispose"); };
        return apply;
      },
      recover() { recovered++; },
    });
    assert.ok(book.beginLocal().ok);
    if (stage !== "apply") m.fail(STORAGE_KEY);
    const result = book.commitLocal(source, model.current);
    assert.equal(result.ok, false);
    assert.equal(disposed, 1, stage);
    assert.equal(applied, 0, stage);
    if (stage === "apply") {
      assert.equal(recovered, 1);
      assert.equal(book.reloadRequired, true);
      assert.notEqual(m.data.get(STORAGE_KEY), original);
    } else {
      assert.deepEqual(result, { ok: false, error: "quota" });
      assert.equal(recovered, 0);
      assert.equal(m.data.get(STORAGE_KEY), original);
      assert.deepEqual(v4.activeTrack(book.save as v4.Save), entry);
    }
  }
});
