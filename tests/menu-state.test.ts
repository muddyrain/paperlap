import { test } from "node:test";
import assert from "node:assert/strict";
import { MenuState } from "../src/game/menu-state.ts";

const context = { mode: "paused" as const, identity: "A", focused: true };
test("menu return only resumes its unchanged, focused running session", () => {
  for (const mode of ["ready", "paused", "running"] as const) {
    const s = new MenuState();
    assert.equal(s.open(mode, "A", true), true);
    assert.equal(s.layer, "menu");
    assert.equal(s.close(context), mode === "running");
    assert.equal(s.layer, "none");
    assert.equal(s.close(context), false);
  }
  for (const patch of [
    { identity: "B" },
    { focused: false },
    { mode: "ready" as const },
  ]) {
    const s = new MenuState();
    s.open("running", "A", true);
    assert.equal(s.close({ ...context, ...patch }), false);
  }
  const s = new MenuState();
  s.open("running", "A", false);
  assert.equal(s.close(context), false);
});
test("lifecycle, trackbook and edit revoke resume; controls return one level", () => {
  const s = new MenuState();
  s.open("running", "A", true);
  s.controls();
  assert.equal(s.layer, "controls");
  s.backControls();
  assert.equal(s.layer, "menu");
  s.invalidate();
  assert.equal(s.close(context), false);
  s.open("running", "A", true);
  s.openBook();
  assert.equal(s.layer, "trackbook");
  assert.equal(s.closeBook(), "menu");
  assert.equal(s.close(context), false);
  s.openBook();
  assert.equal(s.closeBook(), "game");
});
test("editing remembers each entry; confirmation and cancel never imply a save or resume", () => {
  for (const route of ["game", "menu", "book-game", "book-menu"] as const) {
    const s = new MenuState();
    if (route === "menu" || route === "book-menu") s.open("paused", "A", true);
    if (route.startsWith("book")) s.openBook();
    s.beginEdit();
    assert.equal(s.layer, "none");
    s.confirmDiscard();
    assert.equal(s.layer, "discard");
    s.keepEditing();
    assert.equal(s.layer, "none");
    s.confirmDiscard();
    assert.equal(s.cancelEditing(), route);
    assert.equal(
      s.layer,
      route.startsWith("book")
        ? "trackbook"
        : route === "menu"
          ? "menu"
          : "none",
    );
    assert.equal(s.close(context), false);
    s.reset();
    assert.equal(s.layer, "none");
  }
});
test("a blocked or duplicate transition cannot replace an active modal", () => {
  const s = new MenuState();
  assert.equal(s.open("editing", "A", true), false);
  s.open("running", "A", true);
  assert.equal(s.open("ready", "B", true), false);
  s.controls();
  assert.equal(s.openBook(), false);
  s.reset();
  assert.equal(s.layer, "none");
  assert.equal(s.close(context), false);
});
