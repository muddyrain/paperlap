import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { performanceFixtures } from "./fixtures/local-performance.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const phase = process.env.PAPERLAP_PHASE || "after";
const output = `test-results/p1-06/${phase}`;
const base = process.env.PAPERLAP_URL || "http://127.0.0.1:4188";
await mkdir(output, { recursive: true });
const stats = (a) => {
  const v = [...a].sort((a, b) => a - b);
  return {
    median: v[Math.floor(v.length / 2)] ?? 0,
    p95: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] ?? 0,
    max: v.at(-1) ?? 0,
    samples: a,
  };
};
const stages = (rows) =>
  Object.fromEntries(
    [...new Set(rows.map((s) => s.phase))].map((k) => [
      k,
      stats(rows.filter((s) => s.phase === k).map((s) => s.ms)),
    ]),
  );
const report = {
  environment: {
    cpu: os.cpus()[0].model,
    browser: browser.version(),
    platform: os.platform(),
    phase,
  },
  cases: [],
  errors: [],
  failedRequests: [],
};
const state = (p) => p.evaluate(() => paperlapDebug);
const done = (p) => p.waitForFunction(() => !paperlapDebug.local.busy);
try {
  for (const count of [200, 450, 900])
    for (const tracks of [1, 5, 20])
      for (const rate of [1, 4]) {
        const c = await browser.newContext({
          viewport: { width: 1366, height: 768 },
          reducedMotion: "reduce",
        });
        try {
          await c.addInitScript((seed) => {
            if (
              !/^https?:$/.test(location.protocol) ||
              localStorage.getItem("perf-seed")
            )
              return;
            for (const [k, v] of Object.entries(seed))
              localStorage.setItem(k, v);
            localStorage.setItem("perf-seed", "1");
          }, performanceFixtures[`${count}-${tracks}`]);
          const p = await c.newPage();
          p.on("pageerror", (e) => report.errors.push(e.message));
          p.on("console", (m) => {
            if (m.type() === "error") report.errors.push(m.text());
          });
          p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
          const cdp = await c.newCDPSession(p);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate });
          const tracing = count === 900 && tracks === 20 && rate === 4;
          if (tracing) {
            await cdp.send("Profiler.enable");
            await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
            await cdp.send("Profiler.start");
          }
          await p.goto(`${base}/?debug=1&profile=1`);
          await p.waitForFunction(
            () =>
              window.paperlapDebug && document.querySelector("#game canvas"),
          );
          const load = (await state(p)).profile;
          const sample = {
            points: count,
            tracks,
            cpuRate: rate,
            coldLoad: stages(load),
            rounds: [],
          };
          await p.evaluate(() => {
            window.phasePerf = {
              read: [],
              write: [],
              click: [],
              raf: [],
              paint: [],
              last: performance.now(),
              running: true,
            };
            for (const method of ["getItem", "setItem", "removeItem"]) {
              const old = Storage.prototype[method];
              Storage.prototype[method] = function (k, ...args) {
                const start = performance.now();
                try {
                  return old.call(this, k, ...args);
                } finally {
                  phasePerf[method === "getItem" ? "read" : "write"].push({
                    key: k,
                    method,
                    ms: performance.now() - start,
                  });
                }
              };
            }
            const tick = (t) => {
              phasePerf.raf.push(t - phasePerf.last);
              phasePerf.last = t;
              const busy = document
                .querySelector("#local-editor")
                ?.getAttribute("aria-busy");
              if (busy === "true")
                phasePerf.paint.push({
                  at: t,
                  text: document.querySelector("#local-status").textContent,
                });
              if (phasePerf.running) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          for (let round = 0; round < 2; round++) {
            const start = await p.evaluate(() => performance.now());
            await p.locator("#local-edit").click();
            await done(p);
            const entered = await state(p),
              before = await p.evaluate(() =>
                localStorage.getItem("paperlap.save.v3"),
              );
            const ops = [];
            for (let step = 0; step < 3; step++) {
              const s = await state(p),
                points = s.local.current,
                q = points.reduce((a, b) => (b.x < a.x ? b : a)),
                r = await p.locator(".local-surface").boundingBox();
              await p.mouse.move(
                r.x + (q.x * r.width) / 1440,
                r.y + (q.y * r.height) / 860,
              );
              await p.mouse.down();
              await p.mouse.move(
                r.x + ((q.x - 3) * r.width) / 1440,
                r.y + (q.y * r.height) / 860,
                { steps: 8 },
              );
              const t = await p.evaluate(() => performance.now());
              await p.mouse.up();
              await done(p);
              await p.waitForFunction(
                () =>
                  paperlapDebug.local.pending !== null &&
                  !paperlapDebug.local.busy,
              );
              const ready = await state(p);
              assert.equal(ready.local.pending.error, null);
              await p.locator("#local-adopt").click();
              await done(p);
              await p.waitForFunction(() => !paperlapDebug.local.pending);
              const accepted = await state(p);
              ops.push({
                step,
                path: step === 0 && round === 0 ? "cold-draft" : "hot",
                stages: stages(accepted.profile.filter((s) => s.start >= t)),
              });
            }
            assert.equal(
              await p.evaluate(() => localStorage.getItem("paperlap.save.v3")),
              before,
            );
            const t = await p.evaluate(() => performance.now());
            await p.locator("#local-save").click();
            await p.waitForFunction(() => !paperlapDebug.local.active);
            assert.equal((await state(p)).mode, "ready");
            const saved = await state(p);
            sample.rounds.push({
              round,
              entry: stages(entered.profile.filter((s) => s.start >= start)),
              operations: ops,
              save: stages(saved.profile.filter((s) => s.start >= t)),
            });
          }
          const perf = await p.evaluate(() => {
            phasePerf.running = false;
            return phasePerf;
          });
          sample.storageReads = stages(
            perf.read.map((s) => ({ ...s, phase: s.key })),
          );
          sample.storageWrites = stages(
            perf.write.map((s) => ({ ...s, phase: s.key })),
          );
          sample.raf = stats(perf.raf);
          sample.busyFrames = perf.paint.length;
          if (tracing) {
            const profile = (await cdp.send("Profiler.stop")).profile;
            await writeFile(
              `${output}/900-20-4x.cpuprofile`,
              JSON.stringify(profile),
            );
          }
          report.cases.push(sample);
          console.log(
            `PASS ${phase}: ${count} points x ${tracks} tracks / ${rate}x`,
          );
        } finally {
          await c.close();
        }
      }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
} finally {
  await writeFile(`${output}/phases.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
