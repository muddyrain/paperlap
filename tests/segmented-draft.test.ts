import { test } from "node:test";
import assert from "node:assert/strict";
import { EditViewport } from "../src/game/edit-viewport.ts";
import { DraftHistory, draftSource, evaluateDraft } from "../src/game/draft.ts";
import { appendSegment, emptySegmentDraft } from "../src/game/segmented-draft.ts";
import { DraftStorage } from "../src/game/draft-storage.ts";
import { V4_DRAFT_KEY, v4DraftPolicy } from "../src/game/draft-storage-v4.ts";
import { freshSave } from "../src/game/save-v4.ts";

const loop = () => Array.from({ length: 181 }, (_, i) => ({
  x: 2880 + 1500 * Math.cos(i * Math.PI * 2 / 180),
  y: 1720 + 900 * Math.sin(i * Math.PI * 2 / 180),
}));
const parts = () => {
  const raw = loop();
  return [raw.slice(0, 61), raw.slice(60, 121), raw.slice(120)];
};
const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); } };
};

test("view pan and anchored zoom preserve world coordinates and do not scale a track", () => {
  const view = new EditViewport();
  const points = loop(), original = structuredClone(points);
  view.fit(points);
  const cursor = { x: 800, y: 450 };
  const anchor = view.screenToWorld(cursor);
  view.zoomAt(1.5, cursor);
  assert.ok(Math.abs(view.screenToWorld(cursor).x - anchor.x) < 1e-9);
  assert.ok(Math.abs(view.screenToWorld(cursor).y - anchor.y) < 1e-9);
  view.pan(-700, 200);
  const p = points[40];
  assert.ok(Math.abs(view.screenToWorld(view.worldToScreen(p)).x - p.x) < 1e-9);
  assert.deepEqual(points, original);
});

test("three separate strokes form a continuous larger-than-screen valid closed track", () => {
  const h = new DraftHistory();
  h.current = emptySegmentDraft();
  const strokes = parts();
  h.commit(appendSegment(h.current, strokes[0]));
  assert.equal(h.current.phase, "open");
  assert.equal(evaluateDraft(h.current).kind, "hint");
  const end = h.current.raw.at(-1);
  h.commit(appendSegment(h.current, strokes[1]));
  assert.deepEqual(h.current.raw[60], end);
  assert.equal(h.current.raw.length, 121);
  h.commit(appendSegment(h.current, strokes[2]));
  const result = evaluateDraft(h.current);
  assert.equal(result.valid, true, result.message);
  assert.equal(result.track?.schemaVersion, 2);
  assert.deepEqual(h.current.segmentEnds, [61, 121, 181]);
  assert.equal(h.undo(), true);
  assert.equal(h.current.phase, "open");
  assert.equal(h.current.raw.length, 121);
  assert.equal(h.redo(), true);
  assert.equal(evaluateDraft(h.current).valid, true);
});

test("crossing segment stays visible and undo restores the previous exact endpoint", () => {
  const h = new DraftHistory();
  h.current = emptySegmentDraft();
  h.commit(appendSegment(h.current, [{ x: 500, y: 500 }, { x: 1200, y: 500 }]));
  h.commit(appendSegment(h.current, [{ x: 1200, y: 500 }, { x: 1200, y: 1200 }]));
  const prior = structuredClone(h.current);
  h.commit(appendSegment(h.current, [{ x: 1200, y: 1200 }, { x: 800, y: 300 }]));
  assert.equal(evaluateDraft(h.current).kind, "error");
  assert.equal(h.current.raw.length, 4);
  h.undo();
  assert.deepEqual(h.current, prior);
  assert.equal(evaluateDraft(h.current).kind, "hint");
});

test("restoring open segments supports undo, redo and continuing from durable endpoint", () => {
  const h = new DraftHistory();
  h.current = emptySegmentDraft();
  const strokes = parts();
  for (const s of strokes.slice(0, 2)) h.commit(appendSegment(h.current, s));
  const resumed = new DraftHistory();
  resumed.restore(h.checkpoint());
  assert.deepEqual(resumed.current, h.current);
  assert.equal(resumed.undo(), true);
  assert.equal(resumed.current.raw.length, 61);
  resumed.redo();
  resumed.commit(appendSegment(resumed.current, strokes[2]));
  assert.equal(evaluateDraft(resumed.current).valid, true);
});

test("new draft storage preserves old keys and requires exact durable V4 ownership", () => {
  const m = memory(), save = freshSave();
  m.setItem("paperlap.save.v4", JSON.stringify(save));
  m.setItem("paperlap.draft.v1", "old draft 1");
  m.setItem("paperlap.draft.v2", "old draft 2");
  const source = draftSource(save, "create");
  const st = new DraftStorage(m, v4DraftPolicy(() => true));
  assert.equal(st.open(source).ok, true);
  const current = appendSegment(emptySegmentDraft(), parts()[0]);
  assert.equal(st.write({ current, retained: null }).ok, true);
  const loaded = new DraftStorage(m, v4DraftPolicy(() => true)).open(source);
  assert.deepEqual(loaded.checkpoint?.current, current);
  assert.equal(m.getItem("paperlap.draft.v1"), "old draft 1");
  assert.equal(m.getItem("paperlap.draft.v2"), "old draft 2");
  const before = m.getItem(V4_DRAFT_KEY);
  const wrong = new DraftStorage(m, v4DraftPolicy(() => true));
  assert.equal(wrong.open({ ...source, geometryIdentity: "g-" + "f".repeat(32) }).ok, false);
  assert.equal(wrong.write({ current, retained: null }).ok, false);
  assert.equal(m.getItem(V4_DRAFT_KEY), before);
});

test("corrupt segment endpoints, old-format payloads and failed writes cannot replace a draft", () => {
  const m = memory(), save = freshSave();
  m.setItem("paperlap.save.v4", JSON.stringify(save));
  const source = draftSource(save, "replace"), policy = v4DraftPolicy(() => true);
  const st = new DraftStorage(m, policy);
  st.open(source);
  const current = appendSegment(emptySegmentDraft(), parts()[0]);
  st.write({ current, retained: null });
  const good = m.getItem(V4_DRAFT_KEY)!;
  for (const segmentEnds of [[-1], [61, 61], [60], [NaN]]) {
    assert.equal(st.write({ current: { ...current, segmentEnds }, retained: null }).ok, false);
    assert.equal(m.getItem(V4_DRAFT_KEY), good);
  }
  const denied = new DraftStorage({ ...m, setItem: () => { throw Error("quota"); } }, policy);
  denied.open(source);
  assert.equal(denied.write({ current: appendSegment(current, parts()[1]), retained: null }).ok, false);
  assert.equal(m.getItem(V4_DRAFT_KEY), good);
  const swallowed = new DraftStorage({ ...m, setItem: () => {} }, policy);
  swallowed.open(source);
  assert.equal(swallowed.write({ current: appendSegment(current, parts()[1]), retained: null }).ok, false);
  assert.equal(m.getItem(V4_DRAFT_KEY), good);
  const broken = JSON.parse(good);
  broken.entries[0].current.segmentEnds = [1];
  m.setItem(V4_DRAFT_KEY, JSON.stringify(broken));
  const invalid = new DraftStorage(m, policy);
  assert.equal(invalid.open(source).ok, false);
  assert.equal(invalid.clear().ok, false);
});
