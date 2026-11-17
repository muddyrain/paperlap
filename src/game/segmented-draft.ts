import { ROAD } from "./config";
import { dist, drawingBounds, fromDrawing, intersects, type Point } from "./geometry";
import type { DraftSnapshot } from "./draft";

export const emptySegmentDraft = (): DraftSnapshot => ({
  phase: "empty", raw: [], overflow: false, spaceVersion: 2, segmentEnds: [],
});

export function drawingLength(points: readonly Point[]) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  return length;
}

export function closesDrawing(points: readonly Point[]) {
  return points.length >= 12 && drawingLength(points) >= ROAD.minLength &&
    dist(points[0], points.at(-1)!) <= ROAD.closeDistance;
}

// Endpoint indices are exclusive, so each accepted stroke remains an undo unit.
export function appendSegment(previous: DraftSnapshot, stroke: readonly Point[]): DraftSnapshot {
  if (stroke.length < 2 || previous.raw.length >= ROAD.maxRaw) return structuredClone(previous);
  const raw = previous.raw.map((p) => ({ ...p }));
  const additions = raw.length ? stroke.slice(1) : stroke;
  raw.push(...additions.map((p) => ({ ...p })));
  const overflow = raw.length > ROAD.maxRaw;
  const points = raw.slice(0, ROAD.maxRaw);
  return {
    phase: closesDrawing(points) ? "complete" : "open",
    raw: points,
    overflow,
    spaceVersion: 2,
    segmentEnds: [...(previous.segmentEnds ?? []), points.length],
  };
}

export function openDrawingProblem(points: readonly Point[]) {
  const bounds = drawingBounds(2);
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY)
      return { reason: "这一段超出纸面范围，请撤销这一段后重画", point: p };
  }
  for (let i = 0; i + 1 < points.length; i++) {
    for (let j = i + 2; j + 1 < points.length; j++) {
      if (intersects(points[i], points[i + 1], points[j], points[j + 1]))
        return { reason: "这里与已画路线交叉，请重画这一段", point: points[j] };
    }
  }
  return null;
}

export function evaluateSegmentDraft(s: DraftSnapshot) {
  if (!s.raw.length) return {
    valid: false, track: null, kind: "hint" as const,
    message: "先画一段路线；松手后可移动画布，再从末端继续画",
  };
  if (s.overflow) return {
    valid: false, track: null, kind: "error" as const,
    message: "路线细节已到上限，请重画这一段，或撤销后简化路线",
    point: s.raw.at(-1),
  };
  const problem = openDrawingProblem(s.raw);
  if (problem) return {
    valid: false, track: null, kind: "error" as const,
    message: problem.reason, point: problem.point,
  };
  if (s.phase !== "complete") return {
    valid: false, track: null, kind: "hint" as const,
    message: `已画 ${s.segmentEnds?.length ?? 1} 段 · 从蓝色末端继续，最后接回橘色起点`,
  };
  const result = fromDrawing(s.raw, 2);
  return result.ok
    ? { valid: true, track: result.track, kind: "success" as const, message: "赛道已闭合，可以保存并试跑" }
    : { valid: false, track: null, kind: "error" as const, message: result.reason, point: result.point };
}
