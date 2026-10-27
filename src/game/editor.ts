import { ROAD, WORLD } from "./config";
import { dist, fromDrawing, type Point, type Track } from "./geometry";
import type { RaceScene } from "./scene";
import type { Car } from "./vehicle";
import type { LapState } from "./laps";
import type { EditIntent } from "./trackbook";
export class TrackEditor {
  private intent: EditIntent = "replace";
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  raw: Point[] = [];
  candidate: Track | null = null;
  drawing = false;
  overflow = false;
  strokeLength = 0;
  closureReady = false;
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
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      "aria-label",
      "绘制赛道，R 重画，Enter 试跑，Esc 取消",
    );
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.scale(2, 2);
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.cancelPointer);
    this.canvas.addEventListener("lostpointercapture", this.cancelPointer);
    window.addEventListener("resize", this.cancelPointer);
  }
  enter(intent: EditIntent = "replace") {
    this.intent = intent;
    this.canvas.setAttribute(
      "aria-label",
      intent === "create"
        ? "绘制新赛道，R 重画，Enter 保存，Esc 取消"
        : "绘制赛道，R 重画，Enter 试跑，Esc 取消",
    );
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
    this.strokeLength = 0;
    this.candidate = null;
    this.scene.preview(null);
    this.paint();
    this.onStatus("在虚线范围内画一个大圈，回到起点圆圈内松开", false, "hint");
  }
  focus() {
    this.canvas.focus({ preventScroll: true });
  }
  interrupt() {
    if (!this.drawing) return;
    this.release();
    this.paint();
    this.onStatus(
      "绘制已中断，可以重新按住鼠标画一圈，或按 R 清空",
      false,
      "hint",
    );
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
  finish() {
    this.release();
    this.scene.restoreCar();
    this.canvas.hidden = true;
    this.previous = null;
    this.candidate = null;
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
    this.focus();
    this.drawing = true;
    this.overflow = false;
    this.strokeLength = 0;
    this.closureReady = false;
    this.pointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.raw = [this.point(e)];
    this.onStatus("线条不用太工整，画一圈后回到起点圆圈内松开", false, "hint");
    this.paint();
  };
  private move = (e: PointerEvent) => {
    if (!this.drawing || e.pointerId !== this.pointer) return;
    const p = this.point(e);
    const distance = dist(p, this.raw.at(-1)!);
    if (distance < 4) return;
    if (this.raw.length >= ROAD.maxRaw) {
      this.overflow = true;
      return;
    }
    this.strokeLength += distance;
    this.raw.push(p);
    const ready =
      this.strokeLength >= ROAD.minLength &&
      this.raw.length >= 12 &&
      dist(p, this.raw[0]) <= ROAD.closeDistance;
    if (ready !== this.closureReady) {
      this.closureReady = ready;
      this.onStatus(
        ready
          ? "已回到起点 · 松开鼠标，自动闭合并检查赛道"
          : "继续画一圈，回到起点圆圈内松开",
        false,
        "hint",
      );
    }
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
      this.onStatus(
        this.intent === "create"
          ? "赛道画好了！按 Enter 保存新赛道，或按 R 重新绘制。"
          : "赛道画好了！按 Enter 试跑，或按 R 重新绘制。",
        true,
        "success",
      );
    } else {
      this.paint(result.point);
      this.onStatus(result.reason, false, "error");
    }
  };
  private cancelPointer = () => {
    this.interrupt();
  };
  private release() {
    const pointer = this.pointer;
    this.pointer = null;
    this.drawing = false;
    this.closureReady = false;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
  }
  private paint(error?: Point) {
    const c = this.ctx;
    c.clearRect(0, 0, WORLD.width, WORLD.height);
    c.save();
    c.strokeStyle = "rgba(81,107,120,.25)";
    c.lineWidth = 1;
    c.setLineDash([5, 9]);
    c.beginPath();
    c.roundRect(
      ROAD.margin,
      ROAD.minY,
      WORLD.width - ROAD.margin * 2,
      ROAD.maxY - ROAD.minY,
      68,
    );
    c.stroke();
    c.restore();
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
    c.strokeStyle = this.closureReady ? "#567d62" : "rgba(214,89,50,.6)";
    c.beginPath();
    c.arc(first.x, first.y, ROAD.closeDistance, 0, Math.PI * 2);
    if (this.closureReady) {
      c.fillStyle = "rgba(94,133,102,.1)";
      c.fill();
    }
    c.stroke();
    if (dist(first, last) < ROAD.closeDistance) {
      c.beginPath();
      c.moveTo(first.x, first.y);
      c.lineTo(last.x, last.y);
      c.stroke();
    }
    c.setLineDash([]);
    c.fillStyle = this.closureReady ? "#567d62" : "#d65932";
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
    this.canvas.removeEventListener("lostpointercapture", this.cancelPointer);
    window.removeEventListener("resize", this.cancelPointer);
    this.canvas.remove();
  }
}
