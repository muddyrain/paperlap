import { WORLD } from "./config";
import { paperArt } from "./art";
import {
  LocalEditModel,
  prepareLocalDrag,
  deformLocal,
  type LocalDrag,
} from "./local-edit";
import {
  LocalDraftStorage,
  localDraftMessage,
  type LocalDraftResult,
} from "./local-draft-storage";
import type { LocalSource, LocalCheckpoint } from "./local-source";
import type { Point, Track } from "./geometry";
import type { RaceScene } from "./scene";
import { Trackbook, trackbookMessage } from "./trackbook";
import { GameMotion } from "./game-motion";
import { buttonContent } from "./ui";
import { historyKeys } from "./draft-ui";
import { historyShortcut, ignoresShortcuts, shortcutTarget } from "./shortcuts";
import { renderLocal } from "./local-render";

export class LocalEditor {
  private root = document.createElement("section");
  private dialog = document.createElement("dialog");
  readonly canvas = document.createElement("canvas");
  private c: CanvasRenderingContext2D;
  private paper = paperArt();
  private model: LocalEditModel | null = null;
  private source: LocalSource | null = null;
  private base: Point[] = [];
  private backup: LocalDraftStorage | null = null;
  private recovery: LocalCheckpoint | null = null;
  private unconfirmed = false;
  private accessBlocked = false;
  private wasReady = true;
  private selection: LocalDrag | null = null;
  private visible: Point[] | null = null;
  private drag: {
    pointer: number;
    start: Point;
    latest: Point;
    selection: LocalDrag;
  } | null = null;
  private frame = 0;
  private keys = historyKeys();
  private counters = {
    pointerMoves: 0,
    frames: 0,
    validations: 0,
    adoptions: 0,
    previewMs: [] as number[],
    releaseMs: [] as number[],
  };
  get active() {
    return !this.root.hidden;
  }
  get hasDraft() {
    return (
      !!(
        this.model &&
        (this.model.dirty || this.model.canUndo || this.model.canRedo)
      ) || !!this.recovery
    );
  }
  get memoryOnlyDiscard() {
    return this.active && this.unconfirmed;
  }
  get telemetry() {
    return {
      active: this.active,
      source: this.source ? { ...this.source } : null,
      current: this.model?.current ?? null,
      pending: this.model?.pending ?? null,
      dragging: !!this.drag,
      dirty: this.model?.dirty ?? false,
      canUndo: this.model?.canUndo ?? false,
      canRedo: this.model?.canRedo ?? false,
      metrics: structuredClone(this.counters),
      textureCount: this.scene.textures?.getTextureKeys().length ?? 0,
    };
  }
  constructor(
    private scene: RaceScene,
    private book: Trackbook,
    private board: HTMLElement,
    private motion: GameMotion,
    private store: Storage | null,
    private hooks: {
      check: () => boolean;
      cancel: () => void;
      later: () => void;
      saved: (message: string | null) => void;
    },
  ) {
    const k = this.keys;
    this.root.id = "local-editor";
    this.root.hidden = true;
    this.root.innerHTML = `<header class="local-heading"><div class="local-title"><h2>局部调整</h2><span>目标赛道：<strong id="local-track-name" tabindex="0"></strong></span></div><p>拖动道路调整一个弯道 · 虚线是原路线，黄色是影响范围，灰色起点区受保护</p><p id="local-backup" role="status"></p></header><footer class="local-footer"><p id="local-status" role="status"></p><div class="local-actions"><button id="local-cancel" class="paper" aria-keyshortcuts="Escape">${buttonContent("back", "取消调整", "Esc")}</button><button id="local-undo" class="paper" aria-keyshortcuts="${k.modifier}+Z">${buttonContent("undo", "撤销", k.undo)}</button><button id="local-redo" class="paper" aria-keyshortcuts="${k.modifier}+Shift+Z">${buttonContent("redo", "重做", k.redo)}</button><button id="local-adopt" class="paper" aria-keyshortcuts="Enter">${buttonContent("check", "采用本次调整", "Enter")}</button><button id="local-save" class="primary" aria-keyshortcuts="${k.modifier}+Enter">${buttonContent("check", "保存局部修改", k.modifier === "Meta" ? "⌘ Enter" : "Ctrl Enter")}</button></div></footer>`;
    this.canvas.className = "local-surface";
    this.canvas.width = WORLD.width * 2;
    this.canvas.height = WORLD.height * 2;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute(
      "aria-label",
      "局部调整赛道，在道路上拖动弯道，Enter 采用，Ctrl 或 Cmd Enter 保存，Ctrl 或 Cmd Z 撤销，Esc 取消预览或返回",
    );
    this.c = this.canvas.getContext("2d")!;
    this.c.scale(2, 2);
    this.root.prepend(this.canvas);
    board.append(this.root);
    this.dialog.id = "local-recovery";
    this.dialog.className = "game-menu paper";
    this.dialog.setAttribute("aria-labelledby", "local-recovery-title");
    this.dialog.innerHTML = `<h2 id="local-recovery-title">找到上次的局部调整</h2><p>继续只恢复合法编辑路线，不会覆盖正式赛道或起跑。刷新恢复最近一步撤销/重做，会话内可撤销 24 次。</p><p id="local-recovery-error" role="status"></p><div class="menu-actions"><button id="local-continue" class="primary">${buttonContent("edit", "继续局部调整")}</button><button id="local-discard" class="paper">${buttonContent("trash", "放弃草稿")}</button><button id="local-later" class="paper" aria-keyshortcuts="Escape">${buttonContent("back", "暂不处理", "Esc")}</button></div>`;
    board.append(this.dialog);
    this.get("local-cancel").onclick = () => this.requestCancel();
    this.get("local-adopt").onclick = () => this.adopt();
    this.get("local-save").onclick = () => this.save();
    this.get("local-undo").onclick = () => this.history("undo");
    this.get("local-redo").onclick = () => this.history("redo");
    this.dialog.querySelector<HTMLElement>("#local-continue")!.onclick = () => {
      if (!this.recovery || !this.model) return;
      try {
        this.model.restore(this.recovery);
        this.status("已恢复局部调整；尚未正式保存。");
      } catch {
        this.unconfirmed = true;
        this.backup = null;
        this.status("草稿无法验证，原文保留，本次仅内存调整。", true);
      }
      this.closeRecovery();
      this.refresh();
      this.paint();
      this.focus();
    };
    this.dialog.querySelector<HTMLElement>("#local-discard")!.onclick = () => {
      const result = this.backup?.clear() ?? {
        ok: false as const,
        error: "unavailable" as const,
      };
      if (!this.backupStatus(result)) {
        this.dialog.querySelector("#local-recovery-error")!.textContent =
          localDraftMessage(result);
        return;
      }
      this.closeRecovery();
      this.focus();
    };
    this.dialog.querySelector<HTMLElement>("#local-later")!.onclick = () =>
      this.later();
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.later();
    });
    this.dialog.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (ignoresShortcuts(e)) return;
      if (e.repeat && ["Escape", "Enter", "Space"].includes(e.code)) {
        e.preventDefault();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        this.later();
      }
      if (e.code === "Tab") {
        const buttons = [
          ...this.dialog.querySelectorAll<HTMLButtonElement>("button"),
        ];
        if (
          document.activeElement === (e.shiftKey ? buttons[0] : buttons.at(-1))
        ) {
          e.preventDefault();
          (e.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
        }
      }
    });
    this.canvas.addEventListener("pointerdown", this.down);
    this.canvas.addEventListener("pointermove", this.move);
    this.canvas.addEventListener("pointerup", this.up);
    this.canvas.addEventListener("pointercancel", this.cancelPointer);
    this.canvas.addEventListener("lostpointercapture", this.cancelPointer);
    window.addEventListener("resize", this.resize);
  }
  private get(id: string) {
    return this.root.querySelector<HTMLButtonElement>(`#${id}`)!;
  }
  enter(source: LocalSource, track: Track) {
    this.accessBlocked = false;
    this.source = { ...source };
    this.base = track.points.map((p) => ({ ...p }));
    this.model = new LocalEditModel(this.base);
    this.wasReady = this.scene.mode === "ready";
    this.counters = {
      pointerMoves: 0,
      frames: 0,
      validations: 0,
      adoptions: 0,
      previewMs: [],
      releaseMs: [],
    };
    const sheet = this.motion.capture(this.scene);
    this.scene.keys.clear();
    this.scene.stepper.reset();
    this.scene.mode = "editing";
    this.scene.carSprite.setVisible(false);
    this.scene.roadImage.setVisible(false);
    this.scene.scenery.setVisible(false);
    this.root.hidden = false;
    this.root.inert = false;
    this.board.classList.add("editing", "local-editing");
    const title = this.root.querySelector<HTMLElement>("#local-track-name")!;
    title.textContent = track.name.trim() || "未命名赛道";
    title.title = title.textContent;
    this.backup = this.store
      ? new LocalDraftStorage(this.store, this.hooks.check)
      : null;
    const loaded = this.backup?.open(source, this.base) ?? {
      ok: false as const,
      error: "unavailable" as const,
    };
    this.unconfirmed = !loaded.ok;
    this.backupStatus(loaded);
    if (loaded.ok && !loaded.checkpoint)
      this.root.querySelector("#local-backup")!.textContent =
        "采用后自动备份；刷新可恢复最近一步撤销/重做。";
    if (loaded.ok && loaded.foreign)
      this.root.querySelector("#local-backup")!.textContent =
        "存在其他赛道或修订的旧局部草稿，原文保留，不会套用。";
    this.status("在道路上按住鼠标拖动弯道，松手检查；采用后还需正式保存。");
    this.refresh();
    this.paint();
    this.focus();
    this.scene.onChange();
    this.motion.sheet(sheet, "enter");
    if (loaded.ok && loaded.checkpoint) {
      this.recovery = loaded.checkpoint;
      this.dialog.querySelector("#local-recovery-error")!.textContent = "";
      this.dialog.showModal();
      this.dialog.querySelector<HTMLElement>("#local-continue")!.focus();
      this.motion.overlayOpen(this.dialog);
    }
  }
  focus() {
    this.canvas.focus({ preventScroll: true });
  }
  private status(text: string, error = false) {
    const p = this.root.querySelector<HTMLElement>("#local-status")!;
    p.textContent = text;
    p.dataset.kind = error ? "error" : "hint";
  }
  private backupStatus(result: LocalDraftResult) {
    const p = this.root.querySelector<HTMLElement>("#local-backup")!;
    p.textContent = localDraftMessage(result);
    p.dataset.kind = result.ok ? "hint" : "error";
    return result.ok;
  }
  checkpoint() {
    if (this.active && this.model && !this.recovery && this.hasDraft)
      this.backupStatus(
        this.backup?.write(this.model.checkpoint) ?? {
          ok: false,
          error: "unavailable",
        },
      );
  }
  private refresh() {
    const pending = this.model?.pending;
    this.get("local-adopt").disabled =
      !!this.drag || !pending || !!pending.error;
    this.get("local-save").disabled =
      this.accessBlocked || !!this.drag || !!pending || !this.model?.dirty;
    this.get("local-undo").disabled = !this.model?.canUndo;
    this.get("local-redo").disabled = !this.model?.canRedo;
  }
  private paint() {
    if (!this.model || !this.active) return;
    const pending = this.model.pending;
    renderLocal(
      this.c,
      this.paper,
      this.base,
      this.model.current,
      this.visible ?? pending?.points ?? this.model.current,
      this.selection,
      pending?.error?.point,
      !!pending?.error,
    );
  }
  private position(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * WORLD.width) / r.width,
      y: ((e.clientY - r.top) * WORLD.height) / r.height,
    };
  }
  private down = (e: PointerEvent) => {
    if (
      e.button !== 0 ||
      !this.active ||
      this.book.reloadRequired ||
      this.dialog.open ||
      !this.model ||
      this.drag
    )
      return;
    e.preventDefault();
    this.focus();
    this.motion.stopSheet();
    this.model.cancelPreview();
    const p = this.position(e),
      result = prepareLocalDrag(this.model.current, p);
    if (!result.ok) {
      this.status(result.reason, true);
      this.visible = null;
      this.selection = null;
      this.refresh();
      this.paint();
      return;
    }
    this.selection = result.drag;
    this.drag = {
      pointer: e.pointerId,
      start: p,
      latest: p,
      selection: result.drag,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.visible = this.model.current;
    this.status("正在预览，尚未校验 · 松手检查合法性");
    this.refresh();
    this.paint();
  };
  private preview() {
    if (!this.drag) return;
    const start = performance.now(),
      d = this.drag;
    this.visible = deformLocal(d.selection, {
      x: d.latest.x - d.start.x,
      y: d.latest.y - d.start.y,
    });
    this.paint();
    this.counters.frames++;
    this.counters.previewMs.push(performance.now() - start);
    if (this.counters.previewMs.length > 120) this.counters.previewMs.shift();
  }
  private move = (e: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== e.pointerId) return;
    this.drag.latest = this.position(e);
    this.counters.pointerMoves++;
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.preview();
      });
  };
  private up = (e: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== e.pointerId || !this.model) return;
    this.drag.latest = this.position(e);
    this.preview();
    const candidate = this.visible!,
      start = performance.now();
    this.release();
    this.counters.validations++;
    const error = this.model.preview(candidate);
    this.counters.releaseMs.push(performance.now() - start);
    if (this.counters.releaseMs.length > 120) this.counters.releaseMs.shift();
    this.visible = null;
    this.status(
      error
        ? `不能采用：${error.reason}`
        : "路线合法 · Enter 采用到编辑历史，还不会正式保存。",
      !!error,
    );
    this.refresh();
    this.paint();
  };
  private release() {
    const pointer = this.drag?.pointer;
    this.drag = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
  }
  private cancelPointer = () => {
    if (this.drag) this.interrupt();
  };
  private resize = () => {
    if (this.active) this.interrupt();
  };
  interrupt() {
    if (!this.active) return;
    const pending = !!this.drag || !!this.model?.pending;
    this.release();
    this.model?.cancelPreview();
    this.visible = null;
    this.selection = null;
    if (pending) this.status("本次未采用预览已取消；已采用路线和草稿保留。");
    this.checkpoint();
    this.refresh();
    this.paint();
  }
  private adopt() {
    if (
      !this.active ||
      this.book.reloadRequired ||
      !this.model?.pending ||
      this.model.pending.error
    )
      return;
    if (!this.model.adopt()) {
      this.visible = null;
      this.selection = null;
      this.status("没有几何变化，不会产生新修订或写入。");
      this.refresh();
      this.paint();
      this.focus();
      return;
    }
    this.counters.adoptions++;
    this.selection = null;
    this.visible = null;
    this.checkpoint();
    this.status("已采用到编辑历史，尚未正式保存；可继续调整另一个弯道。");
    this.refresh();
    this.paint();
    this.focus();
    this.motion.emphasize("local-adopt", this.get("local-adopt"), "page");
  }
  private history(action: "undo" | "redo") {
    if (!this.active || this.dialog.open || this.book.reloadRequired) return;
    this.release();
    this.visible = null;
    this.selection = null;
    this.model?.[action]();
    this.checkpoint();
    this.status(
      action === "undo"
        ? "已撤销本次调整；正式赛道不变。"
        : "已重做本次调整；正式赛道不变。",
    );
    this.refresh();
    this.paint();
    this.focus();
  }
  private requestCancel() {
    if (this.drag || this.model?.pending) {
      this.interrupt();
      this.focus();
    } else this.hooks.cancel();
  }
  handleKey(e: KeyboardEvent) {
    if (!this.active) return;
    if (this.book.reloadRequired) {
      e.preventDefault();
      return;
    }
    const target = shortcutTarget(e.target);
    if (
      e.repeat &&
      ["Escape", "Enter", "NumpadEnter", "Space"].includes(e.code)
    ) {
      e.preventDefault();
      return;
    }
    const history = historyShortcut(e, "editing", target);
    if (history) {
      e.preventDefault();
      this.history(history);
      return;
    }
    if (
      !e.repeat &&
      !e.isComposing &&
      !e.altKey &&
      (e.ctrlKey || e.metaKey) &&
      ["Enter", "NumpadEnter"].includes(e.code) &&
      target !== "text"
    ) {
      e.preventDefault();
      this.save();
      return;
    }
    if (ignoresShortcuts(e) || target === "text") return;
    if (e.code === "Escape") {
      e.preventDefault();
      this.requestCancel();
    } else if (
      target === "surface" &&
      ["Enter", "NumpadEnter"].includes(e.code)
    ) {
      e.preventDefault();
      this.adopt();
    }
  }
  save() {
    if (
      !this.active ||
      this.dialog.open ||
      this.drag ||
      this.model?.pending ||
      !this.model?.dirty ||
      !this.source ||
      this.accessBlocked ||
      this.book.reloadRequired
    )
      return;
    const sheet = this.motion.capture(this.scene, this.canvas),
      result = this.book.commitLocal(this.source, this.model.current);
    if (!result.ok) {
      this.status(trackbookMessage(result.error), true);
      if (this.book.reloadRequired) this.root.inert = true;
      this.motion.emphasize(
        "local-error",
        this.root.querySelector("#local-status"),
        "error",
      );
      return;
    }
    if (!result.changed) return;
    const cleanup = this.backup?.confirmed ? this.backup.clear(true) : null;
    const message =
      cleanup && !cleanup.ok
        ? "赛道已保存；局部草稿未能清理，已保留。"
        : this.unconfirmed
          ? "赛道已保存；未知旧局部草稿原文保留。"
          : null;
    this.leave();
    this.scene.restoreCar();
    this.hooks.saved(message);
    this.motion.sheet(sheet, "return");
  }
  cancel(discard = true) {
    if (!this.active) return true;
    if (
      discard &&
      this.hasDraft &&
      !this.unconfirmed &&
      !this.backupStatus(
        this.backup?.clear() ?? { ok: false, error: "unavailable" },
      )
    )
      return false;
    const sheet = this.motion.capture(this.scene, this.canvas);
    this.release();
    this.scene.restoreCar();
    this.scene.mode = this.wasReady ? "ready" : "paused";
    this.book.cancelLocal();
    this.leave();
    this.scene.onChange();
    this.motion.sheet(sheet, "return");
    return true;
  }
  private closeRecovery() {
    this.motion.overlayClose(this.dialog);
    this.dialog.close();
    this.recovery = null;
  }
  private later() {
    this.closeRecovery();
    this.hooks.later();
  }
  private leave() {
    this.release();
    this.closeRecovery();
    this.root.hidden = true;
    this.board.classList.remove("editing", "local-editing");
    this.model = null;
    this.source = null;
    this.backup = null;
    this.selection = null;
    this.visible = null;
  }
  block() {
    if (this.active) {
      this.release();
      this.root.inert = true;
    }
  }
  accessChanged(reason: string | null) {
    if (!this.active || !reason) return;
    this.accessBlocked = true;
    this.status(reason, true);
    this.root.querySelector("#local-backup")!.textContent =
      "停止写入，已有局部草稿保留；当前内存修改请勿刷新。";
    this.refresh();
  }
  destroy() {
    this.release();
    this.dialog.close();
    this.dialog.remove();
    this.root.remove();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.cancelPointer);
    this.canvas.removeEventListener("lostpointercapture", this.cancelPointer);
    window.removeEventListener("resize", this.resize);
  }
}
