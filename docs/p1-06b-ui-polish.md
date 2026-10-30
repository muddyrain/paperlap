# P1-06B：局部编辑 UI 精修与验证

Refs #20。基于 master `68a834a00e31bfa5bf10fcbc7ceb450fc16754cc`，开发分支 `feat/p1-06b-ux-polish`。本 PR 汇总已经完成审计、精准修复和人工 Code Review 的实现，保留手绘纸片美学、赛道主体、铅笔焦点与 reduced-motion，不进入 Issue #21。

本报告是可随 PR 阅读的精简审计与验证记录，只引用本次提交的精选证据。完整阶段记录 `docs/p1-06-ux-audit.md`、`docs/p1-06-ux-fix-verification.md`、`docs/p1-06-ux-review-closeout.md`、历史图库和 Review ZIP 原样保留在本地，不要求把全部历史产物提交到仓库。阶段性失败和未测项没有改写为通过。

## 审计发现与最终修复

审计确认 5 项 UI 缺陷、2 项需求差距，没有据此认定数据丢失或 P0/P1 阻塞。

| 项目 | 分类 / 优先级 | 已复现的问题与用户影响 | 最终修复与验收 |
| --- | --- | --- | --- |
| F-01 | UI 缺陷 / P2 | Tab 到局部赛道名出现完整蓝框，焦点样式不一致 | 给名称补铅笔短线和柔和纸色底；Tab/Shift+Tab、完整名称、forced-colors 可见性保留 |
| F-02 | UI 缺陷 / P2 | 900×700 长冲突文字与合法道路外缘交叉，降低辨识度 | 完整状态移到按钮行下方；默认/真实边界赛道三视口逐字符 Range 与道路描边无交叉，不隐藏错误或改成短 toast |
| F-03 | UI 缺陷 / P2 | 正式保存成功但草稿清理失败只提示 3 秒，之后无法再次获取说明 | HUD 和历史页持续说明“赛道已保存、旧局部草稿仍保留、清理未完成”；用户确认只关闭 UI，不删除草稿，不误报正式保存失败 |
| F-04 | UI 缺陷 / P2 | 只读入口部分点击被纸签装饰线截获 | 装饰伪元素不接收指针；三视口九点命中、九次原生点击、Enter/Space 与 Esc 焦点返回验证 |
| F-05 | 需求差距 / P2 | 标题与 40 字名称同排，持续帮助挤占注意力 | 标题、次级名称、备份状态分层；长名省略并保留全文；详细帮助按需展开，高优先级警告持续可见 |
| F-06 | 需求差距 / P3 | 禁用和处理中动作仍提示不可执行的键帽 | 五动作按真实 disabled 更新键帽与 aria-keyshortcuts；忙碌时“取消等待”的 Esc 保留，实际快捷键映射不变 |
| F-07 | UI 缺陷 / P2 | disabled primary hover 变成浅底，浅字难辨 | 禁用 hover 背景稳定；禁用不发生假按压，可用 primary 与忙碌状态不退化 |

涉及应用文件只有 `src/style.css`、`src/game/local-editor.ts`、`src/game/save-history.ts` 和 `src/main.ts`。修改限于布局、反馈、状态说明与可访问性，不重构业务算法。

## 关键前后截图与测量

前图为未修改 master 的实际游戏；后图为本次最终源码在专用无头浏览器中的实际游戏。表内每张 PNG 都有同名 JSON，包含文字 Range、bounding boxes、九点 elementFromPoint、disabled/aria-busy/键帽及焦点样式。父容器空白跨过道路不直接视为遮挡，模态框正常遮住底层控件也不视为异常。

| 900×700 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 名称焦点、长名、五动作 | [PNG](p1-06b-pr-evidence/before/name-focus-900.png) | [PNG](p1-06b-pr-evidence/after/name-focus-900.png) |
| disabled primary hover | [PNG](p1-06b-pr-evidence/before/disabled-hover-900.png) | [PNG](p1-06b-pr-evidence/after/disabled-hover-900.png) |
| 默认赛道长冲突警告 | [PNG](p1-06b-pr-evidence/before/default-conflict-900.png) | [PNG](p1-06b-pr-evidence/after/default-conflict-900.png) |
| 真实边界赛道长警告 | [PNG](p1-06b-pr-evidence/before/edge-conflict-900.png) | [PNG](p1-06b-pr-evidence/after/edge-conflict-900.png) |
| toast 清空后的清理失败入口 | [PNG](p1-06b-pr-evidence/before/cleanup-persistent-900.png) | [PNG](p1-06b-pr-evidence/after/cleanup-persistent-900.png) |
| 持续完整说明 | [PNG](p1-06b-pr-evidence/before/cleanup-history-900.png) | [PNG](p1-06b-pr-evidence/after/cleanup-history-900.png) |
| 只读入口命中 | [PNG](p1-06b-pr-evidence/before/readonly-900.png) | [PNG](p1-06b-pr-evidence/after/readonly-900.png) |

