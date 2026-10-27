import assert from "node:assert/strict";

export const buttonFocus = (page) =>
  page.evaluate(() => {
    const el = document.activeElement,
      css = getComputedStyle(el),
      pencil = getComputedStyle(el, "::after");
    return {
      id: el.id,
      button: el instanceof HTMLButtonElement,
      input: document.querySelector(".board").dataset.input,
      outline:
        css.outlineStyle !== "none" &&
        parseFloat(css.outlineWidth) > 0 &&
        css.outlineColor !== "rgba(0, 0, 0, 0)",
      mark:
        pencil.content !== "none" &&
        pencil.display !== "none" &&
        parseFloat(pencil.opacity) > 0 &&
        pencil.backgroundColor !== "rgba(0, 0, 0, 0)",
      width: parseFloat(pencil.width),
      height: parseFloat(pencil.height),
      buttonWidth: el.getBoundingClientRect().width,
      clip: pencil.clipPath,
    };
  });
export async function keyboardFocus(page) {
  const r = await buttonFocus(page);
  assert.equal(r.button, true);
  assert.equal(r.input, "keyboard");
  assert.equal(r.outline, false, "keyboard focus must not enclose the button");
  assert.equal(r.mark, true, "keyboard location needs a visible pencil marker");
  assert.ok(
    r.width >= 20 &&
      r.width < r.buttonWidth * 0.7 &&
      r.height > 0 &&
      r.height <= 4,
    JSON.stringify(r),
  );
  assert.notEqual(r.clip, "none");
}
export async function pointerFocus(page) {
  const r = await buttonFocus(page);
  assert.equal(r.button, true);
  assert.equal(r.input, "pointer");
  assert.equal(r.outline, false);
  assert.equal(
    r.mark,
    false,
    "pointer focus must not resemble keyboard or selection",
  );
}
