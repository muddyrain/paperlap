import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshSave,
  activeTrack,
  recordKey,
  setBest,
} from "../src/game/save-v3.ts";
import {
  LocalEditModel,
  prepareLocalDrag,
  deformLocal,
} from "../src/game/local-edit.ts";
import {
  localSource,
  sameLocalSource,
  type LocalSource,
} from "../src/game/local-source.ts";
import {
  LocalDraftStorage,
  LOCAL_DRAFT_KEY,
} from "../src/game/local-draft-storage.ts";
import { SaveSession, STORAGE_KEY } from "../src/game/storage-v3.ts";
import { Trackbook } from "../src/game/trackbook.ts";
function memory() {
  const data = new Map<string, string>(),
    writes: string[] = [];
  let fail = "";
  const store = {
    getItem(k: string) {
      if (fail === "read" && k === LOCAL_DRAFT_KEY) throw Error("read");
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (fail === "write" && k === LOCAL_DRAFT_KEY) throw Error("write");
      if (fail === "v3" && k === STORAGE_KEY) throw Error("v3");
      data.set(k, v);
      writes.push(k);
    },
    removeItem(k: string) {
      if (fail === "clear") throw Error("clear");
      data.delete(k);
      writes.push(k);
    },
  };
  const lease = {
    owned: true,
    release() {
      this.owned = false;
    },
  };
  const session = new SaveSession(store, lease),
    save = session.open().save;
  return {
    data,
    writes,
    store,
    session,
    save,
    lease,
    fail: (v: string) => {
      fail = v;
    },
  };
}
function adopted(points = activeTrack(freshSave()).track.points) {
  const model = new LocalEditModel(points);
  const i = points.reduce((a, p, i) => (p.x < points[a].x ? i : a), 0);
  const selected = prepareLocalDrag(points, points[i]);
  assert.ok(selected.ok);
  if (!selected.ok) throw Error();
  assert.equal(
    model.preview(deformLocal(selected.drag, { x: -12, y: 0 })),
    null,
  );
  assert.ok(model.adopt());
  return model;
}
test("local history restores exact accepted points and one-step undo/redo, rejecting seam edits", () => {
  const base = activeTrack(freshSave()).track.points,
    model = adopted(base),
    cp = model.checkpoint;
  const restore = new LocalEditModel(base);
  restore.restore(cp);
  assert.deepEqual(restore.current, model.current);
  assert.ok(restore.dirty);
  restore.undo();
  assert.deepEqual(restore.current, base);
  restore.redo();
  assert.deepEqual(restore.current, cp.current);
  const broken = structuredClone(cp);
  broken.current[0].x += 1;
  assert.throws(() => restore.restore(broken));
  assert.deepEqual(restore.current, cp.current);
});
test("local draft stores exact accepted snapshots, retains whole-stroke bytes and source metadata", () => {
  const m = memory(),
    base = activeTrack(m.save),
    src = localSource(base),
    model = adopted(base.track.points);
  for (const k of [
    "paperlap.save.v1",
    "paperlap.save.v2",
    "paperlap.draft.v1",
    "paperlap.draft.v2",
  ])
    m.data.set(k, "untouched");
  // Those legacy writes simulate an incompatible client; retain bytes without bypassing session guards.
  for (const k of ["paperlap.save.v1", "paperlap.save.v2"]) m.data.delete(k);
  const storage = new LocalDraftStorage(m.store, () => m.session.check().ok);
  assert.ok(storage.open(src, base.track.points).ok);
  assert.ok(storage.write(model.checkpoint).ok);
  const recovered = new LocalDraftStorage(
    m.store,
    () => m.session.check().ok,
  ).open(src, base.track.points);
  assert.ok(recovered.ok);
  if (recovered.ok) assert.deepEqual(recovered.checkpoint, model.checkpoint);
  assert.equal(m.data.get("paperlap.draft.v1"), "untouched");
  assert.equal(m.data.get("paperlap.draft.v2"), "untouched");
  assert.deepEqual(
    JSON.parse(m.data.get(LOCAL_DRAFT_KEY)!).entries[0].source,
    src,
  );
});
test("wrong source, stale official bytes, unsupported algorithms and foreign drafts never apply", () => {
  const m = memory(),
    base = activeTrack(m.save),
    src = localSource(base),
    s = new LocalDraftStorage(m.store, () => m.session.check().ok);
  assert.ok(s.open(src, base.track.points).ok);
  assert.ok(s.write(adopted(base.track.points).checkpoint).ok);
  const raw = m.data.get(LOCAL_DRAFT_KEY);
  for (const source of [
    { ...src, uid: "other" },
    { ...src, geometryIdentity: "g-" + "a".repeat(32) },
    { ...src, geometryDigest: "geom-v1-sha256-" + "a".repeat(64) },
    { ...src, algorithmVersion: 2 },
  ])
    assert.equal(
      new LocalDraftStorage(m.store, () => true).open(
        source as LocalSource,
        base.track.points,
      ).ok,
      false,
    );
  m.data.set(STORAGE_KEY, m.data.get(STORAGE_KEY)! + " ");
  assert.equal(s.write(adopted(base.track.points).checkpoint).ok, false);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), raw);
  assert.equal(
    sameLocalSource(src, {
      ...src,
      algorithmVersion: 2,
    } as unknown as LocalSource),
    false,
  );
});
test("unknown draft and initial read failure cannot erase unknown backups", () => {
  for (const kind of ["invalid", "read"]) {
    const m = memory(),
      e = activeTrack(m.save),
      s = new LocalDraftStorage(m.store, () => true);
    m.data.set(LOCAL_DRAFT_KEY, "unknown bytes");
    if (kind === "read") m.fail("read");
    assert.equal(s.open(localSource(e), e.track.points).ok, false);
    assert.equal(s.confirmed, false);
    assert.equal(s.clear().ok, false);
    assert.equal(m.data.get(LOCAL_DRAFT_KEY), "unknown bytes");
  }
});
test("quota and known cleanup failure preserve the previous recoverable local route", () => {
  const m = memory(),
    e = activeTrack(m.save),
    s = new LocalDraftStorage(m.store, () => true),
    model = adopted(e.track.points);
  assert.ok(s.open(localSource(e), e.track.points).ok);
  assert.ok(s.write(model.checkpoint).ok);
  const raw = m.data.get(LOCAL_DRAFT_KEY);
  model.undo();
  m.fail("write");
  assert.equal(s.write(model.checkpoint).ok, false);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), raw);
  m.fail("clear");
  assert.equal(s.clear().ok, false);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), raw);
});
test("local draft bad geometry, duplicate source, bounds and external draft changes are refused", () => {
  const m = memory(),
    e = activeTrack(m.save),
    src = localSource(e),
    s = new LocalDraftStorage(m.store, () => true);
  assert.ok(s.open(src, e.track.points).ok);
  const cp = adopted(e.track.points).checkpoint;
  assert.ok(s.write(cp).ok);
  const raw = m.data.get(LOCAL_DRAFT_KEY)!;
  const bad = structuredClone(cp);
  bad.current[15].y = -100;
  assert.equal(s.write(bad).ok, false);
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), raw);
  const doc = JSON.parse(raw);
  doc.entries.push({
    ...doc.entries[0],
    source: {
      algorithmVersion: 1,
      geometryDigest: src.geometryDigest,
      geometryIdentity: src.geometryIdentity,
      uid: src.uid,
    },
  });
  m.data.set(LOCAL_DRAFT_KEY, JSON.stringify(doc));
  assert.equal(
    new LocalDraftStorage(m.store, () => true).open(src, e.track.points).ok,
    false,
  );
  assert.equal(s.clear().ok, false);
});
function bookFor(stage = "") {
  const m = memory();
  let applied = 0,
    recovered = false;
  const result = setBest(m.save, m.save.activeTrackUid, 23);
  assert.ok(result.ok);
  if (!result.ok) throw Error();
  assert.ok(m.session.write(result.save).ok);
  const book = new Trackbook(result.save, {
    uid: () => "new",
    write: (s) =>
      s.schemaVersion === 3
        ? m.session.write(s)
        : { ok: false, error: "invalid-save" },
    check: () => m.session.check(),
    stop() {},
    prepare() {
      if (stage === "prepare") throw Error();
      return () => {
        if (stage === "apply") throw Error();
        applied++;
      };
    },
    recover() {
      recovered = true;
    },
  });
  return {
    m,
    book,
    get applied() {
      return applied;
    },
    get recovered() {
      return recovered;
    },
  };
}
test("explicit local transaction preserves UID/name and historical PB, changes revision only on changed geometry", () => {
  const t = bookFor(),
    before = activeTrack(t.book.save as ReturnType<typeof freshSave>);
  assert.ok(t.book.beginLocal().ok);
  assert.equal(t.book.beginEdit("replace").ok, false);
  const source = t.book.localSource!;
  assert.ok(
    t.book.commitLocal(source, adopted(before.track.points).current).ok,
  );
  assert.equal(t.applied, 1);
  const after = activeTrack(t.book.save as ReturnType<typeof freshSave>);
  assert.equal(after.uid, before.uid);
  assert.equal(after.track.name, before.track.name);
  assert.notEqual(after.geometryIdentity, before.geometryIdentity);
  assert.equal(t.book.save.records[recordKey(before)], 23);
  assert.equal(t.book.save.records[recordKey(after)], undefined);
});
test("local no-op and invalid source never perform a false formal save", () => {
  const t = bookFor(),
    e = activeTrack(t.book.save as ReturnType<typeof freshSave>);
  assert.ok(t.book.beginLocal().ok);
  const source = t.book.localSource!,
    writes = t.m.writes.length;
  assert.equal(
    t.book.commitLocal({ ...source, uid: "wrong" }, e.track.points).ok,
    false,
  );
  assert.equal(t.m.writes.length, writes);
  const r = t.book.commitLocal(source, e.track.points);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.changed, false);
  assert.equal(t.m.writes.length, writes);
  assert.equal(t.applied, 0);
});
test("prepare/write/apply failure obey strict transaction order and preserve local edit state", () => {
  for (const stage of ["prepare", "write", "apply"]) {
    const t = bookFor(stage),
      e = activeTrack(t.book.save as ReturnType<typeof freshSave>);
    t.book.beginLocal();
    const raw = t.m.data.get(STORAGE_KEY);
    if (stage === "write") t.m.fail("v3");
    assert.equal(
      t.book.commitLocal(t.book.localSource!, adopted(e.track.points).current)
        .ok,
      false,
    );
    assert.ok(t.book.localSource);
    if (stage === "apply") {
      assert.notEqual(t.m.data.get(STORAGE_KEY), raw);
      assert.ok(t.book.reloadRequired);
      assert.ok(t.recovered);
    } else {
      assert.equal(t.m.data.get(STORAGE_KEY), raw);
      assert.equal(t.book.reloadRequired, false);
      assert.deepEqual(
        activeTrack(t.book.save as ReturnType<typeof freshSave>).track,
        e.track,
      );
    }
  }
});
test("writer lease failure denies entering local edit and backup export includes its raw key", () => {
  const t = bookFor();
  t.m.data.set(LOCAL_DRAFT_KEY, "local backup raw");
  assert.equal(
    JSON.parse(t.m.session.backup()).localDraftV1,
    "local backup raw",
  );
  t.m.lease.release();
  assert.equal(t.book.beginLocal().ok, false);
  assert.equal(t.book.localSource, null);
});

