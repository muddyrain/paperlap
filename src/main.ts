import Phaser from "phaser";
import { RaceScene } from "./game/scene";
import { WORLD } from "./game/config";
import { TrackEditor } from "./game/editor";
import {
  activeTrack,
  freshSave,
  recordKey,
  setBest,
  type Save,
} from "./game/save";
import { loadSave, writeSave } from "./game/storage";
import { Sound } from "./game/audio";
import { Trackbook, trackbookMessage, type EditIntent } from "./game/trackbook";
import { TrackbookView } from "./game/trackbook-ui";
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
 <div class="editor-caption" hidden><strong>画一条你想开的路</strong><span>按住画一圈 · 起点附近松开 · 自动修圆</span></div>
 <div class="top-actions"><button id="sound" class="icon-button" aria-label="开启声音" title="开启声音">${icon("mute")}</button><button id="pause" class="paper" disabled>${icon("pause")}<span>暂停</span></button></div></header>
 <div id="lap-status" class="lap-status" role="status"></div><div id="toast" class="toast" role="status"></div>
 <section id="welcome" class="center-note paper"><span class="tiny">一张纸，一条路，一次好成绩。</span><h2>把这一圈，开成你的纪录。</h2><p>方向键或 WASD 驾驶。出发后，沿赛道绕行一圈。</p><button id="start" class="primary">${icon("play")}开始试跑</button><span class="start-hint">按住 ↑ 加速，弯前松油或刹车</span></section>
 <section id="pause-panel" class="center-note paper" hidden><span class="tiny">休息一下，赛道等你。</span><h2>已暂停</h2><p id="pause-reason">车辆和计时都已暂停</p><button id="resume" class="primary">${icon("play")}继续试跑</button></section>
 <div id="draw-intro" class="draw-intro" hidden><svg viewBox="0 0 230 100" fill="none" aria-hidden="true"><path d="M28 64C-4 16 96 2 109 35s108-37 103 18-133 44-179 16" stroke="currentColor" stroke-width="2" stroke-dasharray="6 6"/><circle cx="28" cy="64" r="6" fill="currentColor"/><path d="m30 49-2 15 16-3" stroke="currentColor" stroke-width="2"/></svg><strong>从这里，随手画一圈。</strong><span>线条不用太工整，回到起点圆圈内松开就好。</span></div>
 <div id="editor-status" class="editor-status" role="status" hidden></div>
 <div class="track-note"><span id="track-name"></span><button id="trackbook-open" class="paper" aria-haspopup="dialog">赛道本</button></div>
 <footer class="footer"><div class="controls"><span><kbd>↑</kbd> 加速</span><span><kbd>↓</kbd> 刹车</span><span><kbd>←</kbd><kbd>→</kbd> 转向</span><span class="extra-controls"><kbd>R</kbd> 重来 <span class="control-dot">·</span> <kbd>Esc</kbd> 暂停</span></div><div class="bottom-actions"><button id="edit" class="paper accent">${icon("edit")}编辑赛道</button><button id="restart" class="paper">${icon("reset")}重新开始</button></div></footer>
 <footer id="editor-footer" class="editor-footer" hidden><button id="cancel-edit" class="paper" aria-keyshortcuts="Escape" title="取消编辑 (Esc)">${icon("close")}取消编辑<kbd aria-hidden="true">Esc</kbd></button><span>随手画，线条会自动修圆。</span><div><button id="redraw" class="paper" aria-keyshortcuts="R" title="重新绘制 (R)">${icon("reset")}重新绘制<kbd aria-hidden="true">R</kbd></button><button id="drive-drawing" class="primary" aria-keyshortcuts="Enter" title="开始试跑 (Enter)" disabled>开始试跑<kbd aria-hidden="true">Enter ↵</kbd></button></div></footer>
 <section id="recovery" class="center-note paper" role="alert" hidden><h2>画面加载失败</h2><p>请重新加载以恢复已保存的赛道。</p><button id="reload" class="primary">重新加载</button></section>
 <div class="page-signature">DRAW A LITTLE. DRIVE A LITTLE.</div>
