import assert from "node:assert/strict";
delete process.env.PWDEBUG;
const { chromium, firefox, webkit } = await import("@playwright/test");
export const engineName = process.env.PAPERLAP_BROWSER || "chromium";
const engines = { chromium, firefox, webkit };
assert.ok(Object.hasOwn(engines, engineName), `Unknown QA engine: ${engineName}`);
export async function launchHeadless() {
  const browser = await engines[engineName].launch({
    headless: true,
    ...(engineName === "chromium" ? { args: ["--mute-audio"] } : {}),
    ...(engineName === "firefox" ? { firefoxUserPrefs: { "media.volume_scale": "0.0" } } : {}),
  });
  assert.equal(browser.browserType().name(), engineName);
  return browser;
}
