import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcut } from "../src/game/shortcuts.ts";

test("game shortcuts are scoped to the surface and match every displayed state", () => {
  for (const mode of ["ready", "running", "paused"] as const) {
    for (const [code, action] of [
      ["KeyT", "book"],
      ["KeyE", "edit"],
      ["Space", "toggle"],
      ["KeyR", "restart"],
    ])
      assert.equal(shortcut({ code }, mode, "surface"), action);
    assert.equal(
      shortcut({ code: "Escape" }, mode, "surface"),
      mode === "running" ? "pause" : null,
    );
    for (const target of ["text", "button"] as const)
      assert.equal(shortcut({ code: "Space" }, mode, target), null);
  }
});

test("text, IME, modifiers and repeated actions cannot cross shortcut contexts", () => {
  for (const state of ["ready", "editing", "list", "form"] as const)
    for (const flag of [
      "ctrlKey",
      "altKey",
      "metaKey",
      "isComposing",
      "repeat",
    ])
      assert.equal(
        shortcut(
          {
            code:
              state === "list" ? "KeyN" : state === "form" ? "Escape" : "KeyR",
            [flag]: true,
          },
          state,
          "surface",
        ),
        null,
      );
  assert.equal(shortcut({ code: "KeyN" }, "list", "text"), null);
  assert.equal(shortcut({ code: "Escape" }, "form", "text"), "back");
  assert.equal(shortcut({ code: "Enter" }, "editing", "button"), null);
  assert.equal(shortcut({ code: "Space" }, "list", "button"), null);
  assert.equal(shortcut({ code: "KeyN" }, "form", "button"), null);
  assert.equal(shortcut({ code: "Enter" }, "editing", "surface"), "accept");
  assert.equal(shortcut({ code: "KeyR" }, "editing", "button"), "redraw");
  assert.equal(
    shortcut({ code: "ArrowDown", repeat: true }, "list", "card"),
    "next",
  );
});
