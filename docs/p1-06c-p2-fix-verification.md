# P1-06C 两项 P2 焦点修复验证

基线 `3904352f6e7fd799bde398d6fe8e558bd274657f`；对应 Issue #21。应用只修改 `src/style.css` 和 `src/game/save-history.ts`，与已人工 Review 的实现哈希一致。提交版整理了证据链接和范围；完整已审核报告原稿、原始失败及 ZIP 仅本地保存，见 [证据范围说明](p1-06c-pr-evidence/README.md)。

**结果：两项 P2 已验证修复，发布建议 CONDITIONAL GO，PR 停 Code Review。** 不改变车辆物理、圈速、RULES_VERSION、几何算法、Save V3/身份/PB、Web Locks/草稿或 Esc 状态规则。`main.ts`、`game-menu.ts`、`trackbook-ui.ts` 未改。尚未执行正式 V1.0 发布。

## 根因与最小修复

| 问题 | 原始复现与根因 | 最终实现 |
| --- | --- | --- |
| QA-UI-01 | 普通名/40 字名 Tab 到 HUD，computed outline=solid 2px、pseudo content=none；HUD 与整笔编辑器共享 enclosing outline，未接入既有铅笔样式 | 只将 HUD 从旧共享 selector 移出，增加相对定位锚点并接入 keyboard 的纸色底、24×3px 短线、pointer 区分和 forced-colors 标记；保留整笔输入旧规则、Tab/title 和截断 |
| QA-UI-02 | WebKit 指针点击入口时 activeElement 是 BODY；open 误将它当作返回目标。鼠标返回后焦点留在已关闭 dialog，下一次 Esc 被其监听器消费 | 两类 onclick 显式传入实际入口按钮；close 聚焦可见有效目标，否则回历史入口；保留知晓提示隐藏 badge 后的现有回退、pause 顺序与 Esc 处理器 |

[原生点击捕获探针](p1-06c-pr-evidence/c2/before/webkit-click-probe.json) 在正常动效和 reduced-motion 都复现，排除了关闭动效覆盖焦点。修改前两个入口均可复现，修改后不再依赖指针是否自动聚焦按钮。

## 先失败、再修复

| 引擎 | 修复前实际检查 / FAIL / exit | 已审核最终 P2 | 提交前独立检出 P2 |
| --- | --- | --- | --- |
| Chromium | 132 / 9 / 1 | PASS 138/138 | PASS 138/138 |
| Firefox | 132 / 9 / 1 | PASS 138/138 | PASS 138/138 |
| WebKit | 117 / 39 / 1 | PASS 138/138 | PASS 138/138 |

[原始尝试与退出码](p1-06c-pr-evidence/c2/commands.json)。初版最多 132 项，WebKit 的失败路径无法进入后续 book 检查，因此实际 117 项；最终增加真实提示消失回退和像素验证成为 138 项。未完成项没有写成 PASS，历史失败没有改写。

第一次 after-dev WebKit 仍有 3 个 FAIL：测试要求 CSSOM forced-color-adjust=none，但 [实际能力探针](p1-06c-pr-evidence/c2/webkit-forced-capability.json) 返回 unsupported。该日志保留。最终在支持该属性时保留原断言，不支持时明确记未测，并追加实际 PNG 标记色像素验证（Chromium 22/22/24，Firefox 29/30/28，WebKit 45/46/43）。没有仅靠元素或 computed content 存在判通过，也没有偷偷换 Chromium。真实 OS 高对比度未测。

## 三引擎、三视口与实际交互

macOS 15.7.9 / M3 Pro / arm64；Node 22.23.3、Playwright 1.56.1；Chromium 141.0.7390.37、Firefox 142.0.1、WebKit 26.0。1366×768、1280×800、900×700，DPR 1。显式 headless、独立 context，不接管用户 Chrome 或桌面。

P2 专项真实执行普通/40 字名、Tab/Shift+Tab、pointer 区分、forced-colors/reduced-motion；历史和只读入口 × 鼠标/Enter/Space 打开 × 鼠标/Esc 关闭，再 Esc 进菜单；T→book→Esc 回 menu-book→Esc 回游戏区；另含真实驾驶中打开后保持暂停。WebKit 的原生按钮导航按实际平台策略记录 Option+Tab，HUD 名称仍用普通 Tab/Shift+Tab。

