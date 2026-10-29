import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performanceFixtures } from "./fixtures/local-performance.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const output = "test-results/p1-06/response",
  base = process.env.PAPERLAP_URL || "http://127.0.0.1:4188";
await mkdir(`${output}/video`, { recursive: true });
const report = {
  checks: [],
  errors: [],
  failedRequests: [],
  headless: true,
  completed: false,
  video: null,
};
const check = (s) => {
  report.checks.push(s);
  console.log(`PASS ${s}`);
};
const state = (p) => p.evaluate(() => paperlapDebug);
const raw = (p, k = "paperlap.save.v3") =>
  p.evaluate((k) => localStorage.getItem(k), k);
const idle = (p) => p.waitForFunction(() => !paperlapDebug.local.busy);
async function isolated(
  run,
  { width = 1366, height = 768, reduced = false, record = false } = {},
) {
  const c = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    ...(record
      ? { recordVideo: { dir: `${output}/video`, size: { width, height } } }
      : {}),
  });
  let video;
  try {
    await c.addInitScript((seed) => {
      if (
        /^https?:$/.test(location.protocol) &&
        !localStorage.getItem("response-seeded")
      ) {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        localStorage.setItem("response-seeded", "1");
      }
      // Test-only gate: hold scheduled callbacks without changing UI or geometry.
      // Functional race checks/screenshots can inspect a genuinely queued operation.
      // Performance runs and the actual recording never use this gate.
      const raf = window.requestAnimationFrame.bind(window);
      window.heldLocal = [];
      window.holdLocal = false;
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          if (
            window.holdLocal &&
            document
              .querySelector("#local-editor")
              ?.getAttribute("aria-busy") === "true"
          )
            window.heldLocal.push(() => cb(performance.now()));
          else cb(t);
        });
      window.releaseLocal = () => {
        window.holdLocal = false;
        const a = window.heldLocal.splice(0);
        for (const cb of a) cb();
      };
    }, performanceFixtures["900-1"]);
    c.on("page", (p) => {
      p.on("pageerror", (e) => report.errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") report.errors.push(m.text());
      });
      p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
    });
    const p = await c.newPage();
    if (record) video = p.video();
    const cdp = await c.newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await p.goto(`${base}/?debug=1&profile=1`);
    await p.waitForFunction(
      () => window.paperlapDebug && document.querySelector("#game canvas"),
    );
    await p.locator("#local-edit").click();
    await run(p, c);
  } finally {
    await c.close();
    if (video) {
      await video.saveAs(`${output}/response.webm`);
      report.video = `${output}/response.webm`;
    }
  }
}
async function drag(p, delta = -3) {
  const s = await state(p),
    q = s.local.current.reduce((a, b) => (b.x < a.x ? b : a)),
    r = await p.locator(".local-surface").boundingBox();
  await p.mouse.move(
    r.x + (q.x * r.width) / 1440,
    r.y + (q.y * r.height) / 860,
  );
  await p.mouse.down();
  await p.mouse.move(
    r.x + ((q.x + delta) * r.width) / 1440,
    r.y + (q.y * r.height) / 860,
    { steps: 12 },
  );
  await p.mouse.up();
  await idle(p);
  assert.equal((await state(p)).local.pending.error, null);
}
async function queue(p, button) {
  await p.evaluate(() => {
    window.holdLocal = true;
  });
  const r = await p.locator(button).evaluate((el) => {
    el.click();
    el.click();
    return {
      busy: document.querySelector("#local-editor").getAttribute("aria-busy"),
      text: el.textContent,
      disabled: el.disabled,
      background: getComputedStyle(el).backgroundColor,
    };
  });
  assert.equal(r.busy, "true");
  assert.equal(r.disabled, true);
  assert.match(r.text, /正在/);
  assert.equal(
    r.background,
    "rgb(239, 223, 184)",
    "busy contrast is immediate, not trapped halfway through a color transition",
  );
  await p.waitForTimeout(65); // rendering continues; the test gate holds only callbacks.
  assert.equal(
    await p.locator("#local-editor").getAttribute("aria-busy"),
    "true",
  );
}
async function resume(p) {
  await p.evaluate(() => window.releaseLocal());
  await idle(p);
}
async function adopted(p) {
  await drag(p);
  await p.locator("#local-adopt").click();
  await idle(p);
  assert.equal((await state(p)).local.pending, null);
}
async function layout(p) {
  const r = await p.locator(".local-actions").evaluate((e) => ({
    buttons: [...e.querySelectorAll("button")].map((b) =>
      b.getBoundingClientRect().toJSON(),
    ),
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.equal(r.overflow, false);
  for (const b of r.buttons) {
    assert.ok(
      b.x >= 0 &&
        b.y >= 0 &&
        b.right <= r.width + 1 &&
        b.bottom <= r.height + 1,
    );
  }
}
try {
  if (process.env.PAPERLAP_RESPONSE_RECORD_ONLY !== "1") {
    for (const [width, height] of [
      [1366, 768],
      [1280, 800],
      [900, 700],
    ])
      await isolated(
        async (p) => {
          const formal = await raw(p);
          await drag(p);
          const before = await state(p);
          await queue(p, "#local-adopt");
          await layout(p);
          await p.screenshot({ path: `${output}/adopting-${width}.png` });
          await p.keyboard.down("Enter");
          await p.keyboard.down("Enter");
          await p.keyboard.up("Enter");
          await p.keyboard.press("Control+Enter");
          assert.equal((await state(p)).local.metrics.adoptions, 0);
          assert.equal(await raw(p), formal);
          assert.deepEqual(
            (await state(p)).local.current,
            before.local.current,
          );
          await resume(p);
          const a = await state(p);
          assert.equal(a.local.metrics.adoptions, 1);
          assert.equal(a.local.pending, null);
          assert.equal(a.local.proof.strict, before.local.proof.strict);
          assert.ok(a.local.proof.reused > before.local.proof.reused);
          await p.screenshot({ path: `${output}/adopted-${width}.png` });
          const draft = await raw(p, "paperlap.local-draft.v1");
          assert.ok(draft);
          await p.evaluate(() => {
            window.rejectFormal = true;
            const old = Storage.prototype.setItem;
            window.responseWrites = 0;
            Storage.prototype.setItem = function (k, v) {
              if (k === "paperlap.save.v3") {
                responseWrites++;
                if (rejectFormal)
                  throw new DOMException("full", "QuotaExceededError");
              }
              return old.call(this, k, v);
            };
          });
          await queue(p, "#local-save");
          await p.screenshot({ path: `${output}/saving-${width}.png` });
          await resume(p);
          assert.equal((await state(p)).local.active, true);
          assert.equal(await raw(p), formal);
          assert.equal(await raw(p, "paperlap.local-draft.v1"), draft);
          assert.match(
            await p.locator("#local-status").textContent(),
            /空间不足/,
          );
          assert.equal(await p.evaluate(() => responseWrites), 1);
          assert.equal(await p.locator("#local-save").isEnabled(), true);
          assert.notEqual(
            await p.locator("#toast").getAttribute("data-feedback"),
            "saved",
          );
          await p.screenshot({ path: `${output}/failed-${width}.png` });
          await p.evaluate(() => {
            window.rejectFormal = false;
          });
          await p.locator("#local-save").focus();
          await p.keyboard.press("Enter");
          await idle(p);
          await p.waitForFunction(() => !paperlapDebug.local.active);
          assert.equal((await state(p)).mode, "ready");
          assert.equal(await p.evaluate(() => responseWrites), 2);
          const saved = JSON.parse(await raw(p)),
            old = JSON.parse(formal);
          assert.equal(saved.tracks[0].uid, old.tracks[0].uid);
          assert.notEqual(
            saved.tracks[0].geometryIdentity,
            old.tracks[0].geometryIdentity,
          );
          assert.deepEqual(saved.legacy, old.legacy);
          assert.equal(await raw(p, "paperlap.local-draft.v1"), null);
          await p.screenshot({ path: `${output}/saved-${width}.png` });
          check(
            `${width}x${height}${width === 900 ? " reduced" : ""}: painted busy, single adoption, proof reuse, quota failure retains state, native retry saves once`,
          );
        },
        { width, height, reduced: width === 900 },
      );
    for (const kind of ["validating", "adopting", "saving"])
      for (const interruption of ["Escape", "blur", "hidden", "resize"])
        await isolated(async (p) => {
          const formal = await raw(p);
          if (kind !== "validating") await drag(p);
          if (kind === "saving") {
            await p.locator("#local-adopt").click();
            await idle(p);
          }
          const accepted = (await state(p)).local.current,
            draft = await raw(p, "paperlap.local-draft.v1");
          if (kind === "validating") {
            await p.evaluate(() => {
              window.holdLocal = true;
            });
            const s = await state(p),
              q = s.local.current.reduce((a, b) => (b.x < a.x ? b : a)),
              r = await p.locator(".local-surface").boundingBox();
            await p.mouse.move(
              r.x + (q.x * r.width) / 1440,
              r.y + (q.y * r.height) / 860,
            );
            await p.mouse.down();
            await p.mouse.move(
              r.x + ((q.x - 4) * r.width) / 1440,
              r.y + (q.y * r.height) / 860,
            );
            await p.mouse.up();
          } else
            await queue(
              p,
              kind === "adopting" ? "#local-adopt" : "#local-save",
            );
          assert.equal((await state(p)).local.busy, kind);
          if (interruption === "Escape") await p.keyboard.press("Escape");
          else if (interruption === "resize")
            await p.setViewportSize({ width: 1280, height: 800 });
          else if (interruption === "blur")
            await p.evaluate(() => window.dispatchEvent(new Event("blur")));
          else
            await p.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
          await p.evaluate(() => {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: false,
            });
            window.releaseLocal();
          });
          await p.waitForTimeout(100);
          assert.equal((await state(p)).local.busy, null);
          assert.deepEqual((await state(p)).local.current, accepted);
          assert.equal((await state(p)).local.pending, null);
          assert.equal(await raw(p), formal);
          if (draft)
            assert.deepEqual(
              JSON.parse(await raw(p, "paperlap.local-draft.v1")).entries[0]
                .checkpoint,
              JSON.parse(draft).entries[0].checkpoint,
            );
          else assert.equal(await raw(p, "paperlap.local-draft.v1"), null);
          // Deliver new real input after the stale callbacks; old work cannot win later.
          await adopted(p);
          assert.equal(
            (await state(p)).local.metrics.adoptions,
            kind === "saving" ? 2 : 1,
          );
          check(
            `${kind} + ${interruption}: cancel queued work, keep accepted backup, ignore old callback, accept next drag`,
          );
        });
    await isolated(async (p, c) => {
      await adopted(p);
      const formal = await raw(p),
        draft = await raw(p, "paperlap.local-draft.v1");
      await queue(p, "#local-save");
      const other = await c.newPage();
      await other.goto(`${base}/?debug=1`);
      await other.waitForFunction(() => window.paperlapDebug);
      assert.equal((await state(other)).storage.writable, false);
      await other.evaluate(() =>
        localStorage.setItem(
          "paperlap.save.v3",
          localStorage.getItem("paperlap.save.v3") + " ",
        ),
      );
      await p.waitForFunction(() => paperlapDebug.storage.error === "conflict");
      await p.evaluate(() => window.releaseLocal());
      await p.waitForTimeout(100);
      assert.equal(await raw(p), formal + " ");
      assert.equal(await raw(p, "paperlap.local-draft.v1"), draft);
      assert.equal((await state(p)).local.busy, null);
      assert.equal(await p.locator("#local-save").isEnabled(), false);
      check(
        "real second read-only tab/source change cancels queued save; neither branch nor draft overwritten",
      );
    });
    await isolated(async (p) => {
      await adopted(p);
      const formal = await raw(p),
        draft = await raw(p, "paperlap.local-draft.v1");
      await p.evaluate(() => {
        const old = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "paperlap.save.v3") return;
          return old.call(this, k, v);
        };
      });
      await p.locator("#local-save").click();
      await idle(p);
      assert.equal((await state(p)).local.active, true);
      assert.equal(await raw(p), formal);
      assert.equal(await raw(p, "paperlap.local-draft.v1"), draft);
      assert.equal((await state(p)).storage.error, "conflict");
      assert.match(await p.locator("#local-status").textContent(), /变化|停止/);
      check(
        "no-op write/readback failure cannot celebrate or clear draft after queued save",
      );
    });
  }
  await isolated(
    async (p) => {
      await drag(p);
      await p.locator("#local-adopt").focus();
      await p.keyboard.press("Space");
      await idle(p);
      await drag(p);
      await p.keyboard.down("Enter");
      await p.keyboard.down("Enter");
      await p.keyboard.up("Enter");
      await idle(p);
      assert.equal((await state(p)).local.metrics.adoptions, 2);
      await p.keyboard.press("Control+z");
      assert.ok((await state(p)).local.canRedo);
      await p.keyboard.press("Control+Shift+z");
      await p.keyboard.press("Control+Enter");
      await p.waitForFunction(() => !paperlapDebug.local.active);
      await p.waitForTimeout(350);
      check(
        "uninterrupted recording: real native Space/held Enter, undo/redo, busy save and reliable success",
      );
      assert.match(await p.locator("#toast").textContent(), /已保存/);
      await p.keyboard.press("l");
      assert.equal(
        await p.locator("#toast").textContent(),
        "",
        "entering another edit must retire the previous save notification",
      );
      await adopted(p);
      await p.evaluate(() => {
        const old = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "paperlap.save.v3")
            throw new DOMException("full", "QuotaExceededError");
          return old.call(this, k, v);
        };
      });
      await p.locator("#local-save").click();
      await idle(p);
      assert.match(await p.locator("#local-status").textContent(), /空间不足/);
      assert.equal(await p.locator("#toast").textContent(), "");
      check(
        "a failed second edit cannot retain the earlier successful save notice",
      );
    },
    { record: true },
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  report.completed = true;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
