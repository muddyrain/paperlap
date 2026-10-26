import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTrack,
  derive,
  fromDrawing,
  resample,
  smooth,
  validate,
  type Point,
} from "../src/game/geometry.ts";
import { advanceLap, crossing, newLap } from "../src/game/laps.ts";
import { FixedStepper, moveCar, noInput, spawn } from "../src/game/vehicle.ts";
import {
  freshSave,
  loadSave,
  parseSave,
  recordKey,
  writeSave,
} from "../src/game/storage.ts";
import { formatTime } from "../src/game/time.ts";
import { RULES_VERSION } from "../src/game/config.ts";
const data = derive(defaultTrack());
const ellipse = (rx = 460, ry = 230, n = 180): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: 720 + rx * Math.cos((i / n) * Math.PI * 2),
    y: 430 + ry * Math.sin((i / n) * Math.PI * 2),
  }));
test("timer rolls over at whole minutes without a 60-second display", () => {
  assert.equal(formatTime(59.999999), "00:59.99");
  assert.equal(formatTime(60), "01:00.00");
  assert.equal(formatTime(24.68), "00:24.68");
});
test("default and freehand closed track are valid; stable geometry identity", () => {
  assert.equal(validate(data.track.points), null);
  const result = fromDrawing(ellipse());
  assert.equal(result.ok, true);
  assert.deepEqual(fromDrawing(ellipse()), result);
});
test("open, crossing, degenerate, nonfinite and overlapping roads are rejected", () => {
  const open = fromDrawing(ellipse().slice(0, 120));
  assert.equal(open.ok, false);
  if (!open.ok) assert.match(open.reason, /终点/);
  const bow = Array.from({ length: 181 }, (_, i) => {
    const a = (i / 180) * Math.PI * 2;
    return { x: 720 + 460 * Math.sin(a), y: 430 + 230 * Math.sin(2 * a) };
  });
  const crossed = fromDrawing(bow);
  assert.equal(crossed.ok, false);
  if (!crossed.ok) assert.match(crossed.reason, /交叉|太近/);
  assert.equal(fromDrawing(Array(20).fill({ x: 500, y: 500 })).ok, false);
  assert.equal(fromDrawing([{ x: NaN, y: 400 }, ...ellipse()]).ok, false);
  assert.equal(fromDrawing(ellipse(460, 40)).ok, false);
  assert.equal(
    fromDrawing(ellipse().map((p) => ({ x: p.x, y: p.y - 60 }))).ok,
    false,
  );
  assert.equal(fromDrawing(Array(1601).fill({ x: 400, y: 400 })).ok, false);
});
test("sharp bends are checked after smoothing", () => {
  const points = smooth([
    { x: 200, y: 200 },
    { x: 1200, y: 200 },
    { x: 720, y: 220 },
    { x: 1200, y: 650 },
    { x: 200, y: 650 },
  ]);
  assert.ok(validate(points));
});
function pass(
  lap: ReturnType<typeof newLap>,
  index: number,
  onRoad = true,
  reverse = false,
) {
  const gate = data.gates[index],
    s = reverse ? -1 : 1;
  return advanceLap(
    lap,
    data,
    {
      x: gate.center.x - gate.tangent.x * 10 * s,
      y: gate.center.y - gate.tangent.y * 10 * s,
    },
    {
      x: gate.center.x + gate.tangent.x * 10 * s,
      y: gate.center.y + gate.tangent.y * 10 * s,
    },
    0.1,
    onRoad,
  );
}
test("initialization and leaving start cannot record a lap", () => {
  const lap = newLap(),
    g = data.gates[0];
  assert.equal(
    advanceLap(
      lap,
      data,
      g.center,
      { x: g.center.x + g.tangent.x * 20, y: g.center.y + g.tangent.y * 20 },
      0.1,
      true,
    ),
    null,
  );
  assert.equal(lap.completed, 0);
  assert.equal(pass(lap, 0), null);
  assert.equal(lap.completed, 0);
});
test("ordered checkpoints + forward swept start crossing complete a valid lap", () => {
  const lap = newLap();
  for (let i = 1; i < data.gates.length; i++) assert.equal(pass(lap, i), null);
  const result = pass(lap, 0);
  assert.ok(result?.valid);
  assert.ok(result.time > 1);
  assert.equal(lap.completed, 1);
  assert.equal(lap.nextGate, 1);
  assert.ok(lap.elapsed < 0.1);
});
test("reverse crossing and skipped checkpoints do not count; offroad lap stays invalid until complete", () => {
  const lap = newLap();
  pass(lap, 2);
  assert.equal(lap.nextGate, 1);
  assert.equal(pass(lap, 0), null);
  for (let i = 1; i < data.gates.length; i++) pass(lap, i, i !== 4);
  assert.equal(pass(lap, 0, true, true), null);
  assert.equal(lap.completed, 0);
  assert.equal(pass(lap, 0)?.valid, false);
  assert.equal(lap.valid, true);
  assert.equal(lap.nextGate, 1);
  const g = data.gates[1];
  const fraction = crossing(
    { x: g.center.x - g.tangent.x * 300, y: g.center.y - g.tangent.y * 300 },
    { x: g.center.x + g.tangent.x * 300, y: g.center.y + g.tangent.y * 300 },
    g,
  );
  assert.ok(fraction !== null && Math.abs(fraction - 0.5) < 1e-12);
});
test("fixed simulation matches at 30/60/144 FPS; large frame gaps are bounded", () => {
  function simulate(fps: number) {
    const c = spawn(data),
      stepper = new FixedStepper();
    let elapsed = 0;
    for (let i = 0; i < fps * 4; i++)
      stepper.advance(1 / fps, (dt) => {
        moveCar(
          c,
          { ...noInput(), throttle: true, right: elapsed >= 2 },
          dt,
          true,
        );
        elapsed += dt;
      });
    return c;
  }
  const a = simulate(30),
    b = simulate(60),
    c = simulate(144);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 3);
  assert.ok(Math.hypot(b.x - c.x, b.y - c.y) < 3);
  const stepper = new FixedStepper();
  let seconds = 0;
  stepper.advance(20, (dt) => (seconds += dt));
  assert.ok(seconds <= 0.10001);
  stepper.reset();
  assert.equal(stepper.accumulator, 0);
});
test("no stationary spinning, braking stops, offroad slows, pause does not advance or catch up", () => {
  const c = spawn(data),
    angle = c.angle;
  for (let i = 0; i < 120; i++)
    moveCar(c, { ...noInput(), right: true }, 1 / 120, true);
  assert.equal(c.angle, angle);
  for (let i = 0; i < 360; i++)
    moveCar(c, { ...noInput(), throttle: true }, 1 / 120, true);
  const fast = c.speed;
  for (let i = 0; i < 120; i++)
    moveCar(c, { ...noInput(), throttle: true }, 1 / 120, false);
  assert.ok(c.speed < fast * 0.5);
  for (let i = 0; i < 240; i++)
    moveCar(c, { ...noInput(), brake: true }, 1 / 120, true);
  assert.ok(c.speed < 0.001);
  const lap = newLap(),
    stepper = new FixedStepper();
  stepper.advance(0.016, (dt) => advanceLap(lap, data, c, c, dt, true));
  const time = lap.elapsed;
  stepper.reset();
  assert.equal(lap.elapsed, time);
  assert.equal(newLap().elapsed, 0);
});
test("storage validates shape/geometry/version; corrupted or unavailable storage is recoverable", () => {
  for (const raw of [
    "{oops",
    "null",
    "{}",
    JSON.stringify({ schemaVersion: 99 }),
    JSON.stringify({
      schemaVersion: 1,
      track: {
        schemaVersion: 1,
        width: 108,
        points: Array(20).fill({ x: "a", y: 1 }),
      },
    }),
  ])
    assert.deepEqual(parseSave(raw), freshSave());
  assert.deepEqual(
    loadSave({
      getItem() {
        throw Error("blocked");
      },
    }),
    freshSave(),
  );
  assert.equal(
    writeSave(
      {
        setItem() {
          throw Error("full");
        },
      },
      freshSave(),
    ),
    false,
  );
  const save = freshSave();
  save.records[recordKey(save.track)] = 24.68;
  save.muted = false;
  assert.deepEqual(parseSave(JSON.stringify(save)), save);
  const old = { ...save, rulesVersion: 99 };
  assert.deepEqual(parseSave(JSON.stringify(old)).records, {});
  const other = fromDrawing(ellipse());
  assert.equal(other.ok, true);
  if (other.ok) assert.equal(save.records[recordKey(other.track)], undefined);
});
test("handling upgrade retains track/preferences and separates legacy records", () => {
  const legacy = freshSave();
  legacy.rulesVersion = 1;
  legacy.muted = false;
  const oldKey = `${legacy.track.id}:rules-1`;
  legacy.records[oldKey] = 24.68;
  const restored = parseSave(JSON.stringify(legacy));
  assert.equal(restored.rulesVersion, RULES_VERSION);
  assert.deepEqual(restored.track, legacy.track);
  assert.equal(restored.muted, false);
  assert.equal(restored.records[oldKey], 24.68);
  assert.equal(restored.records[recordKey(restored.track)], undefined);
  let written = "";
  assert.ok(
    writeSave(
      {
        setItem(_key, value) {
          written = value;
        },
      },
      restored,
    ),
  );
  assert.equal(parseSave(written).records[oldKey], 24.68);
});
