# P1-05B-02A：Save V3 验证与兼容报告

基线 `0058e52ead247157b0de339700f6fcc78f7e2655`，分支 `feat/p1-05b-02a-geometry-identity`，Issue #15。先以提交 `c109b69` 固定 [RFC](save-v3-rfc.md)，再完成数据层、游戏接入和回归。未开发 Issue #16 的正式局部编辑 UI 或局部草稿。

## 身份与迁移结果

新纪录键为 UID＋geometryIdentity＋规则版本。新建、真正改线获得独立修订；改名、切换、声音、更新成绩和精确原几何保存保留身份。测试用 `x += 0.001` 构造合法同旧 32 位指纹的路线，确认新摘要、新身份、新 PB 隔离，旧修订成绩仍可查看。完整坐标比较和严格几何校验不由摘要替代。

canonical v1 固定二进制宽度、版本、点数、顺序与 float64 编码；`-0` 归一为 `+0`，无坐标量化。SHA-256 与 Node crypto、浏览器 WebCrypto、标准向量交叉核对。旧键原文来源摘要使用 UTF-16BE 码元，避免 TextEncoder 将不同未配对代理项替换成同一内容；迁入 identity 的 JSON 输入使用 UTF-8。这些编码分别有固定测试。

| 来源 / 状态                   | 实际结果                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 合法 V2                       | 保留全部 tracks、UID、名称、活动条目、声音；records 全部移入 legacy.records，孤立 legacyRecords 原样保留；V1/V2 原文逐字不变，只写 V3 |
| 合法 V1                       | 直接迁入 V3，不创建 V2；保留来源规则版本，当前与孤立纪录都可查；V1 原文不变                                                           |
| 旧纪录                        | HUD、卡片明确显示“旧纪录（未验证）”，历史面板逐项列出名称、来源、原键、规则和时间；不进入新 PB 比较，不触发奖励                       |
| V1 需有损规范化               | 过长名称、会被旧解析器过滤的纪录或不支持字段类型，整体拒绝升级；仅临时预览，不静默截断                                                |
| quota / 禁用读取 / 写后不一致 | 不承认升级成功、不清旧键；持续错误入口、原文备份；quota 释放空间后刷新重试，迁入 identity 相同                                        |
| 损坏 / 未知 V3 / 错误摘要     | 保留原文，受保护的默认临时预览；不自动回退 V2 并覆盖 V3                                                                               |
| 新版双标签                    | 真实 Web Lock 只允许一个写入标签，第二个只读；关闭写入者并刷新后可取得锁                                                              |
| 旧客户端改写 V2               | 实时事件和重载后的来源摘要都识别冲突；V2/V3 两个分支都保留，不自动合并                                                                |
| 正式保存 / 场景故障           | 准备失败不写盘；V3 写入失败仍留在编辑器并保留草稿；写盘后场景提交异常停止操作、要求可靠重载                                           |
| 旧整笔草稿                    | draft.v1 保留原文并提示，不按弱指纹自动套用；新整笔 draft.v2 绑定 UID、意图、修订身份和摘要，错误归属拒绝恢复                         |

全部旧 records 512＋孤立归档 128 的上限组合有完整保留测试；超限整体拒绝。历史结构和来源摘要在会话中不可被候选悄悄改写，已用修订身份不能重新绑定不同坐标。正式成绩保存失败恢复旧 PB，不把失败的新成绩作为已保存纪录。

## 最终验证

| 检查                                      | 结果                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| npm test                                  | **105/105**；含旧 V2 合同、15 项新增身份/V3/容量检查                              |
| npm run build / build:local-edit          | 通过，均包含 typecheck；正式构建仅保留既有 Phaser chunk 提示                      |
| test:storage                              | **15/15**；迁移、历史、三尺寸、摘要对照、配额、两标签、旧客户端、损坏、驾驶与草稿 |
| test:trackbook / test:editor              | **27/27、9/9**                                                                    |
| test:draft                                | **37/37**：主 28、初读失败 4、A→R→未完成 B 中断 5                                 |
| test:menu / test:motion / test:focus      | **13/13、14/14、9/9**                                                             |
| test:sound / test:browser / test:handling | **4/4、15/15、4/4**                                                               |
| test:local-edit                           | **23/23**；原型仅补只读 V3 读取，正式游戏未开放局部编辑                           |
| 格式 / git diff --check                   | 通过                                                                              |

