import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DraftHistory,
  emptyDraft,
  evaluateDraft,
  draftSource,
  sameSource,
} from "../src/game/draft.ts";
import {
  DraftStorage,
  DRAFT_KEY,
  DRAFT_LIMITS,
} from "../src/game/draft-storage.ts";
import { freshSave } from "../src/game/save.ts";
import { wobblyLoop } from "./fixtures/editor-paths.mjs";

const complete = () => ({
  phase: "complete" as const,
  raw: wobblyLoop(),
  overflow: false,
});
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
};
const source = () => draftSource(freshSave(), "replace");

test("whole-stroke history restores valid preview after R and can redo empty", () => {
  const h = new DraftHistory();
  h.commit(complete());
  h.commit(emptyDraft());
  assert.equal(evaluateDraft(h.current).valid, false);
  assert.equal(h.undo(), true);
  assert.equal(evaluateDraft(h.current).valid, true);
  assert.equal(h.redo(), true);
  assert.deepEqual(h.current, emptyDraft());
  const saved = h.checkpoint();
  assert.ok(saved.retained?.raw.length);
  const reload = new DraftHistory();
  reload.restore(saved);
  assert.equal(reload.undo(), true);
  assert.equal(evaluateDraft(reload.current).valid, true);
});

test("history is bounded, copies points and discards redo after a new stroke", () => {
  const h = new DraftHistory();
  const s = complete();
  h.commit(s);
  s.raw[0].x = -999;
  assert.notEqual(h.current.raw[0].x, -999);
  h.undo();
  h.commit({ ...complete(), overflow: true });
  assert.equal(h.canRedo, false);
  for (let i = 0; i < 50; i++)
    h.commit({
      phase: "interrupted",
      raw: [{ x: i, y: 200 }],
      overflow: false,
    });
  let undos = 0;
  while (h.undo()) undos++;
  assert.ok(undos <= 24);
});

test("restoration revalidates invalid, overflow and interrupted raw; never trusts candidates", () => {
  assert.equal(evaluateDraft(complete()).valid, true);
  for (const s of [
    { ...complete(), phase: "interrupted" as const },
    { ...complete(), overflow: true },
    { ...complete(), raw: [{ x: 200, y: 200 }] },
  ])
    assert.equal(evaluateDraft(s).valid, false);
});

test("source distinguishes intent, UID and original geometry across replaced saves", () => {
  const s = freshSave();
  const a = draftSource(s, "replace");
  assert.equal(sameSource(a, draftSource(s, "create")), false);
  s.tracks[0].uid = "another";
  s.activeTrackUid = "another";
  assert.equal(sameSource(a, draftSource(s, "replace")), false);
  s.tracks[0].track.id = "track-deadbeef";
  assert.equal(sameSource(a, draftSource(s, "replace")), false);
});

test("separate versioned drafts roundtrip without touching Save V2 or allocating a track", () => {
  const m = memory();
  const s = source();
  const store = new DraftStorage(m);
  assert.equal(store.open(s).ok, true);
  assert.equal(store.write({ current: complete(), retained: null }).ok, true);
  assert.deepEqual([...m.data.keys()], [DRAFT_KEY]);
  const reopened = new DraftStorage(m);
  const loaded = reopened.open(s);
  assert.equal(loaded.ok, true);
  if (loaded.ok)
    assert.equal(evaluateDraft(loaded.checkpoint!.current).valid, true);
  assert.equal(
    new DraftStorage(m).open({ ...s, intent: "create" }).checkpoint,
    undefined,
  );
});

test("corrupt, unsupported, excessive and nonfinite payloads are rejected without overwrite", () => {
  for (const raw of [
    "{broken",
    JSON.stringify({ schemaVersion: 99, entries: [] }),
    "x".repeat(DRAFT_LIMITS.characters + 1),
  ]) {
    const m = memory();
    m.data.set(DRAFT_KEY, raw);
    const st = new DraftStorage(m);
    assert.equal(st.open(source()).ok, false);
    assert.equal(st.write({ current: complete(), retained: null }).ok, false);
    assert.equal(m.data.get(DRAFT_KEY), raw);
  }
  const m = memory();
  const st = new DraftStorage(m);
  st.open(source());
  for (const raw of [
    [{ x: Infinity, y: 200 }],
    Array(1601).fill({ x: 200, y: 200 }),
    [{ x: 1e30, y: 200 }],
  ])
    assert.equal(
      st.write({
        current: { phase: "complete", raw, overflow: false },
        retained: null,
      }).ok,
      false,
    );
});

test("another tab cannot be silently overwritten or deleted", () => {
  const m = memory();
  const a = new DraftStorage(m),
    b = new DraftStorage(m);
  a.open(source());
  b.open(source());
  assert.equal(a.write({ current: complete(), retained: null }).ok, true);
  const original = m.data.get(DRAFT_KEY);
  assert.equal(b.write({ current: complete(), retained: null }).ok, false);
  assert.equal(b.clear().ok, false);
  assert.equal(m.data.get(DRAFT_KEY), original);
  m.data.set("paperlap.save.v2", "external change");
  assert.equal(a.write({ current: complete(), retained: null }).ok, false);
  assert.equal(a.clear().ok, false);
  assert.equal(m.data.get(DRAFT_KEY), original);
});

