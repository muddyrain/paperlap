import { test } from "node:test";
import assert from "node:assert/strict";
import { trackThumbnail } from "../src/game/thumbnail.ts";
import type { Track } from "../src/game/geometry.ts";

test("thumbnail fits real coordinates and road width with padding; metadata never changes the drawing", () => {
  const track: Track = {
    schemaVersion: 1,
    id: "track-a",
    name: "A",
    width: 108,
    points: [
      { x: 100, y: 200 },
      { x: 900, y: 200 },
      { x: 900, y: 600 },
      { x: 100, y: 600 },
    ],
  };
  const svg = trackThumbnail(track);
  assert.match(svg, /viewBox="30 130 940 540"/);
  assert.match(svg, /M100,200 L900,200 L900,600 L100,600 Z/);
  assert.match(svg, /stroke-width="108"/);
  assert.equal(trackThumbnail({ ...track, name: "B" }), svg);
  assert.notEqual(
    trackThumbnail({
      ...track,
      points: [
        { x: 400, y: 200 },
        { x: 600, y: 400 },
        { x: 400, y: 600 },
        { x: 200, y: 400 },
      ],
    }),
    svg,
  );
  assert.equal(track.points[0].x, 100);
});
