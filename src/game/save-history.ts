import type { Save } from "./save-model";
import type { SaveSession, StorageError } from "./storage-v3";
import { storageMessage } from "./storage-v3";
import { recordKey } from "./save-model";
import { formatTime } from "./time";
import { buttonContent } from "./ui";
import type { GameMotion } from "./game-motion";
export function legacyTimes(save: Save, uid: string): number[] {
  return save.schemaVersion === 3
    ? Object.entries(save.legacy.records)
        .filter(([k]) => k.startsWith(`${uid}:`))
        .map(([, v]) => v)
    : [];
}
export function legacyLabel(save: Save, uid: string): string {
  const times = legacyTimes(save, uid);
  return times.length
    ? `旧纪录（未验证）${formatTime(Math.min(...times))}`
    : "";
}
export class SaveHistory {
  private dialog = document.createElement("dialog");
  private badge = document.createElement("button");
  private entry = document.createElement("button");
  private returnFocus: HTMLButtonElement | null = null;
  private error: StorageError | null = null;
  private localNotice: string | null = null;
  constructor(
    private board: HTMLElement,
    private save: () => Save,
    private session: SaveSession,
    private pause: () => void,
    private motion: GameMotion,
  ) {
    this.dialog.id = "save-history";
    this.dialog.className = "game-menu paper save-history";
    this.dialog.setAttribute("aria-labelledby", "save-history-title");
    this.dialog.innerHTML = `<h2 id="save-history-title">纪录历史与存档</h2><p id="save-state-description" role="status"></p><section id="local-cleanup-notice" class="local-cleanup-notice" hidden><p id="local-cleanup-description" role="status"></p><button id="acknowledge-local-notice" class="paper">${buttonContent("check", "已知晓，保留旧草稿")}</button></section><p>旧纪录（旧几何身份，未验证）已完整保留，不与当前个人最佳比较。不同规则与孤立归档在下方逐项列出。</p><p>V1/V2 是升级前备份，旧版不会看到 V3 新作品。恢复前请导出所有键并关闭其他标签；本游戏不会自动删除或覆盖旧键、损坏原文。</p><div class="history-actions"><button id="history-close" class="paper" aria-keyshortcuts="Escape">${buttonContent("back", "返回", "Esc")}</button><button id="export-save" class="paper">${buttonContent("book", "导出全部存档备份")}</button><button id="retry-save" class="paper">${buttonContent("reset", "重新加载 / 重试升级")}</button></div><p id="backup-error" role="status"></p><ol id="record-history-list"></ol>`;
    this.board.append(this.dialog);
    this.badge.id = "storage-state";
    this.badge.className = "storage-state";
    this.badge.setAttribute("aria-haspopup", "dialog");
    this.badge.onclick = () => this.open(this.badge);
    document.querySelector(".mode-copy")!.append(this.badge);
    this.entry.id = "record-history-open";
    this.entry.className = "record-history-open";
    this.entry.setAttribute("aria-haspopup", "dialog");
    this.entry.onclick = () => this.open(this.entry);
    document.querySelector(".timing")!.append(this.entry);
    this.get("history-close").onclick = () => this.close();
    this.get("acknowledge-local-notice").onclick = () => {
      // Acknowledgement only dismisses this session's UI notice, never storage.
      this.localNotice = null;
      this.update();
      if (this.returnFocus === this.badge && this.badge.hidden)
        this.returnFocus = this.entry;
      this.get("history-close").focus({ preventScroll: true });
    };
    this.get("retry-save").onclick = () => location.reload();
    this.get("export-save").onclick = () => {
      try {
        const url = URL.createObjectURL(
          new Blob([this.session.backup()], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "paperlap-all-saves.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.get("backup-error").textContent =
          "已生成备份文件；请妥善保留，恢复前先核对内容。";
      } catch {
        this.get("backup-error").textContent =
          "浏览器拒绝读取，未能导出；没有删除任何数据。请先恢复存储权限。";
      }
    };
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.code === "Escape") {
        e.preventDefault();
        if (
          !e.isComposing &&
          !e.repeat &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        )
          this.close();
      }
    });
    this.update();
  }
  private get(id: string) {
    return this.dialog.querySelector<HTMLElement>(`#${id}`)!;
  }
  status(error: StorageError | null) {
    this.error = error;
    this.update();
  }
  localDraftNotice(message: string) {
    this.localNotice = message;
    this.update();
  }
  update() {
    const save = this.save(),
      text = legacyLabel(save, save.activeTrackUid);
    this.entry.textContent = text || "纪录历史 / 备份";
    this.entry.title = "查看全部旧纪录（旧几何身份，未验证）及存档备份";
    this.badge.hidden = !this.error && !this.localNotice;
    this.badge.textContent = this.error
      ? "存档未保存或只读 · 查看说明"
      : "赛道已保存 · 旧草稿保留";
    this.badge.title = this.error
      ? storageMessage(this.error)
      : (this.localNotice ?? "");
    if (this.dialog.open) this.render();
  }
  private render() {
    const save = this.save();
    this.get("save-state-description").textContent = storageMessage(this.error);
    this.get("local-cleanup-notice").hidden = !this.localNotice;
    this.get("local-cleanup-description").textContent = this.localNotice ?? "";
    const list = this.get("record-history-list");
    list.replaceChildren();
    const row = (title: string, key: string, value: number) => {
      const li = document.createElement("li"),
        label = document.createElement("strong"),
        detail = document.createElement("small");
      label.textContent = `${title} · ${formatTime(value)}`;
      detail.textContent = key;
      li.append(label, detail);
      list.append(li);
    };
    if (save.schemaVersion === 3) {
      for (const [key, time] of Object.entries(save.legacy.records)) {
        const uid = key.slice(0, key.indexOf(":")),
          name = save.legacy.tracks.find((e) => e.uid === uid)?.name || uid;
        const originalKey =
          save.legacy.source === "v1" ? key.slice(key.indexOf(":") + 1) : key;
        row(
          `旧纪录（旧几何身份，未验证）· ${name} · 来源 ${save.legacy.source.toUpperCase()}`,
          originalKey,
          time,
        );
      }
      for (const [key, time] of Object.entries(save.legacyRecords))
        row(
          `旧孤立归档（未验证）· 来源 ${save.legacy.source.toUpperCase()}`,
          key,
          time,
        );
      for (const [key, time] of Object.entries(save.records)) {
        const current = save.tracks.some((e) => recordKey(e) === key);
        row(
          current
            ? "当前身份个人最佳"
            : "已保存修订的历史成绩（非当前个人最佳）",
          key,
          time,
        );
      }
    }
    if (!list.childElementCount)
      list.textContent =
        "暂无历史纪录。完成有效圈后，个人最佳会按当前几何身份独立记录。";
  }
  private open(trigger: HTMLButtonElement) {
    // WebKit pointer clicks can leave activeElement on BODY instead of the invoker.
    this.returnFocus = trigger;
    this.pause();
    this.render();
    this.dialog.showModal();
    this.motion.overlayOpen(this.dialog);
    this.get("history-close").focus({ preventScroll: true });
  }
  private close() {
    this.motion.overlayClose(this.dialog);
    this.dialog.close();
    const target = this.returnFocus;
    (target?.isConnected && !target.disabled && target.getClientRects().length
      ? target
      : this.entry
    ).focus({ preventScroll: true });
  }
  destroy() {
    this.dialog.close();
    this.dialog.remove();
    this.badge.remove();
    this.entry.remove();
  }
}
