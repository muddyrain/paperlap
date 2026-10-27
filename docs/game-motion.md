# P1-04B · 纸片玩具赛车 Motion Spec

基线：master `5e398b8`，PR #9 于 2026-10-27 08:59:51 UTC 合并；实现 Issue #8。先保留 P1-04A 状态/焦点契约，再增加视觉层。玩家在 PC 方格本上开玩具车：纸片有重量，铅笔反馈轻巧，纪录像盖在本子上的印章；道路和车辆始终是视觉主体。

## 统一节奏

- 输入落地：按下立即压缩约 3%、下陷 1px，释放 120ms 回正；键盘铅笔标记立即可见，selected 始终由静态边框与文字表达。
- 纸片落位：菜单 300ms，右侧抽屉 300ms，前 65% 完成主要位移，末段只回正约 1% / 0.4°。退出 180ms，干净收走。只用一次轻回正，不循环弹跳。
- 翻纸交接：编辑进入 380ms、退出 300ms；缓存纹理组成独立视觉纸页，沿纸边揭开，真实 Canvas、世界坐标、尺寸与 hit testing 完全不动。标题/意图/目标名立即出现，笔一落下立刻收掉旧页。
- 确认与奖励：换轨 320ms，保存 300ms，纪录 460ms；视觉重心在 HUD、卡片和边缘通知，禁止中央大印章、全屏闪白或粒子。
- 曲线统一为落位 `cubic-bezier(.16,1,.3,1)`、纸页 `cubic-bezier(.22,.8,.25,1)`、退出 `cubic-bezier(.4,0,1,1)`；轻微回正使用显式关键帧，不使用循环弹簧。

## 交互覆盖审计与触发合同

| 事件                                | 当前反馈           | 期望/关键帧                                                                                        | 触发点                                              | 节奏              | 取消与 reduced-motion                                | 验证/录屏                         |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------- | ---------------------------------------------------- | --------------------------------- |
| ready/running/paused 的 Esc 打开    | 无                 | 纸片从左上折入：-16px / -2° / Y 压缩→略超落点→归位；菜单项最多 60ms 错峰；背景柔和压暗             | 真实 pause、showModal、focus 完成后                 | 300ms / 落位      | Esc 立即关；reduce 静态立即                          | menu、motion；menu 视频/三帧      |
| Esc/按钮/遮罩关闭                   | 无                 | 纸片轻收回、背景退去；菜单到抽屉保持同一层背景                                                     | 状态及真实 dialog 立即关闭；只让 inert 副本退出     | 180ms / 退出      | 下一操作/blur/hidden/resize 取消副本；reduce 无副本  | rapid Esc、焦点、菜单视频         |
| 操作说明/返回/放弃确认              | 无                 | 小幅纸页转向、内页从纸边展开；危险确认强调保留草稿按钮                                             | 原状态机更新子页后                                  | 200ms / 纸页      | 按键不等待；reduce 立即                              | scope、Tab、discard 视频          |
| 菜单→赛道本→菜单                    | 太弱               | 左纸收走、右纸落位；只一层背景；返回方向呼应                                                       | 原路由先关旧 modal 再开新 modal                     | 300/180ms         | 不延迟真实 close；reduce 立即                        | menu/trackbook、AB 视频           |
| 从游戏/菜单/本子进入 create/replace | 无，画面瞬空       | 原赛道纸页揭走，露出真实绘图纸；顶部绘图引导从纸边展开（标题和意图不参与遮罩）；意图和名称立即可见 | beginEdit 成功，先捕获旧纹理，真实 editing 立即生效 | 380ms / 纸页      | 触笔/快捷键/生命周期清理；reduce 不捕获              | 两意图、三尺寸；editor 视频/三帧  |
| 空草稿取消/确认放弃                 | 无                 | 绘图页反向揭走，原路线出现；返回对应入口                                                           | 原 cancel 完成后                                    | 300ms / 纸页      | 不写盘，不改车位/圈时；reduce 立即                   | menu/editor、discard 视频         |
| 确认继续绘制                        | 无                 | 确认纸片退出、原草稿维持                                                                           | 原 keepEditing/focus 后                             | 180ms / 退出      | 触笔立即清理；reduce 立即                            | candidate/raw 保留                |
| 保存新建/修改                       | 太弱               | 绘图页收走，已提交路线显现；边缘保存签章与 HUD 呼应                                                | acceptDrawing 成功后；失败只有错误提示              | 300ms / 纸页+落位 | create ready / replace running 立即；reduce 文字     | storage/menu/editor；save 视频    |
| 按钮/卡片鼠标、键盘、触屏           | 太弱               | 按下压缩/下陷，释放回正；focus 与 selected 清晰分开                                                | pointerdown/keydown 原生输入，click 释放确认        | 100/120ms         | 不 preventDefault；disabled 不动；reduce 静态        | press/focus/Enter/Space/touch     |
| Space 开始/暂停/继续、R 重开        | 无                 | HUD 轻压纸/回正；暂停纸签出现；重开局部旋转                                                        | 真实模式切换后                                      | 180–260ms         | 不加倒计时；后续命令覆盖；reduce 文字                | menu/browser/handling             |
| 换轨 A/B                            | 太弱               | 已提交卡片选择签与 HUD 纸签对齐，路线轻量翻纸确认                                                  | 持久化及场景提交成功后的 change hook                | 320ms / 纸页      | 失败不庆祝；不自动开始；reduce 静态选择              | trackbook/storage；AB 视频        |
| 改名/删除/取消                      | 缺区分             | 保存名称下划线确认、删除状态收纸；取消只内页返回                                                   | 成功 run 后；失败局部红色反馈                       | 180–260ms         | 取消无成功签章；reduce 文字                          | trackbook/storage                 |
| 有效圈/无效圈/新纪录                | 太弱               | 普通圈纸签；无效局部铅笔提醒；新纪录盖章缩至落点、星标与最佳时钟呼应                               | onLap；新纪录必须 persist 成功                      | 220 / 180 / 460ms | 后一结果覆盖；失败绝无纪录庆祝；reduce 明确文字/星标 | 真实有效圈、存储失败；record 视频 |
| 触笔/闭合/无效/重画                 | 太弱               | 画线仍即时；闭合状态划线确认；无效仅提示局部横移 2px；R 用旧墨迹短擦除                             | editor 的状态回调及 redraw 输入                     | 140–240ms         | 新笔迹立即清旧页；reduce 静态颜色                    | editor、motion                    |
| 声音切换/越界                       | 足够文字，缺轻反馈 | 图标短回正；越界提示首次出现轻强调，不每帧重播                                                     | 状态变化时                                          | 120–160ms         | 不遮车、不改变音频保护；reduce 静态                  | sound、motion                     |

