import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalGeometry,
  geometryDigest,
  sha256Hex,
  storageTextDigest,
} from "../src/game/geometry-identity.ts";
import { defaultTrack } from "../src/game/geometry.ts";
const reference = (v: Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
test("SHA256 standard vectors and block boundaries match Node crypto", () => {
  for (const text of [
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "a".repeat(1000),
  ]) {
    const data = new TextEncoder().encode(text);
    assert.equal(sha256Hex(data), reference(data));
  }
  assert.equal(
    sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("canonical v1 is exact big endian and normalizes minus zero only", () => {
  const bytes = canonicalGeometry(
    [
      { x: -0, y: 1.25 },
      { x: 2.5, y: -3 },
    ],
    108,
  );
  assert.equal(bytes.length, 64);
  assert.equal(
    new TextDecoder().decode(bytes.slice(0, 16)),
    "PaperlapGeometry",
  );
  assert.equal(
    Buffer.from(bytes.slice(16)).toString("hex"),
    "00000001405b0000000000000000000200000000000000003ff40000000000004004000000000000c008000000000000",
  );
  assert.equal(
    sha256Hex(bytes),
    "ef9662c730bad41e7fb2db2b862053f7e69baf199694254bae014598b58e7e8e",
  );
  assert.equal(
    geometryDigest([{ x: -0, y: 1.25 }], 108),
    geometryDigest([{ x: 0, y: 1.25 }], 108),
  );
  assert.throws(() => canonicalGeometry([{ x: Infinity, y: 2 }], 108));
});
test("digest matches Node on real geometry, keeps order, width and sub-0.1 coordinates", () => {
  const points = defaultTrack().points;
  assert.equal(
    geometryDigest(points, 108),
    `geom-v1-sha256-${reference(canonicalGeometry(points, 108))}`,
  );
  const changed = structuredClone(points);
  changed[0].x += 0.001;
  assert.notEqual(geometryDigest(points, 108), geometryDigest(changed, 108));
  assert.notEqual(
    geometryDigest(points, 108),
    geometryDigest([...points].reverse(), 108),
  );
  assert.notEqual(
    geometryDigest(points, 108),
    geometryDigest([...points.slice(1), points[0]], 108),
  );
  assert.notEqual(geometryDigest(points, 108), geometryDigest(points, 109));
});

test("source digests preserve exact UTF-16 strings including lone surrogates", () => {
  const a = "\ud800",
    b = "\ud801";
  assert.deepEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
  assert.notEqual(storageTextDigest(a), storageTextDigest(b));
  assert.equal(storageTextDigest(a), reference(new Uint8Array([0xd8, 0x00])));
});
