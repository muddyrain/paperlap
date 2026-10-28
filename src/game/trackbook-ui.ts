import { legacyLabel } from "./save-history";
import type { GameMotion } from "./game-motion";
import {
  activeTrack,
  recordKey,
  SAVE_LIMITS,
  type TrackEntry,
} from "./save-model";
import { Trackbook, trackbookMessage, type CommandResult } from "./trackbook";
import { shortcut, shortcutTarget, ignoresShortcuts } from "./shortcuts";
import { trackThumbnail } from "./thumbnail";
import { buttonContent } from "./ui";
import { formatTime } from "./time";

export const trackName = (entry: TrackEntry) =>
  entry.track.name.trim() ? entry.track.name : "未命名赛道";
type Operation = "select" | "rename" | "delete";

export class TrackbookView {
  private dialog: HTMLDialogElement;
  private target = "";
  private view: "list" | "rename" | "delete" = "list";
  private returnFocus: HTMLElement | null = null;
  private blockCancel = false;
  constructor(
    private book: Trackbook,
    container: HTMLElement,
    private hooks: {
      create: () => CommandResult;
      local: () => CommandResult;
      localReason: () => string | null;
      beforeSelect: () => HTMLCanvasElement | null;
      change: (action: Operation, sheet?: HTMLCanvasElement | null) => void;
      open: () => void;
      close?: () => boolean;
    },
    private motion: GameMotion,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.id = "trackbook";
    this.dialog.className = "trackbook paper";
    this.dialog.setAttribute("aria-labelledby", "trackbook-title");
    this.dialog.innerHTML = `
      <div class="trackbook-heading"><div><span class="notebook-label">PAPERLAP / 路线收藏</span><h2 id="trackbook-title">我的赛道本</h2></div><button id="trackbook-close" class="paper" aria-keyshortcuts="Escape">${buttonContent("close", "关闭", "Esc")}</button></div>
      <div id="trackbook-list"><div class="trackbook-toolbar"><span id="track-count"></span><button id="new-track" class="primary" aria-keyshortcuts="N" title="新建独立赛道 (N)">${buttonContent("add", "新建赛道", "N")}</button></div><button id="trackbook-local" class="paper" aria-keyshortcuts="L">${buttonContent("curve", "局部调整当前赛道", "L")}</button><p id="trackbook-local-status" role="status"></p><p class="trackbook-hint"><kbd>↑</kbd><kbd>↓</kbd> 选路线 · <kbd>Enter</kbd> 使用 · 切换后等待开始</p><ol id="track-list" aria-label="已保存的赛道"></ol></div>
      <form id="rename-form" hidden><label for="track-name-input">赛道名称（最多 40 个字符）</label><input id="track-name-input" autocomplete="off"><div class="trackbook-actions"><button type="button" data-back class="paper" aria-keyshortcuts="Escape">${buttonContent("back", "取消", "Esc")}</button><button type="submit" id="rename-save" class="primary" aria-keyshortcuts="Enter">${buttonContent("check", "保存名称", "Enter")}</button></div></form>
      <div id="delete-confirm" hidden><h3 id="delete-question"></h3><p>将删除这条赛道及其全部纪录，其他赛道和旧归档保留。</p><div class="trackbook-actions"><button data-back class="paper" id="delete-cancel" aria-keyshortcuts="Escape">${buttonContent("back", "取消", "Esc")}</button><button id="delete-track-confirm" class="primary">${buttonContent("trash", "确认删除")}</button></div></div>
      <p id="trackbook-status" role="status"></p>`;
    container.append(this.dialog);
    this.get("trackbook-close").onclick = () => this.backOrClose();
    this.dialog.addEventListener("keydown", this.keydown);
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!this.blockCancel) this.backOrClose();
    });
    this.dialog.addEventListener("close", () => {
      if (this.dialog.open) return;
      this.settle();
      document
        .getElementById("trackbook-open")
        ?.setAttribute("aria-expanded", "false");
    });
    this.dialog.addEventListener("click", (event) => {
      const r = this.dialog.getBoundingClientRect();
      if (
        event.target === this.dialog &&
        (event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom)
      )
        this.backOrClose();
    });
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-back]")
      .forEach((button) => {
        button.onclick = () => this.backOrClose();
      });
    this.get("new-track").onclick = () => this.create();
    this.get("trackbook-local").onclick = () => this.local();
    this.get<HTMLFormElement>("rename-form").onsubmit = (event) => {
      event.preventDefault();
      this.settle();
      if (
        this.run(
          this.book.rename(
            this.target,
            this.get<HTMLInputElement>("track-name-input").value,
          ),
          "rename",
        )
      )
        this.focusRow(this.target);
    };
    this.get("delete-track-confirm").onclick = () => {
      this.settle();
      if (this.run(this.book.remove(this.target, true), "delete"))
        this.focusRow();
    };
    this.render();
  }
  private get<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  private settle() {
    this.motion.settleOverlay(this.dialog);
  }
  open() {
    if (this.book.reloadRequired || this.book.intent || this.book.localSource)
      return;
    this.settle();
    if (!this.dialog.open) {
      this.returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.hooks.open();
      this.show("list");
      this.render();
      this.dialog.showModal();
      document
        .getElementById("trackbook-open")
        ?.setAttribute("aria-expanded", "true");
      this.motion.overlayOpen(this.dialog, true);
    }
    this.focusRow();
  }
  private finishClose(restore = true) {
    this.settle();
    if (!this.dialog.open) return;
    this.motion.overlayClose(this.dialog, true);
    this.dialog.close();
    if (restore && this.hooks.close?.()) return;
    if (restore && this.returnFocus?.isConnected)
      this.returnFocus.focus({ preventScroll: true });
  }
  private backOrClose() {
    if (this.view !== "list") {
      this.settle();
      this.show("list");
      this.focusRow(this.target);
      return;
    }
    this.finishClose();
  }

  private keydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    this.blockCancel = ignoresShortcuts(event) || event.repeat;
    // Native Enter clicks repeat too, including after a form moves focus to a card.
    if (
      event.repeat &&
      !ignoresShortcuts(event) &&
      ["Enter", "NumpadEnter"].includes(event.code) &&
      ["button", "card"].includes(shortcutTarget(event.target))
    ) {
      event.preventDefault();
      return;
    }
    if (event.code === "Tab" && !ignoresShortcuts(event)) {
      const controls = [
        ...this.dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled)",
        ),
      ].filter((control) => control.getClientRects().length > 0);
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
      this.view === "list" ? "list" : "form",
      shortcutTarget(event.target),
    );
    if (!action) return;
    event.preventDefault();
    if (action === "back") {
      this.backOrClose();
      return;
    }
    this.settle();
    if (action === "new") this.create();
    else if (action === "local") this.local();
    else {
      const buttons = [
        ...this.dialog.querySelectorAll<HTMLButtonElement>(
          '[data-action="select"]',
        ),
      ];
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      buttons[
        (current + (action === "next" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    }
  };
  private show(view: "list" | "rename" | "delete") {
    this.view = view;
    this.get("trackbook-list").hidden = view !== "list";
    this.get("rename-form").hidden = view !== "rename";
    this.get("delete-confirm").hidden = view !== "delete";
    this.get("trackbook-close").innerHTML = buttonContent(
      view === "list" ? "close" : "back",
      view === "list" ? "关闭" : "返回列表",
      "Esc",
    );
    this.get("trackbook-status").textContent = "";
    if (this.dialog.open) this.motion.overlayOpen(this.dialog, true, true);
  }
  private status(message: string, kind: "error" | "success") {
    this.get("trackbook-status").textContent = message;
    this.get("trackbook-status").dataset.kind = kind;
    this.motion.emphasize(
      "book-status",
      this.get("trackbook-status"),
      kind === "error" ? "error" : "saved",
    );
  }
  private create() {
    this.settle();
    if (this.book.save.tracks.length >= SAVE_LIMITS.tracks) {
      this.status(trackbookMessage("track-limit"), "error");
      return;
    }
    this.finishClose(false);
    const result = this.hooks.create();
    if (!result.ok) {
      this.open();
      this.status(trackbookMessage(result.error), "error");
    }
  }
  private local() {
    const reason = this.hooks.localReason();
    if (reason) {
      this.status(reason, "error");
      return;
    }
    this.finishClose(false);
    const result = this.hooks.local();
    if (!result.ok) {
      this.open();
      this.status(trackbookMessage(result.error), "error");
    }
  }
  updateLocalAccess() {
    const reason = this.hooks.localReason();
    this.get<HTMLButtonElement>("trackbook-local").disabled = !!reason;
    this.get("trackbook-local-status").textContent = reason ?? "";
  }
  private run(
    result: CommandResult,
    action: Operation,
    sheet?: HTMLCanvasElement | null,
  ): boolean {
    if (!result.ok) {
      this.status(trackbookMessage(result.error), "error");
      return false;
    }
    if (!result.changed) return true;
    this.render();
    this.show("list");
    this.hooks.change(action, sheet);
    if (action === "select")
      this.motion.emphasize(
        "selected",
        this.dialog.querySelector("[aria-current]"),
        "saved",
      );
    this.status(
      {
        select: "已使用该赛道，关闭赛道本后开始试跑。",
        rename: "名称已保存。",
        delete: "赛道已删除，其他作品已保留。",
      }[action],
      "success",
    );
    return true;
  }
  private focusRow(uid = this.book.save.activeTrackUid) {
    const button =
      this.dialog.querySelector<HTMLButtonElement>(
        `[data-uid="${uid}"] [data-action="select"]`,
      ) ??
      this.dialog.querySelector<HTMLButtonElement>(
        '[aria-current="true"] [data-action="select"]',
      );
    if (this.dialog.open) {
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest" });
    }
  }
  render() {
    this.updateLocalAccess();
    const label = document.getElementById("track-name")!;
    label.textContent = trackName(activeTrack(this.book.save));
    label.title = label.textContent;
    this.get("track-count").textContent =
      `${this.book.save.tracks.length} / ${SAVE_LIMITS.tracks} 条赛道`;
    const list = this.get("track-list"),
      scroll = list.scrollTop;
    list.replaceChildren();
    for (const entry of this.book.save.tracks) {
      const current = entry.uid === this.book.save.activeTrackUid;
      const row = document.createElement("li");
      row.className = "track-card";
      row.dataset.uid = entry.uid;
      if (current) row.setAttribute("aria-current", "true");
      const use = document.createElement("button");
      use.className = "track-use";
      use.dataset.action = "select";
      use.setAttribute("aria-keyshortcuts", "Enter");
      const best = this.book.save.records[recordKey(entry)];
      use.setAttribute(
        "aria-label",
        `${current ? "当前赛道" : "使用赛道"}：${trackName(entry)}，${best ? `个人最佳 ${formatTime(best)}` : "暂无纪录"}`,
      );
      use.title = trackName(entry);
      use.innerHTML = `<span class="track-thumb">${trackThumbnail(entry.track)}</span><span class="track-card-copy"><span class="track-entry-name"></span><span class="track-best"></span><span class="track-legacy"></span><span class="track-choice">${buttonContent(current ? "check" : "arrow", current ? "当前赛道" : "使用赛道", "Enter")}</span></span>`;
      use.querySelector(".track-entry-name")!.textContent = trackName(entry);
      use.querySelector(".track-best")!.textContent = best
        ? `个人最佳 ${formatTime(best)}`
        : "暂无纪录";
      use.querySelector(".track-legacy")!.textContent = legacyLabel(
        this.book.save,
        entry.uid,
      );
      use.onclick = () => {
        this.settle();
        this.target = entry.uid;
        const sheet = current ? null : this.hooks.beforeSelect();
        this.run(this.book.select(entry.uid), "select", sheet);
        this.focusRow(entry.uid);
      };
      row.append(use);
      const actions = document.createElement("div");
      actions.className = "track-card-actions";
      for (const action of ["rename", "delete"] as const) {
        const button = document.createElement("button");
        button.className = "paper";
        button.dataset.action = action;
        button.innerHTML = buttonContent(
          action === "rename" ? "edit" : "trash",
          action === "rename" ? "重命名" : "删除",
        );
        button.onclick = () => {
          this.settle();
          this.target = entry.uid;
          this.show(action);
          if (action === "rename") {
            const input = this.get<HTMLInputElement>("track-name-input");
            input.value = entry.track.name;
            input.focus();
            input.select();
          } else {
            this.get("delete-question").textContent =
              `确定删除“${trackName(entry)}”吗？`;
            this.get("delete-cancel").focus();
          }
        };
        actions.append(button);
      }
      row.append(actions);
      list.append(row);
    }
    list.scrollTop = scroll;
  }
  destroy() {
    this.settle();
    this.dialog.removeEventListener("keydown", this.keydown);
    this.dialog.close();
    this.dialog.remove();
  }
}