test("local draft capacity never evicts old entries or truncates oversized raw data", () => {
  const m = memory(),
    e = activeTrack(m.save),
    source = localSource(e),
    checkpoint = adopted(e.track.points).checkpoint;
  const raw = JSON.stringify({
    schemaVersion: 1,
    entries: Array.from({ length: 8 }, (_, i) => ({
      source: { ...source, uid: `foreign-${i}` },
      checkpoint,
      updatedAt: 1,
    })),
  });
  m.data.set(LOCAL_DRAFT_KEY, raw);
  const s = new LocalDraftStorage(m.store, () => true);
  assert.ok(s.open(source, e.track.points).ok);
  assert.deepEqual(s.write(checkpoint), { ok: false, error: "limit" });
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), raw);
  const oversized = raw + " ".repeat(1_200_001);
  m.data.set(LOCAL_DRAFT_KEY, oversized);
  assert.equal(
    new LocalDraftStorage(m.store, () => true).open(source, e.track.points).ok,
    false,
  );
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), oversized);
});

test("local checkpoint writes and cleanup require exact readback, not merely a nonthrowing storage call", () => {
  const m = memory(),
    e = activeTrack(m.save),
    s = new LocalDraftStorage(m.store, () => true),
    checkpoint = adopted(e.track.points).checkpoint;
  assert.ok(s.open(localSource(e), e.track.points).ok);
  const set = m.store.setItem;
  m.store.setItem = (k, v) => {
    if (k !== LOCAL_DRAFT_KEY) set(k, v);
  };
  assert.deepEqual(s.write(checkpoint), { ok: false, error: "conflict" });
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), undefined);
  m.store.setItem = set;
  assert.ok(s.write(checkpoint).ok);
  const raw = m.data.get(LOCAL_DRAFT_KEY);
  const remove = m.store.removeItem;
  m.store.removeItem = () => {};
  assert.deepEqual(s.clear(), { ok: false, error: "conflict" });
  assert.equal(m.data.get(LOCAL_DRAFT_KEY), raw);
  m.store.removeItem = remove;
  assert.ok(s.clear().ok);
});
