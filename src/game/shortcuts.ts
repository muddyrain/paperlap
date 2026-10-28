export type ShortcutScope =
  | "ready"
  | "running"
  | "paused"
  | "editing"
  | "list"
  | "form"
  | "menu"
  | "menu-child";
export type ShortcutTarget = "surface" | "button" | "text" | "card";
type Key = Pick<KeyboardEvent, "code"> &
  Partial<
    Pick<
      KeyboardEvent,
      "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "repeat"
    >
  >;
export function ignoresShortcuts(key: Key) {
  return !!(key.isComposing || key.ctrlKey || key.metaKey || key.altKey);
}
export function shortcut(
  key: Key,
  scope: ShortcutScope,
  target: ShortcutTarget,
): string | null {
  if (ignoresShortcuts(key)) return null;
  const navigation =
    scope === "list" &&
    target === "card" &&
    ["ArrowUp", "ArrowDown"].includes(key.code);
  if (key.repeat && !navigation) return null;
  if (scope === "form" && key.code === "Escape") return "back";
  if (target === "text") return null;
  if (scope === "list") {
    if (key.code === "Escape") return "back";
    if (key.code === "KeyN") return "new";
    if (navigation) return key.code === "ArrowUp" ? "previous" : "next";
    return null; // Enter/Space stay native button activation.
  }
  if (scope === "form") return null;
  if (scope === "menu" || scope === "menu-child") {
    if (key.code === "Escape") return "back";
    if (scope === "menu-child") return null;
    if (key.code === "Space") return target === "surface" ? "toggle" : null;
    return (
      (
        { KeyR: "restart", KeyT: "book", KeyE: "edit" } as Record<
          string,
          string
        >
      )[key.code] ?? null
    );
  }
  if (scope === "editing") {
    if (key.code === "Escape") return "cancel";
    if (key.code === "KeyR") return "redraw";
    if (target === "surface" && ["Enter", "NumpadEnter"].includes(key.code))
      return "accept";
    return null;
  }
  if (key.code === "Escape") return "menu";
  if (target !== "surface") return null;
  return (
    (
      {
        KeyT: "book",
        KeyE: "edit",
        Space: "toggle",
        KeyR: "restart",
      } as Record<string, string>
    )[key.code] ?? null
  );
}

export function shortcutTarget(target: EventTarget | null): ShortcutTarget {
  if (!(target instanceof Element)) return "surface";
  if (target.closest("input,textarea,select,[contenteditable]")) return "text";
  if (target.closest('[data-action="select"]')) return "card";
  return target.closest("button,a") ? "button" : "surface";
}

// Editor history is the only modified-key game command. Native text undo stays
// with the browser, and key repeat/IME must never consume additional snapshots.
export function historyShortcut(
  key: Key & Partial<Pick<KeyboardEvent, "shiftKey">>,
  scope: ShortcutScope,
  target: ShortcutTarget,
): "undo" | "redo" | null {
  if (
    scope !== "editing" ||
    target === "text" ||
    key.isComposing ||
    key.repeat ||
    key.altKey ||
    !(key.ctrlKey || key.metaKey) ||
    key.code !== "KeyZ"
  )
    return null;
  return key.shiftKey ? "redo" : "undo";
}
