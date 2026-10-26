import Phaser from "phaser";
import { RaceScene } from "./game/scene";
import { WORLD } from "./game/config";
import { TrackEditor } from "./game/editor";
import {
  freshSave,
  loadSave,
  recordKey,
  writeSave,
  type Save,
} from "./game/storage";
import { Sound } from "./game/audio";
import { formatTime as format } from "./game/time";
import "./style.css";

const icon = (name: string) => {
  const paths: Record<string, string> = {
    flag: "M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0m5-10v10m5-9v10M5 8h15",
    pause: "M8 5v14M16 5v14",
    play: "m8 4 13 8-13 8Z",
    edit: "m4 16 12-12 4 4L8 20l-5 1 1-5Zm9-9 4 4",
    reset: "M20 7v5h-5M4 17a8 8 0 1 0 0-10",
    sound: "m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
    mute: "m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    close: "m6 6 12 12M6 18 18 6",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ? `<path d="${paths[name]}"/>` : ""}</svg>`;
};
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<main class="board" aria-label="纸上飞驰赛车游戏">
 <div id="game" tabindex="0" role="application" aria-label="赛车区域，方向键或 WASD 驾驶"></div>
 <header class="hud"><div class="mode-note paper"><span class="flag">${icon("flag")}</span><div><span class="tiny">PAPERLAP / 纸上飞驰</span><h1 id="mode-label">自由试跑</h1></div></div>
 <div class="timing paper"><div class="current"><span>本圈</span><output id="timer">00:00.00</output></div><div class="best"><span>个人最佳</span><output id="best">--:--.--</output><span class="best-star">☆</span></div></div>
 <div class="editor-caption" hidden><strong>画一条你想开的路</strong><span>按住鼠标绘制 · 首尾相连</span></div>
 <div class="top-actions"><button id="sound" class="icon-button" aria-label="开启声音" title="开启声音">${icon("mute")}</button><button id="pause" class="paper" disabled>${icon("pause")}<span>暂停</span></button></div></header>
 <div id="lap-status" class="lap-status" role="status"></div><div id="toast" class="toast" role="status"></div>
 <section id="welcome" class="center-note paper"><span class="tiny">一张纸，一条路，一次好成绩。</span><h2>把这一圈，开成你的纪录。</h2><p>方向键或 WASD 驾驶。出发后，沿赛道绕行一圈。</p><button id="start" class="primary">${icon("play")}开始试跑</button><span class="start-hint">按住 ↑ 加速，弯前松油或刹车</span></section>
 <section id="pause-panel" class="center-note paper" hidden><span class="tiny">休息一下，赛道等你。</span><h2>已暂停</h2><p id="pause-reason">车辆和计时都已暂停</p><button id="resume" class="primary">${icon("play")}继续试跑</button></section>
 <div id="draw-intro" class="draw-intro" hidden><svg viewBox="0 0 230 100" fill="none" aria-hidden="true"><path d="M28 64C-4 16 96 2 109 35s108-37 103 18-133 44-179 16" stroke="currentColor" stroke-width="2" stroke-dasharray="6 6"/><circle cx="28" cy="64" r="6" fill="currentColor"/><path d="m30 49-2 15 16-3" stroke="currentColor" stroke-width="2"/></svg><strong>从这里，随手画一圈。</strong><span>画大一些，弯圆一些，给小车留点空间。</span></div>
 <div id="editor-status" class="editor-status" role="status" hidden></div>
 <footer class="footer"><div class="controls"><span><kbd>↑</kbd> 加速</span><span><kbd>↓</kbd> 刹车</span><span><kbd>←</kbd><kbd>→</kbd> 转向</span><span class="extra-controls"><kbd>R</kbd> 重来 <span class="control-dot">·</span> <kbd>Esc</kbd> 暂停</span></div><div class="bottom-actions"><button id="edit" class="paper accent">${icon("edit")}编辑赛道</button><button id="restart" class="paper">${icon("reset")}重新开始</button></div></footer>
 <footer id="editor-footer" class="editor-footer" hidden><button id="cancel-edit" class="paper">${icon("close")}取消编辑</button><span>一笔画完，不交叉，不挤在一起。</span><div><button id="redraw" class="paper">${icon("reset")}重新绘制</button><button id="drive-drawing" class="primary" disabled>开始试跑${icon("arrow")}</button></div></footer>
 <div class="page-signature">DRAW A LITTLE. DRIVE A LITTLE.</div>
</main>`;
const scene = new RaceScene();
let save: Save;
try {
  save = loadSave(window.localStorage);
} catch {
  save = freshSave();
}
scene.setTrack(save.track);
const sound = new Sound();
sound.muted = save.muted;
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: WORLD.width,
  height: WORLD.height,
  transparent: true,
  scene: [scene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
  input: { keyboard: false },
  audio: { noAudio: true },
  banner: false,
});
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const area = el("game");
const board = document.querySelector<HTMLElement>(".board")!;
const editor = new TrackEditor(scene, board);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, stamp = false) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").classList.toggle("stamp", stamp);
  toastTimer = setTimeout(() => (el("toast").textContent = ""), 3000);
}
function persist() {
  save.track = scene.trackData.track;
  try {
    if (!writeSave(window.localStorage, save))
      toast("本次未能保存，仍可继续试跑");
  } catch {
    toast("本次未能保存，仍可继续试跑");
  }
}
function updateBest() {
  const best = save.records[recordKey(scene.trackData.track)];
  el("best").textContent = best ? format(best) : "--:--.--";
}
function soundUI() {
  el("sound").innerHTML = icon(sound.muted ? "mute" : "sound");
  el("sound").setAttribute("aria-label", sound.muted ? "开启声音" : "静音");
  el("sound").setAttribute("title", sound.muted ? "开启声音" : "静音");
  el("sound").setAttribute("aria-pressed", String(!sound.muted));
}
soundUI();
updateBest();
let uiClock = 0;
scene.onChange = () => {
  const now = performance.now();
  if (now - uiClock < 45) return;
  uiClock = now;
  el("timer").textContent = format(scene.lap.elapsed);
  el("welcome").hidden = scene.mode !== "ready";
  el("pause-panel").hidden = scene.mode !== "paused";
  el<HTMLButtonElement>("pause").disabled = scene.mode !== "running";
  el("lap-status").textContent =
    scene.mode === "editing"
      ? ""
      : !scene.lap.valid
        ? "本圈不计成绩 · 沿路线回到起点，开始新的一圈"
        : scene.offroad
          ? "驶离道路 · 回到赛道继续"
          : "";
  sound.update(scene.car.speed, scene.mode === "running");
};
scene.onLap = (time, valid) => {
  const key = recordKey(scene.trackData.track),
    best = save.records[key];
  if (valid && (!best || time < best)) {
    save.records[key] = time;
    persist();
    updateBest();
    toast(`新纪录！ ${format(time)}`, true);
    sound.stamp();
  } else
    toast(
      valid ? `完成一圈 · ${format(time)}` : `上圈 ${format(time)} · 未计成绩`,
    );
};
function start() {
  void sound.unlock();
  scene.start();
  uiClock = 0;
  scene.onChange();
  area.focus();
}
el("start").onclick = start;
el("resume").onclick = start;
el("pause").onclick = () => scene.pause();
el("restart").onclick = () => {
  scene.reset();
  start();
};
el("sound").onclick = () => {
  sound.muted = !sound.muted;
  save.muted = sound.muted;
  void sound.unlock();
  soundUI();
  persist();
  if (scene.mode === "running") area.focus();
};
function editUI(editing: boolean) {
  board.classList.toggle("editing", editing);
  el("editor-footer").hidden = !editing;
  el("editor-status").hidden = !editing;
  document.querySelector<HTMLElement>(".editor-caption")!.hidden = !editing;
  el("mode-label").textContent = editing ? "手绘赛道" : "自由试跑";
  uiClock = 0;
  scene.onChange();
}
el("edit").onclick = () => {
  editor.enter();
  editUI(true);
  el("redraw").focus();
};
editor.onStatus = (message, valid, kind) => {
  el("editor-status").textContent = message;
  el("editor-status").dataset.kind = kind;
  el<HTMLButtonElement>("drive-drawing").disabled = !valid;
  el("draw-intro").hidden = editor.raw.length > 0;
};
el("redraw").onclick = () => editor.redraw();
el("cancel-edit").onclick = () => {
  editor.cancel();
  editUI(false);
  el("draw-intro").hidden = true;
};
el("drive-drawing").onclick = () => {
  if (!editor.accept()) return;
  editUI(false);
  el("draw-intro").hidden = true;
  persist();
  updateBest();
  start();
  toast("你的赛道，你来破纪录。");
};
function keydown(e: KeyboardEvent) {
  if (e.target !== area) return;
  if (e.code === "Escape" && scene.mode === "running") {
    e.preventDefault();
    scene.pause();
    uiClock = 0;
    scene.onChange();
  } else if (e.code === "KeyR" && scene.mode === "running") {
    e.preventDefault();
    scene.reset();
  } else if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyS",
      "KeyA",
      "KeyD",
    ].includes(e.code) &&
    scene.mode === "running"
  ) {
    e.preventDefault();
    scene.keys.add(e.code);
  }
}
const keyup = (e: KeyboardEvent) => scene.keys.delete(e.code);
function loseFocus() {
  scene.keys.clear();
  scene.pause();
  uiClock = 0;
  scene.onChange();
}
function visibility() {
  if (document.hidden) loseFocus();
}
function areaBlur() {
  scene.keys.clear();
  if (scene.mode === "running") {
    scene.pause();
    uiClock = 0;
    scene.onChange();
  }
}
function pointerFocus() {
  if (scene.mode === "running") area.focus();
}
area.addEventListener("keydown", keydown);
window.addEventListener("keyup", keyup);
window.addEventListener("blur", loseFocus);
document.addEventListener("visibilitychange", visibility);
area.addEventListener("blur", areaBlur);
area.addEventListener("pointerdown", pointerFocus);
// Read-only telemetry is available only with ?debug=1 for local inspection.
const debug = new URLSearchParams(location.search).has("debug");
if (debug)
  Object.defineProperty(window, "paperlapDebug", {
    configurable: true,
    get: () => ({
      mode: scene.mode,
      car: { ...scene.car },
      lap: { ...scene.lap },
      trackId: scene.trackData.track.id,
      track: structuredClone(scene.trackData.track),
      offroad: scene.offroad,
      effects: scene.trail.length,
    }),
  });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearTimeout(toastTimer);
    editor.destroy();
    sound.destroy();
    area.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", loseFocus);
    document.removeEventListener("visibilitychange", visibility);
    area.removeEventListener("blur", areaBlur);
    area.removeEventListener("pointerdown", pointerFocus);
    game.destroy(true);
    if (debug)
      delete (window as unknown as Record<string, unknown>).paperlapDebug;
  });