</main>`;
const scene = new RaceScene();
let save: Save;
let loadFailed = false;
try {
  const loaded = loadSave(window.localStorage);
  save = loaded.save;
  loadFailed = !!loaded.error;
} catch {
  save = freshSave();
  loadFailed = true;
}
scene.setTrack(activeTrack(save).track);
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
const book = new Trackbook(save, {
  uid: () => crypto.randomUUID(),
  write: (candidate) => writeSave(window.localStorage, candidate),
  stop: () => {
    scene.keys.clear();
    scene.pause();
    sound.update(0, false);
  },
  prepare: (entry) => {
    const apply = scene.prepareTrack(entry.track);
    return () => {
      apply();
      scene.mode = "ready";
      scene.restoreCar();
      uiClock = 0;
      scene.onChange();
    };
  },
  recover: () => {
    scene.keys.clear();
    scene.mode = "paused";
    game.loop.stop();
    sound.update(0, false);
    board.classList.add("recovering");
    board.querySelectorAll("dialog").forEach((dialog) => dialog.close());
    el("recovery").hidden = false;
    el("reload").focus();
  },
});
const trackbook = new TrackbookView(book, board, {
  create: () => beginEdit("create"),
  change: () => updateBest(),
});
el("trackbook-open").onclick = () => trackbook.open();
el("reload").onclick = () => location.reload();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, stamp = false) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").classList.toggle("stamp", stamp);
  toastTimer = setTimeout(() => (el("toast").textContent = ""), 3000);
}
function persist() {
  return book.persist().ok;
}
function updateBest() {
  const best = book.save.records[recordKey(activeTrack(book.save))];
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
if (loadFailed) toast("存档未能更新，仍可继续试跑");
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
  const key = recordKey(activeTrack(book.save)),
    best = book.save.records[key];
  if (valid && (!best || time < best)) {
    const result = setBest(book.save, book.save.activeTrackUid, time);
    if (!result.ok) {
      toast("成绩未能保存，仍可继续试跑");
      return;
    }
    book.save = result.save;
    const persisted = persist();
    updateBest();
    toast(
      persisted ? `新纪录！ ${format(time)}` : "本次未能保存，仍可继续试跑",
      persisted,
    );
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
  book.save.muted = sound.muted;
  void sound.unlock();
  soundUI();
  if (!persist()) toast("本次未能保存，仍可继续试跑");
  if (scene.mode === "running") area.focus();
};
function editUI(editing: boolean) {
  board.classList.toggle("editing", editing);
  el("editor-footer").hidden = !editing;
  el("editor-status").hidden = !editing;
  document.querySelector<HTMLElement>(".editor-caption")!.hidden = !editing;
  el("mode-label").textContent = editing
    ? book.intent === "create"
      ? "新建赛道"
      : "手绘赛道"
    : "自由试跑";
  el("drive-drawing").firstChild!.textContent =
    book.intent === "create" ? "保存新赛道" : "开始试跑";
  el("drive-drawing").title =
    book.intent === "create" ? "保存新赛道 (Enter)" : "开始试跑 (Enter)";
  uiClock = 0;
  scene.onChange();
}
function beginEdit(intent: EditIntent) {
  const result = book.beginEdit(intent);
  if (!result.ok) return result;
  editor.enter(intent);
  editUI(true);
  editor.focus();
  return result;
}
el("edit").onclick = () => beginEdit("replace");
editor.onStatus = (message, valid, kind) => {
  el("editor-status").textContent = message;
  el("editor-status").dataset.kind = kind;
  el<HTMLButtonElement>("drive-drawing").disabled = !valid;
  el("draw-intro").hidden = editor.raw.length > 0;
};
el("redraw").onclick = () => {
  editor.redraw();
  editor.focus();
};
function cancelEdit() {
  editor.cancel();
  book.cancelEdit();
  editUI(false);
  el("draw-intro").hidden = true;
  el(scene.mode === "ready" ? "start" : "resume").focus();
}
el("cancel-edit").onclick = cancelEdit;
function driveDrawing() {
  if (!editor.candidate) return;
  const create = book.intent === "create";
  const result = book.acceptDrawing(editor.candidate);
  if (!result.ok) {
    el("editor-status").textContent = trackbookMessage(result.error);
    el("editor-status").dataset.kind = "error";
    return;
  }
  editor.finish();
  editUI(false);
  el("draw-intro").hidden = true;
  trackbook.render();
  updateBest();
  if (create) area.focus();
  else start();
  toast(
    result.persisted
      ? create
        ? "新赛道已保存，点击开始试跑。"
        : "你的赛道，你来破纪录。"
      : "本次未能保存，仍可继续试跑",
  );
}
el("drive-drawing").onclick = driveDrawing;
function keydown(e: KeyboardEvent) {
  if (book.reloadRequired) return;
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (
    e.target instanceof Element &&
    e.target.closest("input,textarea,select,[contenteditable]")
  )
    return;
  if (scene.mode === "editing") {
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (e.target instanceof Element && e.target.closest("button,a")) return;
      e.preventDefault();
      if (!e.repeat) driveDrawing();
    } else if (e.code === "KeyR") {
      e.preventDefault();
      if (!e.repeat) {
        editor.redraw();
        editor.focus();
      }
    } else if (e.code === "Escape") {
      e.preventDefault();
      if (!e.repeat) cancelEdit();
    }
    return;
  }
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
  editor.interrupt();
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
board.addEventListener("keydown", keydown);
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
      activeTrackUid: book.save.activeTrackUid,
      keys: [...scene.keys],
      sound: {
        muted: sound.muted,
        running: scene.mode === "running" && !sound.muted,
        motorGain: sound.gain?.gain.value ?? 0,
      },
      track: structuredClone(scene.trackData.track),
      offroad: scene.offroad,
      effects: scene.trail.length,
    }),
  });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearTimeout(toastTimer);
    editor.destroy();
    trackbook.destroy();
    sound.destroy();
    board.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", loseFocus);
    document.removeEventListener("visibilitychange", visibility);
    area.removeEventListener("blur", areaBlur);
    area.removeEventListener("pointerdown", pointerFocus);
    game.destroy(true);
    if (debug)
      delete (window as unknown as Record<string, unknown>).paperlapDebug;
  });
