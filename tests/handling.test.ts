import { test } from "node:test";
import assert from "node:assert/strict";
import { moveCar, noInput, type Car } from "../src/game/vehicle.ts";

const step = 1 / 120;
const movingCar = (speed: number): Car => ({
  x: 500,
  y: 350,
  angle: 0,
  vx: speed,
  vy: 0,
  speed,
  steering: 0,
});

function quarterTurn(speed: number) {
  const car = movingCar(speed);
  let length = 0,
    elapsed = 0,
    maxSlip = 0;
  while (car.angle < Math.PI / 2 && elapsed < 3) {
    const before = { x: car.x, y: car.y };
    moveCar(car, { ...noInput(), throttle: true, right: true }, step, true);
    length += Math.hypot(car.x - before.x, car.y - before.y);
    maxSlip = Math.max(
      maxSlip,
      Math.abs(car.angle - Math.atan2(car.vy, car.vx)),
    );
    elapsed += step;
  }
  return { car, radius: length / car.angle, elapsed, maxSlip };
}

test("medium/high-speed corner fits a smaller turning radius", (t) => {
  for (const [speed, limit] of [
    [220, 94],
    [260, 106],
  ]) {
    const turn = quarterTurn(speed);
    t.diagnostic(
      `speed=${speed}, effective radius=${turn.radius.toFixed(2)}, quarter turn=${turn.elapsed.toFixed(3)}s`,
    );
    assert.ok(turn.car.angle >= Math.PI / 2);
    assert.ok(
      turn.radius <= limit,
      `radius ${turn.radius.toFixed(2)} must fit ${limit}`,
    );
    assert.ok(
      turn.maxSlip < (12 * Math.PI) / 180,
      "steering must not become a sustained drift",
    );
  }
});

test("direction reaches useful lock quickly and releases without a long tail", (t) => {
  const car = movingCar(220);
  for (let i = 0; i < 14; i++)
    moveCar(car, { ...noInput(), throttle: true, right: true }, step, true);
  assert.ok(
    car.steering >= 0.9,
    `steering at 117ms: ${car.steering.toFixed(3)}`,
  );
  const turn = quarterTurn(220),
    before = turn.car.angle;
  for (let i = 0; i < 12; i++)
    moveCar(turn.car, { ...noInput(), throttle: true }, step, true);
  const tail = ((turn.car.angle - before) * 180) / Math.PI;
  t.diagnostic(`release tail=${tail.toFixed(2)} degrees`);
  assert.ok(turn.car.steering < 0.05);
  assert.ok(tail < 4.2, `release keeps turning ${tail.toFixed(2)} degrees`);
});

test("left/right corrections settle without a heading snap or residual slide", () => {
  const car = movingCar(220);
  for (let i = 0; i < 120; i++) {
    const before = car.angle;
    moveCar(
      car,
      { ...noInput(), throttle: true, right: i < 36, left: i >= 36 && i < 72 },
      step,
      true,
    );
    assert.ok(Math.abs(car.angle - before) < (3 * Math.PI) / 180);
  }
  assert.ok(Math.abs(car.angle) < 0.4);
  assert.ok(Math.abs(car.steering) < 0.001);
  assert.ok(Math.abs(car.angle - Math.atan2(car.vy, car.vx)) < Math.PI / 180);
});
