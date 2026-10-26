import { ROAD, WORLD } from "./config";
import { dist, fromDrawing, type Point, type Track } from "./geometry";
import type { RaceScene } from "./scene";
import type { Car } from "./vehicle";
import type { LapState } from "./laps";
export class TrackEditor {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  raw: Point[] = [];
  candidate: Track | null = null;
  drawing = false;
  overflow = false;
  pointer: number | null = null;
  previous: {
    track: Track;
    car: Car;
    lap: LapState;
    ready: boolean;
    offroad: boolean;
  } | null = null;
  onStatus: (
    message: string,
    valid: boolean,
    kind: "hint" | "error" | "success",
  ) => void = () => {};
  constructor(
    private scene: RaceScene,
    container: HTMLElement,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "draw-surface";
    this.canvas.width = WORLD.width * 2;
    this.canvas.height = WORLD.height * 2;
    this.canvas.hidden = true;
    this.canvas.setAttribute("aria-label", "按住鼠标绘制闭合赛道");
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.scale(2, 2);
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.cancelPointer);
  }
  enter() {
    this.previous = {
      track: this.scene.trackData.track,
      car: { ...this.scene.car },
      lap: { ...this.scene.lap },
      ready: this.scene.mode === "ready",
      offroad: this.scene.offroad,
    };
    this.scene.keys.clear();
    this.scene.stepper.reset();
    this.scene.mode = "editing";
    this.canvas.hidden = false;
    this.redraw();
  }
  redraw() {
    this.release();
    this.raw = [];
    this.candidate = null;
    this.scene.preview(null);
    this.paint();
    this.onStatus("按住鼠标画一圈，让终点回到起点附近", false, "hint");
  }
  cancel() {
    this.release();
    if (!this.previous) return;
    this.scene.setTrack(this.previous.track);
    this.scene.car = this.previous.car;
    this.scene.lap = this.previous.lap;
    this.scene.offroad = this.previous.offroad;
    this.scene.mode = this.previous.ready ? "ready" : "paused";
    this.scene.restoreCar();
    this.canvas.hidden = true;
    this.previous = null;
    this.scene.onChange();
  }
  accept(): Track | null {
    if (!this.candidate) return null;
    const track = this.candidate;
    this.release();
    this.scene.setTrack(track);
    this.scene.restoreCar();
    this.canvas.hidden = true;
    this.previous = null;
    return track;
  }
  private point(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * WORLD.width) / r.width,
      y: ((e.clientY - r.top) * WORLD.height) / r.height,
    };
  }
  private down = (e: PointerEvent) => {
    if (e.button !== 0 || this.candidate || this.drawing) return;
    e.preventDefault();
    this.drawing = true;
    this.overflow = false;
    this.pointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.raw = [this.point(e)];
    this.onStatus("慢慢画，不用太工整。回到橘色圆圈就能闭合。", false, "hint");
    this.paint();
  };
  private move = (e: PointerEvent) => {
    if (!this.drawing || e.pointerId !== this.pointer) return;
    const p = this.point(e);
    if (dist(p, this.raw.at(-1)!) < 4) return;
    if (this.raw.length >= ROAD.maxRaw) {
      this.overflow = true;
      return;
    }
    this.raw.push(p);
    this.paint();
  };
  private up = (e: PointerEvent) => {
    if (!this.drawing || e.pointerId !== this.pointer) return;
    const p = this.point(e);
    if (this.raw.length < ROAD.maxRaw) this.raw.push(p);
    this.release();
    const result = this.overflow
      ? { ok: false as const, reason: "路线画得太久了，请重新画一个简洁的圈" }
      : fromDrawing(this.raw);
    if (result.ok) {
      this.candidate = result.track;
      this.scene.preview(result.track);
      this.ctx.clearRect(0, 0, WORLD.width, WORLD.height);
      this.onStatus("赛道画好了！准备好就开始试跑。", true, "success");
    } else {
      this.paint(result.point);
      this.onStatus(result.reason, false, "error");
    }
  };
  private cancelPointer = () => {
    this.release();
    this.paint();
    this.onStatus("绘制已中断，可以重新按住鼠标画一圈", false, "hint");
  };
  private release() {
    if (this.pointer !== null && this.canvas.hasPointerCapture(this.pointer))
      this.canvas.releasePointerCapture(this.pointer);
    this.pointer = null;
    this.drawing = false;
  }
  private paint(error?: Point) {
    const c = this.ctx;
    c.clearRect(0, 0, WORLD.width, WORLD.height);
    if (!this.raw.length) return;
    const first = this.raw[0],
      last = this.raw.at(-1)!;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    this.raw.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.strokeStyle = "rgba(214,89,50,.12)";
    c.lineWidth = ROAD.width;
    c.stroke();
    c.strokeStyle = error ? "#aa4e39" : "#d65932";
    c.lineWidth = 3;
    c.stroke();
    c.setLineDash([5, 6]);
    c.lineWidth = 1.5;
    c.strokeStyle = "rgba(214,89,50,.6)";
    c.beginPath();
    c.arc(first.x, first.y, ROAD.closeDistance, 0, Math.PI * 2);
    c.stroke();
    if (dist(first, last) < ROAD.closeDistance) {
      c.beginPath();
      c.moveTo(first.x, first.y);
      c.lineTo(last.x, last.y);
      c.stroke();
    }
    c.setLineDash([]);
    c.fillStyle = "#d65932";
    c.beginPath();
    c.arc(first.x, first.y, 6, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#374553";
    c.font = "600 14px sans-serif";
    c.fillText("起点", first.x + 14, first.y - 15);
    if (error) {
      c.strokeStyle = "#a43e29";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(error.x, error.y, 22, 0, Math.PI * 2);
      c.stroke();
      c.font = "bold 25px sans-serif";
      c.fillStyle = "#a43e29";
      c.fillText("!", error.x - 4, error.y + 9);
    }
  }
  destroy() {
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancelPointer);
    this.canvas.remove();
  }
}
