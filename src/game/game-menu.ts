import type { GameMotion } from "./game-motion";
import { MenuState } from "./menu-state";
import { shortcut, shortcutTarget, ignoresShortcuts } from "./shortcuts";
import { buttonContent } from "./ui";
import { formatTime } from "./time";
import {
  trackbookMessage,
  type CommandResult,
  type EditIntent,
} from "./trackbook";
import type { Mode } from "./scene";

interface Context {
  mode: Mode;
  identity: string;
  name: string;
  elapsed: number;
  muted: boolean;
  blocked: boolean;
}
interface Hooks {
  context: () => Context;
  pause: () => void;
  start: () => void;
  restart: () => void;
  book: () => void;
  edit: (intent: EditIntent) => CommandResult;
  draft: () => boolean;
  interrupt: () => void;
  cancelEdit: () => void;
  focusEditor: () => void;
  sound: () => boolean;
}
export class GameMenu {
  readonly state = new MenuState();
  private dialog: HTMLDialogElement;
  constructor(
    private container: HTMLElement,
    private game: HTMLElement,
    private hooks: Hooks,
    private motion: GameMotion,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.id = "game-menu";
    this.dialog.className = "game-menu paper";
    this.dialog.setAttribute("aria-labelledby", "menu-title");
    this.dialog.innerHTML = `
      <div class="menu-heading"><h2 id="menu-title"></h2><button id="menu-back" class="paper" aria-keyshortcuts="Escape">${buttonContent("close", "关闭", "Esc")}</button></div>
      <div class="menu-context"><span id="menu-track" tabindex="0"></span><span id="menu-time"></span></div>
      <div id="menu-home" class="menu-actions">
        <button id="menu-continue" class="primary" aria-keyshortcuts="Space"></button>
        <button id="menu-restart" class="paper" aria-keyshortcuts="R">${buttonContent("reset", "重新开始", "R")}</button>
        <button id="menu-book" class="paper" aria-keyshortcuts="T">${buttonContent("book", "我的赛道本", "T")}</button>
        <button id="menu-edit" class="paper" aria-keyshortcuts="E">${buttonContent("edit", "编辑当前赛道", "E")}</button>
        <button id="menu-sound" class="paper"></button>
        <button id="menu-controls" class="paper">${buttonContent("help", "操作说明")}</button>
      </div>
      <section id="menu-controls-page" hidden aria-label="操作说明"><dl>
        <dt>驾驶</dt><dd><kbd>↑</kbd> / <kbd>W</kbd> 加速 · <kbd>↓</kbd> / <kbd>S</kbd> 刹车<br><kbd>←</kbd> / <kbd>A</kbd>、<kbd>→</kbd> / <kbd>D</kbd> 转向</dd>
        <dt>游戏区域</dt><dd><kbd>Space</kbd> 开始 / 暂停 / 继续<br><kbd>R</kbd> 重新开始 · <kbd>T</kbd> 赛道本<br><kbd>E</kbd> 编辑当前 · <kbd>Esc</kbd> 游戏菜单</dd>
        <dt>赛道本与绘图</dt><dd><kbd>N</kbd> 新建 · <kbd>↑</kbd><kbd>↓</kbd> 选择焦点 · <kbd>Enter</kbd> 使用赛道<br>绘图：<kbd>Enter</kbd> 保存 · <kbd>R</kbd> 重画 · <kbd>Esc</kbd> 取消 / 确认放弃</dd>
      </dl><p>按钮上的 Enter / Space 为原生操作。切换赛道等待开始；离开窗口会暂停，恢复焦点不会自动继续。</p><button id="controls-back" class="paper" aria-keyshortcuts="Escape">${buttonContent("back", "返回菜单", "Esc")}</button></section>
      <section id="menu-discard" hidden><p>尚未保存本次绘制。放弃后将恢复原赛道、车辆和圈时。</p><div class="menu-actions"><button id="keep-drawing" class="primary" aria-keyshortcuts="Escape">${buttonContent("edit", "继续绘制", "Esc")}</button><button id="discard-drawing" class="paper">${buttonContent("trash", "放弃修改")}</button></div></section>
      <p id="menu-hint"></p><p id="menu-status" role="status"></p>`;
    container.append(this.dialog);
    this.get("menu-back").onclick = () => this.back();
    this.get("menu-continue").onclick = () => this.run("continue");
    this.get("menu-restart").onclick = () => this.run("restart");
    this.get("menu-book").onclick = () => this.openBook();
    this.get("menu-edit").onclick = () => this.edit("replace");
    this.get("menu-sound").onclick = () => {
      if (this.hooks.context().blocked) return;
      const saved = this.hooks.sound();
      this.soundUI();
      this.get("menu-status").textContent = saved
        ? "声音设置已保存。"
        : "声音设置未能保存，本次仍可使用。";
      this.motion.emphasize("menu-sound", this.get("menu-sound"));
    };
    this.get("menu-controls").onclick = () => {
      this.state.controls();
      this.show("controls-back");
    };
    this.get("controls-back").onclick = () => this.back();
    this.get("keep-drawing").onclick = () => this.back();
    this.get("discard-drawing").onclick = () => this.cancelEditing();
    this.dialog.addEventListener("keydown", this.keydown);
    this.dialog.addEventListener("cancel", (event) => event.preventDefault());
    this.dialog.addEventListener("click", (event) => {
      const r = this.dialog.getBoundingClientRect();
      if (
        event.target === this.dialog &&
        (event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom)
      )
        this.back(false);
    });
  }
  private get(id: string) {
    return this.dialog.querySelector<HTMLElement>(`#${id}`)!;
  }
  private hide() {
    this.motion.overlayClose(this.dialog);
    this.dialog.close();
    this.container.classList.remove("menu-open");
    document.getElementById("pause")?.setAttribute("aria-expanded", "false");
  }
  private show(focus = "menu-continue") {
    if (!["menu", "controls", "discard"].includes(this.state.layer)) return;
    if (this.hooks.context().blocked) {
      this.block();
      return;
    }
    const child = this.dialog.open;
    const context = this.hooks.context(),
      layer = this.state.layer;
    this.get("menu-home").hidden = layer !== "menu";
    this.get("menu-controls-page").hidden = layer !== "controls";
    this.get("menu-discard").hidden = layer !== "discard";
    this.get("menu-title").textContent =
      layer === "discard"
        ? "放弃本次修改？"
        : layer === "controls"
          ? "操作说明"
          : context.mode === "ready"
            ? "游戏菜单"
            : "已暂停";
    this.get("menu-track").textContent = context.name;
    this.get("menu-track").title = context.name;
    this.get("menu-time").textContent = `本圈 ${formatTime(context.elapsed)}`;
    this.get("menu-continue").innerHTML = buttonContent(
      "play",
      context.mode === "ready" ? "开始试跑" : "继续游戏",
      "Space",
    );
    this.get("menu-back").innerHTML = buttonContent(
      "back",
      layer === "menu" ? "关闭" : "返回",
      "Esc",
    );
    this.get("menu-status").textContent = "";
    this.get("menu-hint").textContent =
      layer !== "menu"
        ? ""
        : this.state.resumable
          ? "Esc 返回驾驶 · Space 继续游戏"
          : "关闭菜单不会起跑，请显式开始或继续。";
    this.soundUI();
    this.dialog.dataset.layer = layer;
    this.container.classList.add("menu-open");
    if (!this.dialog.open) this.dialog.showModal();
    document.getElementById("pause")?.setAttribute("aria-expanded", "true");
    this.get(focus).focus({ preventScroll: true });
    this.motion.overlayOpen(this.dialog, false, child);
  }
  private soundUI() {
    const muted = this.hooks.context().muted;
    this.get("menu-sound").innerHTML = buttonContent(
      muted ? "mute" : "sound",
      muted ? "声音：关闭" : "声音：开启",
    );
    this.get("menu-sound").setAttribute("aria-pressed", String(!muted));
  }
  open() {
    const context = this.hooks.context();
    if (
      context.blocked ||
      !this.state.open(
        context.mode,
        context.identity,
        document.activeElement === this.game && document.hasFocus(),
      )
    )
      return;
    this.hooks.pause();
    this.show();
  }
  invalidate() {
    this.state.invalidate();
    if (this.state.layer === "menu")
      this.get("menu-hint").textContent =
        "关闭菜单不会起跑，请显式开始或继续。";
  }
  block() {
    this.state.reset();
    this.hide();
  }
  openBook() {
    if (
      this.hooks.context().blocked ||
      this.hooks.context().mode === "editing" ||
      !this.state.openBook()
    )
      return;
    this.hide();
    this.hooks.book();
  }
  bookClosed() {
    if (this.hooks.context().blocked) {
      this.block();
      return false;
    }
    if (this.state.closeBook() === "menu") {
      this.show("menu-book");
      return true;
    }
    return false;
  }
  edit(intent: EditIntent): CommandResult {
    const context = this.hooks.context();
    if (context.blocked) return { ok: false, error: "reload-required" };
    if (context.mode === "editing" || !this.state.beginEdit())
      return { ok: false, error: "editing" };
    this.hide();
    const result = this.hooks.edit(intent);
    if (!result.ok) {
      const route = this.state.cancelEditing();
      if (route === "menu" && !this.hooks.context().blocked) {
        this.show("menu-edit");
        this.get("menu-status").textContent = trackbookMessage(result.error);
      }
    }
    return result;
  }
  cancelEdit() {
    if (this.hooks.context().blocked || this.hooks.context().mode !== "editing")
      return;
    if (this.hooks.draft()) {
      this.hooks.interrupt();
      this.state.confirmDiscard();
      this.show("keep-drawing");
    } else this.cancelEditing();
  }
  private cancelEditing() {
    if (this.hooks.context().blocked || this.hooks.context().mode !== "editing")
      return;
    const route = this.state.cancelEditing();
    this.hide();
    this.hooks.cancelEdit();
    if (route === "menu") this.show("menu-edit");
    else if (route.startsWith("book")) this.hooks.book();
  }
  editFinished() {
    this.state.reset();
    this.hide();
  }
  private run(action: "continue" | "restart") {
    if (this.hooks.context().blocked || this.state.layer !== "menu") return;
    this.state.reset();
    this.hide();
    if (action === "restart") this.hooks.restart();
    else this.hooks.start();
  }
  private back(allowResume = true) {
    if (this.hooks.context().blocked) {
      this.block();
      return;
    }
    if (this.state.layer === "controls") {
      this.state.backControls();
      this.show("menu-controls");
    } else if (this.state.layer === "discard") {
      this.state.keepEditing();
      this.hide();
      this.hooks.focusEditor();
    } else if (this.state.layer === "menu") {
      const context = this.hooks.context();
      const resume = this.state.close({
        ...context,
        focused:
          allowResume &&
          document.hasFocus() &&
          !document.hidden &&
          this.dialog.contains(document.activeElement),
      });
      this.hide();
      this.game.focus({ preventScroll: true });
      if (resume) this.hooks.start();
    }
  }
  private keydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (this.hooks.context().blocked) {
      event.preventDefault();
      this.block();
      return;
    }
    if (ignoresShortcuts(event)) return;
    if (
      event.repeat &&
      ["Enter", "NumpadEnter", "Space", "Escape"].includes(event.code)
    ) {
      event.preventDefault();
      return;
    }
    if (event.code === "Tab") {
      const controls = [
        ...this.dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled),[tabindex='0'],input:not(:disabled)",
        ),
      ].filter((el) => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
      return;
    }
    const action = shortcut(
      event,
      this.state.layer === "menu" ? "menu" : "menu-child",
      shortcutTarget(event.target),
    );
    if (!action) return;
    event.preventDefault();
    if (action === "back") this.back();
    else if (action === "toggle") this.run("continue");
    else if (action === "restart") this.run("restart");
    else if (action === "book") this.openBook();
    else if (action === "edit") this.edit("replace");
  };
  destroy() {
    this.block();
    this.dialog.removeEventListener("keydown", this.keydown);
    this.dialog.remove();
  }
}
