import "./local-edit.css";
import { paperArt } from "../game/art";
import { ROAD, WORLD } from "../game/config";
import { type Point, type Track } from "../game/geometry";
import {
  LocalEditModel,
  LOCAL_EDIT,
  arcLengths,
  deformLocal,
  prepareLocalDrag,
  type LocalDrag,
} from "../game/local-edit";
import { parseSave } from "../game/save";
import { ellipseTrack, localFixtures } from "./local-edit-fixtures";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("local-canvas"),
  ctx = canvas.getContext("2d")!;
const route = $<HTMLSelectElement>("route"),
  radius = $<HTMLInputElement>("radius");
const paper = paperArt(); // Shared paper art, created once; no animation/render loop.
let tracks = localFixtures(),
  track: Track,
  model: LocalEditModel;
const count = Number(new URLSearchParams(location.search).get("points"));
if ([200, 450, 900].includes(count)) tracks[0] = ellipseTrack(count);
let selection: LocalDrag | null = null;
let drag: {
  selection: LocalDrag;
  start: Point;
  pointer: number;
  latest: Point;
  queuedAt: number;
} | null = null;
let visible: Point[] | null = null,
  frame = 0;
const metrics = {
  fullChecks: 0,
  previewFrames: 0,
  previewMs: [] as number[],
  eventToPaintMs: [] as number[],
  validateMs: [] as number[],
};
const sample = (list: number[], n: number) => {
  list.push(n);
  if (list.length > 512) list.shift();
};
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
$("undo").setAttribute("aria-keyshortcuts", isMac ? "Meta+Z" : "Control+Z");
$("redo").setAttribute(
  "aria-keyshortcuts",
  isMac ? "Meta+Shift+Z" : "Control+Shift+Z",
);
document.querySelector(".undo-key")!.textContent = isMac ? "⌘ Z" : "Ctrl Z";
document.querySelector(".redo-key")!.textContent = isMac ? "⌘ ⇧ Z" : "Ctrl ⇧ Z";
function status(text: string, kind = "hint") {
  if ($("status").textContent !== text) $("status").textContent = text;
  $("status").dataset.kind = kind;
}
function buttons() {
  const pending = model.pending;
  $<HTMLButtonElement>("adopt").disabled =
    !pending || !!pending.error || !!drag;
  $<HTMLButtonElement>("cancel").disabled = !pending && !drag;
  $<HTMLButtonElement>("undo").disabled = !model.canUndo;
  $<HTMLButtonElement>("redo").disabled = !model.canRedo;
  radius.disabled = !!drag;
  $("history-count").textContent = String(model.historySize);
  $("validation-count").textContent = String(metrics.fullChecks);
  $("validation-time").textContent = metrics.validateMs.length
    ? `${metrics.validateMs.at(-1)!.toFixed(2)} ms`
    : "—";
  $("affected-count").textContent = selection
    ? `${selection.weights.filter((w) => w > 0).length} / ${track.points.length}`
    : "—";
}
function path(points: readonly Point[], close = true) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (close) ctx.closePath();
}
function markedArc(points: readonly Point[], selected: (i: number) => boolean) {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (!selected(i)) return;
    const next = points[(i + 1) % points.length];
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(next.x, next.y);
  });
  ctx.stroke();
}
function paint() {
  const current = model.current,
    pending = model.pending;
  const points = visible ?? pending?.points ?? current;
  const invalid = !!pending?.error;
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  ctx.drawImage(paper, 0, 0, WORLD.width, WORLD.height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.save();
  ctx.setLineDash([8, 9]);
  ctx.strokeStyle = "#a89a80";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    ROAD.margin,
    ROAD.minY,
    WORLD.width - 2 * ROAD.margin,
    ROAD.maxY - ROAD.minY,
  );
  ctx.restore();
  path(track.points);
  ctx.lineWidth = ROAD.width;
  ctx.strokeStyle = "#a39a8e33";
  ctx.stroke();
  path(current);
  ctx.lineWidth = ROAD.width;
  ctx.strokeStyle = "#999b9377";
  ctx.stroke();
  if (selection) {
    ctx.strokeStyle = "#e5b54466";
    ctx.lineWidth = ROAD.width + 18;
    markedArc(
      selection.base,
      (i) =>
        selection!.weights[i] > 0 ||
        selection!.weights[(i + 1) % selection!.weights.length] > 0,
    );
  }
  path(points);
  ctx.lineWidth = ROAD.width;
  ctx.strokeStyle = invalid ? "#dba78a77" : "#8ba99d88";
  ctx.stroke();
  path(points);
  ctx.lineWidth = 3;
  ctx.strokeStyle = invalid ? "#a84d36" : "#326c62";
  ctx.stroke();
  ctx.save();
  path(track.points);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#70675dc9";
  ctx.setLineDash([10, 9]);
  ctx.stroke();
  ctx.restore();
  const arcs = arcLengths(current),
    total = arcs.at(-1)!;
  ctx.strokeStyle = "#716b7088";
  ctx.lineWidth = ROAD.width + 6;
  markedArc(
    current,
    (i) =>
      arcs[i] <= LOCAL_EDIT.guard || arcs[i + 1] >= total - LOCAL_EDIT.guard,
  );
  const start = current[0],
    next = current[1],
    angle = Math.atan2(next.y - start.y, next.x - start.x);
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(angle);
  ctx.strokeStyle = "#434f57";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -ROAD.width / 2);
  ctx.lineTo(0, ROAD.width / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(46, 0);
  ctx.lineTo(36, -8);
  ctx.moveTo(46, 0);
  ctx.lineTo(36, 8);
  ctx.stroke();
  ctx.restore();
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#4c5358";
  ctx.fillText("起点 · 保护", start.x - 45, start.y + ROAD.width / 2 + 30);
  if (selection) {
    const a = selection.anchor;
    ctx.strokeStyle = "#a7742d";
    ctx.lineWidth = 2;
    for (let i = 1; i < selection.weights.length; i++)
      if (
        selection.weights[i] === 0 &&
        (selection.weights[i - 1] > 0 ||
          selection.weights[(i + 1) % selection.weights.length] > 0)
      ) {
        const p = selection.base[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    ctx.fillStyle = "#fff7db";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (drag) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(
        a.x + drag.latest.x - drag.start.x,
        a.y + drag.latest.y - drag.start.y,
      );
      ctx.stroke();
    }
  }
  if (pending?.error?.point) {
    const p = pending.error.point;
    ctx.strokeStyle = "#a43e2b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#a43e2b";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText("!", p.x - 4, p.y + 9);
  }
}
function position(e: PointerEvent): Point {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * WORLD.width) / r.width,
    y: ((e.clientY - r.top) * WORLD.height) / r.height,
  };
}
function release() {
  const id = drag?.pointer;
  drag = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  canvas.dataset.dragging = "false";
  if (id !== undefined && canvas.hasPointerCapture(id))
    canvas.releasePointerCapture(id);
}
function cancel(message = "本次预览已取消，已采用路线保留。") {
  release();
  model.cancelPreview();
  visible = null;
  selection = null;
  status(message);
  buttons();
  paint();
}
function consume() {
  frame = 0;
  if (!drag) return;
  const now = performance.now();
  visible = deformLocal(drag.selection, {
    x: drag.latest.x - drag.start.x,
    y: drag.latest.y - drag.start.y,
  });
  const outside = visible.some(
    (p) =>
      p.x < ROAD.margin ||
      p.x > WORLD.width - ROAD.margin ||
      p.y < ROAD.minY ||
      p.y > ROAD.maxY,
  );
  status(
    outside
      ? "预览已靠近纸边；松手后完整检查，尚未采用。"
      : "正在预览，尚未校验；松手检查道路。",
    "preview",
  );
  paint();
  metrics.previewFrames++;
  sample(metrics.previewMs, performance.now() - now);
  sample(metrics.eventToPaintMs, performance.now() - drag.queuedAt);
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || drag) return;
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  const point = position(e),
    result = prepareLocalDrag(model.current, point, Number(radius.value));
  if (!result.ok) {
    status(result.reason);
    return;
  }
  model.cancelPreview();
  visible = null;
  selection = result.drag;
  drag = {
    selection,
    start: point,
    latest: point,
    pointer: e.pointerId,
    queuedAt: performance.now(),
  };
  canvas.setPointerCapture(e.pointerId);
  canvas.dataset.dragging = "true";
  status("正在预览，尚未校验；松手检查道路。", "preview");
  buttons();
  paint();
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  drag.latest = position(e);
  drag.queuedAt = performance.now();
  if (!frame) frame = requestAnimationFrame(consume);
});
canvas.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  drag.latest = position(e);
  drag.queuedAt = performance.now();
  if (frame) cancelAnimationFrame(frame);
  consume();
  const points = visible!;
  release();
  visible = null;
  if (
    points.every(
      (p, i) => p.x === selection!.base[i].x && p.y === selection!.base[i].y,
    )
  ) {
    model.cancelPreview();
    status("已选中这段道路。按住并拖动来调整，起点及接头受保护。");
    buttons();
    paint();
    return;
  }
  const start = performance.now(),
    error = model.preview(points);
  sample(metrics.validateMs, performance.now() - start);
  metrics.fullChecks++;
  status(
    error
      ? `不可采用：${error.reason}。红圈为检查位置，请取消后重新选择。`
      : "合法，可采用。只进入演示内存，不会保存或开始驾驶。",
    error ? "invalid" : "valid",
  );
  buttons();
  paint();
});
for (const type of ["pointercancel", "lostpointercapture"])
  canvas.addEventListener(type, () => {
    if (drag) cancel("拖动已中断，已采用路线保留。请重新选择。");
  });