## 工程与竞态

唯一 `GameMotion` 控制器管理有名字的有限动画槽、视觉副本和一层背景；完成回调只回收自身视觉资源，不写游戏/存档/菜单状态。每个槽的新动画先取消旧动画，旧回调不能清新对象。真实 dialog 立即开关，退出副本是 aria-hidden/inert 的普通 div，不进入 top layer、不截获指针；同一时刻最多一个真实 modal。菜单层级仍由 MenuState 决定。

动画不变形 Phaser 或 draw-surface Canvas。纸页只在事件边界从已有 paper/road/scenery/car 纹理和已有笔迹复制一次，不调用几何推导或重新生成纹理；捕获失败直接跳过视觉，不妨碍功能。最多一个全画幅视觉纸页，触笔即移除。菜单项只错峰前六项。没有常驻循环和每帧 DOM 工作。

Esc/T/E/N/R/Enter/Space、后续命令、blur/hidden、resize、reduced-motion 运行中改变均可收敛；blur/hidden 继续走原暂停/清键/静音。reduce 首次生效跳过位移、回弹与副本，运行时切换立即取消 pending WAAPI/CSS，视觉源保持真实最终状态。保存/切换先成功再反馈，损坏存档/写入失败/恢复异常没有成功动画。

## 验收方式

`test:motion` 使用独立 headless Chromium、真实键鼠和只读 telemetry，覆盖三尺寸、两意图、快速操作、焦点、存储失败和运行时 reduced-motion；保存开始/中间/结束关键帧。录屏命令与产物在实现后的验证记录补齐，至少包含菜单、编辑返回、保存/放弃、A/B、新纪录五段。对比正常/减少动效及 CPU 降速下的输入到状态延迟、rAF 帧间隔和动画/副本上界；报告环境和分位数，不以无头数据冒充所有设备的真实帧率。

完成 typecheck、unit、build 和 menu/trackbook/storage/browser/handling/editor/sound 回归后创建独立 PR。最终质感由用户试玩菜单进出、换轨、按压及纪录奖励决定；停在 Code Review，不自动合并。

## 追加试玩反馈：焦点不是选中

Issue #8 的 2026-10-27 追加意见已纳入：保留 GameMenu.show 的真实默认 DOM 焦点、安全默认动作和 Tab 环绕。统一输入方式由视觉控制器在捕获阶段读取 pointerdown / 非组合 keydown，不阻止或重新派发输入、不修改菜单状态。

