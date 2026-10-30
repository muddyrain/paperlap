# Paperlap · Issue #21 发布前验收清单

基线 master：`3904352f6e7fd799bde398d6fe8e558bd274657f`。验收环境：2026-10-30，macOS 15.7.9 / Darwin 24.6.0 / arm64 / Apple M3 Pro；Node 22.23.3、Playwright 1.56.1、Phaser 3.90.0。

**发布建议：CONDITIONAL GO。** 三个可用引擎的自动化验收和两项 P2 修复已通过；真实 Safari、系统生命周期、声音听感及辅助技术仍未验收。本 PR 停 Code Review，尚未执行正式 V1.0 发布、Tag、GitHub Release 或正式部署。关联 `Refs #21`，不自动关闭 Issue。

## 结果与证据口径

PASS = 实际运行通过；FAIL = 实际断言失败；NOT TESTED = 未运行/环境不支持；BLOCKED = 明确依赖阻塞。没有以 WebKit 代替真实 Safari，没有以旧结果冒充本轮重跑。提交版只整理已审核报告及相对证据链接；原始大证据和 ZIP 均完整保留在本地，范围见 [精选证据索引](p1-06c-pr-evidence/README.md)。

| 引擎 / OS | 实际版本 | 视口 | 最终 P2 / UX / smoke |
| --- | --- | --- | --- |
| Chromium / macOS 15.7.9 | 141.0.7390.37 | 1366×768、1280×800、900×700，DPR 1 | PASS 138/138 · PASS 92/92 · 三视口 PASS |
| Firefox / macOS 15.7.9 | 142.0.1 | 同上 | PASS 138/138 · PASS 92/92 · 三视口 PASS |
| Playwright WebKit / macOS 15.7.9 | 26.0 | 同上 | PASS 138/138 · PASS 92/92 · 三视口 PASS；forced-color-adjust 属性不支持单列未测 |
| 真实 Safari、用户安装的 Chrome/Firefox、Windows/Linux、其他设备/DPR/缩放 | 未提供 | NOT TESTED | NOT TESTED |

以上最终专项已在提交前独立检出、`npm ci`、production build 后再次执行。[实际命令/退出码](p1-06c-pr-evidence/final/results.json)、[代码哈希与干净检出依赖](p1-06c-pr-evidence/final/checkout.json)。所有自动浏览器显式 headless、独立上下文，不接管个人浏览器和桌面。Canvas 检查包含实际道路/纸张像素和 FIT 坐标；鼠标、Tab/Shift+Tab、Enter/Space/Esc、Ctrl/Cmd、长名、reduced-motion 均有真实页面断言。

WebKit 本环境普通 Tab 跳过部分原生按钮，Option+Tab 可到达；测试如实记录按钮导航方式，HUD 名称仍用普通 Tab/Shift+Tab。高对比度 media/标记像素不等同于真实 OS 高对比度验收。

## 两项 P2

- QA-UI-01：HUD 名称原共享整笔编辑器的 2px enclosing outline；现在只让 HUD 接入既有纸色底和 24×3px 铅笔短线，保留全文 title、Tab 和 forced-colors 标记，其他输入规则不改。
- QA-UI-02：WebKit 指针点击时 activeElement 可能是 BODY，历史面板据此保存了错误返回目标；现在两类入口显式传入实际按钮，关闭时回可见有效按钮，提示消失则回历史入口。暂停顺序和 Esc 状态规则不改，不自动驾驶。

[完整修复验证与代表性前后图](p1-06c-p2-fix-verification.md)。历史 FAIL 仍在 [C1 全部跨引擎尝试](p1-06c-pr-evidence/c1/cross-results.json)、[C2 原始尝试](p1-06c-pr-evidence/c2/commands.json) 及对应日志中。测试自身的无效视口外手势、R 状态预期和 WebKit CSSOM 能力断言失败均被保留，没有删除断言或换引擎制造 PASS。

## 存档安全与完整游戏链路（C1 原始验收）