三视口为 1366×768、1280×800、900×700，DPR=1；900×700 实际画板约 900×537.5。新专项覆盖普通/40 字名称、合法/非法候选、采用≠正式保存、备份/正式写失败、恢复、清理失败、真实第二页只读/来源冲突、菜单、赛道本和历史入口；记录自然 validating/adopting/saving 阶段，没有通过暂停业务制造忙碌状态。

## T-01：等待真实异步操作完成

P1-06A 的双 requestAnimationFrame 调度后，Enter 同一事件中仍可能处于 adopting，aria-busy=true，备份文字尚是上一步“已备份”。操作结束后 busy=null、aria-busy=false，正确变为“未备份”，旧草稿原文保持不变。原即时断言探针 exit 1，等待完成条件后 exit 0。

`tests/local-game-browser.mjs` 只在 busy 时等待真实 telemetry 和 aria-busy 一致结束；在草稿写失败及写后场景失败断言前补完成屏障，保留失败文案、dirty/pending 和旧草稿原文断言。没有固定 sleep、删除断言或修改保存规则。

[时序证据](p1-06b-pr-evidence/diagnosis/t01-probe.json) · [即时读取失败](p1-06b-pr-evidence/diagnosis/t01-red.log) · [完成后通过](p1-06b-pr-evidence/diagnosis/t01-wait.log)

## T-02：外部聚合超时

基线三个 draft 子脚本分别 exit 0，耗时 378.41s、53.25s、72.21s，合计 503.87s。第一阶段外部 runner 给整条串行命令设置 420s 总上限，在后续子脚本中途终止；不是已证明的产品卡死。另一次单脚本 420s 保护也曾终止仍持续输出的长套件。

本次三个脚本独立记录 exit、耗时和最后场景，所有浏览器严格串行；外部保护仅检测连续 240s 无输出，不扩大项目原有动作等待或 180s 驾驶期限。不会把未完成或包装命令未运行写成 PASS。曾在并行负载下出现录制驾驶未生成有效 PB 的失败；本 PR 不宣称已全面解决驱动器并行稳定性，也没有改驾驶输入或物理换取通过。

[基线结果摘要](p1-06b-pr-evidence/diagnosis/baseline-results.json)；本轮真实结果见下表。

## Code Review 收尾

`#storage-state` 以可见按钮文字作为可访问名称，title 保留完整说明；删除覆盖名称的 aria-label。三视口在只读与清理失败两种可见状态共 6 组 `toHaveAccessibleName` / `toHaveAccessibleDescription` 和实际 ariaSnapshot 验证。[原名称覆盖证据](p1-06b-pr-evidence/diagnosis/accessible-name-red.json)

900×700 的帮助在真实绘制、校验、保存的边界赛道上展开。检查实际圆角轮廓后，与道路描边最小余量约 0.955px（离散误差上界约 0.0097px）；最近道路边缘九点均命中画布，真实拖动产生合法候选，正式存档/草稿原文未变。外接矩形曾相交 -0.681px，但交点在被裁掉的圆角，不据此误报已复现遮挡。没有修改帮助布局。

[展开帮助](p1-06b-pr-evidence/after/edge-help-open-900.png) · [原生拖动后的合法候选](p1-06b-pr-evidence/after/edge-help-drag-900.png)

## Fixture 与干净检出

`tests/fixtures/ux-legacy-save-v2.json` 是明确随源码提交的最小测试输入：自动化测试生成的一条赛道和旧纪录，由游戏真实 V2→V3 流程迁移；测试断言可写 V3 与旧纪录完整归档。它不读取未跟踪审计 JSON，不预置运行中 debug 状态，不改摘要或几何身份；原始浏览器 storageState、用户存档与浏览器配置不纳入 PR。

本轮从干净 Git clone 检出上述 master，应用已审查补丁后独立 npm ci，未复制审计目录，node_modules 未链接原工作区。默认专项仅设置服务 URL 即可运行：

```sh
npm ci
npm run dev -- --port 4218 --strictPort --open false
# 另一个终端，已有项目对应的 Playwright Chromium：
PAPERLAP_URL=http://127.0.0.1:4218 node tests/ux-polish-browser.mjs
```

## 提交前最终回归

环境为 macOS arm64 / Node 22.23.3 / Playwright 1.56.1 / Chromium 141.0.7390.37。全部浏览器明确 headless、独立上下文；没有连接用户浏览器、打开可见窗口或接管桌面。普通测试产物位于任务自己的临时检出，不覆盖工作区原有 test-results；提交日志中的主机临时绝对路径替换为 `<validation>`。暂存检查曾因两份工具日志的行尾空白/末尾空行失败；只归一化提交版日志的空白后通过，不修改测试输出的实质内容或断言。

