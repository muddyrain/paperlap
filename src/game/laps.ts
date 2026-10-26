import type { Gate, Point, TrackData } from "./geometry";
export interface LapState {
  elapsed: number;
  valid: boolean;
  nextGate: number;
  completed: number;
  last: number | null;
}
export const newLap = (): LapState => ({
  elapsed: 0,
  valid: true,
  nextGate: 1,
  completed: 0,
  last: null,
});
// A swept, directed line crossing. Gate thickness is independent of frame rate.
export function crossing(
  previous: Point,
  current: Point,
  gate: Gate,
): number | null {
  const a =
    (previous.x - gate.center.x) * gate.tangent.x +
    (previous.y - gate.center.y) * gate.tangent.y;
  const b =
    (current.x - gate.center.x) * gate.tangent.x +
    (current.y - gate.center.y) * gate.tangent.y;
  if (a >= 0 || b < 0) return null;
  const t = -a / (b - a),
    x = previous.x + (current.x - previous.x) * t - gate.center.x,
    y = previous.y + (current.y - previous.y) * t - gate.center.y;
  return Math.abs(-x * gate.tangent.y + y * gate.tangent.x) <= gate.halfWidth
    ? t
    : null;
}
export function advanceLap(
  lap: LapState,
  data: TrackData,
  previous: Point,
  current: Point,
  dt: number,
  onRoad: boolean,
): { time: number; valid: boolean } | null {
  const before = lap.elapsed;
  lap.elapsed += dt;
  if (!onRoad) lap.valid = false;
  if (lap.nextGate < data.gates.length) {
    if (crossing(previous, current, data.gates[lap.nextGate]) !== null)
      lap.nextGate++;
    return null;
  }
  const t = crossing(previous, current, data.gates[0]);
  if (t === null) return null;
  const result = { time: before + dt * t, valid: lap.valid };
  lap.last = result.time;
  lap.completed++;
  lap.elapsed = dt * (1 - t);
  lap.valid = onRoad;
  lap.nextGate = 1;
  return result;
}
