import { validate, type Point } from "./geometry";
import type { TrackEntry } from "./save-v3";

export const LOCAL_ALGORITHM = 1;
export interface LocalSource {
  uid: string;
  geometryIdentity: string;
  geometryDigest: string;
  algorithmVersion: 1;
}
export interface LocalCheckpoint {
  current: Point[];
  previous: Point[] | null;
  next: Point[] | null;
}
export const localSource = (entry: TrackEntry): LocalSource => ({
  uid: entry.uid,
  geometryIdentity: entry.geometryIdentity,
  geometryDigest: entry.geometryDigest,
  algorithmVersion: LOCAL_ALGORITHM,
});
export const sameLocalSource = (a: LocalSource, b: LocalSource) =>
  a.uid === b.uid &&
  a.geometryIdentity === b.geometryIdentity &&
  a.geometryDigest === b.geometryDigest &&
  a.algorithmVersion === b.algorithmVersion;
export const samePoints = (a: readonly Point[], b: readonly Point[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
export function checkLocalPoints(
  base: readonly Point[],
  points: readonly Point[],
) {
  return localGeometryError(base, points)?.reason ?? null;
}
function localGeometryError(base: readonly Point[], points: readonly Point[]) {
  if (
    points.length !== base.length ||
    [0, 1, base.length - 1].some(
      (i) =>
        !points[i] || points[i].x !== base[i].x || points[i].y !== base[i].y,
    )
  )
    return { reason: "局部调整不能改变点数、起点或接头方向" };
  return validate(points.map((p) => ({ ...p })));
}

// Evidence is local to one source revision. No caller can insert an unchecked
// proof or obtain its frozen numeric copies. Hash/fingerprint equality is unused.
export class LocalGeometryProof {
  private source: Readonly<LocalSource>;
  private base: readonly Readonly<Point>[];
  private snapshots: (readonly Readonly<Point>[])[] = [];
  private strict = 0;
  private reused = 0;
  constructor(source: LocalSource, base: readonly Point[]) {
    this.source = Object.freeze({ ...source });
    this.base = this.snapshot(base);
  }
  private snapshot(points: readonly Point[]) {
    return Object.freeze(points.map((p) => Object.freeze({ x: p.x, y: p.y })));
  }
  matches(source: LocalSource, base: readonly Point[]) {
    return sameLocalSource(source, this.source) && samePoints(this.base, base);
  }
  get stats() {
    return {
      strict: this.strict,
      reused: this.reused,
      snapshots: this.snapshots.length,
    };
  }
  check(points: readonly Point[], fresh = false) {
    if (!fresh && this.snapshots.some((p) => samePoints(p, points))) {
      this.reused++;
      return null;
    }
    this.strict++;
    const error = localGeometryError(this.base, points);
    if (!error) {
      this.snapshots.push(this.snapshot(points));
      if (this.snapshots.length > 32) this.snapshots.shift();
    }
    return error;
  }
}
