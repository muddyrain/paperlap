import Phaser from "phaser";
import { GameMenu } from "./game/game-menu";
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
import { TrackbookView, trackName } from "./game/trackbook-ui";
import { formatTime as format } from "./game/time";
import { icon, buttonContent } from "./game/ui";
import { shortcut, shortcutTarget, ignoresShortcuts } from "./game/shortcuts";
import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<main class="board" aria-label="纸上飞驰赛车游戏">
 <div id="game" tabindex="0" role="application" aria-label="赛车区域，方向键或 WASD 驾驶"></div>
 <header class="hud"><div class="mode-note paper"><span class="flag">${icon("flag")}</span><div class="mode-copy"><h1><span class="track-label">当前赛道：</span><span id="track-name" tabindex="0"></span></h1><span id="mode-label">自由试跑</span></div></div>
 <div class="timing paper"><div class="current"><span>本圈</span><output id="timer">00:00.00</output></div><div class="best"><span>个人最佳</span><output id="best">--:--.--</output><span class="best-star">☆</span></div></div>
 <div class="editor-caption" hidden><div class="editor-heading"><h2 id="editor-title">新建赛道</h2><span id="editor-target">目标赛道：<strong id="editor-track-name" tabindex="0"></strong></span></div><p id="editor-intent"></p><div id="draw-intro" hidden>按住画一圈 · 起点附近松开 · 自动修圆</div></div>
 <div class="top-actions"><button id="trackbook-open" class="paper" aria-haspopup="dialog" aria-expanded="false" aria-controls="trackbook" aria-keyshortcuts="T" title="赛道本 (T)">${buttonContent("book", "赛道本", "T")}</button><button id="pause" class="paper" aria-keyshortcuts="Escape" aria-haspopup="dialog" aria-controls="game-menu" aria-expanded="false" title="游戏菜单 (Esc)">${buttonContent("pause", "菜单", "Esc")}</button></div></header>
 <div id="lap-status" class="lap-status" role="status"></div><div id="toast" class="toast" role="status"></div>
 <footer class="footer"><div class="controls"><span><kbd>↑</kbd> 加速</span><span><kbd>↓</kbd> 刹车</span><span><kbd>←</kbd><kbd>→</kbd> 转向</span><span class="extra-controls"><kbd>R</kbd> 重来 <span class="control-dot">·</span> <kbd>Esc</kbd> 菜单</span></div><section id="welcome" class="race-note paper" aria-labelledby="ready-title"><h2 id="ready-title">准备试跑</h2><p id="start-hint" class="sr-only">方向键或 WASD 驾驶，按住 ↑ 加速，弯前松油或刹车。</p><button id="start" class="primary" aria-keyshortcuts="Space" title="开始试跑 (Space)" aria-describedby="start-hint">${buttonContent("play", "开始试跑", "Space")}</button></section><section id="pause-panel" class="race-note paper" aria-labelledby="pause-title" hidden><h2 id="pause-title">已暂停</h2><p id="pause-reason" class="sr-only">车辆和计时都已暂停</p><button id="resume" class="primary" aria-keyshortcuts="Space" title="继续试跑 (Space)" aria-describedby="pause-reason">${buttonContent("play", "继续试跑", "Space")}</button></section><div class="bottom-actions"><button id="sound" class="paper" aria-label="开启声音" title="开启声音">${buttonContent("mute", "声音")}</button><button id="edit" class="paper accent" aria-keyshortcuts="E" title="编辑当前赛道 (E)">${buttonContent("edit", "编辑当前", "E")}</button><button id="restart" class="paper" aria-keyshortcuts="R" title="重新开始 (R)">${buttonContent("reset", "重新开始", "R")}</button></div></footer>
 <footer id="editor-footer" class="editor-footer" hidden><button id="cancel-edit" class="paper" aria-keyshortcuts="Escape" title="取消编辑 (Esc)">${icon("close")}取消编辑<kbd class="button-key" aria-hidden="true">Esc</kbd></button><div id="editor-status" class="editor-status" role="status" hidden></div><div><button id="redraw" class="paper" aria-keyshortcuts="R" title="重新绘制 (R)">${icon("reset")}重新绘制<kbd class="button-key" aria-hidden="true">R</kbd></button><button id="drive-drawing" class="primary" aria-keyshortcuts="Enter" title="保存修改并试跑 (Enter)" disabled>${icon("check")}<span id="drawing-action">保存修改并试跑</span><kbd class="button-key" aria-hidden="true">Enter ↵</kbd></button></div></footer>
 <section id="recovery" class="center-note paper" role="alert" hidden><h2>画面加载失败</h2><p>请重新加载以恢复已保存的赛道。</p><button id="reload" class="primary">${buttonContent("reset", "重新加载")}</button></section>
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
    menu.block();
    board.classList.add("recovering");
    board.querySelectorAll("dialog").forEach((dialog) => dialog.close());
    el("recovery").hidden = false;
    el("reload").focus();
  },
});
const trackbook = new TrackbookView(book, board, {
  create: () => menu.edit("create"),
  open: () => pause(),
  close: () => menu.bookClosed(),
  change: (action) => {
    updateBest();
    if (action === "select") {
      toast("赛道已切换 · 等待开始试跑");
      el("track-name")
        .getAnimations()
        .forEach((motion) => motion.cancel());
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        el("track-name").animate([{ opacity: 0.5 }, { opacity: 1 }], {
          duration: 220,
        });
    }
  },
});
const menu = new GameMenu(board, area, {
  context: () => ({
    mode: scene.mode,
    identity: `${book.save.activeTrackUid}:${scene.trackData.track.id}`,
    name: trackName(activeTrack(book.save)),
    elapsed: editor.previous?.lap.elapsed ?? scene.lap.elapsed,
    muted: sound.muted,
    blocked: book.reloadRequired,
  }),
  pause,
  start,
  restart,
  book: () => trackbook.open(),
  edit: applyEdit,
  draft: () => editor.raw.length > 0 || !!editor.candidate || editor.drawing,
  interrupt: () => editor.interrupt(),
  cancelEdit,
  focusEditor: () => editor.focus(),
  sound: toggleSound,
});
el("trackbook-open").onclick = () => menu.openBook();
el("reload").onclick = () => location.reload();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastMotion: Animation | null = null;
function toast(message: string, stamp = false) {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").title = message;
  el("toast").classList.toggle("stamp", stamp);
  toastMotion?.cancel();
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    toastMotion = el("toast").animate(
      [
        { opacity: 0.5, transform: "translateY(-3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 220, easing: "ease-out" },
    );
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
  el("sound").innerHTML = buttonContent(
    sound.muted ? "mute" : "sound",
    sound.muted ? "声音" : "静音",
  );
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
  board.classList.toggle("paused", scene.mode === "paused");
  board.classList.toggle("ready", scene.mode === "ready");
  el<HTMLButtonElement>("pause").disabled =
    scene.mode === "editing" || book.reloadRequired;
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
  if (book.reloadRequired || scene.mode === "editing") return;
  void sound.unlock();
  scene.start();
  uiClock = 0;
  scene.onChange();
  area.focus();
}
el("start").onclick = start;
el("resume").onclick = start;
function pause() {
  scene.keys.clear();
  scene.pause();
  uiClock = 0;
  scene.onChange();
}
function restart() {
  if (book.reloadRequired || scene.mode === "editing") return;
  scene.reset();
  start();
}
// Keep game focus so opening the menu can capture the actual running source.
el("pause").onpointerdown = (event) => {
  if (event.button === 0) event.preventDefault();
};
el("pause").onclick = () => menu.open();
el("restart").onclick = restart;
// Pointer sound toggles keep driving focus; keyboard focus changes still pause.
el("sound").onpointerdown = (event) => {
  if (event.button === 0 && scene.mode === "running") event.preventDefault();
};
function toggleSound() {
  sound.muted = !sound.muted;
  book.save.muted = sound.muted;
  void sound.unlock();
  soundUI();
  const saved = persist();
  if (!saved) toast("本次未能保存，仍可继续试跑");
  if (scene.mode === "running") area.focus();
  return saved;
}
el("sound").onclick = toggleSound;
function editUI(editing: boolean) {
  board.classList.toggle("editing", editing);
  el("editor-footer").hidden = !editing;
  el("editor-status").hidden = !editing;
  document.querySelector<HTMLElement>(".editor-caption")!.hidden = !editing;
  const create = book.intent === "create";
  const name = trackName(activeTrack(book.save));
  el("editor-title").textContent = create ? "新建赛道" : "编辑当前赛道";
  el("editor-target").hidden = create;
  el("editor-track-name").textContent = name;
  el("editor-track-name").title = name;
  el("editor-intent").textContent = create
    ? "将保存为独立赛道，原有赛道保留。"
    : "保存将替换当前赛道路线，取消不会影响原赛道。";
  const action = create ? "保存新赛道" : "保存修改并试跑";
  el("drawing-action").textContent = action;
  el("drive-drawing").title = `${action} (Enter)`;
  el("drive-drawing").setAttribute("aria-label", `${action} (Enter)`);
  uiClock = 0;
  scene.onChange();
}
function applyEdit(intent: EditIntent) {
  const result = book.beginEdit(intent);
  if (!result.ok) return result;
  editor.enter(intent, trackName(activeTrack(book.save)));
  editUI(true);
  editor.focus();
  return result;
}
el("edit").onclick = () => menu.edit("replace");
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
  area.focus({ preventScroll: true });
}
el("cancel-edit").onclick = () => menu.cancelEdit();
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
  menu.editFinished();
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
  if (book.reloadRequired || ignoresShortcuts(e) || menu.state.layer !== "none")
    return;
  const target = shortcutTarget(e.target);
  const inEditor = scene.mode === "editing";
  const action = shortcut(e, scene.mode, target);
  if (action && (inEditor || e.target === area || action === "menu")) {
    e.preventDefault();
    switch (action) {
      case "book":
        menu.openBook();
        break;
      case "edit":
        menu.edit("replace");
        break;
      case "toggle":
        if (scene.mode === "running") pause();
        else start();
        break;
      case "restart":
        restart();
        break;
      case "menu":
        menu.open();
        break;
      case "redraw":
        editor.redraw();
        editor.focus();
        break;
      case "accept":
        driveDrawing();
        break;
      case "cancel":
        menu.cancelEdit();
        break;
    }
    return;
  }
  if (
    e.target === area &&
    scene.mode === "running" &&
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyS",
      "KeyA",
      "KeyD",
    ].includes(e.code)
  ) {
    e.preventDefault();
    if (!e.repeat) scene.keys.add(e.code);
  }
}
const keyup = (e: KeyboardEvent) => scene.keys.delete(e.code);
function loseFocus() {
  menu.invalidate();
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
    menu.invalidate();
    scene.pause();
    uiClock = 0;
    scene.onChange();
  }
}
function pointerFocus() {
  if (scene.mode === "running") area.focus();
}
const resizeMenu = () => menu.invalidate();
window.addEventListener("resize", resizeMenu);
board.addEventListener("keydown", keydown);
window.addEventListener("keyup", keyup);
window.addEventListener("blur", loseFocus);
document.addEventListener("visibilitychange", visibility);
area.addEventListener("blur", areaBlur);
area.addEventListener("pointerdown", pointerFocus);
area.focus({ preventScroll: true });
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
    toastMotion?.cancel();
    menu.destroy();
    window.removeEventListener("resize", resizeMenu);
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
