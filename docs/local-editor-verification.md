# P1-05B-02B：正式局部编辑验证

基线 master `347d2eb32a124159227f88a7c7efda0e8ca97cde`，分支 `feat/p1-05b-02b-local-editor`，Issue #16。先提交状态/恢复合同 `889bdfb`，再实现数据、候选控制层与正式 UI。[状态图、草稿协议和失败矩阵](local-editor-integration.md)。

## 试玩

```bash
npm ci
npm run dev
# 用户手动打开终端中的地址；服务不会自动打开浏览器
```

L 从游戏、Esc 菜单或赛道本进入当前已保存赛道的局部调整。E 仍为整圈重画。道路上拖动，松手检查；Enter 只采用到编辑历史，可继续改另一个弯。Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 撤销/重做；Ctrl/Cmd+Enter 才正式保存，成功后等待开始，不自动驾驶。Esc 先取消预览，再确认放弃已采用修改，并沿原入口返回。

原始虚线、绿色候选、黄色影响区和灰色起点保护区都来自实际中心线；没有全圈重新平滑或改变世界坐标。合法几何仍由原 validate 判断；靠近顶部边界的 S 弯向外推 8 单位会被拒绝，测试改用向内合法位移，并保留独立的非法拖动断言，没有放宽规则。

刷新后再按 L，匹配 UID、身份、摘要、算法版本时提示继续/放弃/暂不处理。恢复仅到编辑候选；会话内最多 24 次历史，刷新保存相邻一步撤销/重做。只读锁、未可靠升级或来源冲突禁止进入。草稿读取失败可明确放弃本次内存，未知备份保留；已确认备份清理失败继续编辑，不偷删数据。

## 本轮验证范围

全部通过：117 项单元测试、204 项真实无头浏览器检查（原有正式游戏 159 项＋本轮局部编辑 22 项＋独立原型 23 项），以及 6 组正式游戏性能检查。正式游戏与独立原型均构建成功。浏览器报告的 errors 均为 0；记录 failedRequests 的报告均为 0（handling 旧报告不记录该字段）。机器可读汇总为 `test-results/local-game/summary.json`。

| 检查            | 范围                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit            | 原 105 项＋12 项局部历史/存储/事务/容量/读回检查                                                                                                           |
| test:local-game | 22 项真实游戏场景；两次连续弯道、远端点/接头不变、非法、采用/保存、撤销重做、刷新、A/B/PB、真实有效圈、全部入口与焦点、驾驶/声音冻结、输入保护             |
| 局部恢复和失败  | A→未采用 B→blur/resize/pointercancel/hidden/reload；UID/身份/摘要/算法不匹配；quota、未知/初读失败、已确认清理失败、prepare/apply、真实双标签/外部 V3 冲突 |
| 原有完整回归    | hud、storage、editor、trackbook、draft（主/初读/中断）、menu、motion、focus、sound、browser、handling；另测独立原型                                        |
| build/typecheck | 正式与独立原型构建；无新增依赖                                                                                                                             |

Playwright 使用隔离上下文、明确 headless:true、静音、页面鼠标/键盘 API；清除 PWDEBUG，finally 释放任务创建的浏览器。完整套件串行，报告不自动打开；没有用户 Chrome、系统鼠标、前台应用或系统级按键。

回归过程中实际定位并修复了赛道本返回焦点：局部取消隐藏画布后，原返回点可能成为 BODY，关闭抽屉后快捷键失效。旧构建的真实页面探针记录 `{id:"",tag:"BODY",mode:"ready"}`；现在取消成功先恢复游戏焦点，再交给原 MenuState 返回菜单/赛道本，最终关闭后仍为 `#game`。各入口的真实 L / Esc 链有焦点断言。没有改变 MenuState 的自动继续许可规则。

恢复测试区分笔迹内容与备份时间：撤销/重做或恢复写入权限后的中断 checkpoint 可以合法更新 updatedAt；“暂不处理”和清理失败断言比较该操作前的最新备份原文。quota 仍单独断言旧 A 原文不被失败的 B 覆盖。

## 正式游戏性能

Apple M3 Pro / macOS arm64 / Chromium 141.0.7390.37；生产预览、真实 pointermove 和按钮。每组 3 次拖动、60 个移动事件、3 次松手验证。事件与预览为 JS/Canvas 命令提交耗时，不冒充 GPU 完成时间；另采 rAF 间隔。不是用独立原型代替正式游戏。

| 点数 / CPU | 预览 P95 | 松手中位 / P95    | 采用中位 / 最大   | 正式保存 |
| ---------- | -------- | ----------------- | ----------------- | -------- |
| 200 / 正常 | 0.20ms   | 1.90 / 2.20ms     | 2.30 / 4.40ms     | 34.60ms  |
| 450 / 正常 | 0.30ms   | 7.80 / 8.20ms     | 8.00 / 15.10ms    | 50.50ms  |
| 900 / 正常 | 0.40ms   | 28.30 / 28.60ms   | 29.90 / 57.70ms   | 89.40ms  |
| 200 / 4×   | 1.00ms   | 8.50 / 8.60ms     | 10.80 / 16.70ms   | 151.20ms |
| 450 / 4×   | 1.40ms   | 34.20 / 34.60ms   | 37.60 / 70.90ms   | 241.40ms |
| 900 / 4×   | 1.80ms   | 123.80 / 124.90ms | 128.90 / 250.20ms | 444.00ms |