for (const type of ["blur", "resize", "pagehide"])
  window.addEventListener(type, () => {
    if (drag) cancel("拖动已中断，已采用路线保留。请重新选择。");
  });
document.addEventListener("visibilitychange", () => {
  if (document.hidden && drag) cancel();
});
function adopt() {
  if (drag) return;
  if (!model.adopt()) {
    buttons();
    paint();
    return;
  }
  visible = null;
  status(
    "已采用到演示。可继续选择另一处弯道，也可撤销；正式赛道未改变。",
    "valid",
  );
  buttons();
  paint();
  canvas.focus({ preventScroll: true });
}
function history(redo: boolean) {
  release();
  visible = null;
  selection = null;
  const changed = redo ? model.redo() : model.undo();
  status(
    changed
      ? redo
        ? "已重做合法调整。"
        : "已撤销，恢复上一份路线。"
      : "没有可恢复的已采用调整。",
  );
  buttons();
  paint();
  canvas.focus({ preventScroll: true });
}
function reset() {
  release();
  visible = null;
  selection = null;
  model.reset();
  status("已取消全部调整，回到原始路线。正式存档与纪录未改变。");
  buttons();
  paint();
}
$("adopt").addEventListener("click", adopt);
$("cancel").addEventListener("click", () => {
  cancel();
  canvas.focus({ preventScroll: true });
});
$("undo").addEventListener("click", () => history(false));
$("redo").addEventListener("click", () => history(true));
$("reset").addEventListener("click", () => {
  reset();
  canvas.focus({ preventScroll: true });
});
radius.addEventListener("input", () => {
  $("radius-value").textContent = radius.value;
});
document.addEventListener("keydown", (e) => {
  if (
    e.isComposing ||
    e.repeat ||
    e.altKey ||
    (e.target instanceof HTMLElement &&
      e.target.matches("input,select,textarea,[contenteditable='true']"))
  )
    return;
  const modifier = e.ctrlKey || e.metaKey;
  if (modifier && e.code === "KeyZ") {
    e.preventDefault();
    history(e.shiftKey);
    return;
  }
  if (modifier) return;
  if (e.code === "Escape") {
    e.preventDefault();
    if (drag || model.pending) cancel();
    else reset();
    return;
  }
  if (e.code === "KeyR") {
    e.preventDefault();
    reset();
    return;
  }
  if (e.code === "Enter" && e.target === canvas) {
    e.preventDefault();
    adopt();
  }
});
function load(index: number) {
  release();
  visible = null;
  selection = null;
  track = structuredClone(tracks[index]);
  model = new LocalEditModel(track.points);
  $("route-name").textContent = track.name;
  status("选一处弯道，轻轻拖动。独立演示，不会保存。");
  buttons();
  paint();
}
function options() {
  route.replaceChildren(...tracks.map((t, i) => new Option(t.name, String(i))));
}
route.addEventListener("change", () => load(Number(route.value)));
$("read-saved").addEventListener("click", () => {
  try {
    const saved = parseSave(window.localStorage.getItem("paperlap.save.v2"));
    if (!saved) {
      status(
        "此网址与端口没有可读取的有效 Save V2。可继续体验样例；未修改存档。",
      );
      return;
    }
    tracks = saved.tracks.map((e) => e.track);
    options();
    load(saved.tracks.findIndex((e) => e.uid === saved.activeTrackUid));
    route.value = String(
      saved.tracks.findIndex((e) => e.uid === saved.activeTrackUid),
    );
    status("已只读加载已保存赛道。调整仅存在于本演示，旧赛道和纪录保持不变。");
  } catch {
    status("浏览器拒绝读取存档。仍可体验样例；未写入或删除任何数据。");
  }
});
options();
load(0);
if (new URLSearchParams(location.search).has("debug"))
  Object.defineProperty(window, "localEditDebug", {
    get: () => ({
      route: track.name,
      original: structuredClone(track.points),
      current: model.current,
      pending: model.pending,
      preview: visible ? structuredClone(visible) : null,
      selection: selection ? structuredClone(selection) : null,
      dragging: !!drag,
      pointer: drag?.pointer ?? null,
      queuedFrame: !!frame,
      history: model.historySize,
      canRedo: model.canRedo,
      metrics: structuredClone(metrics),
    }),
  });
