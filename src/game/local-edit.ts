// Experimental only: no production editor, storage or scene imports.
import { dist, nearest, validate, type Point } from "./geometry";
import { ROAD, WORLD } from "./config";

export const LOCAL_EDIT = {
  guard: 64,
  minRadius: 80,
  maxRadius: 320,
  maxDelta: 360,
};
const copy = (points: readonly Point[]) => points.map((p) => ({ ...p }));
export interface LocalDrag {
  readonly base: readonly Readonly<Point>[];
  readonly weights: readonly number[];
  readonly anchor: Readonly<Point>;
  readonly center: number;
  readonly radius: number;
}
export function arcLengths(points: readonly Point[]) {
  const lengths = [0];
  points.forEach((p, i) =>
    lengths.push(lengths[i] + dist(p, points[(i + 1) % points.length])),
  );
  return lengths;
}
export function prepareLocalDrag(
  points: readonly Point[],
  pointer: Point,
  requested = 240,
): { ok: true; drag: LocalDrag } | { ok: false; reason: string } {
  if (
    points.length < 12 ||
    points.length > ROAD.maxPoints ||
    !Number.isFinite(requested) ||
    requested < LOCAL_EDIT.minRadius ||
    ![pointer, ...points].every(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Math.abs(p.x) <= WORLD.width * 4 &&
        Math.abs(p.y) <= WORLD.height * 4,
    )
  )
    return { ok: false, reason: "无法选择这段路线" };
  const base = copy(points),
    lengths = arcLengths(base),
    total = lengths.at(-1)!;
  const hit = nearest(pointer, base);
  if (hit.distance > ROAD.width / 2 + 18)
    return { ok: false, reason: "请在道路上选择一处弯道" };
  const center =
    lengths[hit.index] + hit.t * (lengths[hit.index + 1] - lengths[hit.index]);
  const radius = Math.min(
    requested,
    LOCAL_EDIT.maxRadius,
    center - Math.max(LOCAL_EDIT.guard, lengths[1]),
    Math.min(total - LOCAL_EDIT.guard, lengths[base.length - 1]) - center,
  );
  if (radius < LOCAL_EDIT.minRadius)
    return { ok: false, reason: "起点与接头受保护，请选择离起点更远的弯道" };
  const weights = base.map((_, i) => {
    const q = Math.abs(lengths[i] - center) / radius;
    return q < 1 ? (1 - q * q) ** 3 : 0;
  });
  return {
    ok: true,
    drag: { base, weights, anchor: { ...hit.point }, center, radius },
  };
}
export function deformLocal(drag: LocalDrag, delta: Point): Point[] {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    throw new RangeError("Nonfinite displacement");
  const magnitude = Math.hypot(delta.x, delta.y);
  const scale =
    magnitude > LOCAL_EDIT.maxDelta ? LOCAL_EDIT.maxDelta / magnitude : 1;
  return drag.base.map((p, i) =>
    drag.weights[i] === 0
      ? { ...p }
      : {
          x: p.x + drag.weights[i] * delta.x * scale,
          y: p.y + drag.weights[i] * delta.y * scale,
        },
  );
}

// Only immutable, validated candidates can enter accepted history. A pending
// invalid preview cannot replace the last good route, even during interruption.
export class LocalEditModel {
  private original: Point[];
  private accepted: Point[];
  private past: Point[][] = [];
  private future: Point[][] = [];
  private candidate: {
    points: Point[];
    error: ReturnType<typeof validate>;
  } | null = null;
  constructor(points: readonly Point[]) {
    const error = validate(copy(points));
    if (error) throw new Error(error.reason);
    this.original = copy(points);
    this.accepted = copy(points);
  }
  get current() {
    return copy(this.accepted);
  }
  get pending() {
    return this.candidate ? structuredClone(this.candidate) : null;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get historySize() {
    return this.past.length;
  }
  preview(points: readonly Point[]) {
    const snapshot = copy(points);
    const error =
      snapshot.length !== this.accepted.length
        ? { reason: "局部调整不能改变采样点数量" }
        : validate(snapshot);
    this.candidate = { points: snapshot, error };
    return error;
  }
  adopt() {
    if (!this.candidate || this.candidate.error) return false;
    const points = this.candidate.points;
    this.candidate = null;
    if (
      points.every(
        (p, i) => p.x === this.accepted[i].x && p.y === this.accepted[i].y,
      )
    )
      return false;
    this.past.push(this.accepted);
    if (this.past.length > 24) this.past.shift();
    this.accepted = points;
    this.future = [];
    return true;
  }
  cancelPreview() {
    this.candidate = null;
  }
  undo() {
    this.cancelPreview();
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.accepted);
    this.accepted = previous;
    return true;
  }
  redo() {
    this.cancelPreview();
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.accepted);
    this.accepted = next;
    return true;
  }
  reset() {
    this.accepted = copy(this.original);
    this.past = [];
    this.future = [];
    this.cancelPreview();
  }
}