正式游戏浏览器功能检查 **147/147**，另加独立原型 **23/23**，合计 **170/170**。所有报告的控制台错误为 0；记录失败请求的套件均为 0（handling 套件不单独记录这一字段）。汇总为 `test-results/save-v3/summary.json`，详细 JSON 位于各套件目录；最终日志在 `test-results/save-v3/regression-*.log`。

已有测试的正式键、身份 fixture 和草稿来源已同步 V3；旧 V2 纯数据测试保留。动效配额回归发现原测试重画完全相同路线，不会发生实际写盘；改为真实不同路线，并额外断言拒绝写入次数大于 0。仍严格验证失败留在编辑器、不庆祝、不改变磁盘。最初 SHA 模块缺失的红测日志保留于 `identity-red.log`，没有把后续所有用例宣称为先红后绿。

所有浏览器通过独立上下文、明确 `headless: true` 的 Chromium 在后台串行运行；输入仅使用页面 API，清除 PWDEBUG，finally 释放浏览器；没有日常 Chrome、系统鼠标、前台激活或自动报告窗口。

## 接近容量上限的性能

本机 macOS arm64 / Apple M3 Pro / Chromium 141.0.7390.37，20 条×900 点，V2 838,217 字符，V3 约 843,548 字符。冷路径使用新存储/外部有效原文并完整验证；热路径只复用私有完整坐标快照或逐字相同、已严格验证的原文。相对守卫要求热操作小于冷验证中位数的 50%。

| 测量                                      | 中位数 / 样本                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Node V3 冷加载                            | **735.34ms**                                                                         |
| Node 改名 / PB / 静音热写入               | **37.82 / 37.17 / 23.90ms**                                                          |
| Chromium 页面迁入及冷重载                 | **1043.62 / 992.55 / 994.37ms**，包含页面与游戏初始化                                |
| Chromium 声音实际点击处理                 | **21.10ms**；首次 237.40ms 包含首次音频解锁，不隐去                                  |
| Chromium 进入编辑                         | **3.20ms**；首次 23.80ms                                                             |
| Chromium 改名提交处理                     | **43.50ms**，最大 52.50ms；计量真实 form submit，不把按钮 click 的默认动作误算成 0ms |
| Chromium DraftStorage 热 / 外部变更冷进入 | **2.50 / 455.10ms**；首次冷页面约 1024.44ms                                          |

性能原文：`unit.log`、`browser-performance.json`、`draft-browser-performance.json`，均在 `test-results/save-v3/`。本轮保持完整冷验证的成本，未降低几何安全标准；这些是本机观测，不是所有设备的帧率承诺。

## 实际截图

| 状态                 | 1366×768                                        | 1280×800                                        | 900×700                                        |
| -------------------- | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| 当前 PB 与旧纪录分离 | [HUD](screenshots/p1-05b-02a-hud-1366.png)      | [HUD](screenshots/p1-05b-02a-hud-1280.png)      | [HUD](screenshots/p1-05b-02a-hud-900.png)      |
| 全部历史与备份入口   | [历史](screenshots/p1-05b-02a-history-1366.png) | [历史](screenshots/p1-05b-02a-history-1280.png) | [历史](screenshots/p1-05b-02a-history-900.png) |
| 赛道卡片双来源展示   | [卡片](screenshots/p1-05b-02a-cards-1366.png)   | [卡片](screenshots/p1-05b-02a-cards-1280.png)   | [卡片](screenshots/p1-05b-02a-cards-900.png)   |

这些截图来自真实迁移页面，9 张原始 PNG 入库；自动化原始 JSON、日志和录像留在忽略的 test-results，按下述命令复现。

