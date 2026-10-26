export class Sound {
  context: AudioContext | null = null;
  motor: OscillatorNode | null = null;
  gain: GainNode | null = null;
  muted = true;
  async unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.motor = this.context.createOscillator();
        this.gain = this.context.createGain();
        this.motor.type = "triangle";
        this.gain.gain.value = 0;
        this.motor.connect(this.gain).connect(this.context.destination);
        this.motor.start();
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      /* Audio is optional; gameplay keeps running. */
    }
  }
  update(speed: number, running: boolean) {
    if (!this.context || !this.gain || !this.motor) return;
    const t = this.context.currentTime;
    this.motor.frequency.setTargetAtTime(45 + speed * 0.7, t, 0.15);
    this.gain.gain.setTargetAtTime(!this.muted && running ? 0.012 : 0, t, 0.08);
  }
  stamp() {
    if (this.muted || !this.context) return;
    try {
      const c = this.context,
        o = c.createOscillator(),
        g = c.createGain();
      o.connect(g).connect(c.destination);
      o.frequency.setValueAtTime(620, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(980, c.currentTime + 0.13);
      g.gain.setValueAtTime(0.045, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
      o.start();
      o.stop(c.currentTime + 0.3);
    } catch {}
  }
  destroy() {
    void this.context?.close().catch(() => {});
  }
}
