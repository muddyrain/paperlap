import { localProfile } from "./game/local-profile";
import { LocalEditor } from "./game/local-editor";
import { SaveHistory } from "./game/save-history";
import { GameMotion, type Feedback } from "./game/game-motion";
import Phaser from "phaser";
import { GameMenu } from "./game/game-menu";
import { RaceScene } from "./game/scene";
import { WORLD } from "./game/config";
import { draftSource } from "./game/draft";
import { DraftView } from "./game/draft-ui";
import { TrackEditor } from "./game/editor";
import { activeTrack, recordKey, setBest, type Save } from "./game/save-model";
import {
  SaveSession,
  storageMessage,
  acquireWriter,
  STORAGE_KEY,
  OLD_KEYS,
} from "./game/storage-v3";
import { v3DraftPolicy } from "./game/draft-storage-v3";
import { Sound } from "./game/audio";
import { Trackbook, trackbookMessage, type EditIntent } from "./game/trackbook";
import { TrackbookView, trackName } from "./game/trackbook-ui";
import { formatTime as format } from "./game/time";
import { icon, buttonContent } from "./game/ui";
import {
  shortcut,
  shortcutTarget,
  ignoresShortcuts,
  historyShortcut,
} from "./game/shortcuts";
import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<main class="board" aria-label="纸上飞驰赛车游戏">
 <div id="game" tabindex="0" role="application" aria-label="赛车区域，方向键或 WASD 驾驶"></div>
 <header class="hud"><div class="mode-note paper"><span class="flag">${icon("flag")}</span><div class="mode-copy"><h1><span class="track-label">当前赛道：</span><span id="track-name" tabindex="0"></span></h1><span id="mode-label">自由试跑</span></div></div>
 <div class="timing paper"><div class="current"><span>本圈</span><output id="timer">00:00.00</output></div><div class="best"><span>个人最佳</span><output id="best">--:--.--</output><span class="best-star">☆</span></div></div>
 <div class="editor-caption" hidden><div class="editor-heading"><h2 id="editor-title">新建赛道</h2><span id="editor-target">目标赛道：<strong id="editor-track-name" tabindex="0"></strong></span></div><p id="editor-intent"></p><p id="draft-backup" role="status"></p><div class="editor-history"><button id="undo-drawing" class="paper" disabled></button><button id="redo-drawing" class="paper" disabled></button></div><div id="draw-intro" hidden>按住画一圈 · 起点附近松开 · 自动修圆</div></div>
 <div class="top-actions"><button id="trackbook-open" class="paper" aria-haspopup="dialog" aria-expanded="false" aria-controls="trackbook" aria-keyshortcuts="T" title="赛道本 (T)">${buttonContent("book", "赛道本", "T")}</button><button id="pause" class="paper" aria-keyshortcuts="Escape" aria-haspopup="dialog" aria-controls="game-menu" aria-expanded="false" title="游戏菜单 (Esc)">${buttonContent("pause", "菜单", "Esc")}</button></div></header>
 <div id="lap-status" class="lap-status" role="status"></div><div id="toast" class="toast" role="status"></div>
 <footer class="footer"><div class="controls"><span><kbd>↑</kbd> 加速</span><span><kbd>↓</kbd> 刹车</span><span><kbd>←</kbd><kbd>→</kbd> 转向</span><span class="extra-controls"><kbd>R</kbd> 重来 <span class="control-dot">·</span> <kbd>Esc</kbd> 菜单</span></div><section id="welcome" class="race-note paper" aria-labelledby="ready-title"><h2 id="ready-title">准备试跑</h2><p id="start-hint" class="sr-only">方向键或 WASD 驾驶，按住 ↑ 加速，弯前松油或刹车。</p><button id="start" class="primary" aria-keyshortcuts="Space" title="开始试跑 (Space)" aria-describedby="start-hint">${buttonContent("play", "开始试跑", "Space")}</button></section><section id="pause-panel" class="race-note paper" aria-labelledby="pause-title" hidden><h2 id="pause-title">已暂停</h2><p id="pause-reason" class="sr-only">车辆和计时都已暂停</p><button id="resume" class="primary" aria-keyshortcuts="Space" title="继续试跑 (Space)" aria-describedby="pause-reason">${buttonContent("play", "继续试跑", "Space")}</button></section><div class="bottom-actions"><button id="sound" class="paper" aria-label="开启声音" title="开启声音">${buttonContent("mute", "声音")}</button><button id="local-edit" class="paper" aria-keyshortcuts="L" aria-describedby="storage-state" title="局部调整 (L)">${buttonContent("curve", "局部调整", "L")}</button><button id="edit" class="paper accent" aria-keyshortcuts="E" title="编辑当前赛道 (E)">${buttonContent("edit", "编辑当前", "E")}</button><button id="restart" class="paper" aria-keyshortcuts="R" title="重新开始 (R)">${buttonContent("reset", "重新开始", "R")}</button></div></footer>
 <footer id="editor-footer" class="editor-footer" hidden><button id="cancel-edit" class="paper" aria-keyshortcuts="Escape" title="取消编辑 (Esc)">${icon("close")}取消编辑<kbd class="button-key" aria-hidden="true">Esc</kbd></button><div id="editor-status" class="editor-status" role="status" hidden></div><div><button id="redraw" class="paper" aria-keyshortcuts="R" title="重新绘制 (R)">${icon("reset")}重新绘制<kbd class="button-key" aria-hidden="true">R</kbd></button><button id="drive-drawing" class="primary" aria-keyshortcuts="Enter" title="保存修改并试跑 (Enter)" disabled>${icon("check")}<span id="drawing-action">保存修改并试跑</span><kbd class="button-key" aria-hidden="true">Enter ↵</kbd></button></div></footer>
 <section id="recovery" class="center-note paper" role="alert" hidden><h2>画面加载失败</h2><p>请重新加载以恢复已保存的赛道。</p><button id="reload" class="primary">${buttonContent("reset", "重新加载")}</button></section>
 <div class="page-signature">DRAW A LITTLE. DRIVE A LITTLE.</div>
