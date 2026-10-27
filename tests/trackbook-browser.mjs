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
  new URL("../test-results/trackbook/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const key = "paperlap.save.v2";
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const state = (page) => page.evaluate(() => window.paperlapDebug);
const read = (page) => page.evaluate((key) => localStorage.getItem(key), key);
async function ready(page) {
  await page.goto(`${base}/?debug=1`);
  await page.waitForFunction(
    () => !!window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function isolated(run) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("requestfailed", (r) => failedRequests.push(r.url()));
    await ready(page);
    await run(page);
  } finally {
    await context.close();
  }
}
async function draw(page, points = wobblyLoop()) {
  const r = await page.locator(".draw-surface").boundingBox();
  const at = (p) => ({
    x: r.x + (p.x * r.width) / 1440,
    y: r.y + (p.y * r.height) / 860,
  });
  const first = at(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const s = at(p);
    await page.mouse.move(s.x, s.y);
  }
  await page.mouse.up();
}
const row = (page, uid) => page.locator(`#track-list [data-uid="${uid}"]`);
async function open(page) {
  await page.locator("#trackbook-open").click();
}
async function close(page) {
  await page.locator("#trackbook-close").click();
}
async function select(page, uid) {
  await open(page);
  await row(page, uid).locator('[data-action="select"]').click();
  await close(page);
}
async function seed(page, save) {
  await page.evaluate(
    ({ key, save }) => localStorage.setItem(key, JSON.stringify(save)),
    { key, save },
  );
  await ready(page);
}
async function drive(page, seconds = 0.4) {
  await page.locator("#start").click();
  await page.keyboard.down("ArrowUp");
  const until = (await state(page)).lap.elapsed + seconds;
  await page.waitForFunction(
    (until) => window.paperlapDebug.lap.elapsed >= until,
    until,
    { timeout: 20000, polling: "raf" },
  );
}
async function blockWrites(page, error = "QuotaExceededError") {
  await page.evaluate((error) => {
    const set = Storage.prototype.setItem;
    window.restoreTrackbookStorage = () => {
      Storage.prototype.setItem = set;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "paperlap.save.v2")
        throw new DOMException("injected storage failure", error);
      return set.call(this, key, value);
    };
  }, error);
}
async function restoreWrites(page) {
  await page.evaluate(() => window.restoreTrackbookStorage());
}
let ab;
try {
  await isolated(async (page) => {
    const a = JSON.parse(await read(page)).tracks[0];
    await page.locator("#trackbook-open").click({ timeout: 2000 });
    await page.locator("#new-track").click();
    assert.equal(
      await page.locator("#drive-drawing").getAttribute("title"),
      "保存新赛道 (Enter)",
    );
    assert.match(
      await page.locator(".draw-surface").getAttribute("aria-label"),
      /Enter 保存/,
    );
    await draw(page);
    assert.match(
      await page.locator("#editor-status").innerText(),
      /Enter 保存新赛道/,
    );
    assert.equal(await page.locator("#drive-drawing").isEnabled(), true);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter"); // Holding save must not activate a newly focused Start button.
    await page.keyboard.up("Enter");
    const save = JSON.parse(await read(page));
    assert.equal(save.tracks.length, 2);
    assert.deepEqual(save.tracks[0], a);
    assert.notEqual(save.activeTrackUid, a.uid);
    assert.equal((await state(page)).mode, "ready");
    await ready(page);
    assert.deepEqual(JSON.parse(await read(page)), save);
    ab = save;
    check(
      "real pointer creates B without replacing A; reload retains both UIDs",
    );

    const b = save.tracks[1];
    save.records[`${a.uid}:${a.track.id}:rules-2`] = 24.68;
    save.records[`${b.uid}:${b.track.id}:rules-2`] = 35;
    save.legacyRecords["track-deadbeef:rules-1"] = 40;
    await seed(page, save);
    await page.locator("#sound").click();
    assert.equal((await state(page)).sound.muted, false);
    await drive(page);
    assert.ok((await state(page)).car.speed > 0);
    assert.ok((await state(page)).sound.motorGain > 0.001);
    await open(page);
    const stable = await state(page),
      stableRaw = await read(page);
    await row(page, b.uid).locator('[data-action="select"]').click();
    assert.deepEqual((await state(page)).car, stable.car);
    assert.deepEqual((await state(page)).lap, stable.lap);
    assert.equal(await read(page), stableRaw);
    await close(page);
    await select(page, a.uid); // ArrowUp remains physically held in this page.
    await page.keyboard.up("ArrowUp");
    const aReady = await state(page);
    assert.equal(aReady.activeTrackUid, a.uid);
    assert.equal(aReady.trackId, a.track.id);
    assert.deepEqual(aReady.track.points, a.track.points);
    assert.equal(aReady.mode, "ready");
    assert.equal(aReady.car.speed, 0);
    assert.equal(aReady.lap.elapsed, 0);
    assert.equal(aReady.offroad, false);
    assert.equal(aReady.effects, 0);
    assert.deepEqual(aReady.keys, []);
    assert.equal(aReady.sound.muted, false);
    assert.equal(aReady.sound.running, false);
    assert.equal(await page.locator("#timer").innerText(), "00:00.00");
    assert.equal(await page.locator("#best").innerText(), "00:24.68");
    await page.waitForTimeout(180);
    assert.deepEqual((await state(page)).car, aReady.car);
    await page.waitForFunction(
      () => window.paperlapDebug.sound.motorGain < 0.001,
    );
    await page.locator("#start").click();
    const until = (await state(page)).lap.elapsed + 0.2;
    await page.waitForFunction(
      (until) => window.paperlapDebug.lap.elapsed > until,
      until,
    );
    assert.equal(
      (await state(page)).car.speed,
      0,
      "old held key cannot accelerate after explicit start",
    );
    await page.keyboard.press("Escape");
    for (const uid of [b.uid, a.uid, b.uid]) {
      await select(page, uid);
      assert.equal((await state(page)).mode, "ready");
      assert.equal((await state(page)).activeTrackUid, uid);
      assert.equal(
        await page.locator("#best").innerText(),
        uid === a.uid ? "00:24.68" : "00:35.00",
      );
    }
    await ready(page);
    assert.equal((await state(page)).activeTrackUid, b.uid);
    assert.equal(await page.locator("#best").innerText(), "00:35.00");
    check(
      "running B→A and repeated A/B switches reset scene, lap, effects, keys, motor and HUD; reload restores selection",
    );

    await open(page);
    await row(page, b.uid).locator('[data-action="rename"]').click();
    const input = page.locator("#track-name-input");
    for (const name of ["", "x".repeat(41)]) {
      await input.fill(name);
      await page.locator("#rename-save").click();
      assert.match(
        await page.locator("#trackbook-status").innerText(),
        /名称不能为空.*40/,
      );
    }
    await input.fill("WASD R 我的 B");
    await input.press("r");
    assert.equal((await state(page)).mode, "ready");
    await input.fill("WASD R 我的 B");
    await input.press("Enter");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#trackbook").isVisible(), false);
    const renamed = JSON.parse(await read(page));
    assert.equal(renamed.tracks[1].track.name, "WASD R 我的 B");
    assert.deepEqual(renamed.records, save.records);
    await ready(page);
    assert.equal(
      await page.locator("#track-name").innerText(),
      "WASD R 我的 B",
    );
    check(
      "empty/overlong names fail; text input and Enter/Escape stay isolated; rename persists UID and bests",
    );

    await drive(page, 0.25);
    await page.keyboard.up("ArrowUp");
    await page.locator("#edit").click();
    const paused = await state(page),
      old = await read(page);
    await draw(page);
    await page.keyboard.press("Escape");
    const cancelled = await state(page);
    assert.equal(cancelled.mode, "paused");
    assert.deepEqual(cancelled.car, paused.car);
    assert.deepEqual(cancelled.lap, paused.lap);
    assert.equal(cancelled.trackId, b.track.id);
    assert.equal(await read(page), old);
    await open(page);
    await page.locator("#new-track").click();
    await draw(page, [
      { x: 350, y: 400 },
      { x: 700, y: 400 },
    ]);
    assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
    await page.keyboard.press("Escape");
    assert.equal(await read(page), old);
    await open(page);
    await page.locator("#new-track").click();
    await draw(page);
    await page.keyboard.press("r");
    assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
    await draw(page);
    await page.keyboard.press("Escape");
    assert.equal(await read(page), old);
    check(
      "replace and create cancellation restore car/lap; invalid drafts, R and previews never write",
    );

    await open(page);
    await row(page, a.uid).locator('[data-action="delete"]').click();
    await page.locator("#delete-cancel").click();
    assert.equal(await read(page), old);
    const beforeDelete = await state(page);
    await row(page, a.uid).locator('[data-action="delete"]').click();
    await page.locator("#delete-track-confirm").click();
    const remaining = JSON.parse(await read(page));
    assert.equal(remaining.activeTrackUid, b.uid);
    assert.deepEqual(remaining.records, {
      [`${b.uid}:${b.track.id}:rules-2`]: 35,
    });
    assert.deepEqual(remaining.legacyRecords, save.legacyRecords);
    assert.deepEqual((await state(page)).car, beforeDelete.car);
    assert.deepEqual((await state(page)).lap, beforeDelete.lap);
    await row(page, b.uid).locator('[data-action="delete"]').click();
    await page.locator("#delete-track-confirm").click();
    assert.match(
      await page.locator("#trackbook-status").innerText(),
      /最后一条/,
    );
    await page.keyboard.press("Escape");
    check(
      "deletion requires confirmation; inactive removal preserves scene and other/legacy bests; last track is protected",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    const a = ab.tracks[0],
      b = ab.tracks[1];
    await drive(page);
    await page.keyboard.up("ArrowUp");
    await open(page);
    await row(page, b.uid).locator('[data-action="delete"]').click();
    await page.locator("#delete-track-confirm").click();
    const s = await state(page);
    assert.equal(s.activeTrackUid, a.uid);
    assert.equal(s.mode, "ready");
    assert.equal(s.trackId, a.track.id);
    assert.equal(s.lap.elapsed, 0);
    assert.equal(s.car.speed, 0);
    assert.deepEqual(s.keys, []);
    assert.equal(await page.locator("#best").innerText(), "00:24.68");
    await close(page);
    await ready(page);
    assert.equal((await state(page)).activeTrackUid, a.uid);
    check(
      "confirmed active deletion selects the first remaining track and resets to ready across reload",
    );
  });

  for (const error of ["QuotaExceededError", "SecurityError"])
    await isolated(async (page) => {
      await seed(page, ab);
      const a = ab.tracks[0],
        b = ab.tracks[1],
        old = await read(page);
      await drive(page);
      await page.keyboard.up("ArrowUp");
      await open(page);
      const before = await state(page);
      await blockWrites(page, error);
      await row(page, a.uid).locator('[data-action="select"]').click();
      assert.match(
        await page.locator("#trackbook-status").innerText(),
        /未能保存/,
      );
      assert.equal((await state(page)).activeTrackUid, b.uid);
      assert.deepEqual((await state(page)).car, before.car);
      assert.deepEqual((await state(page)).lap, before.lap);
      assert.equal(await read(page), old);
      await row(page, b.uid).locator('[data-action="rename"]').click();
      await page.locator("#track-name-input").fill("不应保存");
      await page.locator("#rename-save").click();
      assert.match(
        await page.locator("#trackbook-status").innerText(),
        /未能保存/,
      );
      await page.locator("#rename-form [data-back]").click();
      await row(page, b.uid).locator('[data-action="delete"]').click();
      await page.locator("#delete-track-confirm").click();
      assert.match(
        await page.locator("#trackbook-status").innerText(),
        /未能保存/,
      );
      await page.locator("#delete-cancel").click();
      await page.locator("#new-track").click();
      await draw(page);
      await page.keyboard.press("Enter");
      assert.match(
        await page.locator("#editor-status").innerText(),
        /未能保存/,
      );
      assert.equal((await state(page)).mode, "editing");
      assert.equal((await state(page)).activeTrackUid, b.uid);
      assert.equal(await page.locator("#drive-drawing").isEnabled(), true);
      assert.equal(await page.locator("#best").innerText(), "00:35.00");
      assert.equal(await read(page), old);
      await restoreWrites(page);
      if (error === "QuotaExceededError") {
        await page.keyboard.press("Enter");
        assert.equal(JSON.parse(await read(page)).tracks.length, 3);
        assert.equal((await state(page)).mode, "ready");
      } else {
        await page.keyboard.press("Escape");
        assert.equal(await read(page), old);
        assert.equal((await state(page)).trackId, b.track.id);
        await page.locator("#edit").click();
        await draw(page, wobblyLoop(Math.PI / 2));
        await blockWrites(page, error);
        await page.keyboard.press("Enter");
        assert.equal((await state(page)).mode, "running");
        assert.equal((await state(page)).activeTrackUid, b.uid);
        assert.notEqual((await state(page)).trackId, b.track.id);
        assert.match(await page.locator("#toast").innerText(), /未能保存/);
        assert.equal(await read(page), old);
        await restoreWrites(page);
      }
      check(
        `${error}: select/rename/delete/create failures preserve prior state; create can retry/cancel, replace remains playable`,
      );
    });

  await isolated(async (page) => {
    await page.evaluate(() =>
      localStorage.setItem("paperlap.save.v2", "{broken"),
    );
    await ready(page);
    const original = await state(page);
    await open(page);
    await row(page, original.activeTrackUid)
      .locator('[data-action="rename"]')
      .click();
    await page.locator("#track-name-input").fill("损坏不能覆盖");
    await page.locator("#rename-save").click();
    assert.match(
      await page.locator("#trackbook-status").innerText(),
      /存档损坏/,
    );
    await page.keyboard.press("Escape");
    await open(page);
    await page.locator("#new-track").click();
    await draw(page);
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#editor-status").innerText(), /存档损坏/);
    await page.keyboard.press("Escape");
    assert.equal(await read(page), "{broken");
    assert.equal((await state(page)).trackId, original.trackId);
    check(
      "corrupt V2 remains protected through failed rename/create and cancellation",
    );
  });

  await isolated(async (page) => {
    const same = structuredClone(ab);
    same.tracks[1].track = { ...same.tracks[0].track, name: "" };
    same.records[`${same.tracks[1].uid}:${same.tracks[1].track.id}:rules-2`] =
      32;
    await seed(page, same);
    assert.equal(await page.locator("#track-name").innerText(), "未命名赛道");
    assert.equal(JSON.parse(await read(page)).tracks[1].track.name, "");
    assert.equal(await page.locator("#best").innerText(), "00:32.00");
    await select(page, same.tracks[0].uid);
    assert.equal(await page.locator("#best").innerText(), "00:24.68");
    const full = structuredClone(ab);
    full.tracks = Array.from({ length: 20 }, (_, i) => ({
      ...full.tracks[0],
      uid: `entry-${i}`,
    }));
    full.activeTrackUid = "entry-0";
    full.records = {};
    await seed(page, full);
    const old = await read(page);
    await open(page);
    await page.locator("#new-track").click();
    assert.match(await page.locator("#trackbook-status").innerText(), /20/);
    assert.equal((await state(page)).mode, "ready");
    assert.equal(await read(page), old);
    check(
      "same-geometry UIDs retain independent bests; legacy blank name uses display fallback; 20-entry cap preserves all data",
    );
  });

  for (const stage of ["prepare", "apply"])
    await isolated(async (page) => {
      await seed(page, ab);
      await open(page);
      const old = await read(page),
        before = await state(page);
      await page.evaluate((stage) => {
        const failCanvasOnce = () => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (...args) {
            HTMLCanvasElement.prototype.getContext = get;
            throw Error("injected canvas failure");
          };
        };
        if (stage === "prepare") failCanvasOnce();
        else {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            set.call(this, key, value);
            Storage.prototype.setItem = set;
            failCanvasOnce();
          };
        }
      }, stage);
      await row(page, ab.tracks[0].uid)
        .locator('[data-action="select"]')
        .click();
      if (stage === "prepare") {
        assert.match(
          await page.locator("#trackbook-status").innerText(),
          /画面准备失败/,
        );
        assert.equal(await read(page), old);
        assert.equal((await state(page)).activeTrackUid, before.activeTrackUid);
        assert.deepEqual((await state(page)).car, before.car);
        await close(page);
      } else {
        assert.equal(await page.locator("#recovery").isVisible(), true);
        assert.equal(await page.locator("#game canvas").isVisible(), false);
        assert.equal((await state(page)).mode, "paused");
        assert.deepEqual((await state(page)).keys, []);
        assert.equal(
          JSON.parse(await read(page)).activeTrackUid,
          ab.tracks[0].uid,
        );
        await page.locator("#reload").click();
        await page.waitForFunction(
          () => !!window.paperlapDebug && window.paperlapDebug.mode === "ready",
        );
        assert.equal((await state(page)).activeTrackUid, ab.tracks[0].uid);
        assert.equal((await state(page)).trackId, ab.tracks[0].track.id);
      }
      check(
        `${stage} canvas failure: preserves old state before write or blocks broken rendering until reload from durable selection`,
      );
    });

  await isolated(async (page) => {
    await seed(page, ab);
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1280, height: 800 },
      { width: 900, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator("#trackbook-open").focus();
      await page.keyboard.press("Enter");
      for (const selector of [
        "#trackbook-close",
        "#new-track",
        "#track-list button",
      ]) {
        for (const button of await page.locator(selector).all()) {
          const r = await button.boundingBox();
          assert.ok(
            r &&
              r.x >= 0 &&
              r.y >= 0 &&
              r.x + r.width <= viewport.width &&
              r.y + r.height <= viewport.height,
            selector,
          );
        }
      }
      await page.screenshot({ path: `${output}list-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .locator("#trackbook-open")
          .evaluate((el) => el === document.activeElement),
        true,
      );
    }
    check(
      "1366×768, 1280×800, 900×700 controls fit; keyboard opens/closes the dialog and restores focus",
    );
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify({ headless: true, checks, errors, failedRequests }, null, 2),
  );
  await browser.close();
  console.log("Headless trackbook browser and all contexts closed");
}
