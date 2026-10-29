import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { localGameFixtures } from "./fixtures/local-game.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test"),
  browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const output = "test-results/local-game",
  base = process.env.PAPERLAP_URL || "http://127.0.0.1:4186";
await mkdir(output, { recursive: true });
const report = {
  environment: {
    cpu: os.cpus()[0].model,
    browser: browser.version(),
    platform: os.platform(),
  },
  samples: [],
  errors: [],
  failedRequests: [],
};
const stats = (a) => {
  const v = [...a].sort((a, b) => a - b);
  return {
    medianMs: v[Math.floor(v.length / 2)] ?? 0,
    p95Ms: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] ?? 0,
    maxMs: v.at(-1) ?? 0,
  };
};
try {
  for (const count of [200, 450, 900])
    for (const rate of [1, 4]) {
      const c = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        reducedMotion: "reduce",
      });
      try {
        await c.addInitScript((seed) => {
          if (!/^https?:$/.test(location.protocol)) return;
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        }, localGameFixtures[String(count)]);
        const p = await c.newPage();
        p.on("pageerror", (e) => report.errors.push(e.message));
        p.on("console", (m) => {
          if (m.type() === "error") report.errors.push(m.text());
        });
        p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
        const cdp = await c.newCDPSession(p);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        const began = performance.now();
        await p.goto(`${base}/?debug=1`);
        await p.waitForFunction(
          () => window.paperlapDebug && document.querySelector("#game canvas"),
        );
        const loadMs = performance.now() - began;
        await p.locator("#local-edit").click();
        const before = await p.evaluate(() => ({
          formal: localStorage.getItem("paperlap.save.v3"),
          textures: paperlapDebug.local.textureCount,
          canvas: document.querySelectorAll("canvas").length,
        }));
        await p.evaluate(() => {
          window.localPerf = {
            move: [],
            release: [],
            adopt: [],
            save: [],
            frames: [],
            writing: [],
            running: true,
          };
          const watch = (element, event, key) => {
            let start = 0;
            element.addEventListener(
              event,
              () => {
                start = performance.now();
              },
              true,
            );
            element.addEventListener(event, () => {
              const finish = () => {
                if (
                  document
                    .querySelector("#local-editor")
                    .getAttribute("aria-busy") === "true"
                )
                  requestAnimationFrame(finish);
                else localPerf[key].push(performance.now() - start);
              };
              finish();
            });
          };
          watch(
            document.querySelector(".local-surface"),
            "pointermove",
            "move",
          );
          watch(
            document.querySelector(".local-surface"),
            "pointerup",
            "release",
          );
          watch(document.querySelector("#local-adopt"), "click", "adopt");
          watch(document.querySelector("#local-save"), "click", "save");
          const old = Storage.prototype.setItem;
          Storage.prototype.setItem = function (k, v) {
            localPerf.writing.push(k);
            return old.call(this, k, v);
          };
          let last = performance.now();
          const tick = (now) => {
            localPerf.frames.push(now - last);
            last = now;
            if (localPerf.running) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        for (let step = 0; step < 3; step++) {
          const s = await p.evaluate(() => paperlapDebug.local),
            points = s.current,
            index = points.reduce((a, q, i) => (q.x < points[a].x ? i : a), 0),
            q = points[index],
            r = await p.locator(".local-surface").boundingBox();
          await p.mouse.move(
            r.x + (q.x * r.width) / 1440,
            r.y + (q.y * r.height) / 860,
          );
          await p.mouse.down();
          await p.mouse.move(
            r.x + ((q.x - 3) * r.width) / 1440,
            r.y + (q.y * r.height) / 860,
            { steps: 20 },
          );
          assert.equal(
            await p.evaluate(() => paperlapDebug.local.metrics.validations),
            step,
          );
          assert.equal(
            await p.evaluate(() => paperlapDebug.local.textureCount),
            before.textures,
          );
          await p.mouse.up();
          await p.waitForFunction(
            () =>
              document
                .querySelector("#local-editor")
                .getAttribute("aria-busy") !== "true",
          );
          assert.equal(await p.locator("#local-adopt").isEnabled(), true);
          await p.locator("#local-adopt").click();
          await p.waitForFunction(
            () =>
              document
                .querySelector("#local-editor")
                .getAttribute("aria-busy") !== "true",
          );
        }
        const during = await p.evaluate(() => ({
          local: paperlapDebug.local,
          perf: localPerf,
          formal: localStorage.getItem("paperlap.save.v3"),
        }));
        assert.equal(during.formal, before.formal);
        assert.equal(during.local.metrics.validations, 3);
        assert.ok(
          during.local.metrics.frames <= during.local.metrics.pointerMoves + 3,
        );
        assert.equal(
          during.perf.writing.filter((k) => k === "paperlap.save.v3").length,
          0,
        );
        assert.ok(
          during.perf.writing.filter((k) => k === "paperlap.local-draft.v1")
            .length <= 3,
        );
        await p.locator("#local-save").click();
        await p.waitForFunction(() => !paperlapDebug.local.active);
        const completed = await p.evaluate(() => paperlapDebug.local.metrics);
        assert.equal(await p.evaluate(() => paperlapDebug.mode), "ready");
        await cdp.send("HeapProfiler.collectGarbage");
        const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
        for (let i = 0; i < 8; i++) {
          await p.locator("#local-edit").click();
          await p.keyboard.press("Escape");
        }
        await cdp.send("HeapProfiler.collectGarbage");
        const heapAfter = (await cdp.send("Runtime.getHeapUsage")).usedSize;
        const perf = await p.evaluate(() => {
          localPerf.running = false;
          return localPerf;
        });
        assert.equal(await p.locator("canvas").count(), before.canvas);
        assert.ok(
          heapAfter - heapBefore < 8_000_000,
          `bounded editor heap ${heapAfter - heapBefore}`,
        );
        const preview = stats(during.local.metrics.previewMs),
          release = stats(during.local.metrics.releaseMs),
          move = stats(perf.move);
        // Guard the high-frequency work relative to the strict release validation,
        // rather than claiming a universal frame rate on all desktop hardware.
        assert.ok(
          preview.p95Ms < release.p95Ms * 2 + 20 * rate,
          JSON.stringify({ count, rate, preview, release }),
        );
        assert.ok(move.p95Ms < release.p95Ms + 10 * rate);
        const sample = {
          count,
          cpuRate: rate,
          loadMs,
          preview,
          move,
          release,
          adopt: stats(during.local.metrics.adoptMs),
          save: stats(completed.saveMs),
          includingPaintWait: {
            release: stats(perf.release),
            adopt: stats(perf.adopt),
            save: stats(perf.save),
          },
          raf: stats(during.perf.frames),
          pointerEvents: during.local.metrics.pointerMoves,
          previewFrames: during.local.metrics.frames,
          releaseValidations: during.local.metrics.validations,
          textures: before.textures,
          canvas: before.canvas,
          heapGrowthBytes: heapAfter - heapBefore,
        };
        report.samples.push(sample);
        console.log(JSON.stringify(sample));
      } finally {
        await c.close();
      }
    }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
} finally {
  await writeFile(
    `${output}/performance.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