</main>`;
const scene = new RaceScene();
let backing: Storage | null = null;
try {
  backing = window.localStorage;
} catch {
  /* Read-only fallback below. */
}
const session = new SaveSession(backing, await acquireWriter());
const loaded = session.open();
const save: Save = loaded.save;
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
const motion = new GameMotion(board, (reduced) => {
  scene.reducedMotion = reduced;
  if (reduced) {
    scene.effects?.clear();
    scene.trail = [];
  }
});
const book = new Trackbook(save, {
  uid: () => crypto.randomUUID(),
  check: () => session.check(),
  write: (candidate) => {
    const result =
      candidate.schemaVersion === 3
        ? session.write(candidate)
        : { ok: false as const, error: "invalid-save" as const };
    saveHistory.status(result.ok ? session.error : result.error);
    return result;
  },
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
    local.block();
    board.classList.add("recovering");
    board.querySelectorAll("dialog").forEach((dialog) => dialog.close());
    motion.interrupt();
    el("recovery").hidden = false;
    el("reload").focus();
  },
});
const trackbook = new TrackbookView(
  book,
  board,
  {
    create: () => menu.edit("create"),
    local: () => menu.local(),
    localReason,
    open: () => pause(),
    close: () => menu.bookClosed(),
    beforeSelect: () => motion.capture(scene),
    change: (action, sheet) => {
      updateBest();
      if (action === "select") {
        toast("赛道已切换 · 等待开始试跑");
        motion.sheet(sheet ?? null, "switch");
        motion.emphasize("track-name", el("track-name"), "page");
      } else if (action === "rename") {
        motion.emphasize("track-name", el("track-name"), "page");
      }
    },
  },
  motion,
);
const menu = new GameMenu(
  board,
  area,
  {
    context: () => ({
      mode: scene.mode,
      identity: recordKey(activeTrack(book.save)),
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
    local: applyLocal,
    localReason,
    localEditing: () => local.active,
    draft: () => (local.active ? local.hasDraft : editor.hasDraft),
    memoryOnlyDiscard: () =>
      local.active ? local.memoryOnlyDiscard : drafts.memoryOnlyDiscard,
    interrupt: () => (local.active ? local.interrupt() : editor.interrupt()),
    cancelEdit,
    focusEditor: () => (local.active ? local.focus() : editor.focus()),
    sound: toggleSound,
  },
  motion,
);
const drafts = new DraftView(
  editor,
  board,
  motion,
  () => menu.deferEditing(),
  v3DraftPolicy(() => session.writable),
);
const local = new LocalEditor(scene, book, board, motion, backing, {
  check: () => session.writable && session.check().ok,
  cancel: () => menu.cancelEdit(),
  later: () => menu.deferEditing(),
  saved: (message) => {
    menu.editFinished();
    trackbook.render();
    updateBest();
    uiClock = 0;
    scene.onChange();
    area.focus({ preventScroll: true });
    toast(
      message ?? "局部修改已保存 · 等待开始试跑",
      message ? "notice" : "saved",
    );
  },
});
function localReason() {
  if (book.reloadRequired) return trackbookMessage("reload-required");
  return book.save.schemaVersion !== 3 || !session.writable
    ? storageMessage(session.error ?? "upgrade-required")
    : null;
}
function updateLocalAccess() {
  const reason = localReason();
  el<HTMLButtonElement>("local-edit").disabled = !!reason;
  el("local-edit").title = reason ?? "局部调整 (L)";
  trackbook.updateLocalAccess();
  local.accessChanged(reason);
  el<HTMLButtonElement>("menu-local").disabled = !!reason;
  if (reason && menu.state.layer === "menu")
    el("menu-status").textContent = reason;
}
function applyLocal() {
  const result = book.beginLocal();
  if (!result.ok) {
    toast(trackbookMessage(result.error), "error");
    return result;
  }
  try {
    uiClock = 0;
    local.enter(book.localSource!, activeTrack(book.save).track);
    return result;
  } catch {
    local.cancel(false);
    book.cancelLocal();
    area.focus({ preventScroll: true });
    return { ok: false as const, error: "render" as const };
  }
}
el("local-edit").onclick = () => menu.local();
const saveHistory = new SaveHistory(
  board,
  () => book.save,
  session,
  () => {
    menu.invalidate();
    pause();
  },
  motion,
);
saveHistory.status(session.error);
session.onStatus = () => {
  saveHistory.status(session.error);
  updateLocalAccess();
};
updateLocalAccess();
el("trackbook-open").onclick = () => menu.openBook();
el("reload").onclick = () => location.reload();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, kind: Feedback = "notice") {
  clearTimeout(toastTimer);
  el("toast").textContent = message;
  el("toast").title = message;
  el("toast").classList.toggle("stamp", kind === "record");
  motion.feedback(kind);
  toastTimer = setTimeout(() => (el("toast").textContent = ""), 3000);
}
function persist() {
  return book.persist().ok;
}
function updateBest() {
  const best = book.save.records[recordKey(activeTrack(book.save))];
  el("best").textContent = best ? format(best) : "--:--.--";
  saveHistory.update();
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
  motion.mode(scene.mode, el("lap-status").textContent ?? "");
  sound.update(scene.car.speed, scene.mode === "running");
};
scene.onLap = (time, valid) => {
  const key = recordKey(activeTrack(book.save)),
    best = book.save.records[key];
  if (valid && (!best || time < best)) {
    const result = setBest(book.save, book.save.activeTrackUid, time);
    if (!result.ok) {
      toast("成绩未能保存，仍可继续试跑", "error");
      return;
    }
    const previous = book.save;
    book.save = result.save;
    const persisted = persist();
    if (!persisted) book.save = previous;
    updateBest();
    toast(
      persisted ? `新纪录！ ${format(time)}` : "本次未能保存，仍可继续试跑",
      persisted ? "record" : "error",
    );
    if (persisted) sound.stamp();
  } else
    toast(
      valid ? `完成一圈 · ${format(time)}` : `上圈 ${format(time)} · 未计成绩`,
      valid ? "lap" : "error",
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
  motion.emphasize("restart", document.querySelector(".timing"), "saved");
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
  if (!saved) toast("本次未能保存，仍可继续试跑", "error");
  motion.emphasize("sound", el("sound").querySelector("svg"));
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
  const sheet = motion.capture(scene);
  editor.enter(intent, trackName(activeTrack(book.save)));
  editUI(true);
  editor.focus();
  motion.sheet(sheet, "enter");
  drafts.enter(
    draftSource(book.save, intent),
    trackName(activeTrack(book.save)),
  );
  return result;
}
el("edit").onclick = () => menu.edit("replace");
editor.onStatus = (message, valid, kind) => {
  const changed = el("editor-status").textContent !== message;
  el("editor-status").textContent = message;
  el("editor-status").dataset.kind = kind;
  el<HTMLButtonElement>("drive-drawing").disabled = !valid;
  el("draw-intro").hidden = editor.raw.length > 0;
  if (changed)
    motion.emphasize(
      "drawing-status",
      el("editor-status"),
      kind === "error"
        ? "error"
        : valid || message.startsWith("已回到")
          ? "page"
          : "notice",
    );
  if (valid) motion.emphasize("drawing-save", el("drive-drawing"), "saved");
};
function redraw() {
  const sheet = motion.capture(scene, editor.canvas);
  editor.redraw();
  editor.focus();
  motion.sheet(sheet, "erase");
}
el("redraw").onclick = redraw;
function cancelEdit(discard = true) {
  if (local.active) {
    const cancelled = local.cancel(discard);
    if (cancelled) area.focus({ preventScroll: true });
    uiClock = 0;
    scene.onChange();
    return cancelled;
  }
  if (discard && !drafts.discard()) return false;
  drafts.leave();
  const sheet = motion.capture(scene, editor.canvas);
  editor.cancel();
  book.cancelEdit();
  editUI(false);
  el("draw-intro").hidden = true;
  area.focus({ preventScroll: true });
  motion.sheet(sheet, "return");
}
el("cancel-edit").onclick = () => menu.cancelEdit();
function driveDrawing() {
  if (!editor.candidate) return;
  const create = book.intent === "create";
  const sheet = motion.capture(scene, editor.canvas);
  const result = book.acceptDrawing(editor.candidate);
  if (!result.ok) {
    el("editor-status").textContent = trackbookMessage(result.error);
    el("editor-status").dataset.kind = "error";
    motion.emphasize("drawing-status", el("editor-status"), "error");
    return;
  }
  const cleanupMessage = drafts.saved(result.persisted);
  editor.finish();
  menu.editFinished();
  editUI(false);
  el("draw-intro").hidden = true;
  trackbook.render();
  updateBest();
  if (create) area.focus();
  else start();
  motion.sheet(sheet, "return");
  toast(
    cleanupMessage ??
      (result.persisted
        ? create
          ? "新赛道已保存，点击开始试跑。"
          : "你的赛道，你来破纪录。"
        : "本次未能保存，仍可继续试跑；草稿已保留"),
    result.persisted ? "saved" : "error",
  );
}
el("drive-drawing").onclick = driveDrawing;
function keydown(e: KeyboardEvent) {
  if (book.reloadRequired || menu.state.layer !== "none") return;
  if (local.active) {
    local.handleKey(e);
    return;
  }
  const target = shortcutTarget(e.target);
  const history = historyShortcut(e, scene.mode, target);
  if (history) {
    e.preventDefault();
    drafts.action(history);
    return;
  }
  if (ignoresShortcuts(e)) return;
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
      case "local":
        menu.local();
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
        redraw();
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
  local.interrupt();
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
const checkpointOnExit = () => {
  if (local.active) {
    local.interrupt();
    local.checkpoint();
    return;
  }
  editor.interrupt();
  if (scene.mode === "editing") editor.checkpoint();
};
const releaseSession = () => session.release();
const checkExternal = (event: StorageEvent) => {
  if ([STORAGE_KEY, OLD_KEYS.v1, OLD_KEYS.v2, null].includes(event.key)) {
    session.check();
  }
};
const restoreSession = (event: PageTransitionEvent) => {
  if (event.persisted) location.reload();
};
window.addEventListener("storage", checkExternal);
window.addEventListener("pageshow", restoreSession);
window.addEventListener("pagehide", checkpointOnExit);
window.addEventListener("pagehide", releaseSession);
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
      geometryIdentity:
        "geometryIdentity" in activeTrack(book.save)
          ? (activeTrack(book.save) as import("./game/save-v3").TrackEntry)
              .geometryIdentity
          : null,
      storage: {
        writable: session.writable,
        error: session.error,
        source: loaded.source,
        persisted: loaded.persisted,
      },
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
      local: local.telemetry,
      profile: localProfile(),
      draft: {
        rawLength: editor.raw.length,
        phase: editor.drawing ? "drawing" : editor.history.current.phase,
        valid: !!editor.candidate,
        canUndo: editor.history.canUndo,
        canRedo: editor.history.canRedo,
      },
      motion: { active: motion.active, reduced: motion.reduced },
    }),
  });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    clearTimeout(toastTimer);
    local.checkpoint();
    session.release();
    local.destroy();
    window.removeEventListener("storage", checkExternal);
    window.removeEventListener("pageshow", restoreSession);
    window.removeEventListener("pagehide", releaseSession);
    saveHistory.destroy();
    menu.destroy();
    window.removeEventListener("resize", resizeMenu);
    editor.destroy();
    drafts.destroy();
    window.removeEventListener("pagehide", checkpointOnExit);
    trackbook.destroy();
    motion.destroy();
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
