import assert from "node:assert/strict";
import { screenshotLoop } from "./editor-paths.mjs";

// Real browser actions against the production build; debug snapshots are read-only.
export async function verifyTrackbookUX(h) {
  const {
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
  } = h;
  const a = ab.tracks[0],
    b = ab.tracks[1];
  const settled = (page) =>
    page.locator('#trackbook[data-motion="open"]').waitFor();
  const hidden = (page) =>
    page.locator("#trackbook").waitFor({ state: "hidden" });
  const focus = (page) =>
    page.evaluate(
      () =>
        document.activeElement?.id ||
        document.activeElement?.closest("[data-uid]")?.dataset.uid,
    );
  const dispatch = (page, code, extra = {}, selector = "#game") =>
    page.locator(selector).evaluate(
      (el, { code, extra }) =>
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            code,
            key: code,
            bubbles: true,
            cancelable: true,
            ...extra,
          }),
        ),
      { code, extra },
    );

  await isolated(async (page) => {
    await seed(page, ab);
    assert.equal(await focus(page), "game");
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
      { repeat: true },
    ])
      for (const code of ["KeyT", "KeyE", "KeyR", "Space"])
        await dispatch(page, code, extra);
    assert.equal((await state(page)).mode, "ready");
    assert.equal(await page.locator("#trackbook").isVisible(), false);
    await page.keyboard.press("Space");
    assert.equal((await state(page)).mode, "running");
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(() => window.paperlapDebug.car.speed > 10);
    await page.keyboard.press("t");
    await settled(page);
    await page.keyboard.up("ArrowUp");
    const stopped = await state(page);
    assert.equal(stopped.mode, "paused");
    assert.deepEqual(stopped.keys, []);
    await page.waitForFunction(
      () => window.paperlapDebug.sound.motorGain < 0.001,
    );
    assert.equal(await focus(page), b.uid);
    const raw = await read(page);
    await page.keyboard.press("ArrowUp");
    assert.equal(await focus(page), a.uid);
    assert.equal((await state(page)).activeTrackUid, b.uid);
    assert.equal(await read(page), raw);
    await page.keyboard.press("Enter");
    assert.equal((await state(page)).activeTrackUid, a.uid);
    assert.equal((await state(page)).mode, "ready");
    assert.equal(await page.locator("#track-name").innerText(), a.track.name);
    assert.equal(await page.locator("#best").innerText(), "00:24.68");
    assert.equal(await row(page, a.uid).getAttribute("aria-current"), "true");
    assert.match(await page.locator("#trackbook-status").innerText(), /已使用/);
    const selectedRaw = await read(page);
    const selectedNode = await row(page, a.uid).evaluate((el) => {
      window.currentCard = el;
      return true;
    });
    assert.ok(selectedNode);
    await page.keyboard.press("Enter");
    assert.equal(
      await row(page, a.uid).evaluate((el) => el === window.currentCard),
      true,
      "reselect does not regenerate cards",
    );
    assert.equal(await read(page), selectedRaw);
    await page.keyboard.press("Escape");
    await hidden(page);
    assert.equal(await focus(page), "game");
    await page.waitForTimeout(240);
    assert.equal((await state(page)).mode, "ready");
    assert.equal((await state(page)).car.speed, 0);
    await page.keyboard.press("Space");
    assert.equal((await state(page)).mode, "running");
    await page.keyboard.press("Space");
    assert.equal((await state(page)).mode, "paused");
    await page.keyboard.press("r");
    assert.equal((await state(page)).mode, "running");
    await page.keyboard.press("Space");
    assert.equal(await focus(page), "game");
    assert.equal((await state(page)).mode, "paused");
    await page.keyboard.press("Space");
    assert.equal((await state(page)).mode, "running");
    await page.keyboard.press("Space");
    const beforeEdit = await read(page);
    await page.keyboard.press("e");
    assert.equal((await state(page)).mode, "editing");
    assert.equal(
      await page.locator("#editor-title").innerText(),
      "编辑当前赛道",
    );
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "paused");
    assert.equal(await focus(page), "game");
    assert.equal(await read(page), beforeEdit);
    await page.keyboard.press("e");
    await page.locator("#cancel-edit").focus();
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.equal((await state(page)).mode, "paused");
    assert.equal(await focus(page), "game");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#game-menu").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).mode, "paused");
    await page.locator("#trackbook-open").focus();
    await page.keyboard.press("Space"); // Native button action, no game toggle.
    await settled(page);
    assert.equal((await state(page)).mode, "paused");
    await close(page);
    assert.equal(await focus(page), "trackbook-open");
    check(
      "T/E/Space/R scopes, modifiers/IME/repeat, held-key release, arrow-only focus, native button Space and real A/B Enter switch",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    await page.keyboard.press("t");
    await settled(page);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator("#trackbook")
          .evaluate((el) => el.contains(document.activeElement)),
        true,
      );
    }
    await row(page, a.uid).locator('[data-action="rename"]').click();
    await page.locator("#track-name-input").fill("改名后保留当前赛道 B");
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      window.renameWrites = 0;
      window.restoreRenameCounter = () => {
        Storage.prototype.setItem = set;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === "paperlap.save.v3") window.renameWrites++;
        return set.call(this, key, value);
      };
    });
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.equal((await state(page)).activeTrackUid, b.uid);
    assert.equal(await focus(page), a.uid);
    assert.equal(await page.evaluate(() => window.renameWrites), 1);
    await page.evaluate(() => window.restoreRenameCounter());
    for (const action of ["rename", "delete"]) {
      await row(page, b.uid).locator(`[data-action="${action}"]`).focus();
      await page.keyboard.press("Enter");
      if (action === "rename") {
        const raw = await read(page);
        await page.locator("#track-name-input").fill("T E N R WASD");
        for (const code of ["KeyT", "KeyE", "KeyN", "KeyR", "Space"])
          await dispatch(page, code, {}, "#track-name-input");
        for (const extra of [
          { ctrlKey: true },
          { metaKey: true },
          { altKey: true },
          { isComposing: true },
          { repeat: true },
        ])
          await dispatch(page, "Escape", extra, "#track-name-input");
        assert.equal(await page.locator("#rename-form").isVisible(), true);
        assert.equal(await read(page), raw);
      }
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#trackbook-list").isVisible(), true);
      assert.equal(await page.locator("#trackbook").isVisible(), true);
      assert.equal(await focus(page), b.uid);
    }
    const raw = await read(page);
    await page.keyboard.press("n");
    assert.equal((await state(page)).mode, "editing");
    assert.equal(await page.locator("#editor-title").innerText(), "新建赛道");
    assert.equal(await page.locator("#trackbook").isVisible(), false);
    await draw(page);
    await page.keyboard.press("r");
    assert.equal(await page.locator("#drive-drawing").isEnabled(), false);
    await draw(page);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.equal((await state(page)).mode, "ready");
    const saved = JSON.parse(await read(page));
    assert.equal(saved.tracks.length, 3);
    assert.deepEqual(saved.tracks.slice(0, 2), JSON.parse(raw).tracks);
    await page.reload();
    await page.waitForFunction(() => window.paperlapDebug);
    assert.equal((await state(page)).activeTrackUid, saved.activeTrackUid);
    assert.equal((await state(page)).mode, "ready");
    check(
      "Esc returns from rename/delete before closing; input isolation; N creates independently, R redraws, repeated Enter saves once and reload restores ready",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    await open(page);
    const shape = async (uid) =>
      row(page, uid).locator(".track-thumb svg path").first().getAttribute("d");
    const apath = await shape(a.uid),
      bpath = await shape(b.uid);
    assert.notEqual(apath, bpath);
    for (const entry of [a, b]) {
      const points = entry.track.points;
      assert.equal(
        await shape(entry.uid),
        points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") + " Z",
      );
      assert.equal(
        await row(page, entry.uid)
          .locator(".track-thumb path")
          .nth(1)
          .getAttribute("stroke-width"),
        String(entry.track.width),
      );
      assert.match(
        await row(page, entry.uid).locator(".track-best").innerText(),
        entry === a ? /24.68/ : /35.00/,
      );
    }
    await row(page, b.uid).locator('[data-action="rename"]').click();
    await page.locator("#track-name-input").fill("小湖边的铅笔赛道");
    await page.keyboard.press("Enter");
    assert.equal(await shape(b.uid), bpath);
    assert.equal(
      await page.locator("#track-name").innerText(),
      "小湖边的铅笔赛道",
    );
    assert.equal(await focus(page), b.uid);
    assert.match(
      await page.locator("#trackbook-status").innerText(),
      /名称已保存/,
    );
    await close(page);
    await page.locator("#game").focus();
    await page.keyboard.press("e");
    await draw(page, screenshotLoop);
    await page.keyboard.press("Enter");
    assert.equal((await state(page)).mode, "running");
    await page.keyboard.press("t");
    await settled(page);
    assert.notEqual(await shape(b.uid), bpath);
    const replacement = (await state(page)).track;
    assert.equal(
      await shape(b.uid),
      replacement.points
        .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
        .join(" ") + " Z",
    );
    assert.equal(
      await row(page, b.uid).locator(".track-best").innerText(),
      "暂无纪录",
    );
    assert.equal(await page.locator("#best").innerText(), "--:--.--");
    const same = structuredClone(ab);
    same.tracks[1].track = { ...a.track, name: "相同路线独立作品" };
    same.tracks[1].geometryDigest = a.geometryDigest;
    same.records = {
      ...same.records,
      [`${b.uid}:${same.tracks[1].geometryIdentity}:rules-2`]: 32,
      [`${a.uid}:${a.geometryIdentity}:rules-1`]: 12,
    };
    await close(page);
    await seed(page, same);
    await open(page);
    assert.match(
      await row(page, a.uid).locator(".track-best").innerText(),
      /24.68/,
    );
    assert.match(
      await row(page, b.uid).locator(".track-best").innerText(),
      /32.00/,
    );
    assert.equal(await shape(a.uid), await shape(b.uid));
    check(
      "SVG centerlines and widths match real A/B geometry; rename preserves and real replacement updates thumbnail; cards use UID + geometry + current rules best",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    await open(page);
    const old = await read(page),
      oldPath = await row(page, b.uid).locator(".track-thumb").innerHTML();
    await blockWrites(page);
    await row(page, a.uid).locator('[data-action="select"]').click();
    assert.equal(await read(page), old);
    assert.equal(await row(page, b.uid).getAttribute("aria-current"), "true");
    assert.equal(await row(page, a.uid).getAttribute("aria-current"), null);
    assert.equal(
      await row(page, b.uid).locator(".track-thumb").innerHTML(),
      oldPath,
    );
    assert.equal(
      await page.locator("#trackbook-status").getAttribute("data-kind"),
      "error",
    );
    assert.doesNotMatch(await page.locator("#toast").innerText(), /赛道已切换/);
    assert.equal(
      await page
        .locator("#track-name")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    await restoreWrites(page);
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator("#trackbook-status").getAttribute("data-kind"),
      "success",
    );
    assert.equal((await state(page)).activeTrackUid, a.uid);
    assert.equal((await state(page)).mode, "ready");
    check(
      "failed switch preserves cards/thumbnail/selection and shows no success motion; Enter retries the same card after storage recovers",
    );
  });

  await isolated(async (page) => {
    await seed(page, ab);
    const opened = await page.locator("#game").evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyT", bubbles: true }),
      );
      const dialog = document.querySelector("#trackbook");
      return {
        state: dialog.dataset.motion,
        duration: dialog.getAnimations()[0]?.effect.getTiming().duration,
      };
    });
    assert.deepEqual(opened, { state: "opening", duration: 300 });
    // Capture a deterministic midpoint, then let the real animation finish.
    await page.locator("#trackbook").evaluate((el) => {
      for (const animation of el.getAnimations()) {
        animation.pause();
        animation.currentTime = 150;
      }
    });
    await page.screenshot({ path: `${output}drawer-opening-1366.png` });
    await page.locator("#trackbook").evaluate((el) => {
      for (const animation of el.getAnimations()) animation.play();
    });
    await settled(page);
    const closing = await row(page, b.uid)
      .locator('[data-action="select"]')
      .evaluate((el) => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return document.querySelector("#trackbook").open;
      });
    assert.equal(
      closing,
      false,
      "modal closes immediately; only inert paper exits",
    );
    assert.equal(await focus(page), "game");
    await page.keyboard.press("t"); // Reopen while the old visual exits.
    await settled(page);
    await page.keyboard.press("ArrowUp");
    assert.equal(await focus(page), a.uid);
    await page.keyboard.press("Escape");
    await hidden(page);
    await page.keyboard.press("t");
    await settled(page);
    await page.waitForTimeout(240);
    assert.equal(
      await page.locator("#trackbook-open").getAttribute("aria-expanded"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" }); // Changing preference removes an exiting visual immediately.
    await hidden(page);
    assert.equal(await focus(page), "game");
    await page.keyboard.press("t");
    assert.equal(
      await page.locator("#trackbook").getAttribute("data-motion"),
      "open",
    );
    assert.equal(
      await page
        .locator("#trackbook")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    assert.equal((await state(page)).activeTrackUid, a.uid);
    assert.equal(
      await page
        .locator("#track-name")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    assert.equal(
      await page.locator("#toast").evaluate((el) => el.getAnimations().length),
      0,
    );
    await page.screenshot({ path: `${output}drawer-reduced-motion-1366.png` });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#trackbook").isVisible(), false);
    check(
      "300/180ms drawer presentation never delays modal close, rapid reopen retains focus, reduced motion removes animations including during exit",
    );
  });

  await isolated(async (page) => {
    const full = structuredClone(ab);
    full.tracks = Array.from({ length: 20 }, (_, i) => ({
      ...full.tracks[i % 2],
      uid: `entry-${i}`,
      geometryIdentity: `g-${(i + 1).toString(16).padStart(32, "0")}`,
      track: {
        ...full.tracks[i % 2].track,
        name: `${i + 1} 号 · 清晨绕湖的纸上飞驰练习赛道`.repeat(3).slice(0, 40),
      },
    }));
    full.activeTrackUid = "entry-19";
    full.records = {};
    await seed(page, full);
    const canvas = await page.locator("#game canvas").boundingBox(),
      old = await read(page);
    await open(page);
    assert.match(await page.locator("#track-count").innerText(), /20 \/ 20/);
    assert.equal(await focus(page), "entry-19");
    assert.deepEqual(await page.locator("#game canvas").boundingBox(), canvas);
    assert.equal(
      await page
        .locator("#track-list")
        .evaluate(
          (el) => el.scrollHeight > el.clientHeight && el.scrollTop > 0,
        ),
      true,
    );
    assert.equal(
      await row(page, "entry-19")
        .locator('[data-action="select"]')
        .getAttribute("title"),
      full.tracks[19].track.name,
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(await focus(page), "entry-0");
    await page.keyboard.press("n");
    assert.equal(await page.locator("#trackbook").isVisible(), true);
    assert.match(await page.locator("#trackbook-status").innerText(), /20/);
    assert.equal(await read(page), old);
    assert.deepEqual(await page.locator("#game canvas").boundingBox(), canvas);
    await page.keyboard.press("ArrowUp");
    const scrollAtExit = await page
      .locator("#track-list")
      .evaluate((el) => el.scrollTop);
    assert.ok(scrollAtExit > 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#trackbook").isVisible(), false);
    assert.equal(
      await page
        .locator('.motion-echo [data-echo-id="track-list"]')
        .evaluate((el) => el.scrollTop),
      scrollAtExit,
      "exiting paper keeps the last visible cards",
    );
    check(
      "20 long-name cards scroll internally, exit keeps scroll position, arrows wrap, full names stay accessible, N explains cap without changing canvas/save",
    );
  });

  await isolated(async (page) => {
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1280, height: 800 },
      { width: 900, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await seed(page, ab);
      const keycaps = async () => {
        const failures = await page
          .locator("button:visible")
          .evaluateAll((buttons) =>
            buttons.flatMap((el) => {
              const kbd = el.querySelector("kbd"),
                label =
                  el.querySelector(".button-label") ||
                  el.querySelector("#drawing-action");
              if (!kbd) return [];
              const r = el.getBoundingClientRect(),
                k = kbd.getBoundingClientRect();
              return el.querySelector("svg") &&
                /[\u4e00-\u9fff]/.test(el.textContent) &&
                el.hasAttribute("aria-keyshortcuts") &&
                k.width > 0 &&
                k.right <= r.right + 1 &&
                (!label || label.scrollWidth <= label.clientWidth + 1)
                ? []
                : [el.id || el.textContent];
            }),
          );
        assert.deepEqual(failures, []);
      };
      await keycaps();
      await page.keyboard.press("t");
      await settled(page);
      await keycaps();
      await row(page, a.uid).locator('[data-action="select"]').click();
      await page.screenshot({ path: `${output}drawer-${viewport.width}.png` });
      await close(page);
      await page.screenshot({
        path: `${output}switch-ready-${viewport.width}.png`,
      });
      await page.locator("#game").focus();
      await page.keyboard.press("e");
      await keycaps();
      await page.keyboard.press("Escape");
      check(
        `${viewport.width}×${viewport.height}: real A/B cards, selection, visible icon + Chinese + keycaps in game/drawer/editor and ready switch feedback`,
      );
    }
  });
}
