import { ROAD, WORLD } from "./config";
export interface Point {
  x: number;
  y: number;
}
export interface Track {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  points: Point[];
}
export interface TrackData {
  track: Track;
  lengths: number[];
  length: number;
  gates: Gate[];
}
export interface Gate {
  center: Point;
  tangent: Point;
  halfWidth: number;
}
export type Validation =
  | { ok: true; track: Track }
  | { ok: false; reason: string; point?: Point };
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export function project(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, distance: dist(p, point) };
}
export function nearest(p: Point, points: Point[]) {
  let result = { distance: Infinity, index: 0, t: 0, point: points[0] };
  for (let i = 0; i < points.length; i++) {
    const pr = project(p, points[i], points[(i + 1) % points.length]);
    if (pr.distance < result.distance) result = { ...pr, index: i };
  }
  return result;
}
function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
export function intersects(a: Point, b: Point, c: Point, d: Point) {
  return (
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  );
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  return intersects(a, b, c, d)
    ? 0
    : Math.min(
        project(a, c, d).distance,
        project(b, c, d).distance,
        project(c, a, b).distance,
        project(d, a, b).distance,
      );
}
export function resample(points: Point[], spacing = ROAD.spacing) {
  const lengths = [0];
  points.forEach((p, i) =>
    lengths.push(lengths[i] + dist(p, points[(i + 1) % points.length])),
  );
  const total = lengths.at(-1)!;
  const count = Math.min(
    ROAD.maxPoints,
    Math.max(3, Math.ceil(total / spacing)),
  );
  const output: Point[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = (i * total) / count;
    while (j < points.length - 1 && lengths[j + 1] < s) j++;
    const t = (s - lengths[j]) / (lengths[j + 1] - lengths[j] || 1),
      a = points[j],
      b = points[(j + 1) % points.length];
    output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return output;
}
export function smooth(points: Point[]) {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[(i - 1 + points.length) % points.length],
      b = points[i],
      c = points[(i + 1) % points.length],
      d = points[(i + 2) % points.length];
    const steps = Math.max(2, Math.ceil(dist(b, c) / 6));
    for (let k = 0; k < steps; k++) {
      const t = k / steps,
        t2 = t * t,
        t3 = t2 * t;
      const value = (v0: number, v1: number, v2: number, v3: number) =>
        0.5 *
        (2 * v1 +
          (-v0 + v2) * t +
          (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
          (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
      out.push({ x: value(a.x, b.x, c.x, d.x), y: value(a.y, b.y, c.y, d.y) });
    }
  }
  return resample(out);
}
function smoothDrawing(raw: Point[]) {
  const distinct = [raw[0]];
  for (const point of raw.slice(1)) {
    if (dist(point, distinct.at(-1)!) >= 2) distinct.push(point);
  }
  // Uniform distance samples keep a slow hand from giving one part of the
  // stroke more weight. Circular filtering also smooths the snapped seam.
  const samples = resample(distinct);
  const length = samples.reduce(
    (sum, p, i) => sum + dist(p, samples[(i + 1) % samples.length]),
    0,
  );
  const spacing = length / samples.length;
  const radius = Math.min(
    Math.floor(samples.length / 2),
    Math.ceil((3 * ROAD.smoothingDistance) / (spacing || 1)),
  );
  const weights = Array.from({ length: radius * 2 + 1 }, (_, i) =>
    Math.exp(-0.5 * (((i - radius) * spacing) / ROAD.smoothingDistance) ** 2),
  );
  const weight = weights.reduce((sum, w) => sum + w, 0);
  return resample(
    samples.map((_, i) => {
      const point = { x: 0, y: 0 };
      for (let offset = -radius; offset <= radius; offset++) {
        const sample = samples[(i + offset + samples.length) % samples.length],
          w = weights[offset + radius] / weight;
        point.x += sample.x * w;
        point.y += sample.y * w;
      }
      return point;
    }),
  );
}
export function fingerprint(points: Point[], width: number) {
  let hash = 2166136261;
  const data = JSON.stringify([
    width,
    points.map((p) => [Math.round(p.x * 10), Math.round(p.y * 10)]),
  ]);
  for (let i = 0; i < data.length; i++)
    hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `track-${(hash >>> 0).toString(16)}`;
}
export function validate(
  points: Point[],
  width = ROAD.width,
): { reason: string; point?: Point } | null {
  if (
    points.length < 12 ||
    points.length > ROAD.maxPoints ||
    points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return { reason: "这条路线太短了，请画一个大一些的圈" };
  if (width !== ROAD.width) return { reason: "赛道宽度不受支持" };
  const data = derive({ schemaVersion: 1, id: "", name: "", points, width });
  if (data.length < ROAD.minLength)
    return { reason: "这条路线太短了，请画一个大一些的圈" };
  if (
    points.some(
      (p) =>
        p.x < ROAD.margin ||
        p.x > WORLD.width - ROAD.margin ||
        p.y < ROAD.minY ||
        p.y > ROAD.maxY,
    )
  )
    return {
      reason: "路线太靠边，请给上方计时和下方按钮留些空间",
      point: points.find(
        (p) =>
          p.x < ROAD.margin ||
          p.x > WORLD.width - ROAD.margin ||
          p.y < ROAD.minY ||
          p.y > ROAD.maxY,
      ),
    };
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (
        intersects(
          points[i],
          points[(i + 1) % n],
          points[j],
          points[(j + 1) % n],
        )
      )
        return {
          reason: "这里发生交叉，请画一条不交叉的路线",
          point: points[i],
        };
      const arc = Math.abs(data.lengths[j] - data.lengths[i]);
      if (
        Math.min(arc, data.length - arc) > width * 1.9 &&
        segmentDistance(
          points[i],
          points[(i + 1) % n],
          points[j],
          points[(j + 1) % n],
        ) <
          width + 10
      )
        return {
          reason: "这两段道路太近了，请留出更大的间隔",
          point: points[i],
        };
    }
  const jump = Math.max(1, Math.round(32 / (data.length / n)));
  for (let i = 0; i < n; i++) {
    const a = points[(i - jump + n) % n],
      b = points[i],
      c = points[(i + jump) % n];
    const area = Math.abs(cross(a, b, c));
    const radius = (dist(a, b) * dist(b, c) * dist(c, a)) / (2 * area || 1e-9);
    if (radius < width * 0.62)
      return { reason: "这个弯太挤，请把弯画得更圆、更宽一些", point: b };
  }
  return null;
}
export function fromDrawing(raw: Point[]): Validation {
  if (
    raw.length > ROAD.maxRaw ||
    raw.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return { ok: false, reason: "路线数据无法使用，请重新绘制" };
  if (raw.length < 12)
    return { ok: false, reason: "路线太短了，按住鼠标画一个完整的圈" };
  if (dist(raw[0], raw.at(-1)!) > ROAD.closeDistance)
    return { ok: false, reason: "请将终点画回起点附近", point: raw.at(-1) };
  const points = smoothDrawing(raw),
    error = validate(points);
  if (error) return { ok: false, ...error };
  return {
    ok: true,
    track: {
      schemaVersion: 1,
      id: fingerprint(points, ROAD.width),
      name: "我的手绘赛道",
      points,
      width: ROAD.width,
    },
  };
}
export function derive(track: Track): TrackData {
  const lengths = [0];
  track.points.forEach((p, i) =>
    lengths.push(
      lengths[i] + dist(p, track.points[(i + 1) % track.points.length]),
    ),
  );
  const length = lengths.at(-1)!;
  const gates: Gate[] = [];
  for (let i = 0; i < 12; i++) {
    const target = (length * i) / 12;
    let j = 0;
    while (j < track.points.length - 1 && lengths[j + 1] < target) j++;
    const a = track.points[j],
      b = track.points[(j + 1) % track.points.length],
      l = dist(a, b) || 1,
      t = (target - lengths[j]) / l;
    gates.push({
      center: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      tangent: { x: (b.x - a.x) / l, y: (b.y - a.y) / l },
      halfWidth: track.width / 2 + ROAD.tolerance,
    });
  }
  return { track, lengths, length, gates };
}
export function defaultTrack(): Track {
  const points = smooth([
    { x: 920, y: 676 },
    { x: 600, y: 676 },
    { x: 340, y: 669 },
    { x: 190, y: 580 },
    { x: 152, y: 428 },
    { x: 231, y: 280 },
    { x: 394, y: 192 },
    { x: 555, y: 206 },
    { x: 744, y: 289 },
    { x: 895, y: 310 },
    { x: 1092, y: 261 },
    { x: 1237, y: 331 },
    { x: 1280, y: 493 },
    { x: 1209, y: 644 },
    { x: 1070, y: 676 },
  ]);
  return {
    schemaVersion: 1,
    id: fingerprint(points, ROAD.width),
    name: "方格本环线",
    points,
    width: ROAD.width,
  };
}
