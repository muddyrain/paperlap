// Completion can only release its own visual resource. It never drives game state.
interface Handle {
  finished: Promise<unknown>;
  cancel(): void;
}
export class MotionSlots {
  private slots = new Map<string, { animation: Handle; release: () => void }>();
  get size() {
    return this.slots.size;
  }
  own(slot: string, animation: Handle, release: () => void = () => {}) {
    this.cancel(slot);
    const entry = { animation, release };
    this.slots.set(slot, entry);
    const done = () => {
      if (this.slots.get(slot) !== entry) return;
      this.slots.delete(slot);
      animation.cancel();
      release();
    };
    void animation.finished.then(done, done);
  }
  cancel(slot: string) {
    const entry = this.slots.get(slot);
    if (!entry) return;
    this.slots.delete(slot);
    entry.animation.cancel();
    entry.release();
  }
  clear() {
    for (const slot of [...this.slots.keys()]) this.cancel(slot);
  }
}
