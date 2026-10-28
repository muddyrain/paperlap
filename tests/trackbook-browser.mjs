import { cancelDrawing } from "./fixtures/editor-actions.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { wobblyLoop } from "./fixtures/editor-paths.mjs";
import { verifyTrackbookUX } from "./fixtures/trackbook-ux.mjs";

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
const key = "paperlap.save.v3";
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
  await page.locator('#trackbook[data-motion="open"]').waitFor();
}
async function close(page) {
  await page.locator("#trackbook-close").click();
  await page.locator("#trackbook").waitFor({ state: "hidden" });
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
      if (key === "paperlap.save.v3")
        throw new DOMException("injected storage failure", error);
      return set.call(this, key, value);
    };
  }, error);
}
async function restoreWrites(page) {
  await page.evaluate(() => window.restoreTrackbookStorage());
}
async function rename(page, uid, name) {
  await open(page);
  await row(page, uid).locator('[data-action="rename"]').click();
  await page.locator("#track-name-input").fill(name);
  await page.locator("#track-name-input").press("Enter");
  await close(page);
}
async function clearOfRoad(page, selector) {
  const overlaps = await page.evaluate((selector) => {
    const board = document.querySelector(".board").getBoundingClientRect();
    const box = document.querySelector(selector).getBoundingClientRect();
    const x0 = ((box.left - board.left) * 1440) / board.width;
    const x1 = ((box.right - board.left) * 1440) / board.width;
    const y0 = ((box.top - board.top) * 860) / board.height;
    const y1 = ((box.bottom - board.top) * 860) / board.height;
    const distance = (p) =>
      Math.hypot(
        Math.max(x0 - p.x, 0, p.x - x1),
        Math.max(y0 - p.y, 0, p.y - y1),
      );
    return {
      road: window.paperlapDebug.track.points.some(
        (p) => distance(p) < window.paperlapDebug.track.width / 2,
      ),
      car: distance(window.paperlapDebug.car) < 40,
    };
  }, selector);
  assert.deepEqual(
    overlaps,
    { road: false, car: false },
    `${selector} leaves road and car visible`,
  );
}
async function completeLap(page) {
  await page.locator("#start").click();
  const held = new Set();
  const keys = async (wanted) => {
    for (const key of [...held])
      if (!wanted.includes(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    for (const key of wanted)
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
  };
  try {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const s = await state(page);
      if (s.lap.completed >= 1) return;
      const points = s.track.points,
        car = s.car;
      let index = 0,
        distance = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = Math.hypot(car.x - points[i].x, car.y - points[i].y);
        if (d < distance) {
          distance = d;
          index = i;
        }
      }
      const target =
        points[
          (index + Math.max(5, Math.round((car.speed * 0.32) / 8))) %
            points.length
        ];
      const turn = Math.atan2(target.y - car.y, target.x - car.x) - car.angle;
      const angle = Math.atan2(Math.sin(turn), Math.cos(turn));
      const wanted = [];
      if (angle > 0.035) wanted.push("ArrowRight");
      if (angle < -0.035) wanted.push("ArrowLeft");
      if (car.speed < 165) wanted.push("ArrowUp");
      if (car.speed > 180) wanted.push("ArrowDown");
      await keys(wanted);
      await page.waitForTimeout(45);
    }
    assert.fail("keyboard driver must complete a lap");
  } finally {
    await keys([]);
  }
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
    save.records[`${a.uid}:${a.geometryIdentity}:rules-2`] = 24.68;
    save.records[`${b.uid}:${b.geometryIdentity}:rules-2`] = 35;
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
    await page.keyboard.press("Space");
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
    await page.locator("#trackbook").waitFor({ state: "hidden" });
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
    await cancelDrawing(page);
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
    await cancelDrawing(page);
    assert.equal(await read(page), old);
    await open(page);
    await page.locator("#new-track").click();
    await draw(page);
    await page.keyboard.press("r");
    assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
    await draw(page);
    await cancelDrawing(page);
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
      [`${b.uid}:${b.geometryIdentity}:rules-2`]: 35,
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
        await cancelDrawing(page);
        assert.equal(await read(page), old);
        assert.equal((await state(page)).trackId, b.track.id);
        await page.locator("#edit").click();
        await draw(page, wobblyLoop(Math.PI / 2));
        await blockWrites(page, error);
        await page.keyboard.press("Enter");
        assert.equal((await state(page)).mode, "editing");
        assert.equal((await state(page)).activeTrackUid, b.uid);
        assert.equal(await page.locator("#drive-drawing").isEnabled(), true);
        assert.match(
          await page.locator("#editor-status").innerText(),
          /未能保存/,
        );
        assert.equal(await read(page), old);
        await restoreWrites(page);
      }
      check(
        `${error}: select/rename/delete/create failures preserve prior state; create can retry/cancel, V3 replace retains its editable candidate without claiming a save`,
      );
    });

  await isolated(async (page) => {
    await page.evaluate(() =>
      localStorage.setItem("paperlap.save.v3", "{broken"),
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
    assert.equal(await page.locator("#trackbook-list").isVisible(), true);
    await close(page);
    await open(page);
    await page.locator("#new-track").click();
    await draw(page);
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#editor-status").innerText(), /存档损坏/);
    await cancelDrawing(page);
    assert.equal(await read(page), "{broken");
    assert.equal((await state(page)).trackId, original.trackId);
    check(
      "corrupt V3 remains protected through failed rename/create and cancellation",
    );
  });

  await isolated(async (page) => {
    const same = structuredClone(ab);
    same.tracks[1].track = { ...same.tracks[0].track, name: "" };
    same.tracks[1].geometryDigest = same.tracks[0].geometryDigest;
    same.records[
      `${same.tracks[1].uid}:${same.tracks[1].geometryIdentity}:rules-2`
    ] = 32;
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
      geometryIdentity: `g-${(i + 1).toString(16).padStart(32, "0")}`,
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

  for (const stage of ["capture", "prepare", "apply"])
    await isolated(async (page) => {
      await seed(page, ab);
      await open(page);
      const old = await read(page),
        before = await state(page);
      await page.evaluate((stage) => {
        const failCanvasOnce = () => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (...args) {
            const visual = this.classList.contains("motion-sheet");
            if ((stage === "capture") !== visual) return get.apply(this, args);
            HTMLCanvasElement.prototype.getContext = get;
            throw Error("injected canvas failure");
          };
        };
        if (stage !== "apply") failCanvasOnce();
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
      if (stage === "capture") {
        assert.match(
          await page.locator("#trackbook-status").innerText(),
          /已使用/,
        );
        assert.equal((await state(page)).activeTrackUid, ab.tracks[0].uid);
        assert.equal((await state(page)).mode, "ready");
        assert.equal(
          JSON.parse(await read(page)).activeTrackUid,
          ab.tracks[0].uid,
        );
        assert.equal(await page.locator(".motion-sheet").count(), 0);
        await close(page);
      } else if (stage === "prepare") {
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
    const name = "清晨绕湖的纸上飞驰练习赛道".repeat(3).slice(0, 40);
    const a = ab.tracks[0];
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1280, height: 800 },
      { width: 900, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await seed(page, { ...ab, activeTrackUid: a.uid });
      for (const text of ["晨跑", name]) {
        await rename(page, a.uid, text);
        assert.equal(await page.locator("#track-name").innerText(), text);
        assert.equal(
          await page.locator("#track-name").getAttribute("title"),
          text,
        );
        const headline = await page.evaluate(() => {
          const name = document.querySelector("#track-name"),
            mode = document.querySelector("#mode-label");
          const note = name.closest(".mode-note"),
            box = note.getBoundingClientRect(),
            timer = document.querySelector(".timing").getBoundingClientRect();
          return {
            inPaper: note.classList.contains("paper"),
            marked: note.textContent.includes("当前赛道："),
            prominent:
              parseFloat(getComputedStyle(name).fontSize) >
              parseFloat(getComputedStyle(mode).fontSize),
            separated: box.right + 8 < timer.left,
            fits: name.clientWidth <= name.parentElement.clientWidth,
            truncated: name.scrollWidth > name.clientWidth,
          };
        });
        assert.ok(
          headline.inPaper &&
            headline.marked &&
            headline.prominent &&
            headline.separated &&
            headline.fits,
        );
        if (text === name) assert.equal(headline.truncated, true);
      }
      await clearOfRoad(page, ".mode-note");
      await clearOfRoad(page, "#welcome");
      await page.screenshot({ path: `${output}ux-hud-${viewport.width}.png` });
      await drive(page, 0.2);
      await page.keyboard.up("ArrowUp");
      await page.keyboard.press("Space");
      await page.locator("#pause-panel").waitFor({ state: "visible" });
      const paused = await state(page);
      await clearOfRoad(page, "#pause-panel");
      await page.screenshot({
        path: `${output}ux-paused-${viewport.width}.png`,
      });
      assert.deepEqual((await state(page)).car, paused.car);
      assert.deepEqual((await state(page)).lap, paused.lap);

      const saved = await read(page);
      await page.locator("#edit").click();
      assert.equal(
        await page.locator("#editor-title").innerText(),
        "编辑当前赛道",
      );
      assert.equal(await page.locator("#editor-track-name").innerText(), name);
      assert.equal(
        await page.locator("#editor-track-name").getAttribute("title"),
        name,
      );
      assert.match(
        await page.locator("#editor-intent").innerText(),
        /保存将替换当前赛道路线.*取消不会影响原赛道/,
      );
      assert.equal(
        await page.locator("#drive-drawing").getAttribute("aria-label"),
        "保存修改并试跑 (Enter)",
      );
      assert.equal(
        await page.locator("#drive-drawing").getAttribute("title"),
        "保存修改并试跑 (Enter)",
      );
      const label = await page
        .locator(".draw-surface")
        .getAttribute("aria-label");
      assert.ok(
        label.includes(name) &&
          label.includes("Enter 保存修改并试跑") &&
          label.includes("取消不会影响原赛道"),
      );
      assert.equal(
        await page.evaluate(() => {
          const board = document
            .querySelector(".board")
            .getBoundingClientRect();
          return (
            document.querySelector(".editor-caption").getBoundingClientRect()
              .bottom <
            board.top + (board.height * 184) / 860
          );
        }),
        true,
        "all initial guidance stays above the drawing bounds",
      );
      await page.screenshot({ path: `${output}ux-edit-${viewport.width}.png` });
      await draw(page);
      assert.match(
        await page.locator("#editor-status").innerText(),
        /Enter 保存修改并试跑/,
      );
      await page.keyboard.press("r");
      assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
      assert.equal(
        await page.locator("#editor-title").innerText(),
        "编辑当前赛道",
      );
      await cancelDrawing(page);
      assert.equal(await read(page), saved);
      assert.deepEqual((await state(page)).car, paused.car);
      await open(page);
      await page.locator("#new-track").click();
      assert.equal(await page.locator("#editor-title").innerText(), "新建赛道");
      assert.equal(await page.locator("#editor-target").isVisible(), false);
      assert.match(
        await page.locator("#editor-intent").innerText(),
        /独立赛道.*原有赛道保留/,
      );
      assert.equal(
        await page.locator("#drive-drawing").getAttribute("aria-label"),
        "保存新赛道 (Enter)",
      );
      assert.match(
        await page.locator(".draw-surface").getAttribute("aria-label"),
        /新建赛道.*原有赛道保留.*Enter 保存新赛道/,
      );
      await page.screenshot({ path: `${output}ux-new-${viewport.width}.png` });
      await draw(page);
      await page.keyboard.press("Enter");
      assert.equal((await state(page)).mode, "ready");
      assert.match(await page.locator("#toast").innerText(), /新赛道已保存/);
      await clearOfRoad(page, "#toast");
      await clearOfRoad(page, "#welcome");
      await page.screenshot({
        path: `${output}ux-saved-${viewport.width}.png`,
      });
      check(
        `${viewport.width}×${viewport.height}: long/short track HUD, unobstructed pause/notification, explicit create/replace copy and shortcuts`,
      );
    }
  });

  await isolated(async (page) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seed(page, { ...ab, activeTrackUid: ab.tracks[0].uid, records: {} });
    await completeLap(page);
    assert.equal((await state(page)).lap.valid, true);
    assert.match(await page.locator("#toast.stamp").innerText(), /新纪录/);
    await clearOfRoad(page, "#toast");
    await page.screenshot({ path: `${output}ux-record-900.png` });
    check(
      "real keyboard lap celebrates a saved best in a compact notice clear of road and car",
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
      await page.locator('#trackbook[data-motion="open"]').waitFor();
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
      await page.locator("#trackbook").waitFor({ state: "hidden" });
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
  await verifyTrackbookUX({
    isolated,
    ab,
    state,
    read,
    seed,
    open,
    close,
    row,
    draw,
    blockWrites,
    restoreWrites,
    output,
    check,
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