test("quota and deletion failure preserve the previous draft", () => {
  const m = memory();
  const a = new DraftStorage(m);
  a.open(source());
  a.write({ current: complete(), retained: null });
  const original = m.data.get(DRAFT_KEY);
  const blocked = new DraftStorage({
    ...m,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  blocked.open(source());
  assert.equal(
    blocked.write({ current: emptyDraft(), retained: complete() }).ok,
    false,
  );
  assert.equal(blocked.clear().ok, false);
  assert.equal(m.data.get(DRAFT_KEY), original);
});

test("clearing one source preserves another intent and raw checkpoints", () => {
  const m = memory(),
    a = new DraftStorage(m),
    b = new DraftStorage(m);
  a.open(source());
  a.write({ current: complete(), retained: null });
  b.open({ ...source(), intent: "create" });
  b.write({
    current: {
      phase: "interrupted",
      raw: [{ x: 400, y: 300 }],
      overflow: false,
    },
    retained: null,
  });
  a.open(source());
  assert.equal(a.clear().ok, true);
  const remaining = new DraftStorage(m).open({ ...source(), intent: "create" });
  assert.equal(remaining.ok, true);
  assert.equal(remaining.checkpoint?.current.phase, "interrupted");
});

test("stored malformed coordinates, phases, ownership, duplicates and retained states are rejected", () => {
  const m = memory(),
    st = new DraftStorage(m);
  st.open(source());
  st.write({ current: complete(), retained: null });
  const valid = JSON.parse(m.data.get(DRAFT_KEY)!);
  const mutations = [
    (d: any) => {
      d.entries[0].current.raw[0].x = null;
    },
    (d: any) => {
      d.entries[0].current.phase = "playing";
    },
    (d: any) => {
      d.entries[0].source.uid = "../wrong";
    },
    (d: any) => {
      d.entries[0].source.fingerprint = "track-wrong";
    },
    (d: any) => {
      d.entries[0].source.fingerprint = "track-" + "a".repeat(1000);
    },
    (d: any) => {
      d.entries[0].retained = { raw: [] };
    },
    (d: any) => {
      d.entries.push(d.entries[0]);
    },
    (d: any) => {
      d.entries[0].updatedAt = -1;
    },
    (d: any) => {
      d.entries[0].current.raw = Array(1601).fill({ x: 400, y: 300 });
    },
  ];
  for (const mutate of mutations) {
    const d = structuredClone(valid);
    mutate(d);
    const raw = JSON.stringify(d);
    m.data.set(DRAFT_KEY, raw);
    const read = new DraftStorage(m);
    assert.equal(read.open(source()).ok, false);
    assert.equal(read.clear().ok, false);
    assert.equal(m.data.get(DRAFT_KEY), raw);
  }
});

test("bounded slots reject the thirteenth source without evicting existing work", () => {
  const m = memory();
  for (let i = 0; i <= DRAFT_LIMITS.entries; i++) {
    const s = freshSave();
    s.tracks[0].uid = `source-${i}`;
    s.activeTrackUid = `source-${i}`;
    const store = new DraftStorage(m);
    store.open(draftSource(s, "create"));
    const before = m.data.get(DRAFT_KEY);
    const written = store.write({ current: complete(), retained: null });
    assert.equal(written.ok, i < DRAFT_LIMITS.entries);
    if (i === DRAFT_LIMITS.entries) assert.equal(m.data.get(DRAFT_KEY), before);
  }
});

test("opening against a different durable source refuses recovery and writes", () => {
  const m = memory(),
    st = new DraftStorage(m);
  st.open(source());
  st.write({ current: complete(), retained: null });
  const changed = freshSave();
  changed.tracks[0].uid = "imported";
  changed.activeTrackUid = "imported";
  m.data.set("paperlap.save.v2", JSON.stringify(changed));
  const original = m.data.get(DRAFT_KEY);
  const stale = new DraftStorage(m);
  assert.equal(stale.open(source()).ok, false);
  assert.equal(stale.write({ current: complete(), retained: null }).ok, false);
  assert.equal(m.data.get(DRAFT_KEY), original);
});

test("blocked reads retain the unavailable cause on later checkpoints and cleanup", () => {
  const store = new DraftStorage({
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("unexpected write");
    },
    removeItem: () => {
      throw new Error("unexpected remove");
    },
  });
  assert.deepEqual(store.open(source()), { ok: false, error: "unavailable" });
  assert.deepEqual(store.write({ current: complete(), retained: null }), {
    ok: false,
    error: "unavailable",
  });
  assert.deepEqual(store.clear(), { ok: false, error: "unavailable" });
});