拖动期间 V3 写入为 0，局部草稿每次采用至多一次写入；移动不调用完整验证。Phaser 静态纹理始终 4，DOM canvas 始终 3（正式游戏、整笔、局部）。8 次重新进入/取消后，GC 后 JS 堆增长约 0.13–0.18MB；不把 JS 堆当作完整 GPU/原生 Canvas 内存测量。

正常 rAF 中位约 16.7ms；4× 降速的 rAF P95 约 66.7ms，采用期间最长观测约 300ms。900 点严格采用和保存仍会阻塞数百毫秒，保留这一安全成本，未声称低配恒定 60fps。相对守卫比较预览/移动与实际松手处理，另检查 RAF 合并、纹理、写入计数与重复开关的资源；完整样本为 `test-results/local-game/performance.json`。

## 真实截图与录像

| 状态                   | 1366×768（宽环）                                | 1280×800（S 弯）                                | 900×700（较紧弯）                              |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| 调整前 / 入口 HUD      | [截图](screenshots/p1-05b-02b-before-1366.png)  | [截图](screenshots/p1-05b-02b-before-1280.png)  | [截图](screenshots/p1-05b-02b-before-900.png)  |
| 合法预览 / 影响范围    | [截图](screenshots/p1-05b-02b-preview-1366.png) | [截图](screenshots/p1-05b-02b-preview-1280.png) | [截图](screenshots/p1-05b-02b-preview-900.png) |
| 保存 / 刷新 / 等待开始 | [截图](screenshots/p1-05b-02b-saved-1366.png)   | [截图](screenshots/p1-05b-02b-saved-1280.png)   | [截图](screenshots/p1-05b-02b-saved-900.png)   |

[非法拒绝](screenshots/p1-05b-02b-invalid-900.png) · [恢复询问](screenshots/p1-05b-02b-recovery.png) · [修改后实际有效圈与新 PB](screenshots/p1-05b-02b-new-best.png)

[实际录屏 MP4](videos/p1-05b-02b-playthrough.mp4)：1366×768，31.84 秒，796 帧，25fps。内容为进入、连续两弯、撤销重做、可靠保存、刷新、A/B、实际键盘跑圈与非法预览。来自 Playwright 原始 WebM；H.264/yuv420p 转码，未变帧序、速度或模拟车辆/圈时。所有驾驶由外部脚本读取只读快照、发送真实键盘完成，游戏没有测试修改接口。

## 实际文件与边界

| 文件                                                                                                                       | 职责                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| local-source.ts                                                                                                            | 来源令牌、精确快照、接头/点数与几何保护                    |
| local-edit.ts                                                                                                              | 仅增加 dirty、快照/恢复接口；原有限弧长公式不改            |
| local-draft-storage.ts                                                                                                     | 独立版本/限额、匹配、合法快照、原文冲突、读回和清理        |
| local-editor.ts、local-render.ts                                                                                           | 独立 Canvas 候选、输入/采用/历史、恢复 UI 与状态、只读遥测 |
| trackbook.ts、main.ts                                                                                                      | 显式局部事务，Scene 准备/写入/提交，生命周期、UI/菜单协调  |
| game-menu.ts、trackbook-ui.ts、shortcuts.ts、ui.ts、style.css                                                              | 三入口、L/键帽/焦点/说明、纸片 UI 与三尺寸                 |
| game-motion.ts                                                                                                             | 菜单由 6 到 7 项，扩展相同动画槽的有界创建/取消；不改节奏  |
| storage-v3.ts                                                                                                              | 仅在完整备份增加 localDraftV1 原文字段                     |
| tests/local-integration.test.ts、fixtures/local-game.mjs、local-game-browser.mjs、local-game-performance.mjs、package.json | 纯数据、真实页面、正式性能、运行入口                       |
| README、local-edit-rfc、save-v3-rfc、draft-safety、集成合同、本报告、verification、截图/录像                               | 试玩、协议、兼容与证据                                     |

geometry.ts、vehicle.ts、laps.ts、config.ts/RULES_VERSION、scene.ts、save-v3.ts 和 menu-state.ts 未修改。不增加云保存/分享/自由贝塞尔编辑框架，不混用旧整笔数据。

剩余边界：本轮实测 Chromium，Web Locks 缺失/第二标签继续只读；源冲突不自动合并。起点和接头不能局部拖动；大位移、紧弯、边界仍可能非法。刷新不保留整套 24 层历史，只保留相邻快照。900 点、4× CPU 下严格采用/保存可有可见停顿；需由用户试玩确认手感，自动化不能代替人工验收。

## 复现

```bash
npm test
npm run build
npm run preview -- --port 4186 --strictPort
# 另一终端
PAPERLAP_URL=http://127.0.0.1:4186 npm run test:local-game
PAPERLAP_URL=http://127.0.0.1:4186 npm run bench:local-game
# 按 package.json 分别执行全部 test:hud/storage/editor/trackbook/draft/menu/motion/focus/sound/browser/handling
```

原型仍独立构建/预览，单独运行 test:local-edit。全部日志、原始 WebM、边界/性能 JSON 在 `test-results/local-game/`。停在 Code Review，不自动合并，等待用户真实试玩。
