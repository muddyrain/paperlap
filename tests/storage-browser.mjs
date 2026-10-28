import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { wobblyLoop } from "./fixtures/editor-paths.mjs";
delete process.env.PWDEBUG;
const fixture = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
import {freshSave,recordKey,addTrack} from './src/game/save.ts';
import {migrateSave} from './src/game/save-v3.ts';import {storageTextDigest} from './src/game/geometry-identity.ts';
let s=freshSave();s.muted=false;s.tracks[0].track.name='升级前的弯道';s.records[recordKey(s.tracks[0])]=24.68;s.records[recordKey(s.tracks[0],1)]=20.12;s.records[s.activeTrackUid+':track-beef:rules-2']=27;s.legacyRecords['track-dead:rules-1']=31;
const b=addTrack(s,s.tracks[0].track,'second');if(!b.ok)throw Error(b.error);s=b.save;s.activeTrackUid=s.tracks[0].uid;
const v2=JSON.stringify(s),v1=JSON.stringify({schemaVersion:1,rulesVersion:1,muted:false,track:s.tracks[0].track,records:{[s.tracks[0].track.id+':rules-1']:22.5,'track-beef:rules-2':30}});
const migrated=migrateSave(s,'v2',{v1:null,v2:storageTextDigest(v2)});if(!migrated.ok)throw Error(migrated.error);
console.log(JSON.stringify({v1,v2,v3:migrated.save}));
`,
    ],
    { encoding: "utf8" },
  ),
);
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173",
  output = "test-results/storage";
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const state = (p) => p.evaluate(() => window.paperlapDebug);
const raw = (p, key = "paperlap.save.v3") =>
  p.evaluate((k) => localStorage.getItem(k), key);
const read = async (p) => JSON.parse(await raw(p));
async function load(p) {
  await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function isolated(
  run,
  seed = {},
  viewport = { width: 1366, height: 768 },
) {
  const c = await browser.newContext({ viewport });
  try {
    await c.addInitScript((seed) => {
      if (!/^https?:$/.test(location.protocol)) return;
      if (!sessionStorage.getItem("seeded")) {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        sessionStorage.setItem("seeded", "1");
      }
    }, seed);
    c.on("page", (p) => {
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      p.on("requestfailed", (r) => failedRequests.push(r.url()));
    });
    const p = await c.newPage();
    await load(p);
    await run(p, c);
  } finally {
    await c.close();
  }
}
async function draw(p) {
  const r = await p.locator(".draw-surface").boundingBox(),
    at = (q) => ({
      x: r.x + (q.x * r.width) / 1440,
      y: r.y + (q.y * r.height) / 860,
    }),
    first = at(wobblyLoop()[0]);
  await p.mouse.move(first.x, first.y);
  await p.mouse.down();
  for (const q of wobblyLoop().slice(1)) {
    const a = at(q);
    await p.mouse.move(a.x, a.y);
  }
  await p.mouse.up();
}
try {
  await isolated(async (p) => {
    const s = await read(p);
    assert.equal(s.schemaVersion, 3);
    const id = s.tracks[0].geometryIdentity;
    await load(p);
    assert.equal((await read(p)).tracks[0].geometryIdentity, id);
    assert.equal(await raw(p, "paperlap.save.v2"), null);
    check(
      "first launch writes only V3 and stable default identity survives reload",
    );
  });
  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
    [900, 700],
  ])
    await isolated(
      async (p) => {
        const s = await read(p),
          old = JSON.parse(fixture.v2);
        assert.equal((await state(p)).storage.writable, true);
        assert.deepEqual(s.legacy.records, old.records);
        assert.deepEqual(s.legacyRecords, old.legacyRecords);
        assert.deepEqual(
          s.tracks.map(({ uid, track }) => ({ uid, track })),
          old.tracks,
        );
        assert.equal(await p.locator("#best").innerText(), "--:--.--");
        assert.match(
          await p.locator("#record-history-open").innerText(),
          /旧纪录.*未验证/,
        );
        await p.screenshot({ path: `${output}/v3-hud-${width}.png` });
        await p.locator("#record-history-open").click();
        assert.match(
          await p.locator("#record-history-list").innerText(),
          /00:24.68/,
        );
        assert.match(
          await p.locator("#record-history-list").innerText(),
          /00:31.00/,
        );
        assert.match(
          await p.locator("#record-history-list").innerText(),
          /rules-1/,
        );
        await p.screenshot({ path: `${output}/v3-history-${width}.png` });
        if (width === 1366) {
          const [download] = await Promise.all([
            p.waitForEvent("download"),
            p.locator("#export-save").click(),
          ]);
          await download.saveAs(`${output}/all-saves.json`);
          const { readFile } = await import("node:fs/promises");
          const exported = JSON.parse(
            await readFile(`${output}/all-saves.json`, "utf8"),
          );
          assert.equal(exported.v2, fixture.v2);
          assert.equal(exported.v3, await raw(p));
          assert.equal(exported.draftV1, "unknown old draft");
        }
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).mode, "ready");
        await p.locator("#trackbook-open").click();
        assert.equal(await p.locator(".track-legacy").count(), 2);
        assert.match(
          await p.locator(".track-legacy").first().innerText(),
          /旧纪录/,
        );
        await p.screenshot({ path: `${output}/v3-cards-${width}.png` });
        await p.keyboard.press("Escape");
        assert.equal(await raw(p, "paperlap.save.v2"), fixture.v2);
        assert.equal(await raw(p, "paperlap.draft.v1"), "unknown old draft");
        check(
          `${width}x${height}: V2 migration preserves all tracks/archive/bytes and distinguishes historical records from authoritative PB`,
        );
      },
      {
        "paperlap.save.v2": fixture.v2,
        "paperlap.draft.v1": "unknown old draft",
      },
      { width, height },
    );
  await isolated(
    async (p) => {
      const s = await read(p);
      assert.equal((await state(p)).storage.source, "v1");
      assert.equal(await raw(p, "paperlap.save.v1"), fixture.v1);
      assert.equal(await raw(p, "paperlap.save.v2"), null);
      assert.equal(Object.values(s.legacy.records)[0], 22.5);
      assert.equal(await p.locator("#best").innerText(), "--:--.--");
      check(
        "V1 directly migrates both current and orphan records to V3 without writing V2",
      );
    },
    { "paperlap.save.v1": fixture.v1 },
  );
  await isolated(
    async (p) => {
      const original = await read(p),
        identity = original.tracks[0].geometryIdentity;
      await p.locator("#trackbook-open").click();
      await p.locator('[data-action="rename"]').first().click();
      await p.locator("#track-name-input").fill("改名保持身份");
      await p.locator("#rename-save").click();
      await p.keyboard.press("Escape");
      assert.equal((await read(p)).tracks[0].geometryIdentity, identity);
      await p.locator("#sound").click();
      assert.equal((await read(p)).tracks[0].geometryIdentity, identity);
      await p.locator("#edit").click();
      await draw(p);
      await p.keyboard.press("Enter");
      assert.equal((await state(p)).mode, "running");
      const changed = await read(p);
      assert.notEqual(changed.tracks[0].geometryIdentity, identity);
      assert.deepEqual(changed.legacy, original.legacy);
      assert.equal(await p.locator("#best").innerText(), "--:--.--");
      await load(p);
      assert.equal(
        (await read(p)).tracks[0].geometryIdentity,
        changed.tracks[0].geometryIdentity,
      );
      assert.equal(await raw(p, "paperlap.save.v2"), fixture.v2);
      check(
        "real whole-stroke save creates a new identity; rename/sound/reload preserve it and old records",
      );
      const expected = await p.evaluate(async () => {
        const e = JSON.parse(localStorage.getItem("paperlap.save.v3"))
            .tracks[0],
          b = new Uint8Array(32 + 16 * e.track.points.length),
          v = new DataView(b.buffer);
        b.set(new TextEncoder().encode("PaperlapGeometry"));
        v.setUint32(16, 1);
        v.setFloat64(20, e.track.width);
        v.setUint32(28, e.track.points.length);
        e.track.points.forEach((p, i) => {
          v.setFloat64(32 + 16 * i, p.x === 0 ? 0 : p.x);
          v.setFloat64(40 + 16 * i, p.y === 0 ? 0 : p.y);
        });
        return (
          "geom-v1-sha256-" +
          [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("")
        );
      });
      assert.equal(expected, (await read(p)).tracks[0].geometryDigest);
      check("browser WebCrypto independently confirms the canonical digest");
    },
    { "paperlap.save.v2": fixture.v2 },
  );
  await isolated(
    async (p, c) => {
      const before = await raw(p),
        second = await c.newPage();
      await load(second);
      assert.equal((await state(second)).storage.writable, false);
      assert.equal((await state(second)).storage.error, "writer-busy");
      await second.locator("#sound").click();
      assert.equal(await raw(second), before);
      await p.close();
      await load(second);
      assert.equal((await state(second)).storage.writable, true);
      await second.locator("#sound").click();
      assert.notEqual(await raw(second), before);
      check(
        "real second tab is read-only; after writer closes and reloads it safely obtains the writer lease",
      );
    },
    { "paperlap.save.v2": fixture.v2 },
  );
  await isolated(
    async (p, c) => {
      const before = await raw(p),
        other = await c.newPage();
      await other.goto(base);
      await other.evaluate(() =>
        localStorage.setItem("paperlap.save.v2", "old client changed bytes"),
      );
      await p.waitForFunction(
        () => window.paperlapDebug.storage.error === "conflict",
      );
      await p.locator("#sound").click();
      assert.equal(await raw(p), before);
      assert.match(
        await p.locator("#storage-state").innerText(),
        /只读|未保存/,
      );
      await load(p);
      assert.equal((await state(p)).storage.error, "conflict");
      check(
        "old-client V2 changes are detected by live events and persisted source digest after reload without overwriting either branch",
      );
    },
    { "paperlap.save.v2": fixture.v2 },
  );
  for (const corrupt of [
    "broken",
    JSON.stringify({ schemaVersion: 99 }),
    JSON.stringify({
      ...fixture.v3,
      tracks: fixture.v3.tracks.map((e, i) =>
        i ? e : { ...e, geometryDigest: "geom-v1-sha256-" + "0".repeat(64) },
      ),
    }),
  ])
    await isolated(
      async (p) => {
        assert.equal((await state(p)).storage.error, "invalid-v3");
        assert.equal((await state(p)).storage.persisted, false);
        await p.locator("#sound").click();
        assert.equal(await raw(p), corrupt);
        assert.equal(await raw(p, "paperlap.save.v2"), fixture.v2);
        await p.locator("#record-history-open").click();
        assert.match(
          await p.locator("#save-state-description").innerText(),
          /不会覆盖或自动回退/,
        );
        check(
          "corrupt/unknown/digest-mismatched V3 is preserved and cannot fall back into an overwrite",
        );
      },
      { "paperlap.save.v3": corrupt, "paperlap.save.v2": fixture.v2 },
    );
  await isolated(
    async (p) => {
      await p.evaluate(() => {
        window.nativeSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "paperlap.save.v3" && !sessionStorage.getItem("allow-v3"))
            throw new DOMException("full", "QuotaExceededError");
          return window.nativeSet.call(this, k, v);
        };
        localStorage.removeItem("paperlap.save.v3");
      });
      // Install the refusal for the next document too, then retry the same source.
      await p.context().addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "paperlap.save.v3" && !sessionStorage.getItem("allow-v3"))
            throw new DOMException("full", "QuotaExceededError");
          return set.call(this, k, v);
        };
      });
      await load(p);
      const id = (await state(p)).geometryIdentity;
      assert.equal((await state(p)).storage.persisted, false);
      assert.equal(await raw(p), null);
      assert.equal(await raw(p, "paperlap.save.v2"), fixture.v2);
      await p.locator("#record-history-open").click();
      assert.match(
        await p.locator("#record-history-list").innerText(),
        /00:24.68/,
      );
      await p.keyboard.press("Escape");
      await p.evaluate(() => sessionStorage.setItem("allow-v3", "1"));
      await load(p);
      assert.equal((await state(p)).geometryIdentity, id);
      assert.equal((await state(p)).storage.persisted, true);
      check(
        "quota upgrade failure preserves readable history and old bytes; retry has the same migrated identity",
      );
    },
    { "paperlap.save.v2": fixture.v2 },
  );
  await isolated(async (p) => {
    await p.context().addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await load(p);
    assert.equal((await state(p)).storage.error, "unavailable");
    await p.locator("#start").click();
    await p.keyboard.down("ArrowUp");
    await p.waitForFunction(() => window.paperlapDebug.lap.elapsed > 0.2);
    await p.keyboard.up("ArrowUp");
    assert.ok((await state(p)).car.speed > 0);
    await p.keyboard.press("Space");
    await p.locator("#sound").click();
    assert.match(await p.locator("#toast").innerText(), /未能保存/);
    check(
      "blocked storage still permits real driving and pause with persistent save failure information",
    );
  });
  const oldEntry = JSON.parse(fixture.v2).tracks[0];
  const oldDraft = JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        source: {
          intent: "replace",
          uid: oldEntry.uid,
          fingerprint: oldEntry.track.id,
        },
        current: { phase: "complete", raw: wobblyLoop(), overflow: false },
        retained: null,
        updatedAt: 1,
      },
    ],
  });
  await isolated(
    async (p) => {
      await p.locator("#edit").click();
      assert.equal(await p.locator("#draft-recovery").isVisible(), false);
      assert.match(
        await p.locator("#draft-backup").innerText(),
        /旧版.*保留.*未自动套用/,
      );
      await draw(p);
      const modern = await raw(p, "paperlap.draft.v2");
      assert.equal(
        JSON.parse(modern).entries[0].source.geometryIdentity,
        (await state(p)).geometryIdentity,
      );
      assert.equal(await raw(p, "paperlap.draft.v1"), oldDraft);
      await load(p);
      await p.locator("#edit").click();
      await p.locator("#continue-draft").click();
      assert.equal((await state(p)).draft.valid, true);
      await load(p);
      await p.evaluate(() => {
        const d = JSON.parse(localStorage.getItem("paperlap.draft.v2"));
        d.entries[0].source.geometryIdentity = "g-" + "a".repeat(32);
        localStorage.setItem("paperlap.draft.v2", JSON.stringify(d));
      });
      const wrong = await raw(p, "paperlap.draft.v2");
      await p.locator("#edit").click();
      assert.equal(await p.locator("#draft-recovery").isVisible(), false);
      assert.equal(await raw(p, "paperlap.draft.v2"), wrong);
      assert.equal(await raw(p, "paperlap.draft.v1"), oldDraft);
      check(
        "legacy whole-stroke bytes remain read-only; new drafts recover only the matching V3 revision",
      );
    },
    { "paperlap.save.v2": fixture.v2, "paperlap.draft.v1": oldDraft },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ headless: true, checks, errors, failedRequests }, null, 2),
  );
  await browser.close();
}
