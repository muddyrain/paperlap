import test from "node:test";
import assert from "node:assert/strict";
import { MotionSlots } from "../src/game/motion-slots.ts";
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
function animation() {
  let finish!: () => void;
  const a = {
    finished: new Promise<void>((r) => (finish = r)),
    cancelled: 0,
    cancel() {
      this.cancelled++;
    },
    finish: () => finish(),
  };
  return a;
}
test("superseded completion cannot release the current visual", async () => {
  const slots = new MotionSlots(),
    a = animation(),
    b = animation();
  let old = 0,
    current = 0;
  slots.own("paper", a, () => old++);
  slots.own("paper", b, () => current++);
  assert.equal(a.cancelled, 1);
  assert.equal(old, 1);
  a.finish();
  await tick();
  assert.equal(slots.size, 1);
  assert.equal(current, 0);
  b.finish();
  await tick();
  assert.equal(slots.size, 0);
  assert.equal(current, 1);
});
test("lifecycle/reduced-motion clear is bounded and idempotent", async () => {
  const slots = new MotionSlots();
  let released = 0;
  const all = Array.from({ length: 8 }, () => animation());
  all.forEach((a, i) => slots.own(String(i), a, () => released++));
  slots.clear();
  slots.clear();
  all.forEach((a) => a.finish());
  await tick();
  assert.equal(slots.size, 0);
  assert.equal(released, 8);
  assert.ok(all.every((a) => a.cancelled === 1));
});
