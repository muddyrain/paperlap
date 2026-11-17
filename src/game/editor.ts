import { MAP, ROAD, WORLD } from "./config";
import { dist, drawingBounds, type Point, type Track } from "./geometry";
import type { RaceScene } from "./scene";
import type { Car } from "./vehicle";
import type { LapState } from "./laps";
import { DraftHistory, evaluateDraft, type DraftCheckpoint } from "./draft";
import { appendSegment, closesDrawing, drawingLength, emptySegmentDraft } from "./segmented-draft";
import { EditViewport, type ViewportSnapshot } from "./edit-viewport";
import type { EditIntent } from "./trackbook";

export class TrackEditor {
  private intent: EditIntent = "replace";
  history = new DraftHistory();
  readonly viewport = new EditViewport();
  onViewport: (viewport: ViewportSnapshot) => void = () => {};
  onCheckpoint: (checkpoint: DraftCheckpoint) => void = () => {};
  onHistory: () => void = () => {};
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  readonly tools: HTMLDivElement;
  private panButton: HTMLButtonElement;
  private retryButton: HTMLButtonElement;
  private zoomLabel: HTMLElement;
  private panMode = false;
  private panning = false;
  private lastPointer: Point | null = null;
  private stroke: Point[] = [];
  private errorPoint?: Point;
  private invalidSegment = false;
  private baseLength = 0;
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
  onStatus: (message: string, valid: boolean, kind: "hint" | "error" | "success") => void = () => {};
  get hasDraft() {
    return this.drawing || this.raw.length > 0 || this.history.dirty;
  }
  constructor(private scene: RaceScene, container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "draw-surface";
    // Resolution follows the viewport, never the full map.
    this.canvas.width = WORLD.width;
    this.canvas.height = WORLD.height;
    this.canvas.hidden = true;
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.tools = document.createElement("div");
    this.tools.className = "editor-map-tools paper";
    this.tools.setAttribute("role", "toolbar");
    this.tools.setAttribute("aria-label", "绘图视图");
    this.tools.hidden = true;
    const button = (label: string, action: () => void, title = label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", () => { action(); this.focus(); });
      this.tools.append(b);
      return b;
    };
    this.panButton = button("移动画布", () => {
      this.interrupt();
      this.panMode = !this.panMode;
      this.updateTools();
    }, "切换绘制与移动画布；也可按住鼠标中键或右键拖动");
    this.panButton.setAttribute("aria-pressed", "false");
    button("−", () => this.zoomView(1 / 1.25), "缩小画布").setAttribute("aria-label", "缩小画布");
    this.zoomLabel = document.createElement("span");
    this.zoomLabel.className = "editor-map-zoom";
    this.zoomLabel.setAttribute("aria-label", "画布缩放");
    this.tools.append(this.zoomLabel);
    button("＋", () => this.zoomView(1.25), "放大画布").setAttribute("aria-label", "放大画布");
    button("查看全图", () => this.fitView());
    button("回到末端", () => this.focusEnd());
    this.retryButton = button("重画末段", () => this.undo());
    container.append(this.tools);
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.cancelPointer);
    this.canvas.addEventListener("lostpointercapture", this.cancelPointer);
    this.canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.contextMenu);
    window.addEventListener("resize", this.cancelPointer);
  }
  enter(intent: EditIntent = "replace", name = this.scene.trackData.track.name) {
    this.intent = intent;
    this.canvas.setAttribute("aria-label", `${intent === "create" ? "新建赛道" : `编辑${name}`}：分段绘制，从蓝色末端继续，接回起点闭合。滚轮缩放，右键拖动画布，Ctrl 或 Cmd Z 撤销，Enter 保存，Esc 取消。`);
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
    this.tools.hidden = false;
    this.panMode = false;
    this.history = new DraftHistory();
    this.history.current = emptySegmentDraft();
    this.viewport.zoom = 1;
    this.viewport.center({ x: MAP.width / 2, y: MAP.height / 2 });
    this.renderSnapshot();
    this.viewChanged();
    this.onHistory();
  }
  redraw() {
    this.interrupt();
    this.history.commit(emptySegmentDraft());
    this.renderSnapshot();
    this.changed();
  }
  private renderSnapshot() {
    this.release();
    const snapshot = this.history.current;
    this.raw = snapshot.raw.map((p) => ({ ...p }));
    this.overflow = snapshot.overflow;
    this.strokeLength = 0;
    const result = evaluateDraft(snapshot);
    this.candidate = result.track;
    this.invalidSegment = result.kind === "error";
    this.errorPoint = result.point;
    this.scene.preview(result.track);
    this.paint();
    this.updateTools();
    this.onStatus(result.valid
      ? this.intent === "create"
        ? "赛道已闭合 · 保存新赛道后可开始 3D 试跑"
        : "赛道已闭合 · 保存修改后可开始 3D 试跑"
      : result.message, result.valid, result.kind);
  }
  private changed() {
    this.onHistory();
    this.onCheckpoint(this.history.checkpoint());
  }
  checkpoint() {
    // Unfinished input is not an accepted segment; the previous endpoint is durable.
    this.onCheckpoint(this.history.checkpoint());
  }
  restore(checkpoint: DraftCheckpoint) {
    this.release();
    this.history.restore(checkpoint);
    this.viewport.fit(checkpoint.current.raw);
    this.renderSnapshot();
    this.viewChanged();
    this.changed();
  }
  undo() {
    this.interrupt();
    if (!this.history.undo()) return;
    this.renderSnapshot();
    this.changed();
    this.focus();
  }
  redo() {
    this.interrupt();
    if (!this.history.redo()) return;
    this.renderSnapshot();
    this.changed();
    this.focus();
  }
  focus() { this.canvas.focus({ preventScroll: true }); }
  interrupt() {
    if (!this.drawing && !this.panning) return;
    this.release();
    this.renderSnapshot();
    this.changed();
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
    this.tools.hidden = true;
    this.previous = null;
    this.scene.onChange();
  }
  finish() {
    this.release();
    this.scene.restoreCar();
    this.canvas.hidden = true;
    this.tools.hidden = true;
    this.previous = null;
    this.candidate = null;
  }
  fitView() {
    this.interrupt();
    const points = this.raw.length ? this.raw : [{ x: 0, y: 0 }, { x: MAP.width, y: MAP.height }];
    this.viewport.fit(points);
    this.viewChanged();
  }
  zoomView(factor: number) {
    this.interrupt();
    this.viewport.zoomAt(factor, { x: WORLD.width / 2, y: WORLD.height / 2 + 15 });
    this.viewChanged();
  }
  focusEnd() {
    this.interrupt();
    this.viewport.zoom = Math.max(0.75, this.viewport.zoom);
    this.viewport.center(this.raw.at(-1) ?? { x: MAP.width / 2, y: MAP.height / 2 });
    this.viewChanged();
  }
  private viewChanged() {
    this.onViewport(this.viewport.snapshot());
    this.paint();
    this.updateTools();
  }
  private updateTools() {
    this.panButton.setAttribute("aria-pressed", String(this.panMode));
    this.panButton.textContent = this.panMode ? "继续绘制" : "移动画布";
    this.canvas.style.cursor = this.panMode || this.panning ? "grab" : "crosshair";
    this.zoomLabel.textContent = `${Math.round(this.viewport.zoom * 100)}%`;
    this.retryButton.disabled = !this.history.canUndo;
  }
  private screenPoint(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * WORLD.width) / r.width, y: ((e.clientY - r.top) * WORLD.height) / r.height };
  }
  private point(e: { clientX: number; clientY: number }): Point {
    return this.viewport.screenToWorld(this.screenPoint(e));
  }
  private down = (e: PointerEvent) => {
    if (this.pointer !== null || !this.previous) return;
    e.preventDefault();
    this.focus();
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.panMode)) {
      this.panning = true;
      this.lastPointer = this.screenPoint(e);
    } else {
      if (e.button !== 0 || this.candidate) return;
      if (this.invalidSegment) {
        this.onStatus("请点“重画末段”或撤销，前面的路线会保留", false, "error");
        return;
      }
      if (this.history.current.raw.length >= ROAD.maxRaw) {
        this.onStatus("路线细节已到上限，请重画末段或撤销后简化路线", false, "error");
        return;
      }
      const p = this.point(e), end = this.history.current.raw.at(-1);
      if (end && dist(p, end) > 30 / this.viewport.zoom) {
        this.onStatus("请从蓝色末端继续画；找不到末端时点“回到末端”", false, "hint");
        return;
      }
      this.stroke = [{ ...(end ?? p) }];
      this.drawing = true;
      this.overflow = false;
      this.strokeLength = 0;
      this.baseLength = drawingLength(this.history.current.raw);
      this.closureReady = false;
      this.errorPoint = undefined;
      this.onStatus("松手保留这一段 · 可以移动画布后继续，最后接回橘色起点", false, "hint");
    }
    this.pointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.updateTools();
    this.paint();
  };
  private sample(e: PointerEvent, last = false) {
    const p = this.point(e), previous = this.stroke.at(-1)!;
    const distance = dist(p, previous);
    if (distance < (last ? 0.5 : Math.max(8, 3 / this.viewport.zoom))) return;
    if (this.history.current.raw.length + this.stroke.length > ROAD.maxRaw + 1) {
      this.overflow = true;
      return;
    }
    this.strokeLength += distance;
    this.stroke.push(p);
    this.raw = this.history.current.raw.length
      ? [...this.history.current.raw, ...this.stroke.slice(1)]
      : [...this.stroke];
    const ready = this.baseLength + this.strokeLength >= ROAD.minLength && closesDrawing(this.raw);
    if (ready !== this.closureReady) {
      this.closureReady = ready;
      this.onStatus(ready ? "已回到起点 · 松手闭合并检查赛道" : "松手保留这一段 · 从蓝色末端继续", false, "hint");
    }
  }
  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    if (this.panning) {
      const p = this.screenPoint(e);
      this.viewport.pan(p.x - this.lastPointer!.x, p.y - this.lastPointer!.y);
      this.lastPointer = p;
      this.viewChanged();
    } else if (this.drawing) {
      this.sample(e);
      this.paint();
    }
  };
  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    if (this.panning) { this.release(); this.updateTools(); return; }
    if (!this.drawing) return;
    this.sample(e, true);
    const stroke = this.stroke;
    const length = this.strokeLength;
    this.release();
    if (length >= 6) this.history.commit(appendSegment(this.history.current, stroke));
    this.renderSnapshot();
    this.changed();
  };
  private wheel = (e: WheelEvent) => {
    if (!this.previous) return;
    e.preventDefault();
    this.interrupt();
    this.viewport.zoomAt(Math.exp(-Math.max(-160, Math.min(160, e.deltaY)) * 0.0025), this.screenPoint(e));
    this.viewChanged();
  };
  private contextMenu = (e: Event) => { e.preventDefault(); };
  private cancelPointer = () => { this.interrupt(); };
  private release() {
    const pointer = this.pointer;
    this.pointer = null;
    this.drawing = false;
    this.panning = false;
    this.lastPointer = null;
    this.stroke = [];
    this.closureReady = false;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
  }
  private paint() {
    const c = this.ctx, view = this.viewport;
    c.clearRect(0, 0, WORLD.width, WORLD.height);
    c.fillStyle = "#f2e7d1";
    c.fillRect(0, 0, WORLD.width, WORLD.height);
    c.strokeStyle = "rgba(116,139,150,.15)";
    c.lineWidth = 1;
    const grid = 40 * view.zoom;
    if (grid >= 5) {
      c.beginPath();
      for (let x = ((-view.x * view.zoom) % grid + grid) % grid; x < WORLD.width; x += grid) { c.moveTo(x, 0); c.lineTo(x, WORLD.height); }
      for (let y = ((-view.y * view.zoom) % grid + grid) % grid; y < WORLD.height; y += grid) { c.moveTo(0, y); c.lineTo(WORLD.width, y); }
      c.stroke();
    }
    c.save();
    c.scale(view.zoom, view.zoom);
    c.translate(-view.x, -view.y);
    const b = drawingBounds(2);
    c.strokeStyle = "rgba(81,107,120,.35)";
    c.lineWidth = 1 / view.zoom;
    c.setLineDash([6 / view.zoom, 8 / view.zoom]);
    c.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    c.setLineDash([]);
    const points = this.candidate?.points ?? this.raw;
    if (points.length) {
      c.lineCap = "round";
      c.lineJoin = "round";
      const line = () => {
        c.beginPath();
        points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
        if (this.candidate) c.closePath();
      };
      line();
      c.lineWidth = ROAD.width;
      c.strokeStyle = this.candidate ? "#a6a3a0" : "rgba(214,89,50,.16)";
      c.stroke();
      c.lineWidth = 2.5 / view.zoom;
      c.strokeStyle = this.errorPoint ? "#a43e29" : this.candidate ? "#f9f1e2" : "#d65932";
      if (this.candidate) c.setLineDash([14, 19]);
      c.stroke();
      c.setLineDash([]);
      const first = points[0], end = this.raw.at(-1)!;
      const marker = (p: Point, color: string, label: string, radius: number) => {
        c.fillStyle = color;
        c.beginPath(); c.arc(p.x, p.y, radius / view.zoom, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#fff8e8"; c.lineWidth = 2 / view.zoom; c.stroke();
        c.font = `600 ${14 / view.zoom}px sans-serif`;
        c.fillStyle = "#374553";
        c.fillText(label, p.x + 14 / view.zoom, p.y - 15 / view.zoom);
      };
      c.strokeStyle = this.closureReady ? "#567d62" : "rgba(214,89,50,.6)";
      c.lineWidth = 1.5 / view.zoom;
      c.setLineDash([5 / view.zoom, 6 / view.zoom]);
      c.beginPath(); c.arc(first.x, first.y, ROAD.closeDistance, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      marker(first, this.closureReady ? "#567d62" : "#d65932", "起点", 6);
      if (!this.candidate && end) marker(end, "#477c98", "从这里继续", 8);
      if (this.errorPoint) marker(this.errorPoint, "#a43e29", "请重画这一段", 10);
    }
    c.restore();
  }
  destroy() {
    this.interrupt();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancelPointer);
    this.canvas.removeEventListener("lostpointercapture", this.cancelPointer);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("contextmenu", this.contextMenu);
    window.removeEventListener("resize", this.cancelPointer);
    this.canvas.remove();
    this.tools.remove();
  }
}
