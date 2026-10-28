import {
  draftMessage,
  DraftStorage,
  type DraftResult,
  type DraftPolicy,
} from "./draft-storage";
import type { DraftCheckpoint, DraftSource } from "./draft";
import type { TrackEditor } from "./editor";
import type { GameMotion } from "./game-motion";
import { buttonContent } from "./ui";

export const historyKeys = () =>
  /Mac|iPhone|iPad/.test(navigator.platform)
    ? { undo: "⌘ Z", redo: "⌘ ⇧ Z", modifier: "Meta" }
    : { undo: "Ctrl Z", redo: "Ctrl Shift Z", modifier: "Control" };

// Owns only draft backup/recovery UI. Trackbook remains the sole official-save
// transaction owner; GameMenu remains the sole editor return-route owner.
export class DraftView {
  private dialog: HTMLDialogElement;
  private storage: DraftStorage | null = null;
  private pending: DraftCheckpoint | null = null;
  private active = false;
  private unconfirmedBackup = false;
  private legacyHint = "";
  get memoryOnlyDiscard() {
    return this.active && this.unconfirmedBackup;
  }
  constructor(
    private editor: TrackEditor,
    private board: HTMLElement,
    private motion: GameMotion,
    private defer: () => void,
    private policy?: DraftPolicy,
  ) {
    const keys = historyKeys();
    for (const [id, label, glyph, key] of [
      ["undo-drawing", "撤销", "undo", keys.undo],
      ["redo-drawing", "重做", "redo", keys.redo],
    ]) {
      const button = document.getElementById(id)! as HTMLButtonElement;
      button.innerHTML = buttonContent(glyph, label, key);
      button.title = `${label} (${key})`;
      button.setAttribute(
        "aria-keyshortcuts",
        `${keys.modifier}+${id.startsWith("redo") ? "Shift+" : ""}Z`,
      );
      button.onclick = () =>
        this.action(id.startsWith("redo") ? "redo" : "undo");
    }
    this.dialog = document.createElement("dialog");
    this.dialog.id = "draft-recovery";
    this.dialog.className = "game-menu paper draft-recovery";
    this.dialog.setAttribute("aria-labelledby", "draft-title");
    this.dialog.setAttribute("aria-describedby", "draft-description");
    this.dialog.innerHTML = `<h2 id="draft-title">找到上次的绘制</h2><p id="draft-description"></p><p id="draft-range"></p><div class="menu-actions"><button id="continue-draft" class="primary">${buttonContent("edit", "继续上次绘制")}</button><button id="discard-draft" class="paper">${buttonContent("trash", "放弃草稿")}</button><button id="defer-draft" class="paper" aria-keyshortcuts="Escape">${buttonContent("back", "暂不处理", "Esc")}</button></div><p id="draft-error" role="status"></p>`;
    board.append(this.dialog);
    this.get("continue-draft").onclick = () => {
      const checkpoint = this.pending;
      this.close();
      if (checkpoint) this.editor.restore(checkpoint);
      this.editor.focus();
    };
    this.get("discard-draft").onclick = () => {
      if (!this.discard()) return;
      // Stay in this empty editor. Only this explicitly chosen source is cleared.
      this.active = true;
      this.close();
      this.editor.focus();
      this.status("已放弃上次草稿，可以重新绘制。", false);
    };
    this.get("defer-draft").onclick = () => this.later();
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.later();
    });
    this.dialog.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.repeat && ["Enter", "Space", "Escape"].includes(e.code)) {
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
    editor.onHistory = () => this.historyUI();
    editor.onCheckpoint = (checkpoint) => {
      if (
        !this.active ||
        this.dialog.open ||
        !(checkpoint.current.raw.length || checkpoint.retained)
      )
        return;
      this.result(
        this.storage?.write(checkpoint) ?? { ok: false, error: "unavailable" },
      );
    };
    this.historyUI();
  }
  private get(id: string) {
    return this.dialog.querySelector<HTMLElement>(`#${id}`)!;
  }
  private historyUI() {
    (document.getElementById("undo-drawing") as HTMLButtonElement).disabled =
      !this.editor.history.canUndo;
    (document.getElementById("redo-drawing") as HTMLButtonElement).disabled =
      !this.editor.history.canRedo;
  }
  private status(message: string, error: boolean) {
    message = this.legacyHint + message;
    const status = document.getElementById("draft-backup")!;
    if (status.textContent !== message) status.textContent = message;
    status.dataset.kind = error ? "error" : "hint";
    if (this.dialog.open)
      this.get("draft-error").textContent = error ? message : "";
  }
  private result(result: DraftResult) {
    this.status(
      result.ok ? "草稿已备份到此浏览器" : draftMessage(result.error),
      !result.ok,
    );
    return result.ok;
  }
  enter(source: DraftSource, name: string) {
    this.active = true;
    this.pending = null;
    let loaded: DraftResult;
    try {
      this.legacyHint =
        this.policy?.version === 2 &&
        window.localStorage.getItem("paperlap.draft.v1") !== null
          ? "旧版整笔草稿原文保留，未自动套用；请在旧版备份后恢复。 "
          : "";
      this.storage = new DraftStorage(window.localStorage, this.policy);
      loaded = this.storage.open(source);
    } catch {
      this.storage = null;
      loaded = { ok: false, error: "unavailable" };
    }
    // An initial failed read established no attributable backup to delete.
    // Only the explicit memory-only discard confirmation may leave it untouched.
    this.unconfirmedBackup = !loaded.ok;
    this.historyUI();
    this.status(
      loaded.ok
        ? "完成一笔后自动备份；R 重画可撤销"
        : draftMessage(loaded.error),
      !loaded.ok,
    );
    if (!loaded.ok || !loaded.checkpoint) return;
    this.pending = loaded.checkpoint;
    this.get("draft-description").textContent =
      source.intent === "create"
        ? `这是从“${name}”开始的新建草稿。继续只恢复预览，原有赛道会保留。`
        : `这是“${name}”的编辑草稿。继续只恢复预览，正式路线和成绩不会改变。`;
    this.get("draft-range").textContent =
      loaded.checkpoint.current.phase === "interrupted"
        ? loaded.checkpoint.retained?.phase === "complete"
          ? "上次绘制中断：不能接着原手势绘制；已保留上一份完整笔迹，继续后按撤销找回。"
          : "上次绘制中断：可查看保留的笔迹，需要重新画一圈，不能接着原手势绘制。"
        : loaded.checkpoint.retained
          ? "上次已清空画布；继续后可用撤销找回保留笔迹。"
          : "恢复后会重新检查路线；确认保存前不会修改正式赛道。";
    this.get("draft-error").textContent = "";
    this.dialog.showModal();
    this.get("continue-draft").focus({ preventScroll: true });
    this.motion.overlayOpen(this.dialog);
  }
  action(action: "undo" | "redo") {
    if (!this.active || this.dialog.open) return;
    this.editor[action]();
    this.motion.emphasize(
      "draft-history",
      document.getElementById(`${action}-drawing`),
      "page",
    );
  }
  discard() {
    if (!this.active) return true;
    if (!this.editor.hasDraft && !this.pending) {
      this.active = false;
      return true;
    }
    // Without a confirmed read session, discard only the local drawing after
    // confirmation; never call clear on an unknown backup.
    if (
      !this.unconfirmedBackup &&
      (!this.storage || !this.result(this.storage.clear()))
    )
      return false;
    this.active = false;
    return true;
  }
  saved(persisted: boolean) {
    const result = persisted && this.storage ? this.storage.clear(true) : null;
    this.active = false;
    this.close();
    return result && !result.ok ? "赛道已保存；旧草稿未能清理，已保留。" : null;
  }
  leave() {
    this.active = false;
    this.close();
  }
  private close() {
    if (this.dialog.open) {
      this.motion.overlayClose(this.dialog);
      this.dialog.close();
    }
    this.pending = null;
  }
  private later() {
    this.leave();
    this.defer();
  }
  destroy() {
    this.leave();
    this.dialog.remove();
  }
}
