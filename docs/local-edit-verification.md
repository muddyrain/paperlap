# P1-05B-01 原型验证

基线 `dacaa693`，独立分支 `feat/p1-05b-local-edit-rfc`，对应 Issue #12。此报告记录技术验证，不代表用户已认可拖弯手感，也不批准正式保存集成。

## 实际实现与运行

| 文件                                                          | 用途                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/game/local-edit.ts`                                      | 实验纯模块：弧长选区、有限支撑位移、合法候选与 24 层内存历史         |
| `src/prototypes/local-edit.ts`                                | 独立画布、真实鼠标捕获、RAF 合并、校验/采用、键盘与生命周期          |
| `src/prototypes/local-edit-fixtures.ts`                       | 四种合法中心线样例与 200/450/900 点测量输入                          |
| `src/prototypes/local-edit.css`、`prototypes/local-edit.html` | 独立纸片演示、原/新线叠加、影响区、错误点、可见键帽和 reduced-motion |
| `vite.local-edit.config.ts`                                   | 独立构建到 dist-prototype，默认游戏构建不包含它                      |
| `tests/local-edit.test.ts`                                    | 局部性、边界、非法几何、精确历史和旧纪录指纹反例                     |
| `tests/local-edit-browser.mjs`                                | 无头真实鼠标/键盘回归、截图、录屏、浏览器性能和资源观察              |
| `tests/local-edit-performance.ts`                             | 纯算法的选区、预览、严格校验测量                                     |
| `docs/local-edit-rfc.md`、README、package.json、.gitignore    | 方案、兼容边界、试玩与复现命令；忽略独立构建产物                     |

```bash
npm run demo:local-edit
# 手动打开 http://127.0.0.1:5174/prototypes/local-edit.html
```

拖动左侧弯道，松手看合法性；Enter/按钮仅采用到演示内存。Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做；Esc 先取消当前手势/预览，空闲时取消全部；R 回到原始路线。读取已有存档必须显式点击“读取此站赛道（只读）”，且浏览器 origin（含端口）相同。任何采用均不写盘，刷新丢失演示调整。

独立构建验收用 `npm run build:local-edit`，再运行 `npm exec vite preview -- --config vite.local-edit.config.ts --port 4186 --strictPort`。测试另开终端：

```bash
PAPERLAP_URL=http://127.0.0.1:4186 npm run test:local-edit
PAPERLAP_URL=http://127.0.0.1:4186 npm run record:local-edit
npm run bench:local-edit
```

record 命令在合法/非法对比画面短暂停留，便于肉眼审查，不改变几何、速度或测试断言。全部浏览器明确 headless:true、独立上下文、清除 PWDEBUG、静音、finally 清理；没有操作用户桌面或已有浏览器。输出 test-results/local-edit，不自动打开报告。

## 正确性结果

全量单测 **90/90**，其中局部编辑新增 **10 项**。原型浏览器 **23/23**，在独立构建而非 HMR 服务上复跑并录屏。

- 宽环 / S 弯 / 较紧弯分别在 1366×768、1280×800、900×700 真实拖动、松手检查、显式采用。对所有零权重点执行数值深比较；首点、下一点及末点精确不变，原输入不突变。黄色显示所有受影响线段及未移动的外端点，避免把采样段间插值变化漏出影响区。
- Enter 不采用非法候选，按钮保持 disabled；越界预览保留红线与原校验中文原因、错误点。纯模块还分别断言尖弯、交叉和道路间距错误，不绕过正式 validate。
- 精确 Undo/Redo、取消回原路、24 层上限、新调整清除 redo、getter 副本不能伪造合法候选、输入控件保留原生快捷键、原生按钮 Enter 和 Tab、reduced-motion 均通过。
- 起点/接头拒绝不安全选点；非均匀采样中完整固定起点两侧相邻线段，不只依赖 64 弧长。单纯点击选择不会产生待采用候选、历史或昂贵校验。
- Esc、pointercancel、真实释放捕获、blur、原生 resize、pagehide 在拖动中取消并释放捕获，保留已采用历史；不运行松手校验，不遗留 RAF。blur/pagehide 通过页面生命周期事件触发，未切换用户桌面应用。
- 实际读取已保存 Save V2 后拖动并采用；所有操作后 V2、V1、draft.v1 原文字节不变，运行期 setItem/removeItem/clear 调用数为 0。localStorage getter 拒绝时样例仍可操作。刷新回到样例，不恢复演示修改。
- 0.001 合法坐标变化复现相同旧 fingerprint 和 recordKey。未修改 hash、Save、RULES_VERSION 或历史成绩。

完整报告记录 page/console errors=0、failed requests=0。首次浏览器脚本发现 Chrome 的 lostpointercapture 要在下个 pointer 事件前派发，现释放后发送真实鼠标移动再等待事件；另将存储种子初始化限定到 HTTP(S)，避免 about:blank 的安全异常。没有屏蔽页面错误或放宽中断断言。最初直接构造的 16 点稀疏椭圆被原有间距规则拒绝；最终使用通过同一 validate 的非均匀路线测试长首段，未改变几何规则。

## 性能实测

环境：macOS / arm64，Apple M3 Pro，Node v22.22.3，Playwright 1.56.1 / Chromium 141.0.7390.37，无头、静音。无 CPU 限速。以下是本机实验数据，不是固定帧率或其他设备的保证。

纯算法：排除一次 warm-up，选区 30 次、位移预览 300 次、完整校验 15 次。中位耗时：

| 点数 | 冻结/选区 | 位移计算 | 完整校验 |
| ---- | --------- | -------- | -------- |
| 200  | 0.051ms   | 0.0024ms | 1.84ms   |
| 450  | 0.048ms   | 0.0045ms | 8.37ms   |
| 900  | 0.098ms   | 0.0096ms | 33.68ms  |

浏览器：每档 3 次真实拖动，共 78 次预览回调（含松手最终刷新），严格校验仅 3 次。预览时长含候选数组更新、轻量越界提示及 Canvas 绘制指令提交；事件延迟从最后 pointer handler 接收时刻算到绘制指令完成，不包括系统输入队列或 GPU 合成显示。校验不含随后的 DOM/重绘开销。

| 点数 | 预览中位 / P95 | 最后事件→绘制中位 / P95 | 松手完整校验中位 / 最大 |
| ---- | -------------- | ----------------------- | ----------------------- |
| 200  | 0.10 / 0.20ms  | 0.20 / 0.30ms           | 2.0 / 3.0ms             |
| 450  | 0.20 / 0.30ms  | 0.20 / 0.30ms           | 6.0 / 9.0ms             |
| 900  | 0.30 / 0.40ms  | 0.30 / 0.40ms           | 29.6 / 35.3ms           |

200 点有一次事件→绘制最大 23.6ms，未从报告剔除；小样本的 3 次松手不提供稳定尾延迟保证。900 点完整检查仍可能占主线程约 35ms，正是不能在每次 move 调用的原因。未来正式集成若需 Worker，必须配候选版本令牌、丢弃过期结果；不得靠动画等待掩盖未验证状态。

11 次完整重新打开 900 点原型，GC 后 JS 堆从 1,515,572 到 1,522,540 字节，DOM 节点 232、监听器 31、可见 Canvas 1 均保持；没有空闲 RAF。另连续 50 次真实 900 点拖动/采用，200 次预览、50 次完整校验、历史保持 24；第 25→50 次 GC 后堆 3,533,892→3,551,556 字节，监听器 44、节点 239 不增长。此观察覆盖本实验负载，不能证明所有浏览器永久无泄漏；没有测 GPU 或浏览器进程 RSS。

原始性能/资源数据：test-results/local-edit/node-performance.json、browser-report.json。

## 正式游戏隔离与回归

从干净 master dacaa693 在任务专用临时目录重新构建后，与本分支默认 dist 所有文件逐一比较 SHA-256，**完全一致**。包括 index.html、favicon.svg、JS 和 CSS。临时目录已自动清理。原型没有进入默认游戏 bundle，main/editor/scene/Save/草稿/物理/圈速/动效源码均未修改；独立构建 JS 约 19.35kB（gzip 8.28kB），没有 Phaser 或新依赖。

类型检查、默认构建、独立构建通过；默认构建仅既有 Phaser 大 chunk 提示。最终必要旧流程回归全部通过：驾驶 browser 15/15、editor 9/9、menu 13/13、storage 7/7、draft-review 9/9（初读拒绝 4、A/B 中断 5），共 **53/53**。与原型 23 项合计 **76 项浏览器检查**，报告记录的 errors/failedRequests 均为 0。完整日志为 test-results/local-edit/regression-*.log，运行结果和耗时为 regressions.json。

本轮没有重跑其余赛道本、声音专项、完整动效或整套草稿主测试；相关源码与默认构建字节均未变化。保留上述必要回归和全部单测作为证据，不把历史通过数混成本轮检查。

## 实际截图和录像

| 路线 / 尺寸      | 原始                                          | 合法局部修改                                 | 非法候选                                       |
| ---------------- | --------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| 宽环 / 1366×768  | [原始](screenshots/p1-05b-local-0-before.png) | [合法](screenshots/p1-05b-local-0-valid.png) | [越界](screenshots/p1-05b-local-0-invalid.png) |
| S 弯 / 1280×800  | [原始](screenshots/p1-05b-local-1-before.png) | [合法](screenshots/p1-05b-local-1-valid.png) | [越界](screenshots/p1-05b-local-1-invalid.png) |
| 较紧弯 / 900×700 | [原始](screenshots/p1-05b-local-2-before.png) | [合法](screenshots/p1-05b-local-2-valid.png) | [越界](screenshots/p1-05b-local-2-invalid.png) |

实际页面录屏 local-edit-playthrough.webm，20.28 秒；同帧率、原速转为 H.264/yuv420p 的 local-edit-playthrough.mp4。路径均在 test-results/local-edit；不录制用户桌面。9 张截图入库；视频/报告/日志保留本地，可用 record 命令重新生成。

## 留给试玩和 P1-05B-02 的问题

起点保护区不可编辑；默认半径是沿弧长，而非屏幕圆形笔刷。大位移会挤压采样、形成急弯，必须取消后再试；不做自动“修好”以免改变范围外路线。B 的稀疏派生锚点尚未制作同屏 A/B 原型，比较是设计分析，不能断言其手感较差。鼠标拖动是本轮几何操作方式，键盘可访问所有操作按钮但尚不支持键盘移动选区；当前仅 Chromium 验证。

建议 02 继续有限支撑位移，但先由玩家确认推拉软硬、可选半径和保护区是否直觉，再单独批准 geometry identity / Save V3 / legacy best 展示与局部草稿协议。当前原型不应直接接到正式保存按钮。