[117 条常规返回路径](p1-06c-pr-evidence/c2/esc-paths.json) 逐步记录焦点、可见性、祖先 dialog、mode、面板状态。第一下关闭仅关闭历史，下一下 Esc 仅打开菜单；车/计时/正式原文不变，不自动驾驶。另有 9 个真实保存成功但草稿清理失败场景，从警告打开、知晓使入口隐藏、返回历史入口、再 Esc；正式值和旧草稿原文仍保留。

[18 组普通/长名 bounding boxes 比较](p1-06c-pr-evidence/c2/layout-comparison.json) 差值均为 0px。各引擎最终 report 记录实际 DOM Range、全文 title、短线、背景、CSS 能力、像素和状态：

| 引擎 | 已审核最终 P2 DOM | 提交前干净检出 DOM | 最终 UX |
| --- | --- | --- | --- |
| chromium | [138 PASS](p1-06c-pr-evidence/c2/after/chromium/p2/report.json) | [138 PASS](p1-06c-pr-evidence/final/cross/chromium/p2/report.json) | [92 PASS](p1-06c-pr-evidence/final/cross/chromium/ux/report.json) |
| firefox | [138 PASS](p1-06c-pr-evidence/c2/after/firefox/p2/report.json) | [138 PASS](p1-06c-pr-evidence/final/cross/firefox/p2/report.json) | [92 PASS](p1-06c-pr-evidence/final/cross/firefox/ux/report.json) |
| webkit | [138 PASS](p1-06c-pr-evidence/c2/after/webkit/p2/report.json) | [138 PASS](p1-06c-pr-evidence/final/cross/webkit/p2/report.json) | [92 PASS](p1-06c-pr-evidence/final/cross/webkit/ux/report.json) |

代表前后截图（三种视口与引擎；完整九组截图仅本地 Review 包保留）：

| 场景 | before | after |
| --- | --- | --- |
| chromium 1366 HUD 长名 | [截图](p1-06c-pr-evidence/c2/before/chromium/p2/1366-long-keyboard.png) | [截图](p1-06c-pr-evidence/c2/after/chromium/p2/1366-long-keyboard.png) |
| firefox 1280 HUD 长名 | [截图](p1-06c-pr-evidence/c2/before/firefox/p2/1280-long-keyboard.png) | [截图](p1-06c-pr-evidence/c2/after/firefox/p2/1280-long-keyboard.png) |
| webkit 900 HUD 长名 | [截图](p1-06c-pr-evidence/c2/before/webkit/p2/900-long-keyboard.png) | [截图](p1-06c-pr-evidence/c2/after/webkit/p2/900-long-keyboard.png) |
| WebKit 900 鼠标返回 | [截图](p1-06c-pr-evidence/c2/before/webkit/p2/900-hud-pointer-pointer-returned.png) | [截图](p1-06c-pr-evidence/c2/after/webkit/p2/900-hud-pointer-pointer-returned.png) |

[下一次 Esc 的菜单](p1-06c-pr-evidence/c2/after/webkit/ux/esc-menu-900.png)、[Chromium forced-colors](p1-06c-pr-evidence/c2/after/chromium/p2/900-long-forced.png)、[WebKit media 标记](p1-06c-pr-evidence/c2/after/webkit/p2/900-long-forced.png)。图片展示上下文，焦点是否有效由原生操作和 DOM/下一次 Esc 断言判断。

## 回归与独立检出

C2 [11 个受影响命令](p1-06c-pr-evidence/c2/regressions.json) 全部退出 0：typecheck、120 单测、build、focus、HUD、menu、trackbook、browser、local-game、local-response、motion。C1 [20 命令结果](p1-06c-pr-evidence/c1/regressions.json) 和所有原始失败保留；其余存档、draft、handling、sound、性能及双 PB 链路详见 [发布验收清单](p1-06-release-checklist.md)。

C3 提交前重新运行以下 15 个命令实例，均在不含旧证据目录的独立检出中执行；源码和测试保持已审核哈希，`npm ci` 后构建并访问 production preview。未使用未跟踪审计 JSON。

