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
  if (
    points.length !== base.length ||
    [0, 1, base.length - 1].some(
      (i) =>
        !points[i] || points[i].x !== base[i].x || points[i].y !== base[i].y,
    )
  )
    return "局部调整不能改变点数、起点或接头方向";
  return validate(points.map((p) => ({ ...p })))?.reason ?? null;
}