鼠标/触屏只显示 hover 与按压，程序聚焦的按钮不显示突兀焦点框；键盘 Esc 打开、Tab/Shift+Tab 或快捷键返回时，当前按钮以局部 30×3px 铅笔短线和柔和纸色底标记，主橙色按钮使用浅色铅笔线，在 reduce 下同样立即可见。输入框等非按钮控件保留原焦点描边。赛道 selected 仍由 aria-current、橙色静态边框与“当前赛道”表达，不再随 focus-within 改成蓝框；按下由短暂压缩表达，三者不共用持久状态。

`06-focus-inputs.webm` 与鼠标/键盘截图覆盖两种开法、说明返回、草稿确认、赛道本与重新打开；不全局删除 outline。录像与测量不自动打开用户浏览器。

## 初版 ec8e7da 实测与实拍（2026-10-27）

macOS 15.7.9 arm64、Node.js 22.22.3、Playwright 1.56.1；生产构建，隔离无头 Chromium。下表为同一脚本 20 次菜单 Esc 与 5 次编辑进入/空取消的样本。事件开始在 window capture 记时，结束监听位于真实处理器之后，菜单 stopPropagation 不会绕过测量；下一帧为 rAF 回调代理，不是屏幕呈现时间。reduce 是关闭视觉效果的对照，仍执行相同业务操作。

| CPU / 动效 | 空闲 rAF P95 | 操作期间 rAF P95 / 最长 | 菜单处理 P95 | 编辑处理 P95 | 下一帧代理 P95 | 动画槽峰值 |
| ---------- | ------------ | ----------------------- | ------------ | ------------ | -------------- | ---------- |
| 1× / 正常  | 33.4ms       | 33.4ms / 66.7ms         | 3.3ms        | 38.7ms       | 44.2ms         | 8          |
| 1× / 减少  | 33.4ms       | 33.4ms / 50.1ms         | 2.3ms        | 35.2ms       | 33.0ms         | 0          |
| 4× / 正常  | 33.4ms       | 83.3ms / 216.6ms        | 12.6ms       | 149.4ms      | 171.8ms        | 8          |
| 4× / 减少  | 50.0ms       | 50.1ms / 200.1ms        | 10.9ms       | 159.8ms      | 149.1ms        | 0          |

正常 CPU 下，开启效果与 reduce 的编辑处理 P95 分别为 38.7 / 35.2ms，菜单为 3.3 / 2.3ms。4× CPU 的编辑恢复仍有约 149–160ms 的同步处理，最长帧约 200–217ms，reduce 下也存在；本轮不重构原有恢复时的赛道绘制。操作过程包含切换/重绘，并非稳定驾驶帧率测试，不把无头或 CPU 降速结果当成真实低配 GPU/显示器保证。动画没有增加 300/380ms 的等待锁，结束后资源归零。

完整报告：`test-results/motion/report.json`。真实圈测试只观察 telemetry 并发送键盘输入；不伪造车位、圈时或检查点。录像含六段：`01-menu.webm`、`02-editor-return.webm`、`03-save-discard.webm`、`04-track-switch.webm`、`05-record.webm`、`06-focus-inputs.webm`，由 `review.html` 提供手动播放入口。视频不进入 Git，十三张精选原始 PNG 在 `docs/screenshots/p1-04b-*`，全部三尺寸开始/中间/结束关键帧保留在 `test-results/motion/`。

复现（两条命令在不同终端执行；均不自动打开浏览器）：

```bash
npm run build
npm run preview -- --port 4175 --strictPort
```

```bash
PAPERLAP_URL=http://127.0.0.1:4175 npm run record:motion
```

不需录屏时运行同一路径的 `npm run test:motion`；默认 URL 为本地 5173，可用 PAPERLAP_URL 指向预览。完整回归结果见 [验证记录](verification.md)。

PR #10 最新 Review 修正：按钮不再以完整外轮廓表示键盘焦点。仅游戏内、由既有输入方式追踪管理的按钮使用非封闭替代；全局 fallback 和非按钮 outline 保留。短线使用对比清楚的纸片墨色，forced-colors 下使用系统 Highlight，reduce 下静态可见。`test:focus` 验证鼠标→Esc 返回「我的赛道本」、Tab/Shift+Tab、Enter/Space、说明/草稿/赛道本、三尺寸与高对比模式；`PAPERLAP_FOCUS_BASELINE=1` 仅采集指定旧构建的同路径画面（本次修前为 ec8e7da，必须让 PAPERLAP_URL 指向该提交的构建；环境变量本身不切换代码），不声称修前符合新视觉验收。产物位于 `test-results/focus-review/{before,after}/`，主流程自动隔离无头录制，不打开播放器。