| 引擎 / 命令 | 状态 / exit | 秒 | 日志 |
| --- | --- | --- | --- |
| node `npm run typecheck` | PASS / 0 | 1.13 | [日志](p1-06c-pr-evidence/final/static/node/typecheck/run.log) |
| node `npm run test` | PASS / 0 | 6.63 | [日志](p1-06c-pr-evidence/final/static/node/test/run.log) |
| node `npm run build` | PASS / 0 | 2.16 | [日志](p1-06c-pr-evidence/final/static/node/build/run.log) |
| chromium `npm run test:focus` | PASS / 0 | 23.99 | [日志](p1-06c-pr-evidence/final/focused/chromium/focus/run.log) |
| chromium `npm run test:hud` | PASS / 0 | 61.17 | [日志](p1-06c-pr-evidence/final/focused/chromium/hud/run.log) |
| chromium `node tests/p2-focus-browser.mjs` | PASS / 0 | 178.79 | [日志](p1-06c-pr-evidence/final/cross/chromium/p2/run.log) |
| chromium `node tests/release-smoke.mjs` | PASS / 0 | 39.57 | [日志](p1-06c-pr-evidence/final/cross/chromium/smoke/run.log) |
| chromium `npm run test:menu` | PASS / 0 | 188.67 | [日志](p1-06c-pr-evidence/final/focused/chromium/menu/run.log) |
| chromium `node tests/ux-polish-browser.mjs` | PASS / 0 | 159.29 | [日志](p1-06c-pr-evidence/final/cross/chromium/ux/run.log) |
| firefox `node tests/p2-focus-browser.mjs` | PASS / 0 | 37.89 | [日志](p1-06c-pr-evidence/final/cross/firefox/p2/run.log) |
| firefox `node tests/release-smoke.mjs` | PASS / 0 | 13.85 | [日志](p1-06c-pr-evidence/final/cross/firefox/smoke/run.log) |
| firefox `node tests/ux-polish-browser.mjs` | PASS / 0 | 69.54 | [日志](p1-06c-pr-evidence/final/cross/firefox/ux/run.log) |
| webkit `node tests/p2-focus-browser.mjs` | PASS / 0 | 33.09 | [日志](p1-06c-pr-evidence/final/cross/webkit/p2/run.log) |
| webkit `node tests/release-smoke.mjs` | PASS / 0 | 9.73 | [日志](p1-06c-pr-evidence/final/cross/webkit/smoke/run.log) |
| webkit `node tests/ux-polish-browser.mjs` | PASS / 0 | 52.28 | [日志](p1-06c-pr-evidence/final/cross/webkit/ux/run.log) |

[提交前完整结果](p1-06c-pr-evidence/final/results.json)；未在 C3 重复执行的旧套件只按 C1/C2 历史 PASS 引用。未删断言、加固定 sleep、改保存规则或更换引擎。build 保留既有 Phaser 大块提示，不是构建失败。

干净检出复跑：

```bash
npm ci
npx playwright install chromium firefox webkit
npm run build
npm run preview -- --port 4241 --strictPort --open false
PAPERLAP_URL=http://127.0.0.1:4241 PAPERLAP_BROWSER=webkit PAPERLAP_P2_OUTPUT=test-results/p2/webkit node tests/p2-focus-browser.mjs
PAPERLAP_URL=http://127.0.0.1:4241 PAPERLAP_BROWSER=firefox PAPERLAP_UX_OUTPUT=test-results/ux/firefox node tests/ux-polish-browser.mjs
```

测试依赖的 `release-engine.mjs`、`release-png.mjs` 随 PR 提交；`ux-legacy-save-v2.json` 和性能 fixture 已在 master 跟踪。应用只改两份界面文件，没有协议或规则变更。

## 风险与提交范围

两项 P2 已验证修复，未发现新 P0/P1；真实 Safari、其他设备/OS/DPR/缩放、真实后台/BFCache/睡眠恢复、实际听感、真实 IME/辅助技术和 OS 高对比度仍 NOT TESTED，建议仍为 CONDITIONAL GO。没有正式 V1.0 发布、Tag、Release 或部署。

[完整提交文件清单、用途和体积](p1-06c-pr-evidence/manifest.json)。完整历史证据、录像、导出与 Review ZIP 仅本地保留，不加入本 PR；本报告所有 Markdown 相对证据链接均指实际提交文件。PR 只 `Refs #21`，停 Code Review。
