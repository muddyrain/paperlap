import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performanceFixtures } from "./fixtures/local-performance.mjs";
delete process.env.PWDEBUG;
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const phase = process.env.PAPERLAP_PHASE || "after",
  base = process.env.PAPERLAP_URL || "http://127.0.0.1:4188",
  output = `test-results/p1-06/${phase}`;
await mkdir(output, { recursive: true });
const report = {
  phase,
  browser: browser.version(),
  cases: [],
  errors: [],
  failedRequests: [],
};
const idle = (p) =>
  p.waitForFunction(
    () =>
      document.querySelector("#local-editor").getAttribute("aria-busy") !==
      "true",
  );
const state = (p) => p.evaluate(() => paperlapDebug);
const stages = (a) =>
  Object.fromEntries(
    [...new Set(a.map((v) => v.phase))].map((k) => [
      k,
      a.filter((v) => v.phase === k).map((v) => v.ms),
    ]),
  );
try {
  for (const tracks of [1, 5, 20])
    for (const rate of [1, 4]) {
      const c = await browser.newContext({ reducedMotion: "reduce" });
      try {
        await c.addInitScript((seed) => {
          if (
            !/^https?:$/.test(location.protocol) ||
            localStorage.getItem("cold-seeded")
          )
            return;
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
          localStorage.setItem("cold-seeded", "1");
        }, performanceFixtures[`900-${tracks}`]);
        const p = await c.newPage();
        p.on("pageerror", (e) => report.errors.push(e.message));
        p.on("console", (m) => {
          if (m.type() === "error") report.errors.push(m.text());
        });
        p.on("requestfailed", (r) => report.failedRequests.push(r.url()));
        const cdp = await c.newCDPSession(p);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate });
        await p.goto(`${base}/?debug=1&profile=1`);
        await p.waitForFunction(
          () => window.paperlapDebug && document.querySelector("#game canvas"),
        );
        await p.locator("#local-edit").click();
        for (let i = 0; i < 2; i++) {
          const s = await state(p),
            q = s.local.current.reduce((a, b) => (b.x < a.x ? b : a)),
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
          await p.mouse.up();
          await idle(p);
          await p.locator("#local-adopt").click();
          await idle(p);
        }
        const before = await p.evaluate(() => ({
          formal: localStorage.getItem("paperlap.save.v3"),
          checkpoint: JSON.parse(
            localStorage.getItem("paperlap.local-draft.v1"),
          ).entries[0].checkpoint,
        }));
        await p.reload();
        await p.waitForFunction(
          () => window.paperlapDebug && document.querySelector("#game canvas"),
        );
        const cold = (await state(p)).profile;
        await p.evaluate(() => {
          window.recoveryTimes = {};
          for (const [id, key] of [
            ["local-edit", "entry"],
            ["local-continue", "continue"],
          ]) {
            const e = document.getElementById(id);
            let start;
            e.addEventListener(
              "click",
              () => {
                start = performance.now();
              },
              true,
            );
            e.addEventListener("click", () => {
              recoveryTimes[key] = performance.now() - start;
            });
          }
        });
        const t = await p.evaluate(() => performance.now());
        await p.locator("#local-edit").click();
        assert.equal(await p.locator("#local-recovery").isVisible(), true);
        const opened = await state(p);
        assert.notDeepEqual(opened.local.current, before.checkpoint.current);
        assert.equal(
          opened.profile.filter(
            (s) => s.start >= t && s.phase === "draft.validate",
          ).length,
          2,
        );
        const strict = opened.local.proof?.strict;
        await p.locator("#local-continue").click();
        assert.deepEqual(
          (await state(p)).local.current,
          before.checkpoint.current,
        );
        if (phase === "after")
          assert.equal(
            (await state(p)).local.proof.strict,
            strict,
            "unknown bytes checked at open, exact restore reuses only those proofs",
          );
        await p.keyboard.press("Control+z");
        assert.deepEqual(
          (await state(p)).local.current,
          before.checkpoint.previous,
        );
        await p.keyboard.press("Control+Shift+z");
        assert.deepEqual(
          (await state(p)).local.current,
          before.checkpoint.current,
        );
        assert.equal(
          await p.evaluate(() => localStorage.getItem("paperlap.save.v3")),
          before.formal,
        );
        const times = await p.evaluate(() => recoveryTimes);
        report.cases.push({
          points: 900,
          tracks,
          cpuRate: rate,
          coldLoad: stages(cold),
          entry: stages(opened.profile.filter((s) => s.start >= t)),
          entryCpuMs: times.entry,
          continueCpuMs: times.continue,
        });
        console.log(
          `PASS ${phase} cold recovery: 900 x ${tracks} / ${rate}x; entry ${times.entry.toFixed(1)}ms, continue ${times.continue.toFixed(1)}ms`,
        );
      } finally {
        await c.close();
      }
    }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
} finally {
  await writeFile(`${output}/recovery.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