本节为 master 3904352 的 C1 实测；C2/C3 应用只改焦点 UI，没有改这些协议。C3 没有重新运行整套数据/性能链路，不将以下历史 PASS 计作提交前新执行结果。

| 场景 | 三引擎实际结果与关键断言 |
| --- | --- |
| Web Locks writer / 第二标签 / 释放刷新 | PASS；native exclusive writer 可见，第二页只读不能覆盖正式原文，关闭 writer 后刷新可写 |
| Web Locks 缺失 | PASS；专用 context 移除 API 后保持只读、解释明确，旧 V2 不变、不生成 V3；临时驾驶可用，不使用假锁 |
| V1→V3、V2→V3、已有 V3 | PASS；迁入身份稳定、旧键和归档保留，旧成绩不成为新几何 PB |
| 损坏/未知/摘要不符 V3、来源冲突、旧客户端改 V2 | PASS；保留双方原文并停止写入，不自动回落覆盖或合并 |
| 草稿备份/刷新恢复、配额、读回失败和写后冲突 | PASS；只恢复匹配来源，失败不改旧草稿，后续危险写入停止；清理失败不误报正式保存失败 |
| 导出与隔离恢复演练 | PASS；六个键解析后逐码元等于 Storage 原文，包含尾空白/NUL 测例；在另一个新 context 重建后六键仍不变 |

原始跨引擎报告：

| 引擎 | migration/storage | 安全/导出/新 context 重建 | 真实 A/PB/B/A/两弯/刷新/新 PB/导出 |
| --- | --- | --- | --- |
| chromium | [15 项 PASS](p1-06c-pr-evidence/c1/browsers/chromium/storage-1/report.json) | [7 项 PASS](p1-06c-pr-evidence/c1/browsers/chromium/safety-2/safety.json) | [完整链路 PASS](p1-06c-pr-evidence/c1/browsers/chromium/game-1/game-chain.json) |
| firefox | [15 项 PASS](p1-06c-pr-evidence/c1/browsers/firefox/storage-1/report.json) | [7 项 PASS](p1-06c-pr-evidence/c1/browsers/firefox/safety-2/safety.json) | [完整链路 PASS](p1-06c-pr-evidence/c1/browsers/firefox/game-1/game-chain.json) |
| webkit | [15 项 PASS](p1-06c-pr-evidence/c1/browsers/webkit/storage-1/report.json) | [7 项 PASS](p1-06c-pr-evidence/c1/browsers/webkit/safety-2/safety.json) | [完整链路 PASS](p1-06c-pr-evidence/c1/browsers/webkit/game-1/game-chain.json) |

全链路从无存档 context 开始，真实鼠标画 A、真实方向键产生有效 PB，再画 B、返回 A、修改两个弯道、采用/撤销/重做、保存生成新身份；刷新后旧 PB 原值保留且当前 PB 为空，再次真实驾驶产生新 PB，最后下载比对六键。没有写入 debug 对象或假圈速。真实旧/新 PB（秒）：Chromium 15.738329 / 15.054616；Firefox 14.145910 / 14.192229；WebKit 14.094383 / 14.207918。不是跨引擎物理性能基准。

代表截图：[旧真实 PB](p1-06c-pr-evidence/c1/browsers/chromium/game-1/02-a-real-pb.png)、[新几何空 PB](p1-06c-pr-evidence/c1/browsers/chromium/game-1/06-new-geometry-empty-pb.png)、[旧修订历史](p1-06c-pr-evidence/c1/browsers/chromium/game-1/07-old-record-history.png)、[新真实 PB](p1-06c-pr-evidence/c1/browsers/chromium/game-1/08-new-real-pb.png)。完整三引擎录像仅本地保存于 `docs/p1-06-release-evidence/browsers/<engine>/game-1/game-chain.webm`，未纳入 PR。

