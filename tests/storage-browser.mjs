import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { wobblyLoop } from "./fixtures/editor-paths.mjs";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = fileURLToPath(
  new URL("../test-results/storage/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const v2key = "paperlap.save.v2",
  v1key = "paperlap.save.v1";
async function ready(page) {
  await page.goto(`${base}/?debug=1`);
  await page.waitForFunction(
    () => !!window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function isolated(run, init) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  try {
    if (init) await context.addInitScript(init.fn, init.arg);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => failedRequests.push(request.url()));
    await ready(page);
    await run(page);
  } finally {
    await context.close();
  }
}
const read = (page, key = v2key) =>
  page.evaluate((key) => localStorage.getItem(key), key);
const seed = (page, key, raw) =>
  page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
let original, track;
try {
  await isolated(async (page) => {
    const initial = JSON.parse(await read(page));
    assert.equal(initial.schemaVersion, 2);
    assert.equal(initial.tracks.length, 1);
    await ready(page);
    assert.deepEqual(JSON.parse(await read(page)), initial);
    check("first launch persists one default entry; reload retains its UID");
    track = { ...initial.tracks[0].track, name: "旧赛道名字" };
    original = JSON.stringify({
      schemaVersion: 1,
      rulesVersion: 1,
      track,
      muted: false,
      records: {
        [`${track.id}:rules-1`]: 24.68,
        [`${track.id}:rules-2`]: 23.45,
        "track-deadbeef:rules-1": 31,
        "track-deadbeef:rules-2": 30,
      },
    });
    await seed(page, v1key, original);
    await page.evaluate((key) => localStorage.removeItem(key), v2key);
    await ready(page);
    const migrated = JSON.parse(await read(page));
    assert.deepEqual(migrated.tracks[0].track, track);
    assert.equal(await page.locator("#best").innerText(), "00:23.45");
    assert.equal(
      await page.locator("#sound").getAttribute("aria-label"),
      "静音",
    );
    assert.equal(
      migrated.records[`${migrated.activeTrackUid}:${track.id}:rules-1`],
      24.68,
    );
    assert.deepEqual(migrated.legacyRecords, {
      "track-deadbeef:rules-1": 31,
      "track-deadbeef:rules-2": 30,
    });
    await ready(page);
    assert.deepEqual(JSON.parse(await read(page)), migrated);
    await page.locator("#sound").click();
    assert.equal(JSON.parse(await read(page)).muted, true);
    assert.equal(await read(page, v1key), original);
    check(
      "V1 migrates both rules, name, geometry, orphans and sound; V1 bytes remain unchanged",
    );

    await page.locator("#edit").click();
    const rect = await page.locator(".draw-surface").boundingBox();
    const points = wobblyLoop();
    const screen = (p) => ({
      x: rect.x + (p.x / 1440) * rect.width,
      y: rect.y + (p.y / 860) * rect.height,
    });
    const first = screen(points[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of points.slice(1)) {
      const s = screen(p);
      await page.mouse.move(s.x, s.y);
    }
    await page.mouse.up();
    assert.equal(await page.locator("#drive-drawing").isEnabled(), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#best").innerText(), "--:--.--");
    const edited = JSON.parse(await read(page));
    assert.equal(edited.activeTrackUid, migrated.activeTrackUid);
    assert.equal(edited.tracks[0].track.name, track.name);
    assert.notEqual(edited.tracks[0].track.id, track.id);
    assert.deepEqual(edited.records, migrated.records);
    assert.deepEqual(edited.legacyRecords, migrated.legacyRecords);
    await page.keyboard.press("Space");
    await ready(page);
    assert.equal(await page.locator("#best").innerText(), "--:--.--");
    assert.equal(await read(page, v1key), original);
    await page.screenshot({ path: `${output}edited-v2.png` });
    check(
      "real editing retains UID, name and historical records; new geometry starts without a best",
    );

    const a = migrated.tracks[0],
      b = { uid: "entry-b", track: { ...track, name: "同路线第二份" } };
    const multiple = {
      ...migrated,
      tracks: [a, b],
      activeTrackUid: b.uid,
      records: { ...migrated.records, [`${b.uid}:${track.id}:rules-2`]: 35 },
    };
    await seed(page, v2key, JSON.stringify(multiple));
    await ready(page);
    assert.equal(await page.locator("#best").innerText(), "00:35.00");
    multiple.activeTrackUid = a.uid;
    multiple.tracks[0].track.name = "改名仍有成绩";
    await seed(page, v2key, JSON.stringify(multiple));
    await ready(page);
    assert.equal(await page.locator("#best").innerText(), "00:23.45");
    assert.equal(JSON.parse(await read(page)).tracks.length, 2);
    check(
      "persisted same-geometry entries show independent bests; switching and rename retain both",
    );

    await seed(page, v2key, "{corrupt-v2");
    await ready(page);
    assert.equal(await page.locator("#best").innerText(), "00:23.45");
    await page.locator("#sound").click();
    assert.match(await page.locator("#toast").innerText(), /未能保存/);
    assert.equal(await read(page), "{corrupt-v2");
    assert.equal(await read(page, v1key), original);
    check(
      "corrupt V2 plays valid V1 fallback while refusing writes to either original key",
    );
  });

  await isolated(
    async (page) => {
      assert.equal(await page.locator("#best").innerText(), "00:23.45");
      assert.equal(await read(page), null);
      await page.locator("#sound").click();
      assert.match(await page.locator("#toast").innerText(), /未能保存/);
      await ready(page);
      assert.equal(await read(page), null);
      assert.equal(await read(page, v1key), original);
      assert.equal(await page.locator("#best").innerText(), "00:23.45");
      check(
        "QuotaExceededError preserves V1 and loaded records across retry/reload",
      );
    },
    {
      fn: (original) => {
        localStorage.setItem("paperlap.save.v1", original);
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "paperlap.save.v2")
            throw new DOMException("full", "QuotaExceededError");
          return set.call(this, key, value);
        };
      },
      arg: original,
    },
  );

  await isolated(
    async (page) => {
      assert.equal(await page.locator("#start").isVisible(), true);
      await page.locator("#start").click();
      const until =
        (await page.evaluate(() => window.paperlapDebug)).lap.elapsed + 0.3;
      await page.keyboard.down("ArrowUp");
      await page.waitForFunction(
        (until) => window.paperlapDebug.lap.elapsed >= until,
        until,
        { timeout: 20000, polling: "raf" },
      );
      await page.keyboard.up("ArrowUp");
      assert.ok(
        (await page.evaluate(() => window.paperlapDebug)).car.speed > 0,
      );
      await page.keyboard.press("Space");
      await page.locator("#sound").click();
      assert.match(await page.locator("#toast").innerText(), /未能保存/);
      check(
        "blocked storage retains playable driving/pause and visible save failure feedback",
      );
    },
    {
      fn: () => {
        Storage.prototype.getItem = () => {
          throw new DOMException("blocked", "SecurityError");
        };
        Storage.prototype.setItem = () => {
          throw new DOMException("blocked", "SecurityError");
        };
      },
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify({ headless: true, checks, errors, failedRequests }, null, 2),
  );
  await browser.close();
  console.log("Headless storage browser and all contexts closed");
}