本轮 19 个命令全部 exit 0，无超时或提前中断；unit 120/120，UX 专项 86/86、0 pageerror。浏览器全部串行。

| 命令 | 耗时 | exit | 完成结果 | 日志 |
| --- | --- | --- | --- | --- |
| `git diff --check` | 0.28s | `0` | 通过 | [log](p1-06b-pr-evidence/logs/diff-check.log) |
| `npm run typecheck` | 1.05s | `0` | 通过 | [log](p1-06b-pr-evidence/logs/typecheck.log) |
| `npm run test` | 7.22s | `0` | 120/120 unit | [log](p1-06b-pr-evidence/logs/test.log) |
| `npm run build` | 1.68s | `0` | 通过 | [log](p1-06b-pr-evidence/logs/build.log) |
| `node tests/ux-polish-browser.mjs` | 143.62s | `0` | 86 场景 | [log](p1-06b-pr-evidence/logs/ux-polish-browser.log) |
| `npm run test:local-game` | 114.63s | `0` | 22 场景 | [log](p1-06b-pr-evidence/logs/test-local-game.log) |
| `npm run test:local-response` | 123.00s | `0` | 19 场景 | [log](p1-06b-pr-evidence/logs/test-local-response.log) |
| `npm run test:hud` | 35.98s | `0` | 12 场景 | [log](p1-06b-pr-evidence/logs/test-hud.log) |
| `npm run test:focus` | 17.48s | `0` | 9 场景 | [log](p1-06b-pr-evidence/logs/test-focus.log) |
| `npm run test:menu` | 125.47s | `0` | 13 场景 | [log](p1-06b-pr-evidence/logs/test-menu.log) |
| `npm run test:trackbook` | 337.29s | `0` | 27 场景 | [log](p1-06b-pr-evidence/logs/test-trackbook.log) |
| `npm run test:motion` | 163.88s | `0` | 14 场景 | [log](p1-06b-pr-evidence/logs/test-motion.log) |
| `node tests/draft-browser.mjs` | 408.27s | `0` | 28 场景 | [log](p1-06b-pr-evidence/logs/draft-browser.log) |
| `node tests/draft-storage-browser.mjs` | 55.46s | `0` | 4 场景 | [log](p1-06b-pr-evidence/logs/draft-storage-browser.log) |
| `node tests/draft-interruption-browser.mjs` | 77.96s | `0` | 5 场景 | [log](p1-06b-pr-evidence/logs/draft-interruption-browser.log) |
| `npm run test:storage` | 50.85s | `0` | 15 场景 | [log](p1-06b-pr-evidence/logs/test-storage.log) |
| `npm run test:browser` | 83.29s | `0` | 15 场景 | [log](p1-06b-pr-evidence/logs/test-browser.log) |
| `npm run test:handling` | 33.63s | `0` | 4 场景 | [log](p1-06b-pr-evidence/logs/test-handling.log) |
| `npm run test:sound` | 12.04s | `0` | 4 场景 | [log](p1-06b-pr-evidence/logs/test-sound.log) |

三个 draft 子脚本本轮合计 541.69s，全部分别完成。没有把未运行的 `npm run test:draft` 包装命令另算一次 PASS。独立性能 benchmark 和跨浏览器矩阵未运行。


[所有本轮命令的真实结果](p1-06b-pr-evidence/regressions.json) · [完整 UX 专项结果](p1-06b-pr-evidence/ux-results.json) · [源码与提交范围校验](p1-06b-pr-evidence/source-integrity.json) · [提交文件清单](p1-06b-pr-evidence/files.json)

## 边界、风险与人工试玩

车辆物理、碰撞/圈速、RULES_VERSION、几何与局部变形、V3 schema/几何身份/旧纪录归属、正式保存事务/Web Locks、整笔和局部草稿协议、Esc 与实际快捷键行为保持不变。

- 清理失败说明是当前页面会话内 UI，保留到用户确认；没有新增持久化键，刷新后继续依赖原有草稿恢复/来源保护。
- 配额/清理失败采用指定 Storage API 抛错；不等同于真实磁盘耗尽或权限损坏测试。
- forced-colors/reduced-motion 和合成 IME/指针路径已覆盖；VoiceOver、真实系统 IME/触屏、Safari/Firefox、其他字体、DPR/缩放和长时间运行未测。帮助余量较小，不把一个字体环境的通过扩展到所有平台。
- 按用户本轮提供的信息，用户已进行编辑、按钮和实际驾驶试玩；目前没有明确的“全部无异常”完整验收反馈，不标记完整用户验收通过。

PR 只使用 `Refs #20` 关联 Issue；创建后停在 Code Review，不自动合并、关闭 Issue #20、部署或启动 Issue #21。