产品没有安全的一键导入。保守恢复：先导出六键并留只读副本，关闭其他新旧客户端；在专用隔离 profile/origin 中核对 schema/rules、UID、identity/digest、legacySources 并用经 Review 的工具演练；来源冲突/损坏/未知版本时保留全部原文，停止写入并人工比较。不得删除 V3 强制回落、清草稿或混合旧 PB。本轮没有对日常浏览器执行恢复。

## 性能与资源（C1 原始测量）

20 条赛道 × 每条 900 个合法点；每引擎/倍率 3 个新 context/document，浏览器/OS 缓存可能已热，fixture 生成不计入。4× 为 Chromium CDP 模拟，其他引擎 4×/heap API 未测。

| 引擎 / CPU | 冷加载 median / max ms | 正式保存 wall median / max ms | 核心保存 median / max ms |
| --- | --- | --- | --- |
| Chromium 1× | 1022.9 / 1124.5 | 408.3 / 467.0 | 102.5 / 116.6 |
| Chromium 4× | 3517.1 / 3536.8 | 904.2 / 959.0 | 426.2 / 491.2 |
| Firefox 1× | 1335.5 / 1480.2 | 217.1 / 229.8 | 136.0 / 144.0 |
| WebKit 1× | 917.4 / 931.0 | 217.6 / 221.8 | 132.0 / 138.0 |

[完整分布、rAF、堆和资源采样](p1-06c-pr-evidence/c1/performance-summary.json)。n=3 的 p95 等于最大样本，不能代表长期设备分布。正常动效下进出编辑 20 次，Canvas 3→3、Phaser texture keys 4→4，稳定后活跃动画/残影/trail 为 0；Chromium GC 后 heap 首次编辑约 9.2→13.5 MB，后续小幅变化，没有长期无泄漏保证。GPU/native 内存未测。4× 最大帧间隔约 567ms，不承诺复杂场景恒定 60fps。

真实导航 pagehide、锁重获、局部草稿恢复 PASS。无头环境未产生 native document.hidden，后台隐藏/恢复为 NOT TESTED；合成 blur/visibility 回归通过不替代真实系统生命周期。

## 回归记录与发布条件

C1 [20 命令原始结果](p1-06c-pr-evidence/c1/regressions.json) 全部 PASS，含三个 draft 子脚本分别串行完成；draft-browser 实际 424.68s、28 场景，没有被 420s 外层截断。C2 [11 个受影响命令](p1-06c-pr-evidence/c2/regressions.json) 全部 PASS，含 120 单测、focus/HUD/menu/book/browser/local-game/local-response/motion。

C3 提交前重新执行 typecheck、120 单测、build、Chromium focus/HUD/menu，以及三引擎 P2/UX/smoke；全部 PASS。其余 C1/C2 命令仅复核已审核结果和源代码哈希，没有重复执行，未冒充本轮 PASS。[实际退出码和日志](p1-06c-pr-evidence/final/results.json)。

本轮无未解决 P0/P1；两项 P2 已验证修复。以下仍需人工完成，当前条件发布建议不变：

- [ ] 真实 Safari 与用户实际 Chrome/Firefox、Windows/Linux 或目标设备，记录版本、DPR/缩放与字体；WebKit 不代表 Safari。
- [ ] 真实后台/前台、最小化、睡眠唤醒、BFCache、异常退出及恢复：暂停、清键、声音停止，需显式继续。
- [ ] 真实音频设备和听感；真实中文 IME、长按、不同键盘、读屏器、OS 高对比度与 reduced-motion。
- [ ] 专用临时 profile 中的真实权限/配额、备份离线检查与保守恢复演练，不在日常存档试错。
- [ ] 低配设备复杂赛道与长会话人工试玩；900×700 边界帮助留空余量在其他字体/缩放下复核。

已知边界：Web Locks 缺失只读；局部草稿刷新仅恢复相邻一步；起点保护区不可编辑；旧纪录不自动归入新几何 PB；复杂保存可短暂阻塞。没有云同步或一键恢复承诺。提交清单见 [manifest](p1-06c-pr-evidence/manifest.json)，完整旧证据与 Review ZIP 仅在本地保留。
