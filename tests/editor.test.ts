import { test } from "node:test";
import assert from "node:assert/strict";
import { fromDrawing, nearest, validate } from "../src/game/geometry.ts";
import { screenshotLoop, wobblyLoop } from "./fixtures/editor-paths.mjs";

test("screenshot-style loop closes a nearby endpoint without a pinched join", () => {
  const result = fromDrawing(screenshotLoop);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (result.ok) assert.equal(validate(result.track.points), null);
});

test("ordinary hand wobble is smoothed regardless of where the stroke starts", () => {
  for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const raw = wobblyLoop(phase),
      result = fromDrawing(raw);
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : `${phase}: ${result.reason}`,
    );
    if (result.ok) {
      assert.equal(validate(result.track.points), null);
      assert.ok(
        result.track.points.every((p) => nearest(p, raw).distance < 25),
        "smoothing must stay near the drawn route",
      );
    }
  }
});