```bash
npm test
npm run build
npm run preview -- --port 4185 --strictPort
# 另一终端；服务器不会自动打开浏览器
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:storage
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:trackbook
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:editor
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:draft
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:menu
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:motion
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:focus
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:sound
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:browser
PAPERLAP_URL=http://127.0.0.1:4185 npm run test:handling
PAPERLAP_URL=http://127.0.0.1:4185 npm run bench:v3:browser
PAPERLAP_URL=http://127.0.0.1:4185 npm run bench:draft:browser
```

原型独立构建后，在另一专用端口预览 `vite.local-edit.config.ts`，设置 PAPERLAP_URL 指向该端口运行 `npm run test:local-edit`。它不修改任何正式存档或草稿。

## 实际修改文件

| 文件                                                                                                                                                                                                                                                                                                   | 修改                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| src/game/geometry-identity.ts、save-v3.ts、storage-v3.ts                                                                                                                                                                                                                                               | canonical/SHA、修订数据模型、严格迁移、原文来源、单写入锁、可靠提交与备份 |
| src/game/save-model.ts、trackbook.ts、main.ts                                                                                                                                                                                                                                                          | 小型版本适配、严格候选事务、失败 PB 回退、生命周期/锁释放                 |
| src/game/save-history.ts、trackbook-ui.ts、src/style.css                                                                                                                                                                                                                                               | 历史/持续错误/导出入口、卡片旧纪录，沿用已有纸片动效                      |
| src/game/draft-storage-v3.ts、draft-storage.ts、draft.ts、draft-ui.ts                                                                                                                                                                                                                                  | 整笔来源策略接入 V3，新旧键分开，保留已有撤销/恢复架构                    |
| src/prototypes/local-edit.ts、prototypes/local-edit.html                                                                                                                                                                                                                                               | 仅兼容只读 V3 加载；无正式局部保存                                        |
| tests/geometry-identity.test.ts、save-v3.test.ts、save-v3-performance.test.ts                                                                                                                                                                                                                          | 15 项身份、迁移、安全与容量检查                                           |
| tests/save-v3-performance-browser.mjs、storage-browser.mjs                                                                                                                                                                                                                                             | V3 真实页面专项、真实提交性能                                             |
| tests/browser.mjs、editor-browser.mjs、handling-browser.mjs、menu-browser.mjs、motion-browser.mjs、focus-browser.mjs、sound-browser.mjs、trackbook-browser.mjs、draft-browser.mjs、draft-storage-browser.mjs、draft-interruption-browser.mjs、draft-performance-browser.mjs、fixtures/trackbook-ux.mjs | 更新正式键、身份和严格失败断言，保留原功能回归                            |
| package.json、vite.config.ts                                                                                                                                                                                                                                                                           | 性能命令、ES2022 启动边界；无新增依赖                                     |
| README.md、docs/save-v3-rfc.md、draft-safety.md、verification.md、本报告、9 张截图                                                                                                                                                                                                                     | 数据合同、兼容边界、实测证据                                              |

save.ts、storage.ts、geometry.ts、vehicle.ts、laps.ts、config.ts、scene.ts、editor.ts、菜单状态/快捷键及 GameMotion 均未修改。整笔草稿只做身份接入，未加入局部操作或局部草稿。

## 剩余边界与恢复

- 写入需要支持 Web Locks 的安全 origin；缺少锁只读，不伪造原子提交。第二个标签须关闭写入者后刷新，不自动抢锁。
- 冷加载严格校验在本机上限规模仍约 1 秒，外部新原文不能跳过校验。旧键/归档增加占用，容量不足整体拒绝，没有自动淘汰。
- 旧客户端不遵守新版锁，只写旧命名空间；两份分支都保留，检测后停止写入。外部脚本不合作地直接改 V3 不属于 Web Lock 的互斥保证，写前/读回/后续原文检查仍会拒绝继续静默覆盖。
- 来源冲突不能靠刷新合并。先从历史入口导出全部正式键和草稿，关闭其他标签，再恢复相互一致的可信备份；本轮没有危险的一键清空/覆盖或分支合并 UI。
- 回滚旧版仅能看到保留 V1/V2，不能看到 V3 新作品；旧整笔草稿也不会自动套用 V3，可保留备份后在旧版核对。历史缺少可信几何证明，始终标为未验证。
- 浏览器验证为 Chromium，未宣称 Safari/Firefox 或用户人工试玩已通过。ES2022 与 Web Locks 是本轮兼容要求。

