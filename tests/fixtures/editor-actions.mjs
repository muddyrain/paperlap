import assert from "node:assert/strict";

// Legacy editor regressions explicitly discard their draft, then leave a reopened
// direct-entry trackbook. Menu-specific tests verify the intermediate return route.
export async function confirmDiscard(page) {
  if (await page.locator("#discard-drawing").isVisible()) {
    assert.equal(
      await page
        .locator("#keep-drawing")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.locator("#discard-drawing").click();
  }
  if (await page.locator("#trackbook").isVisible()) {
    await page.locator('#trackbook[data-motion="open"]').waitFor();
    await page.locator("#trackbook-close").click();
    await page.locator("#trackbook").waitFor({ state: "hidden" });
  }
}
export async function cancelDrawing(page, via = "Escape") {
  if (via === "button") await page.locator("#cancel-edit").click();
  else await page.keyboard.press("Escape");
  await confirmDiscard(page);
}
