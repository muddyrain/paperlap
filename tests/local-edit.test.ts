import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_EDIT,
  LocalEditModel,
  arcLengths,
  deformLocal,
  prepareLocalDrag,
} from "../src/game/local-edit.ts";
import {
  ellipseTrack,
  localFixtures,
} from "../src/prototypes/local-edit-fixtures.ts";
import { fingerprint, validate } from "../src/game/geometry.ts";
import { recordKey } from "../src/game/save.ts";

function selection(
  points = ellipseTrack().points,
  index = Math.floor(points.length / 4),
  radius = 240,
) {
  const result = prepareLocalDrag(points, points[index], radius);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  if (!result.ok) throw Error(result.reason);
  return result.drag;
}
test("all stored-centerline examples start legal", () => {
  for (const track of localFixtures())
    assert.equal(validate(track.points), null, track.name);
});
test("finite-support displacement keeps remote points, width semantics and original input exact", () => {
  for (const count of [200, 450, 900]) {
    const points = ellipseTrack(count).points,
      before = JSON.stringify(points),
      drag = selection(points);
    const result = deformLocal(drag, { x: -25, y: 10 });
    assert.equal(JSON.stringify(points), before);
    assert.equal(result.length, count);
    assert.equal(validate(result), null);
    let changed = 0;
    result.forEach((p, i) => {
      if (drag.weights[i] === 0) assert.deepEqual(p, points[i]);
      else {
        changed++;
        assert.ok(p.x < points[i].x);
      }
    });
    assert.ok(changed > 0 && changed < count / 3);
    assert.deepEqual(result[0], points[0]);
    assert.deepEqual(result[1], points[1]);
    assert.deepEqual(result.at(-1), points.at(-1));
    result[0].x++;
    assert.equal(
      JSON.stringify(points),
      before,
      "returned points do not alias the base",
    );
  }
});
test("selection is by arc, protected seam cannot move and near-seam support is clipped", () => {
  const points = ellipseTrack().points,
    arcs = arcLengths(points),
    length = arcs.at(-1)!;
  for (const index of [0, 1, points.length - 1])
    assert.equal(prepareLocalDrag(points, points[index]).ok, false);
  const index = arcs.findIndex((s) => s > 200),
    drag = selection(points, index, 320);
  assert.ok(drag.radius < 320 && drag.radius >= 80);
  const changed = deformLocal(drag, { x: 20, y: -10 });
  changed.forEach((p, i) => {
    if (arcs[i] <= LOCAL_EDIT.guard || arcs[i] >= length - LOCAL_EDIT.guard)
      assert.deepEqual(p, points[i]);
  });
  assert.equal(drag.weights[0], 0);
  assert.equal(drag.weights.at(-1), 0);
});
test("falloff has no boundary displacement jump and events do not accumulate", () => {
  const points = ellipseTrack(900).points,
    drag = selection(points);
  const result = deformLocal(drag, { x: -30, y: 15 });
  assert.deepEqual(deformLocal(drag, { x: 0, y: 0 }), points);
  for (let i = 0; i < 100; i++) deformLocal(drag, { x: i, y: 4 });
  assert.deepEqual(deformLocal(drag, { x: -30, y: 15 }), result);
  const boundary = drag.weights.filter((w) => w > 0).sort((a, b) => a - b)[0];
  assert.ok(boundary < 0.0001);
});
test("nonfinite/extreme input is rejected or safely bounded without changing source", () => {
  const points = ellipseTrack().points;
  assert.equal(prepareLocalDrag(points, { x: NaN, y: 400 }).ok, false);
  assert.equal(prepareLocalDrag(points, points[100], NaN).ok, false);
  assert.equal(
    prepareLocalDrag(
      points.map((p) => ({ x: p.x * 1e100, y: p.y })),
      points[100],
    ).ok,
    false,
  );
  assert.equal(prepareLocalDrag(points, { x: 0, y: 0 }).ok, false);
  const drag = selection(points);
  assert.throws(() => deformLocal(drag, { x: Infinity, y: 0 }), RangeError);
  const bounded = deformLocal(drag, { x: 1e100, y: -1e100 });
  assert.ok(
    bounded.every(
      (p, i) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Math.hypot(p.x - points[i].x, p.y - points[i].y) <= 360.00001,
    ),
  );
});
test("preview rejects edge, overlap, crossing and tight-corner candidates without replacing good route", () => {
  const points = ellipseTrack().points,
    model = new LocalEditModel(points);
  const edge = deformLocal(selection(points), { x: -360, y: 0 });
  assert.match(model.preview(edge)!.reason, /靠边/);
  assert.equal(model.adopt(), false);
  const overlap = deformLocal(selection(points, 225, 320), { x: 0, y: 320 });
  assert.match(model.preview(overlap)!.reason, /太近/);
  assert.equal(model.adopt(), false);
  const crossed = points.map((p, i) => {
    const a = (i / points.length) * Math.PI * 2;
    return { x: 720 + 460 * Math.sin(a), y: 440 + 210 * Math.sin(2 * a) };
  });
  assert.match(model.preview(crossed)!.reason, /交叉|太近/);
  assert.equal(model.adopt(), false);
  const sharp = deformLocal(selection(points, 225, 80), { x: 0, y: 50 });
  assert.match(model.preview(sharp)!.reason, /弯太挤/);
  assert.equal(model.adopt(), false);
  assert.deepEqual(model.current, points);
  assert.equal(model.canUndo, false);
});
test("adopt, undo, redo and cancel preserve exact points and isolate rejected previews", () => {
  const points = ellipseTrack().points,
    model = new LocalEditModel(points);
  const a = deformLocal(selection(points), { x: -20, y: 0 });
  assert.equal(model.preview(a), null);
  assert.deepEqual(model.current, points);
  assert.ok(model.adopt());
  assert.deepEqual(model.current, a);
  assert.ok(model.undo());
  assert.deepEqual(model.current, points);
  assert.ok(model.redo());
  assert.deepEqual(model.current, a);
  const p = model.current;
  p[0].x++;
  assert.deepEqual(model.current, a);
  model.preview(deformLocal(selection(a), { x: -360, y: 0 }));
  const pending = model.pending!;
  pending.error = null;
  assert.equal(
    model.adopt(),
    false,
    "pending getter cannot forge validation evidence",
  );
  model.cancelPreview();
  assert.deepEqual(model.current, a);
  model.reset();
  assert.equal(JSON.stringify(model.current), JSON.stringify(points));
  assert.equal(model.canUndo, false);
  assert.equal(model.canRedo, false);
});
test("history stays bounded and a new accepted edit invalidates redo", () => {
  const model = new LocalEditModel(ellipseTrack().points);
  for (let i = 0; i < 30; i++) {
    const p = model.current;
    assert.equal(
      model.preview(deformLocal(selection(p), { x: 0.1, y: 0 })),
      null,
    );
    assert.ok(model.adopt());
  }
  assert.equal(model.historySize, 24);
  assert.ok(model.undo());
  assert.ok(model.canRedo);
  const p = model.current;
  model.preview(deformLocal(selection(p), { x: 0.1, y: 0 }));
  model.adopt();
  assert.equal(model.canRedo, false);
});
test("legacy 0.1 fingerprint and recordKey can be identical for different legal geometry", () => {
  const track = ellipseTrack(200),
    points = structuredClone(track.points);
  const i = 50; // ellipse left apex is exactly x=240; a 0.001 change stays in the same bin.
  points[i].x += 0.001;
  assert.notDeepEqual(points, track.points);
  assert.equal(validate(points), null);
  assert.equal(fingerprint(points, track.width), track.id);
  assert.equal(
    recordKey({ uid: "entry-proof", track }),
    recordKey({
      uid: "entry-proof",
      track: { ...track, points, id: fingerprint(points, track.width) },
    }),
  );
});

test("uneven saved sampling also preserves both start-adjacent segments exactly", () => {
  const full = ellipseTrack().points;
  const points = [full[0], ...full.slice(12)];
  assert.equal(validate(points), null);
  const drag = selection(points, 30, 320);
  const changed = deformLocal(drag, { x: -20, y: 10 });
  for (const i of [0, 1, points.length - 1])
    assert.deepEqual(changed[i], points[i]);
  assert.equal(drag.weights[1], 0);
});