推送后停在 Code Review，等待用户复审，不自动合并。

## PR #17 第一轮 Review：修复顶部计时 HUD

审查基线 `0c68ed9`。上一轮截图中的计时卡片确实偏到右上，被操作按钮遮挡；原浏览器断言没有检查 HUD 重叠，不能据此判断布局正确。本轮先新增真实页面回归，实际失败于 `1366x768 fresh ready: timing overlaps top actions`，原文记录在 `test-results/hud-review/red.log`。

产品代码只修改 `src/style.css`：删除末尾 `.timing { position: relative; }`，恢复原有 absolute 居中；历史入口使用既有唯一 ID 定位，避免通用键盘焦点的 `position: relative` 在 Esc 返回时把按钮挤回文档流。原有铅笔焦点标记、Tab 和菜单返回行为保留，不修改任何 V3 数据、迁移、身份、锁或草稿逻辑。跨规则历史文案本轮保持原样。

新增 `tests/hud-browser.mjs` 与 `npm run test:hud`。三视口分别测试空存档、旧纪录迁入、当前 PB＋旧纪录＋40 字长名、配额失败共 **12 个场景、48 次 DOM 布局采样**。每个场景检查 ready、历史返回、running、驾驶中打开历史并返回 paused：

- `.timing` 与 `.top-actions`、左侧赛道名卡片不相交，水平中心与真实 Phaser canvas 相差不超过 1px。
- 卡片、计时/PB 行、文本 Range 与历史入口均在游戏面板/视口内；文本无裁切，九点 `elementFromPoint` 检查没有被其他元素遮挡。
- 历史入口不与本圈/PB 相交；Esc 返回后焦点仍在入口，ready 卡片边界逐项相同；驾驶返回后仍暂停、计时不继续。
- 不关闭原有动效；中心与边界检查等待卡片实际 Web Animation 结束，避免把合法暂停缩放的中间帧误判成静态布局偏移。

| 当前 PB＋长名场景 | 卡片中心误差 | 距右侧操作区间隔 | 实际修后截图                                      |
| ----------------- | ------------ | ---------------- | ------------------------------------------------- |
| 1366×768          | 0.008px      | 149.01px         | [HUD](screenshots/p1-05b-02a-review-hud-1366.png) |
| 1280×800          | 0.008px      | 146.17px         | [HUD](screenshots/p1-05b-02a-review-hud-1280.png) |
| 900×700           | 0.016px      | 56.37px          | [HUD](screenshots/p1-05b-02a-review-hud-900.png)  |

三张截图同时展示本圈计时、当前 PB 00:34.56 和旧纪录提示。原有三尺寸 HUD/卡片/历史共 9 张截图也由本轮真实 storage 测试重新生成，替换错误布局版本。实际 running 截图、完整 DOM 边界与控制台/请求记录在 `test-results/hud-review/`。

最终结果：**105/105 单元、64/64 浏览器检查**（HUD 12、storage 15、browser 15、menu 13、focus 9），typecheck/build、格式与 diff 检查通过；所有本轮报告的控制台/请求错误为 0，构建仅保留既有 Phaser chunk 提示。

本轮执行：`npm test`、`npm run build`（含 typecheck）、`test:hud`、`test:storage`、`test:browser`、`test:menu`、`test:focus`。浏览器均使用隔离无头 Chromium，串行执行并释放资源，不接管日常浏览器或桌面。最终套件结果见同目录 `regressions.json` 与 `summary.json`；未将上一轮全部 170 项声称为本轮重跑。

实际修改文件：`src/style.css`、`tests/hud-browser.mjs`、`package.json`、`README.md`、本报告、`docs/verification.md`，以及上表 3 张新截图和 9 张更新截图。不修改其他产品模块，继续停在 Code Review。
