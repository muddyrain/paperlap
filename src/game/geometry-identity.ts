import type { Point } from "./geometry";
// SHA-256, FIPS 180-4 §6.2. Cross-checked against Node and WebCrypto; used
// for content identity, not password storage or authentication.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (v: number, n: number) => (v >>> n) | (v << (32 - n));
export function sha256Hex(input: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer),
    bits = input.length * 8;
  view.setUint32(bytes.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(bytes.length - 4, bits >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      w[i] =
        (w[i - 16] +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          w[i - 7] +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, j] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (j +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[i] +
          w[i]) >>>
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      j = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, j].forEach((v, i) => (h[i] = (h[i] + v) >>> 0));
  }
  return [...h].map((v) => v.toString(16).padStart(8, "0")).join("");
}
export const textDigest = (raw: string) =>
  sha256Hex(new TextEncoder().encode(raw));

// localStorage stores UTF-16 code units. UTF-8 TextEncoder replaces lone
// surrogates, so it cannot prove exact source-string provenance on reload.
export function storageTextDigest(raw: string): string {
  const bytes = new Uint8Array(raw.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < raw.length; i++) view.setUint16(i * 2, raw.charCodeAt(i));
  return sha256Hex(bytes);
}
export function canonicalGeometry(
  points: readonly Point[],
  width: number,
): Uint8Array {
  if (
    !Number.isFinite(width) ||
    points.length > 900 ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw new RangeError("Nonfinite geometry");
  const bytes = new Uint8Array(32 + 16 * points.length),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PaperlapGeometry"));
  view.setUint32(16, 1);
  view.setFloat64(20, width === 0 ? 0 : width);
  view.setUint32(28, points.length);
  points.forEach((p, i) => {
    view.setFloat64(32 + i * 16, p.x === 0 ? 0 : p.x);
    view.setFloat64(40 + i * 16, p.y === 0 ? 0 : p.y);
  });
  return bytes;
}
// Private exact snapshots: mutating a public points array invalidates evidence.
const cache = new WeakMap<
  object,
  { width: number; points: Point[]; digest: string }
>();
export function geometryDigest(
  points: readonly Point[],
  width: number,
): string {
  const prior = cache.get(points);
  if (
    prior &&
    prior.width === width &&
    prior.points.length === points.length &&
    points.every(
      (p, i) => p.x === prior.points[i].x && p.y === prior.points[i].y,
    )
  )
    return prior.digest;
  const digest = `geom-v1-sha256-${sha256Hex(canonicalGeometry(points, width))}`;
  cache.set(points, { width, points: points.map((p) => ({ ...p })), digest });
  return digest;
}
export const validIdentity = (id: unknown): id is string =>
  typeof id === "string" && /^(g-[a-f0-9]{32}|m-[a-f0-9]{64})$/.test(id);
export const validDigest = (id: unknown): id is string =>
  typeof id === "string" && /^geom-v1-sha256-[a-f0-9]{64}$/.test(id);
export const newGeometryIdentity = () =>
  `g-${crypto.randomUUID().replaceAll("-", "")}`;
export const migratedIdentity = (source: string, uid: string, digest: string) =>
  `m-${textDigest(JSON.stringify([1, source, uid, digest]))}`;
