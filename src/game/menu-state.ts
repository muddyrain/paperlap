import type { Mode } from "./scene";
export type MenuLayer = "none" | "menu" | "controls" | "trackbook" | "discard";
export type EditReturn = "game" | "menu" | "book-game" | "book-menu";

// Only overlay navigation lives here. Scene mode, draft and Save remain owned by their controllers.
export class MenuState {
  layer: MenuLayer = "none";
  private resumeIdentity: string | null = null;
  private bookParent: "game" | "menu" = "game";
  private editReturn: EditReturn = "game";
  get resumable() {
    return this.resumeIdentity !== null;
  }
  open(mode: Mode, identity: string, focused: boolean) {
    if (this.layer !== "none" || mode === "editing") return false;
    this.resumeIdentity = mode === "running" && focused ? identity : null;
    this.layer = "menu";
    return true;
  }
  invalidate() {
    this.resumeIdentity = null;
  }
  close(context: { mode: Mode; identity: string; focused: boolean }) {
    if (this.layer !== "menu") return false;
    const resume =
      this.resumeIdentity === context.identity &&
      context.mode === "paused" &&
      context.focused;
    this.reset();
    return resume;
  }
  controls() {
    if (this.layer === "menu") this.layer = "controls";
  }
  backControls() {
    if (this.layer === "controls") this.layer = "menu";
  }
  openBook() {
    if (this.layer !== "none" && this.layer !== "menu") return false;
    this.bookParent = this.layer === "menu" ? "menu" : "game";
    this.invalidate();
    this.layer = "trackbook";
    return true;
  }
  closeBook() {
    if (this.layer !== "trackbook") return "game";
    this.layer = this.bookParent === "menu" ? "menu" : "none";
    return this.bookParent;
  }
  beginEdit() {
    if (!["none", "menu", "trackbook"].includes(this.layer)) return false;
    this.editReturn =
      this.layer === "trackbook"
        ? `book-${this.bookParent}`
        : this.layer === "menu"
          ? "menu"
          : "game";
    this.invalidate();
    this.layer = "none";
    return true;
  }
  confirmDiscard() {
    this.layer = "discard";
  }
  keepEditing() {
    if (this.layer === "discard") this.layer = "none";
  }
  cancelEditing(): EditReturn {
    const route = this.editReturn;
    this.editReturn = "game";
    this.invalidate();
    this.layer = route.startsWith("book")
      ? "trackbook"
      : route === "menu"
        ? "menu"
        : "none";
    if (route.startsWith("book"))
      this.bookParent = route === "book-menu" ? "menu" : "game";
    return route;
  }
  reset() {
    this.layer = "none";
    this.resumeIdentity = null;
    this.bookParent = "game";
    this.editReturn = "game";
  }
}
