import { activeTrack, type TrackEntry } from "./save";
import { Trackbook, trackbookMessage, type CommandResult } from "./trackbook";

export const trackName = (entry: TrackEntry) =>
  entry.track.name.trim() ? entry.track.name : "未命名赛道";

export class TrackbookView {
  private dialog: HTMLDialogElement;
  private target = "";
  constructor(
    private book: Trackbook,
    container: HTMLElement,
    private hooks: { create: () => CommandResult; change: () => void },
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.id = "trackbook";
    this.dialog.className = "trackbook paper";
    this.dialog.setAttribute("aria-labelledby", "trackbook-title");
    this.dialog.innerHTML = `
      <div class="trackbook-heading"><h2 id="trackbook-title">赛道本</h2><button id="trackbook-close" class="paper">关闭</button></div>
      <div id="trackbook-list"><p>选择赛道后，点击“开始试跑”出发。</p><ol id="track-list"></ol><button id="new-track" class="primary">新建赛道</button></div>
      <form id="rename-form" hidden><label for="track-name-input">赛道名称（最多 40 个字符）</label><input id="track-name-input" autocomplete="off"><div class="trackbook-actions"><button type="button" data-back class="paper">取消</button><button type="submit" id="rename-save" class="primary">保存名称</button></div></form>
      <div id="delete-confirm" hidden><p id="delete-question"></p><p>将删除这条赛道及其全部纪录。</p><div class="trackbook-actions"><button data-back class="paper" id="delete-cancel">取消</button><button id="delete-track-confirm" class="primary">确认删除</button></div></div>
      <p id="trackbook-status" role="status"></p>`;
    container.append(this.dialog);
    this.get("trackbook-close").onclick = () => this.dialog.close();
    this.dialog.addEventListener("keydown", (event) => event.stopPropagation());
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-back]")
      .forEach((button) => {
        button.onclick = () => {
          this.show("list");
          this.focusRow();
        };
      });
    this.get("new-track").onclick = () => {
      // close() restores the opener's focus before the editor takes focus.
      this.dialog.close();
      const result = this.hooks.create();
      if (!result.ok) {
        this.dialog.showModal();
        this.get("trackbook-status").textContent = trackbookMessage(
          result.error,
        );
      }
    };
    this.get<HTMLFormElement>("rename-form").onsubmit = (event) => {
      event.preventDefault();
      if (
        this.run(
          this.book.rename(
            this.target,
            this.get<HTMLInputElement>("track-name-input").value,
          ),
        )
      ) {
        this.show("list");
        this.focusRow();
      }
    };
    this.get("delete-track-confirm").onclick = () => {
      if (this.run(this.book.remove(this.target, true))) {
        this.show("list");
        this.focusRow();
      }
    };
    this.render();
  }
  private get<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>(`#${id}`)!;
  }
  open() {
    this.show("list");
    this.render();
    this.dialog.showModal();
  }
  private show(view: "list" | "rename" | "delete") {
    this.get("trackbook-list").hidden = view !== "list";
    this.get("rename-form").hidden = view !== "rename";
    this.get("delete-confirm").hidden = view !== "delete";
    this.get("trackbook-status").textContent = "";
  }
  private run(result: CommandResult): boolean {
    if (!result.ok) {
      this.get("trackbook-status").textContent = trackbookMessage(result.error);
      return false;
    }
    this.hooks.change();
    this.render();
    return true;
  }
  private focusRow() {
    this.dialog
      .querySelector<HTMLButtonElement>(
        `[data-uid="${this.book.save.activeTrackUid}"] [data-action="select"]`,
      )
      ?.focus();
  }
  render() {
    const label = document.getElementById("track-name")!;
    label.textContent = trackName(activeTrack(this.book.save));
    label.title = label.textContent;
    const list = this.get("track-list");
    list.replaceChildren();
    for (const entry of this.book.save.tracks) {
      const row = document.createElement("li");
      row.dataset.uid = entry.uid;
      if (entry.uid === this.book.save.activeTrackUid)
        row.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.className = "track-entry-name";
      name.textContent = trackName(entry);
      row.append(name);
      for (const [action, label] of [
        [
          "select",
          entry.uid === this.book.save.activeTrackUid ? "当前" : "切换",
        ],
        ["rename", "重命名"],
        ["delete", "删除"],
      ]) {
        const button = document.createElement("button");
        button.className = "paper";
        button.dataset.action = action;
        button.textContent = label;
        button.onclick = () => {
          this.target = entry.uid;
          if (action === "select") {
            this.run(this.book.select(entry.uid));
            this.focusRow();
          } else if (action === "rename") {
            this.show("rename");
            const input = this.get<HTMLInputElement>("track-name-input");
            input.value = entry.track.name;
            input.focus();
            input.select();
          } else {
            this.show("delete");
            this.get("delete-question").textContent =
              `确定删除“${trackName(entry)}”吗？`;
            this.get("delete-cancel").focus();
          }
        };
        row.append(button);
      }
      list.append(row);
    }
  }
  destroy() {
    this.dialog.remove();
  }
}
