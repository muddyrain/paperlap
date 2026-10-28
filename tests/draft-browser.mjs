import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { wobblyLoop, screenshotLoop } from "./fixtures/editor-paths.mjs";
import { keyboardFocus } from "./fixtures/focus-feedback.mjs";

delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:5173";
const output = fileURLToPath(
  new URL("../test-results/draft/", import.meta.url),
);
await mkdir(output, { recursive: true });
const checks = [],
  errors = [],
  failedRequests = [];
const state = (p) => p.evaluate(() => window.paperlapDebug);
const official = (p) =>
  p.evaluate(() => localStorage.getItem("paperlap.save.v2"));
const backup = (p) =>
  p.evaluate(() => localStorage.getItem("paperlap.draft.v1"));
const draft = async (p) => JSON.parse(await backup(p));
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const settle = (p) => p.waitForTimeout(480);
const shot = (p, name) => p.screenshot({ path: `${output}${name}.png` });
async function load(p, reload = false) {
  if (reload) await p.reload();
  else await p.goto(`${base}/?debug=1`);
  await p.waitForFunction(
    () => window.paperlapDebug && document.querySelector("#game canvas"),
  );
}
async function isolated(
  run,
  { width = 1366, height = 768, video, ...options } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    ...(video
      ? { recordVideo: { dir: `${output}raw-video`, size: { width, height } } }
      : {}),
    ...options,
  });
  const p = await context.newPage();
  const recording = p.video();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("requestfailed", (r) => failedRequests.push(r.url()));
  try {
    await load(p);
    await run(p, context);
  } finally {
    await context.close();
    if (recording) {
      await recording.saveAs(`${output}${video}.webm`);
      await recording.delete();
    }
  }
}
async function enter(p, intent = "replace") {
  if (intent === "create") {
    await p.locator("#trackbook-open").click();
    await p.locator('#trackbook[data-motion="open"]').waitFor();
    await p.locator("#new-track").click();
  } else await p.locator("#edit").click();
  await settle(p);
}
async function draw(p, points = wobblyLoop(), interrupt) {
  const r = await p.locator(".draw-surface").boundingBox();
  const at = (point) => ({
    x: r.x + (point.x * r.width) / 1440,
    y: r.y + (point.y * r.height) / 860,
  });
  const start = at(points[0]);
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  for (const point of points.slice(1)) {
    const q = at(point);
    await p.mouse.move(q.x, q.y);
  }
  if (interrupt) await interrupt();
  await p.mouse.up();
}
async function undo(p, redo = false) {
  const modifier = await p.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await p.keyboard.press(`${modifier}+${redo ? "Shift+" : ""}z`);
}
async function abandon(p) {
  await p.keyboard.press("Escape");
  await p.locator("#keep-drawing").waitFor({ state: "visible" });
  await settle(p);
  await p.locator("#discard-drawing").click();
  await settle(p);
}
async function closeBook(p) {
  if (await p.locator("#trackbook").isVisible()) {
    await p.locator('#trackbook[data-motion="open"]').waitFor();
    await p.keyboard.press("Escape");
    await settle(p);
  }
}
async function prompt(p) {
  await p.locator("#draft-recovery[open]").waitFor();
  assert.equal(await p.locator("dialog[open]").count(), 1);
  assert.equal(
    await p.evaluate(() => document.activeElement.id),
    "continue-draft",
  );
}
async function keep(p) {
  await prompt(p);
  await p.locator("#continue-draft").click();
  await settle(p);
}
async function seedTwo(p) {
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("paperlap.save.v2"));
    s.tracks.push({
      uid: "draft-second",
      track: { ...structuredClone(s.tracks[0].track), name: "B 赛道" },
    });
    localStorage.setItem("paperlap.save.v2", JSON.stringify(s));
  });
  await load(p, true);
}
async function select(p, uid) {
  await p.locator("#trackbook-open").click();
  await p.locator('#trackbook[data-motion="open"]').waitFor();
  await p.locator(`[data-uid="${uid}"] [data-action="select"]`).click();
  await closeBook(p);
}
async function block(p, key, remove = false) {
  await p.evaluate(
    ({ key, remove }) => {
      window.testSet = Storage.prototype.setItem;
      window.testRemove = Storage.prototype.removeItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === key)
          throw new DOMException("test quota", "QuotaExceededError");
        return window.testSet.call(this, k, v);
      };
      if (remove)
        Storage.prototype.removeItem = function (k) {
          if (k === key) throw new DOMException("test denied", "SecurityError");
          return window.testRemove.call(this, k);
        };
    },
    { key, remove },
  );
}
async function unblock(p) {
  await p.evaluate(() => {
    Storage.prototype.setItem = window.testSet;
    Storage.prototype.removeItem = window.testRemove;
  });
}
try {
  await isolated(
    async (p) => {
      const original = await official(p);
      await enter(p);
      await draw(p);
      await settle(p);
      assert.equal((await state(p)).draft.valid, true);
      const points = (await draft(p)).entries[0].current.raw;
      await shot(p, "valid-before-r");
      await p.keyboard.press("r");
      assert.equal((await state(p)).draft.rawLength, 0);
      assert.deepEqual((await draft(p)).entries[0].retained.raw, points);
      assert.equal(await p.locator("#undo-drawing").isEnabled(), true);
      await undo(p);
      await settle(p);
      assert.equal((await state(p)).draft.valid, true);
      await shot(p, "r-undo-restored");
      await undo(p, true);
      assert.equal((await state(p)).draft.rawLength, 0);
      await undo(p);
      await p.locator("#redo-drawing").click();
      assert.equal((await state(p)).draft.rawLength, 0);
      await p.locator("#undo-drawing").click();
      assert.equal((await state(p)).draft.valid, true);
      assert.equal(await official(p), original);
      check(
        "valid preview → R → keyboard undo/redo and native buttons restore whole strokes without official writes",
      );
      await p.locator(".draw-surface").focus();
      await p.keyboard.press("r");
      await load(p, true);
      await enter(p);
      await keep(p);
      assert.equal((await state(p)).draft.rawLength, 0);
      await undo(p);
      assert.equal((await state(p)).draft.valid, true);
      check(
        "R checkpoint survives reload and retains its only recoverable preview",
      );
      await p.keyboard.press("Enter");
      await settle(p);
      assert.equal((await state(p)).mode, "running");
      assert.equal(await backup(p), null);
      assert.notEqual(
        (await state(p)).trackId,
        JSON.parse(original).tracks[0].track.id,
      );
      check(
        "reliable replace save and scene commit clear only the matching draft",
      );
    },
    { video: "undo-redraw" },
  );

  await isolated(
    async (p, context) => {
      const original = await official(p);
      await enter(p, "create");
      await draw(p, screenshotLoop);
      const stored = await backup(p);
      await load(p, true);
      assert.equal((await state(p)).mode, "ready");
      assert.equal(await p.locator("#draft-recovery").isVisible(), false);
      await enter(p);
      assert.equal(await p.locator("#draft-recovery").isVisible(), false);
      await p.keyboard.press("Escape");
      await enter(p, "create");
      await prompt(p);
      await settle(p);
      await shot(p, "reload-recovery");
      await p.keyboard.press("Tab");
      await keyboardFocus(p);
      await p.keyboard.press("Shift+Tab");
      await p.keyboard.press("Enter");
      await settle(p);
      assert.equal((await state(p)).draft.valid, true);
      assert.equal(await official(p), original);
      await shot(p, "recovered-preview");
      check(
        "real reload offers create-only recovery; explicit adoption revalidates preview and never writes Save V2",
      );
      await p.keyboard.press("Escape");
      await settle(p);
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "keep-drawing",
      );
      await shot(p, "discard-confirm");
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).mode, "editing");
      assert.equal((await state(p)).draft.valid, true);
      assert.ok(await backup(p));
      await abandon(p);
      await closeBook(p);
      assert.equal(await backup(p), null);
      assert.equal(await official(p), original);
      await enter(p, "create");
      assert.equal(await p.locator("#draft-recovery").isVisible(), false);
      check(
        "Esc defaults to keep drawing; explicit discard clears the matching draft and restores the source",
      );
      // Closing the page (same isolated browser storage) also preserves unaccepted work.
      await draw(p);
      const beforeClose = await backup(p);
      const next = await context.newPage();
      await p.close();
      await load(next);
      await enter(next, "create");
      await prompt(next);
      assert.equal(await backup(next), beforeClose);
      await next.close();
      assert.ok(stored);
      check(
        "closing and reopening a browser page retains recoverable raw without auto-start",
      );
    },
    { video: "refresh-recovery" },
  );

  await isolated(async (p) => {
    await enter(p);
    await draw(p, [
      { x: 400, y: 300 },
      { x: 480, y: 320 },
      { x: 550, y: 350 },
    ]);
    const raw = await backup(p);
    await load(p, true);
    await enter(p);
    await prompt(p);
    await p.keyboard.press("Escape");
    assert.equal((await state(p)).mode, "ready");
    assert.equal(await backup(p), raw);
    await enter(p);
    await keep(p);
    assert.equal((await state(p)).draft.valid, false);
    assert.equal(await p.locator("#drive-drawing").isEnabled(), false);
    await shot(p, "invalid-recovered");
    check(
      "invalid completed stroke and defer/Esc preserve raw; restoration cannot bypass validation",
    );
  });

  for (const interruption of ["blur", "resize", "pointercancel"])
    await isolated(async (p) => {
      await enter(p);
      await draw(p, wobblyLoop().slice(0, 75), async () => {
        if (interruption === "resize")
          await p.setViewportSize({ width: 1280, height: 800 });
        else if (interruption === "blur")
          await p.evaluate(() => window.dispatchEvent(new Event("blur")));
        else
          await p
            .locator(".draw-surface")
            .dispatchEvent("pointercancel", { pointerId: 1 });
      });
      assert.equal((await state(p)).draft.phase, "interrupted");
      assert.match(
        await p.locator("#editor-status").innerText(),
        /中断.*笔迹已保留/,
      );
      await load(p, true);
      await enter(p);
      await prompt(p);
      assert.match(
        await p.locator("#draft-range").innerText(),
        /不能接着原手势/,
      );
      await keep(p);
      assert.equal((await state(p)).draft.valid, false);
      await p.keyboard.press("r");
      await draw(p);
      assert.equal((await state(p)).draft.valid, true);
      check(
        `${interruption} checkpoints interrupted raw and releases pointer; restored partial cannot save and fresh stroke works`,
      );
    });

  await isolated(async (p) => {
    await seedTwo(p);
    const a = (await state(p)).activeTrackUid;
    await enter(p);
    await draw(p);
    const stored = await backup(p);
    await load(p, true);
    await select(p, "draft-second");
    await enter(p);
    assert.equal(await p.locator("#draft-recovery").isVisible(), false);
    await p.keyboard.press("Escape");
    await select(p, a);
    await enter(p);
    await keep(p);
    assert.equal((await state(p)).draft.valid, true);
    assert.equal(
      await backup(p),
      stored.replace(
        /"updatedAt":\d+/,
        `"updatedAt":${JSON.parse(await backup(p)).entries[0].updatedAt}`,
      ),
    );
    await load(p, true);
    await p.evaluate((a) => {
      const s = JSON.parse(localStorage.getItem("paperlap.save.v2"));
      s.tracks = s.tracks.filter((e) => e.uid !== a);
      s.activeTrackUid = "draft-second";
      localStorage.setItem("paperlap.save.v2", JSON.stringify(s));
    }, a);
    await load(p, true);
    await enter(p);
    assert.equal(await p.locator("#draft-recovery").isVisible(), false);
    check(
      "A/B selection and deleting the original entry never attach A's draft to B",
    );
  });

  await isolated(async (p) => {
    await enter(p);
    await draw(p);
    await load(p, true);
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("paperlap.save.v2"));
      s.tracks[0].uid = "imported-entry";
      s.activeTrackUid = "imported-entry";
      localStorage.setItem("paperlap.save.v2", JSON.stringify(s));
    });
    await load(p, true);
    const raw = await backup(p);
    await enter(p);
    assert.equal(await p.locator("#draft-recovery").isVisible(), false);
    assert.equal(await backup(p), raw);
    check(
      "replacing the official library leaves unmatched draft bytes intact and offers no incorrect recovery",
    );
  });

  for (const intent of ["create", "replace"])
    await isolated(async (p) => {
      const original = await official(p);
      await enter(p, intent);
      await draw(p);
      const raw = await backup(p);
      await block(p, "paperlap.save.v2");
      await p.keyboard.press("Enter");
      await settle(p);
      assert.equal(await official(p), original);
      assert.equal(await backup(p), raw);
      assert.equal(
        (await state(p)).mode,
        intent === "create" ? "editing" : "running",
      );
      await load(p, true);
      await enter(p, intent);
      await keep(p);
      assert.equal((await state(p)).draft.valid, true);
      await p.keyboard.press("Enter");
      await settle(p);
      assert.equal(await backup(p), null);
      assert.equal(
        (await state(p)).mode,
        intent === "create" ? "ready" : "running",
      );
      check(
        `${intent} official save failure retains backup (including ok:true/persisted:false); reload recovery and successful retry clean it`,
      );
    });

  await isolated(
    async (p) => {
      await enter(p);
      await draw(p);
      const raw = await backup(p);
      await block(p, "paperlap.draft.v1", true);
      await p.keyboard.press("r");
      assert.equal((await state(p)).draft.rawLength, 0);
      assert.equal(await backup(p), raw);
      assert.match(await p.locator("#draft-backup").innerText(), /未备份/);
      await undo(p);
      assert.equal((await state(p)).draft.valid, true);
      await p.keyboard.press("Escape");
      await settle(p);
      await p.locator("#discard-drawing").click();
      assert.equal((await state(p)).mode, "editing");
      assert.equal(await backup(p), raw);
      assert.match(await p.locator("#menu-status").innerText(), /未能清理/);
      await shot(p, "backup-failure");
      await p.keyboard.press("Escape");
      await unblock(p);
      await abandon(p);
      assert.equal(await backup(p), null);
      check(
        "quota/cleanup rejection preserve memory and previous bytes; failed discard stays editing and can retry",
      );
    },
    { video: "discard-safety" },
  );

  await isolated(async (p) => {
    await enter(p);
    await draw(p);
    const raw = await backup(p);
    await block(p, "paperlap.draft.v1", true);
    await p.keyboard.press("Enter");
    await settle(p);
    assert.equal((await state(p)).mode, "running");
    assert.equal(await backup(p), raw);
    assert.match(await p.locator("#toast").innerText(), /旧草稿未能清理/);
    check(
      "official success with backup cleanup failure reports retained stale draft without undoing the committed scene",
    );
  });

  await isolated(async (p, context) => {
    await enter(p);
    await draw(p);
    const other = await context.newPage();
    await other.goto(`${base}/`);
    await other.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("paperlap.draft.v1"));
      d.entries[0].updatedAt++;
      localStorage.setItem("paperlap.draft.v1", JSON.stringify(d));
    });
    const competing = await backup(p);
    await p.locator(".draw-surface").focus();
    await p.keyboard.press("r");
    assert.equal(await backup(p), competing);
    assert.match(await p.locator("#draft-backup").innerText(), /其他标签/);
    await undo(p);
    assert.equal((await state(p)).draft.valid, true);
    assert.equal(await backup(p), competing);
    await other.close();
    check(
      "a real second tab changing the draft prevents silent write/delete while local undo remains available",
    );
  });

  for (const raw of [
    "{broken",
    JSON.stringify({ schemaVersion: 99, entries: [] }),
  ])
    await isolated(async (p) => {
      await p.evaluate(
        (raw) => localStorage.setItem("paperlap.draft.v1", raw),
        raw,
      );
      const original = await official(p);
      await enter(p);
      assert.equal(await p.locator("#draft-recovery").isVisible(), false);
      await draw(p);
      assert.equal((await state(p)).draft.valid, true);
      assert.equal(await backup(p), raw);
      assert.equal(await official(p), original);
      assert.match(
        await p.locator("#draft-backup").innerText(),
        /损坏或版本不支持/,
      );
      check(
        "corrupt/unsupported draft is not overwritten; editor remains usable and official data stays isolated",
      );
    });

  await isolated(async (p) => {
    await p.evaluate(() =>
      localStorage.setItem("paperlap.save.v2", "{official-corrupt"),
    );
    await load(p, true);
    await enter(p);
    await draw(p);
    assert.ok(await backup(p));
    await p.keyboard.press("Enter");
    await settle(p);
    assert.equal(await official(p), "{official-corrupt");
    assert.ok(await backup(p));
    check(
      "damaged official Save V2 remains untouched while recoverable drawing is independently backed up",
    );
  });

  await isolated(async (p) => {
    await enter(p);
    await draw(p);
    const original = (await state(p)).draft;
    await p.evaluate(() => {
      const input = document.createElement("input");
      input.id = "draft-input";
      input.style.cssText = "position:absolute;z-index:20;top:120px;left:40px";
      document.querySelector(".board").append(input);
    });
    await p.locator("#draft-input").fill("原生撤销");
    await undo(p);
    assert.deepEqual((await state(p)).draft, original);
    await p.locator(".draw-surface").focus();
    await p.locator(".draw-surface").dispatchEvent("keydown", {
      code: "KeyZ",
      key: "z",
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
    });
    assert.deepEqual((await state(p)).draft, original);
    await p.keyboard.down("Control");
    await p.keyboard.down("z");
    const once = (await state(p)).draft;
    await p.keyboard.down("z");
    assert.deepEqual((await state(p)).draft, once);
    await p.keyboard.up("z");
    await p.keyboard.up("Control");
    await undo(p, true);
    assert.equal((await state(p)).draft.valid, true);
    await p.keyboard.down("r");
    await draw(p);
    await p.keyboard.down("r");
    assert.equal((await state(p)).draft.valid, true);
    await p.keyboard.up("r");
    check(
      "native input undo, IME, held undo and held R never consume unrelated snapshots",
    );
  });

  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
    [900, 700],
  ])
    await isolated(
      async (p) => {
        await p.keyboard.press("Escape");
        await p.keyboard.press("t");
        await p.locator('#trackbook[data-motion="open"]').waitFor();
        await p.keyboard.press("n");
        await draw(p);
        await p.keyboard.press("r");
        await undo(p);
        await p.keyboard.press("Escape");
        await p.keyboard.press("Escape");
        assert.equal((await state(p)).draft.valid, true);
        await settle(p);
        const boxes = await p
          .locator(".editor-history button, #editor-footer button")
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
              };
            }),
          );
        for (const r of boxes)
          assert.ok(
            r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= height,
            JSON.stringify({ width, height, r }),
          );
        const roadTop = await p.locator(".draw-surface").evaluate((node) => {
          const r = node.getBoundingClientRect();
          return r.top + (r.height * 184) / 860;
        });
        for (const r of boxes.slice(0, 2))
          assert.ok(
            r.bottom < roadTop,
            "history controls must stay above drawing bounds",
          );
        await shot(p, `editor-${width}`);
        await load(p, true);
        await enter(p, "create");
        await prompt(p);
        await settle(p);
        await shot(p, `recovery-${width}`);
        await p.keyboard.press("Escape");
        assert.equal(await p.locator("#trackbook").isVisible(), true);
        await p.keyboard.press("Escape");
        assert.equal(
          await p.locator('#game-menu[data-layer="menu"]').isVisible(),
          false,
        );
        check(
          `${width}×${height}: controls stay in margins; rapid sheet transitions preserve draft and return from recovery to original book`,
        );
      },
      { width, height },
    );

  await isolated(async (p) => {
    const original = await official(p);
    await enter(p, "create");
    await draw(p, [
      { x: 400, y: 300 },
      { x: 470, y: 320 },
    ]);
    await load(p, true);
    await enter(p);
    await draw(p);
    assert.equal((await draft(p)).entries.length, 2);
    await load(p, true);
    await enter(p, "create");
    await keep(p);
    assert.equal((await state(p)).draft.valid, false);
    await abandon(p);
    await closeBook(p);
    assert.equal((await draft(p)).entries.length, 1);
    await enter(p);
    await keep(p);
    assert.equal((await state(p)).draft.valid, true);
    assert.equal(await official(p), original);
    check(
      "create and replace checkpoints coexist; explicitly discarding create preserves replace and the official track",
    );
  });

  await isolated(async (p) => {
    await enter(p, "create");
    await draw(p, screenshotLoop);
    await p.keyboard.press("Enter");
    const b = (await state(p)).activeTrackUid;
    const a = JSON.parse(await official(p)).tracks.find((e) => e.uid !== b).uid;
    await select(p, a);
    await enter(p);
    await draw(p);
    await load(p, true);
    const preserved = await backup(p);
    await p.evaluate(
      ({ a, b }) => {
        const save = JSON.parse(localStorage.getItem("paperlap.save.v2"));
        save.tracks.find((e) => e.uid === a).track = structuredClone(
          save.tracks.find((e) => e.uid === b).track,
        );
        localStorage.setItem("paperlap.save.v2", JSON.stringify(save));
      },
      { a, b },
    );
    await load(p, true);
    await enter(p);
    assert.equal(await p.locator("#draft-recovery").isVisible(), false);
    assert.equal(await backup(p), preserved);
    check(
      "replacing the source geometry with a different genuinely drawn route rejects the old draft despite matching UID",
    );
  });

  await isolated(async (p) => {
    await p.evaluate(() => {
      window.draftWrites = 0;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "paperlap.draft.v1") window.draftWrites++;
        return set.call(this, k, v);
      };
    });
    await enter(p);
    const begun = Date.now();
    await draw(p);
    const elapsed = Date.now() - begun;
    const count = await p.evaluate(() => window.draftWrites);
    assert.ok(
      count > 0 && count <= Math.ceil(elapsed / 1000) + 2,
      `${count} writes in ${elapsed}ms`,
    );
    assert.ok(count < (await state(p)).draft.rawLength / 8);
    const before = await backup(p);
    await p.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide")),
    );
    assert.equal(await backup(p), before);
    check(
      "real pointer drawing checkpoints at most once per second plus completion, and unchanged pagehide does not rewrite the backup",
    );
  });

  await isolated(
    async (p) => {
      await enter(p);
      await draw(p);
      await p.keyboard.press("r");
      await undo(p);
      await load(p, true);
      await enter(p);
      await keep(p);
      assert.equal((await state(p)).draft.valid, true);
      assert.equal((await state(p)).motion.reduced, true);
      await shot(p, "reduced-motion");
      check(
        "reduced-motion preserves recovery, history and keyboard focus without timing-dependent data callbacks",
      );
    },
    { width: 900, height: 700, reducedMotion: "reduce" },
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  await writeFile(
    `${output}report.json`,
    JSON.stringify({ checks, errors, failedRequests }, null, 2),
  );
  await browser.close();
}
console.log(`Passed ${checks.length} draft browser checks`);
