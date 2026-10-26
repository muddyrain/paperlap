import { DRIVE, WORLD } from "./config";
import type { Point, TrackData } from "./geometry";
export interface Car extends Point {
  angle: number;
  vx: number;
  vy: number;
  speed: number;
  steering: number;
}
export interface Input {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
}
export const noInput = (): Input => ({
  throttle: false,
  brake: false,
  left: false,
  right: false,
});
export function spawn(data: TrackData): Car {
  const g = data.gates[0];
  return {
    ...g.center,
    angle: Math.atan2(g.tangent.y, g.tangent.x),
    vx: 0,
    vy: 0,
    speed: 0,
    steering: 0,
  };
}
export function moveCar(car: Car, input: Input, dt: number, onRoad: boolean) {
  const f = { x: Math.cos(car.angle), y: Math.sin(car.angle) },
    r = { x: -f.y, y: f.x };
  let forward = Math.max(0, car.vx * f.x + car.vy * f.y),
    side = car.vx * r.x + car.vy * r.y;
  const max = onRoad ? DRIVE.maxSpeed : DRIVE.offroadSpeed;
  forward +=
    ((input.throttle ? DRIVE.acceleration : 0) -
      (input.brake ? DRIVE.brake : 0)) *
    dt;
  forward = Math.max(
    0,
    forward * Math.exp(-(onRoad ? DRIVE.drag : DRIVE.offroadDrag) * dt),
  );
  if (forward > max)
    forward = Math.max(max, forward - (onRoad ? 180 : 480) * dt);
  const targetSteering = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const response =
    targetSteering === 0 ? DRIVE.steeringReturn : DRIVE.steeringResponse;
  car.steering +=
    (targetSteering - car.steering) * (1 - Math.exp(-response * dt));
  // Add steering authority as speed rises, while retaining the low-speed ramp.
  const speedBlend = Math.max(
    0,
    Math.min(
      1,
      (forward - DRIVE.steeringSpeed) / (DRIVE.maxSpeed - DRIVE.steeringSpeed),
    ),
  );
  const turnRate =
    DRIVE.steering + (DRIVE.highSpeedSteering - DRIVE.steering) * speedBlend;
  car.angle +=
    car.steering * turnRate * Math.min(1, forward / DRIVE.steeringSpeed) * dt;
  side *= Math.exp(-DRIVE.lateralGrip * dt);
  // Keep a little of the old velocity through a turn, then let tire grip settle it.
  const nextF = { x: Math.cos(car.angle), y: Math.sin(car.angle) },
    mix = 1 - Math.exp(-dt * 12);
  car.vx = (f.x * forward + r.x * side) * (1 - mix) + nextF.x * forward * mix;
  car.vy = (f.y * forward + r.y * side) * (1 - mix) + nextF.y * forward * mix;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.speed = Math.hypot(car.vx, car.vy);
  if (
    car.x < 24 ||
    car.x > WORLD.width - 24 ||
    car.y < 105 ||
    car.y > WORLD.height - 90
  ) {
    car.x = Math.max(24, Math.min(WORLD.width - 24, car.x));
    car.y = Math.max(105, Math.min(WORLD.height - 90, car.y));
    car.vx *= 0.4;
    car.vy *= 0.4;
  }
}
export class FixedStepper {
  accumulator = 0;
  reset() {
    this.accumulator = 0;
  }
  advance(seconds: number, step: (dt: number) => void) {
    this.accumulator += Math.min(Math.max(seconds, 0), DRIVE.maxFrame);
    while (this.accumulator + 1e-10 >= DRIVE.step) {
      step(DRIVE.step);
      this.accumulator -= DRIVE.step;
    }
  }
}
