# MVP 验证记录

验证日期：2026-10-26。Node.js 22.22.3，Phaser 3.90.0，Vite 8.3.5，TypeScript 5.9.3。

最终结果：类型检查通过，核心规则测试 **10/10**，生产构建通过。针对 `http://127.0.0.1:4173/` 生产预览的无头浏览器检查 **15/15**，控制台错误与失败资源请求均为零，测试进程退出码为 **0**，浏览器与上下文已释放。

## 核心规则

`npm test` 验证闭合道路、开放线、交叉、退化、非有限数值、道路重叠和尖弯；初始化不计圈、顺序检查点、正向移动线段过线、反向/漏点/出界无效；30/60/144 FPS 一致、长帧间隔限制、静止转向/刹停/出界减速；计时格式、重置、成绩归属、损坏存档与存储不可用降级。

## 浏览器

最终验证使用项目内独立的无头 Chromium，`headless: true`。真实 Pointer/Keyboard 事件完成默认驾驶、绘制并驾驶新赛道、无效草稿与恢复、暂停/继续/R、刷新和完整有效圈。测试只读取诊断快照，未直接修改游戏状态来模拟完成。

1366×768、1280×800、900×700 均检查 HUD 边界与实际缩放绘图。检查重复编辑与重启后仍只有一个引擎画布、一个绘图画布，动态效果不超过 140 条。检查控制台和网络请求。

截图保存在 `docs/screenshots/`；自动生成的逐项结果为 `test-results/browser-report.json`。

无头环境中的失焦验证通过 DOM blur/visibility 生命周期触发，不声称测试了实际切换系统应用。声音开关、偏好和初始化可自动验证，合成音听感未通过无头浏览器验证。

## 第二轮：转向调校

用户试玩反馈为“转弯难转”。基线提交是 `12a63c8`。先增加 `tests/handling.test.ts` 并确认旧实现的转弯半径、方向起效与回正检查失败，再修改运动模型。

同样的初始速度、持续加速和转向输入下，转到 90° 时按行驶长度除以实际转角得到等效转弯半径：

| 测量项                          | 首版    | 第二轮  |
| ------------------------------- | ------- | ------- |
| 初速 220 的等效半径（世界单位） | 117.75  | 83.11   |
| 初速 260 的等效半径（世界单位） | 132.96  | 89.57   |
| 初速 220 转到 90° 的时间        | 0.808 s | 0.592 s |
| 按住方向 117 ms 后的转向量      | 77.1%   | 92.3%   |
| 松开方向后 100 ms 内继续转动    | 6.63°   | 3.77°   |

修改集中在中高速转向增益和方向起效、回正响应。原有低速基础转向、抓地力、加速、刹车、最高速度和道路判定沿用。固定步长检查仍覆盖 30/60/144 FPS，增加左右连续修正后收敛、无突然转角和持续侧滑的检查。

规则版本升级为 2。旧赛道、声音偏好和 `rules-1` 成绩保留，HUD 仅读取 `rules-2` 成绩。单元测试与无头浏览器均检查这个迁移过程。

`npm run test:handling` 通过真实键盘事件完成默认赛道连续两圈有效驾驶，宽弯目标速度 220、较紧弯目标速度 190，并确认存在松油入弯、新纪录正确归属及旧成绩保留。方向响应按实际游戏时间采样，避免将无头渲染耗时当作模拟时间。脚本只读取遥测，不修改车辆或圈数。

定向无头检查 4/4，通过后浏览器与上下文正常关闭。结果为 `test-results/handling-report.json`，截图为 `test-results/handling-v2.png`。自动化可以验证轨迹和输入响应，手感是否合适仍需要玩家再试玩确认。

本轮最终结果：核心规则测试 14/14，类型检查和生产构建通过；生产预览的原有无头回归 15/15，加上转向定向检查 4/4，均正常退出且无控制台错误。原有绘图、三种桌面尺寸、暂停、重置、出界无效圈与刷新存档流程继续通过。

## 手绘赛道容错与编辑快捷键

按用户截图近似描出的闭合路线，以及带轻微手抖的椭圆，在旧实现中均被“弯太挤”拒绝。`tests/editor.test.ts` 先复现失败，再验证修复；其中包含四个不同起笔位置，且要求处理后的路线保持接近原笔迹。

手绘输入改为去重、按弧长采样、循环加权平滑、再次等距采样，最后执行原有的道路几何校验。循环平滑同时处理首尾接头，减少手抖形成的局部急弯。固定示例赛道继续采用原算法，已保存赛道不重新加工；交叉、过窄、道路重叠和极尖弯的限制继续生效。

编辑器显示建议绘制范围。画满一圈后进入起点圆圈会变绿并提示松开；松开后生成真正道路。快捷键为 R 重画、Enter 在有效预览后起跑、Esc 取消恢复。按钮附带可见键帽及 `aria-keyshortcuts`。

快捷键仅在游戏界面内响应，忽略组合键、文本输入与长按重复事件；按钮获得焦点时 Enter 保持按钮自身行为。拖画失焦、resize、pointercancel 或丢失捕获时会释放状态，避免后续无法再次落笔；R 也可直接中断当前拖画。取消编辑保留旧车位、计时和存档。

专用检查命令为 `npm run test:editor`，报告和截图保存在 `test-results/editor/`。使用独立无头 Chromium，通过真实鼠标与键盘操作验证近似截图路线、手抖路线、闭合提示、快捷键与焦点、拖画中断、绘制后驾驶和 1366×768 / 1280×800 / 900×700 布局。自动化截图保存为文件后读取检查。

最终结果：核心测试 16/16、类型检查和生产构建通过；针对生产预览的编辑器检查 9/9、原有浏览器回归 15/15 全部通过，控制台错误与失败资源请求均为零，所有测试上下文与浏览器正常关闭。选取的编辑界面截图为 `docs/screenshots/editor-shortcuts.png`。

## P1-01：Save V2 与无损迁移

验证日期：2026-10-26。环境为 Windows、Node.js 26.4.0、Playwright 1.56.1、独立 Chromium Headless Shell 141.0.7390.37；生产预览使用 `http://127.0.0.1:4175/`。车辆、几何、圈速、编辑器和样式源码保持不变，驾驶规则仍为 2。

| 命令 | 结果 |
| --- | --- |
| `npm ci --registry=https://registry.npmjs.org` | 通过；补齐原锁文件缺失的可选平台绑定并改为公共 npm 下载地址，已有版本和 integrity 全部保持不变 |
| `npm run typecheck` | 通过 |
| `npm test` | 34/34：原有几何/驾驶/编辑/圈速等 14 项，Save V2 专项 20 项 |
| `npm run build` | 通过；仍有 Phaser 引擎 chunk 超过 500 kB 的提示 |
| `PAPERLAP_URL=http://127.0.0.1:4175 npm run test:storage` | 7/7 |
| `PAPERLAP_URL=http://127.0.0.1:4175 npm run test:browser` | 15/15 |
| `PAPERLAP_URL=http://127.0.0.1:4175 npm run test:handling` | 4/4 |
| `PAPERLAP_URL=http://127.0.0.1:4175 npm run test:editor` | 9/9 |
| `git diff --check`、中文编码检查 | 通过 |

表中的环境变量写法用于说明配置；PowerShell 实际使用 `$env:PAPERLAP_URL='http://127.0.0.1:4175'` 后运行相应 npm 命令。所有浏览器验证保持 `headless: true`、独立上下文、真实页面键鼠事件和只读遥测；没有系统级输入、已有浏览器接管或自动打开报告。四套浏览器检查共 35 项，控制台错误均为零；通用、编辑器和存档三套收集的失败资源请求也均为零。各次结束均关闭任务创建的上下文和浏览器。

专项单测在迁移和运行时实现前加入，先确认缺少 V2 API 时失败，再实现并验证通过。覆盖：初始化与序列化、V1 中规则 1/2 成绩、40 条旧记录不再被旧 32 条读取窗口裁剪、孤立成绩归档、同几何多 UID、改名、几何/规则隔离、增删切换、最后一条保护、损坏形状/几何/指纹/UID/纪录、容量边界、写入失败、迁移重试与 V1 原文不变。旧存档测试从 `rules.test.ts` 移入扩展后的 `storage.test.ts`。

真实存储检查使用有效 V1 路线与成绩，逐字比较迁移前后的 V1 字符串。迁移成功后修改声音和路线，验证只有 V2 更新；新路线保留 UID、名称和旧纪录，HUD 不套用旧几何成绩。另用两个同几何条目验证各自最佳，覆盖损坏 V2 的只读回退、真实 `QuotaExceededError` 和 `SecurityError` 注入下的继续驾驶及保存失败提示。

首次运行原通用回归，1.4 秒墙钟等待仅推进约 0.40 秒模拟时间，导致位移断言失败。独立构建基线 `cbe5a51` 后，按同样输入得到相同油门状态（速度 41.33），确认是当前无头环境的渲染调度差异。通用和编辑器驾驶等待改用只读模拟计时，保留原有位移/转向/速度断言；R 在真实按键处理后立即采样，验证精确归零。完整圈脚本保留 180 秒墙钟安全上限。没有增加修改车辆或时间的调试入口，没有改变游戏更新步长或渲染配置。

浏览器首次安装在 Node 26 的 ZIP 解压步骤停滞；停止本任务安装进程后，用已下载归档完成 Chromium 解压，并使用 Node 24.19.0 安装匹配的 Headless Shell，随后执行全部回归。

报告位于 `test-results/storage/report.json`、`test-results/browser-report.json`、`test-results/handling-report.json`、`test-results/editor/report.json`。已读取检查迁移后路线、有效圈新纪录和 900×700 编辑器截图。测试产物留在被 Git 忽略的 `test-results/`，不替换原有产品截图。

另使用 develop-web-game 技能附带的通用 Playwright 客户端，以无头方式执行短按键序列并保存截图，退出码 0，未生成错误日志；已读取 `test-results/game-client/shot-0.png`。项目源码继续使用原有只读遥测，不新增游戏状态写入接口。

数据恢复与容量限制见 [storage-v2.md](storage-v2.md)：V1 孤立成绩缺少中心线，只归档；损坏原文拒绝自动覆盖；超限不自动清除有效数据；本轮不提供跨标签页合并协议、存档修复 UI 或赛道本 UI。声音听感与跨浏览器、Mac 平台表现未在本次 Windows 无头验证中评估。

## PR #2 评审修复：多赛道重复几何校验

2026-10-26，在同一 `feat/p1-01-save-v2` 分支继续处理评审。保留 Save V2/V1 和成绩归属规则，仅在 `save.ts` / `storage.ts` 安全复用未变化几何和已验证原文。未修改 `main.ts`、车辆、几何算法、圈速、编辑器或样式；没有 P1-02 UI。

新增 8 项缓存安全与 2 项性能回归，原有 34 项不变。安全测试覆盖验证后对象突变、冻结数组中的可变点、稀疏数组、同指纹的细小坐标变更、元数据/成绩篡改、新增/替换非法路线、原文外部改动、不同存储对象、同一存储对象超配额失败；不得因缓存写入无效内容。两组性能测试（20×350 / 20×900）先在基线 `93165ce` 失败，再在优化后通过，采用相对于同工作负载完整解析的耗时比例，避免固定硬件毫秒阈值。

| 命令 | 最终结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 44/44；同一存储对象失败的定向用例修订后，专项 8/8 也通过 |
| `npm run build` | 通过，保留原 Phaser chunk 大小提示 |
| `npm run bench:storage -- --baseline-ref 93165ce` | 精确执行旧源码，通过 |
| `npm run bench:storage` | 优化后 Node/内存存储基准通过 |
| `npm run bench:storage:browser` | 真实隔离 localStorage 基准通过，控制台错误 0 |
| `npm run test:storage` | 7/7 |
| `npm run test:browser` | 15/15 |
| `npm run test:handling` | 4/4 |
| `npm run test:editor` | 9/9 |
| 编码、Prettier、`git diff --check` | 通过 |

回归指向 `PAPERLAP_URL=http://127.0.0.1:4185` 的生产预览。基准另使用 4186 开发服务加载纯测试模块，不运行游戏渲染。两者均保持不自动打开浏览器。所有 Playwright 会话为独立无头 Chromium，35 项游戏回归的控制台错误为 0；收集网络失败的通用、编辑器、存档三套均为 0；各上下文及浏览器均正常关闭。

基准为当前机器 Windows x64 / i5-12400F / Node 26.4.0 / Chromium 141.0.7390.37。真实 localStorage 的“刷新成绩并写入”中位数：20×350 点 **236.3→3.9 ms**，20×900 点 **1495.6→10.8 ms**；不可信 JSON 的 20×900 点解析仍为 **487.4→492.7 ms**，继续严格校验。Node 基准对应 **234.851→3.503 ms**、**1505.935→8.979 ms**。每项一次预热、5 次样本，测量不包含游戏渲染竞争，不承诺所有设备帧预算；完整表格、安全边界和复现命令见 [storage-performance.md](storage-performance.md)。

截图和既有游戏报告继续位于 `test-results/`，未改产品图片或新增运行时调试入口。另执行技能附带通用无头客户端，短按键序列退出码 0、无错误日志，截图为 `test-results/game-client-review/shot-0.png`；已读取它与完整有效圈截图进行检查。性能原始样本位于 `test-results/storage-performance/`。Mac、其他浏览器及声音听感本轮未评估。

## P1-02：赛道本最小可用流程

验证日期：2026-10-27。环境为 macOS arm64、Node.js 22.22.3、Playwright 1.56.1，使用独立无头 Chromium。基线为 `master` 的 P1-01 合并提交 `6356036d`；开发分支为 `feat/p1-02-trackbook-flow`。状态转换与失败策略在实现前写入 [trackbook-flow.md](trackbook-flow.md)，随后逐项加入控制层测试并实现。

`trackbook.ts` 协调新建/编辑意图、纯 Save 候选、持久化和场景提交；`trackbook-ui.ts` 提供文字列表、改名及删除确认。新建保存新 UID 后进入 ready，切换或删除活动条目也回到 ready；重命名与删除非活动条目不重建场景。取消恢复车位和圈速，不写盘；新建失败保留有效草稿。现有编辑、静音和纪录的存储受限试玩语义保留。

9 项控制层单测覆盖同几何独立 UID、取消、重选无副作用、先保存后提交、严格管理失败保留旧数据、替换时保留名称/历史、确认删除和最后一条保护、元数据不重建场景、20 条上限，以及写盘前/后的渲染失败恢复。原有 44 项包含缓存突变安全、V1 原文保护、Save V2 归属和 20×350/900 点性能回归。

`test:trackbook` 通过真实鼠标创建 B，反复 A/B 切换及刷新；检查正确中心线、起点、零计时、车辆、越界、特效、held keys 和目标纪录，并读取实际引擎增益确认切换后静音。还覆盖非法/重复名称、输入框键盘隔离、编辑与新建取消、无效草稿、R/Enter/Esc、删除确认/取消、活动与非活动删除、损坏 V2、配额、存储拒绝、20 条上限和历史空名显示回退。浏览器在 Canvas API 边界注入异常：准备失败不写盘，提交失败停止游戏循环、隐藏坏画面，经按钮重新加载已保存条目；不开放游戏状态写入接口。

新增的真实键盘用例复现了新建保存后焦点移到开始按钮、长按 Enter 会立即起跑的问题。修复为焦点留在游戏区域，重复键不会启动驾驶；新建按钮、成功提示与无障碍标签明确写“保存”，编辑当前仍使用“试跑”。

所有浏览器检查通过 `PAPERLAP_URL=http://127.0.0.1:4174` 指向生产预览，明确 `headless: true`，清除继承的 PWDEBUG，使用独立上下文和页面键鼠 API。没有接管个人浏览器、激活窗口、发送系统输入或自动打开报告。截图保存在文件中，已读取检查赛道本三种尺寸中的 900×700 画面；完整纸片抽屉和缩略图仍留在 P1-03。

未修改 `save.ts`、`storage.ts`、`geometry.ts`、`vehicle.ts`、`laps.ts`、`config.ts` 或 RULES_VERSION。存档格式、迁移与性能缓存不变，没有跨标签合并协议。极少见的写盘后渲染错误采用已保存数据重新加载，不保证保留本次未保存的试玩变化。声音自动化检查状态与增益，听感和其他浏览器尚未人工验证。

| 命令 | 最终结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 53/53：原有 44 项、控制层新增 9 项 |
| `npm run build` | 通过；保留既有 Phaser chunk 超过 500 kB 提示 |
| `npm run test:trackbook` | 13/13，包含长按 Enter、实际引擎增益与两阶段 Canvas 故障 |
| `npm run test:storage` | 7/7 |
| `npm run test:browser` | 15/15，含真实键盘完整有效圈与纪录刷新 |
| `npm run test:handling` | 4/4，含连续两圈较快驾驶与旧规则纪录保留 |
| `npm run test:editor` | 9/9，新增意图接入后复跑通过 |
| 源码/专项测试 Prettier、`git diff --check` | 通过 |

五套无头浏览器共 48 项检查，控制台错误均为 0；收集失败资源请求的四套均为 0。所有任务创建的浏览器和上下文已正常关闭；开发与生产预览服务在验证后关闭。报告为 `test-results/trackbook/report.json`、`test-results/storage/report.json`、`test-results/browser-report.json`、`test-results/handling-report.json`、`test-results/editor/report.json`，三种尺寸赛道本截图为 `test-results/trackbook/list-*.png`。测试产物保留在 Git 忽略目录，不替换已有产品截图。

本轮修改 13 个文件：新增 `src/game/trackbook.ts`、`src/game/trackbook-ui.ts`、`tests/trackbook.test.ts`、`tests/trackbook-browser.mjs`、`docs/trackbook-flow.md`；修改 `src/main.ts`、`src/game/editor.ts`、`src/game/scene.ts`、`src/style.css`、`package.json`、`README.md`、`docs/storage-v2.md`、本验收文档。

## PR #4 试玩评审修复：名称层级与画面遮挡

2026-10-27，继续在 `feat/p1-02-trackbook-flow` 处理 [用户 Code Review](https://github.com/muddyrain/paperlap/pull/4#pullrequestreview-5661649265)，基线为 `3826723`。只调整表现层、文案与相应浏览器检查；`trackbook.ts`、Save V2、存储/迁移/性能缓存、场景、车辆、几何和圈速规则均未修改。

- 左上纸片主标题为“当前赛道：名称”，“自由试跑”缩为次要信息。名称限制在独立宽度内省略显示，DOM 保留全文，支持键盘聚焦和悬停 title；切换、改名及删除活动条目沿用现有同步入口。赛道本入口移到右上。
- 成功、警告与新纪录反馈缩为右上边缘纸条，新纪录保留星标和轻微出现动画，遵循 reduced motion。准备和暂停操作移到页脚纸条；准备状态也不再生成中央卡片，避免新建保存后重新遮住道路。车辆、计时冻结和显式开始/恢复行为不变。
- 新建顶部持续说明“将保存为独立赛道，原有赛道保留”，主按钮“保存新赛道”；编辑顶部显示“编辑当前赛道”、目标名称、“保存将替换当前赛道路线，取消不会影响原赛道”，主按钮“保存修改并试跑”。同步 title、aria-label、Canvas 标签及 Enter 成功提示。绘图初始说明移到顶部，校验和错误信息位于底部操作区，画布中心留空。

`test:trackbook` 保留原 13 项，新增三种桌面尺寸（1366×768、1280×800、900×700）的 UX 场景及一个真实有效圈新纪录场景。通过实际 UI 改名验证短名称、40 字长名称、省略与全文 title、主次字号及计时器间隔；通过真实键鼠验证暂停冻结、新建/编辑意图及 Enter/R/Esc、取消不写盘、新建保存后 ready。对准备、暂停、通知区域直接计算与道路/车辆的距离，检查初始绘图说明全部位于绘制边界上方。新纪录通过外部只读遥测和真实键盘驾驶触发，没有向游戏状态写值或伪造印章。

原始截图位于 `test-results/trackbook/ux-*.png`：每种尺寸各有 HUD、暂停、编辑、新建、新建保存五张，另有 `ux-record-900.png`，共 16 张。选取不同尺寸与状态的画面放入 `docs/screenshots/p1-02-ux-*.png` 供 PR 评审。

新增检查先复现了编辑界面缺少明确标题/覆盖说明的问题；接入后又发现改名不重建场景，Canvas 标签从场景取名会沿用旧名称。现在由活动条目向编辑器传入仅用于标签的名称，保留场景和赛道管理规则。长名称测试同时核对视觉目标名称和 Canvas 全文标签。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run build` | 通过，保留既有 Phaser chunk 大小提示 |
| `npm test` | 53/53，含缓存安全和 20×350/900 点性能回归 |
| `npm run test:trackbook` | 17/17，保留原 13 项并新增 4 项 UX 场景 |
| `npm run test:storage` / `test:editor` / `test:browser` / `test:handling` | 7/7、9/9、15/15、4/4 |
| 改动源码/测试 Prettier、`git diff --check` | 通过 |

五套浏览器共 52 项，控制台错误为 0；收集失败请求的四套均为 0。全部使用隔离无头 Chromium，测试浏览器、上下文和本任务服务均已关闭。已读取检查全部六张入库截图：

- [1366×768：长赛道名 HUD](screenshots/p1-02-ux-hud-1366.png)
- [1280×800：暂停](screenshots/p1-02-ux-paused-1280.png)
- [900×700：编辑当前赛道](screenshots/p1-02-ux-edit-900.png)
- [900×700：新建赛道](screenshots/p1-02-ux-new-900.png)
- [900×700：新建保存与 ready](screenshots/p1-02-ux-saved-900.png)
- [900×700：真实有效圈新纪录](screenshots/p1-02-ux-record-900.png)

## P1-03：赛道本操作体验

2026-10-27，从最新 master / `24dd2c1` 创建 `feat/p1-03-trackbook-ux`，按 [Issue #5](https://github.com/muddyrain/paperlap/issues/5) 先编写 [状态与交互规则](trackbook-interactions.md)，再实现抽屉/卡片，最后接入微交互。环境为 macOS 15.7.9 arm64、Node.js 22.22.3、Playwright 1.56.1、Phaser 3.90.0；生产预览地址 `http://127.0.0.1:4174/`。

游戏区域的 T/E/Space/R 分别对应赛道本、编辑当前、开始/暂停/继续和重新开始。抽屉 N 新建，上下键只移动卡片焦点，Enter/Space 使用赛道但不起跑。Esc 从改名/删除确认退回列表，再关闭并恢复入口；Tab/Shift+Tab 在可见控件内循环。绘图 R/Enter/Esc 保留重画/保存/取消语义。输入框、IME、Ctrl/Meta/Alt 不触发动作；按钮首次原生激活保留，重复 Enter 不会在改名完成后意外切换非当前卡片。取消绘图与点击暂停后焦点回到游戏，方便接续快捷键。

右侧纸片抽屉显示数量、实际 SVG 路线、名称、当前标记及 UID+几何+rules-2 的个人最佳。缩略图使用完整中心线和道路宽度、按边界留白缩放；不进入存档，不在每帧生成。20 条长名称列表内部滚动，Phaser 画布尺寸不变。900×700 使用较紧凑的卡片间距，保留中文动作、图标和键帽。

抽屉打开 220ms、关闭 200ms，新的卡片操作可取消退出动画；旧回调不能关闭重开的抽屉。卡片有悬停、焦点和按压反馈，切换后的名称和边缘纸贴仅在控制层成功后出现。改名/删除反馈位于抽屉底部，保存/新纪录反馈位于游戏边缘。reduced-motion 下跳过动效，运行期间切换此偏好也能结束抽屉过渡。

新增快捷键与缩略图单测先确认缺少模块时失败，再实现通过。浏览器还复现并修复了取消后焦点落在开始按钮、点击暂停失焦先禁用按钮，以及长按 Enter 改名后激活非当前卡片的问题。已有编辑器检查的一次重跑暴露出 viewport 协议完成早于 resize 事件的等待竞争；测试现在先等待页面实际显示“中断”再松开鼠标，保留原有中断与后续画线断言，没有修改编辑器实现。

实际改动文件：

- `src/main.ts`、`src/style.css`：动作入口、焦点、键帽、紧凑反馈和纸片样式。
- `src/game/trackbook-ui.ts`：抽屉、卡片、表单/确认、导航与可取消动效。
- 新增 `src/game/shortcuts.ts`、`src/game/thumbnail.ts`、`src/game/ui.ts`：状态映射、真实缩略图、共用图标/按钮内容。
- 新增 `tests/shortcuts.test.ts`、`tests/thumbnail.test.ts`、`tests/fixtures/trackbook-ux.mjs`；扩展 `tests/trackbook-browser.mjs`，同步 `tests/editor-browser.mjs` 的 resize 等待。
- `README.md`、`docs/trackbook-interactions.md`、本验证记录及下列实际游戏截图。

Save V2 schema、V1 迁移、UID/几何/规则纪录绑定、`trackbook.ts` 的准备/写入/提交流程和性能缓存均保持原样；`scene.ts`、`editor.ts`、`geometry.ts`、`vehicle.ts`、`laps.ts`、`config.ts`、RULES_VERSION 均未改动。没有新增依赖或外部素材请求。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 通过；保留既有 Phaser chunk 超过 500 kB 提示 |
| `npm test` | 56/56，含原有 53 项、快捷键 2 项、缩略图 1 项；缓存安全与 20×350/900 点性能回归通过 |
| `npm run test:trackbook` | 26/26，原有 17 项加本轮 9 项交互检查 |
| `npm run test:storage` | 7/7 |
| `npm run test:editor` | 9/9 |
| `npm run test:browser` | 15/15，含真实有效圈与纪录持久化 |
| `npm run test:handling` | 4/4，含真实连续两圈较快驾驶 |
| 改动源码/测试 Prettier、`git diff --check`、UTF-8 检查 | 通过 |

五套浏览器共 61 项，控制台错误为 0；收集失败资源请求的四套均为 0。所有命令退出码均为 0。全部清除继承的 PWDEBUG，明确 `headless: true`，使用隔离 Chromium 上下文与页面键鼠 API；没有前台浏览器、系统键鼠或个人 Chrome 接管。测试浏览器、上下文及本任务生产预览服务在验证后释放。报告在 Git 忽略的 `test-results/` 内，按既有位置保存。

实际截图已读取检查，8 张原始 PNG 入库供审查：

- [1366×768：抽屉、真实 A/B 卡片、最佳与选中状态](screenshots/p1-03-drawer-1366.png)
- [1280×800：纸片抽屉与键帽](screenshots/p1-03-drawer-1280.png)
- [900×700：紧凑卡片、中文动作与键盘焦点](screenshots/p1-03-drawer-900.png)
- [900×700：切换后 ready，完整赛道与边缘反馈](screenshots/p1-03-switch-ready-900.png)
- [1366×768：reduced-motion 静态状态](screenshots/p1-03-reduced-motion-1366.png)
- [1366×768：打开动画中间状态](screenshots/p1-03-opening-1366.png)
- [900×700：编辑意图与保存键帽](screenshots/p1-03-edit-900.png)
- [900×700：真实键盘有效圈触发新纪录反馈](screenshots/p1-03-record-900.png)

未发现阻塞验收的问题。此次浏览器自动化覆盖 Chromium；Safari/Firefox 与人工听感未验证。既有跨标签同步限制、存储受限时原有编辑可继续本次试玩的行为保持不变；仍需用户真实试玩评审后再决定合并。

## PR #6 复审修复：声音按钮焦点

2026-10-27，基线 `1212cc5`，处理 [main.ts 第 222 行的 Review](https://github.com/muddyrain/paperlap/pull/6#discussion_r4385048839)。新增专项测试先在实际生产构建复现：按住 ArrowUp，鼠标点击声音按钮后错误进入 paused。原因是 pointerdown 的默认焦点转移先触发游戏 blur，onclick 中的 running 判断已无法恢复焦点。

`src/main.ts` 仅为声音按钮新增局部 pointerdown 处理：running 且鼠标主按钮按下时 preventDefault，保留游戏焦点和 held keys；ready/paused 的鼠标聚焦、Tab/Enter/Space 原生按钮操作，以及 window blur / visibilitychange 的暂停逻辑均保持原样。未改动抽屉、缩略图、动画、Save V2、音频实现或驾驶规则。

新增 `tests/sound-browser.mjs` 和 `npm run test:sound`，同步 README 命令说明。四项隔离无头 Chromium 检查覆盖：驾驶中开/关声音后的车辆位移、加速、模拟计时、音频增益、偏好保存、转向及松键；ready 点击后正常开始；Tab 离开游戏仍暂停，Enter/Space 各切换一次且不误起跑；声音切换后的窗口/标签生命周期事件仍冻结车辆/计时、清键并静音，直到显式恢复。生命周期事件通过页面 API 投递，没有操作系统前台切换；全部车辆和圈速数据只读。

| 本次复测 | 结果 |
| --- | --- |
| `npm run test:sound` | 4/4，先复现失败再修复通过 |
| `npm run test:browser` | 15/15，含失焦、暂停/恢复、声音偏好、真实有效圈与三种桌面尺寸 |
| `npm run test:storage` | 7/7，迁移、偏好和存储失败回归 |
| `npm test` | 56/56 |
| `npm run build`（含 typecheck） | 通过，保留既有 Phaser chunk 提示 |
| 改动源码/测试 Prettier、`git diff --check` | 通过 |

本次三套浏览器共 26 项，控制台错误与失败请求均为 0，命令退出码均为 0。使用独立、明确 headless 的 Chromium，忽略 PWDEBUG；全部测试浏览器、上下文及本任务预览服务已释放。没有修改或重新生成已验收的抽屉、缩略图、动画与截图。专项报告为 `test-results/sound/report.json`，原有两套报告位置不变。

## P1-04A：正式 Esc 游戏菜单

2026-10-27，从最新 master `ac678a6` 创建 `feat/p1-04a-esc-menu`，按 [Issue #7](https://github.com/muddyrain/paperlap/issues/7) 先写 [菜单状态表与返回规则](game-menu.md)，再增加状态/按键单测、实现原生 dialog 与路由，最后验证实际键鼠与截图。本轮不实施 #8 的完整动效升级。环境继续使用 macOS 15.7.9 arm64、Node.js 22.22.3、Playwright 1.56.1，生产构建预览为 `http://127.0.0.1:4174/`。

独立 MenuState 管理覆盖层、一次性的恢复许可和编辑来源，GameMenu 管理视图与焦点。Esc 在 ready/running/paused 均打开同一菜单；running 先暂停、清键、静音。只有直接来自 running、赛道身份不变、没有失焦/隐藏/缩放或进入赛道本/编辑、且关闭时文档与菜单焦点正常，Esc 才恢复原驾驶；其他关闭保留 ready/paused。遮罩关闭不恢复。Space 在游戏区域仍是快速开始/暂停/继续，菜单按钮上的 Enter/Space 保留原生操作。菜单提供继续/开始、重开、赛道本、编辑、声音和操作说明，真实快捷键均有图标、中文和键帽。

菜单→赛道本→关闭返回菜单；T 直达赛道本仍返回游戏。菜单/赛道本进入编辑会记录来源，取消返回对应入口；有笔迹或有效预览的 Esc/取消先进入放弃确认，默认继续绘制，Esc/Enter 不丢草稿，显式放弃才还原旧赛道、车位与圈时。确认展示编辑前的冻结圈时。保存沿用 create→ready、replace→running，清空返回链。各路由先关闭旧 dialog，再打开新 dialog，避免双模态。

恢复清空驾驶键后，旧按键 repeat 不再重新加油，必须松开重新按；车辆惯性保留。blur/hidden 的安全暂停、P1-03 声音鼠标防失焦修复继续有效。菜单恢复失败保护会清理覆盖层，任何游戏快捷键均不能启动故障场景；重载按钮仍允许原生 Enter/Space 显式重载。

状态单测先确认缺少模块时失败，再实现通过。真实无头测试覆盖非零圈时与车位恢复、A/B 新建/切换/刷新、说明返回、Tab/Shift+Tab 首尾循环、原生按钮、重按、输入框/IME/组合键、窗口生命周期、容量/存储与场景异常、三种尺寸和 reduced-motion。生命周期通过页面 API 投递，未切换用户前台应用；驾驶、绘图与卡片选择均用实际页面键鼠，未写入车辆、圈时或检查点状态。

原回归中的“Esc 快速暂停”场景改用仍保留的 Space；草稿取消补上显式确认，并在需要回到主游戏的旧场景中显式关闭重新打开的赛道本。原车位、圈时、存档与几何断言保留，菜单中间层级另由专项覆盖。初次并发验证出现完整圈离路/未见新纪录；保持原速度目标和断言，改为串行复测。两次菜单进程误写同一目录的中间日志也已弃用，最终菜单报告来自一次独立完整运行。

实际修改文件：

- 新增 `src/game/menu-state.ts`、`src/game/game-menu.ts`；修改 `src/main.ts`、`src/game/shortcuts.ts`、`src/game/ui.ts`、`src/style.css`；`src/game/trackbook-ui.ts` 仅新增关闭返回钩子。
- 新增 `tests/menu-state.test.ts`、`tests/menu-browser.mjs`、`tests/fixtures/editor-actions.mjs`；扩展 `tests/shortcuts.test.ts`，同步 `tests/browser.mjs`、`tests/editor-browser.mjs`、`tests/storage-browser.mjs`、`tests/trackbook-browser.mjs`、`tests/fixtures/trackbook-ux.mjs`。
- `package.json` 增加 `test:menu`；更新 `README.md`、`docs/game-menu.md`、`docs/trackbook-interactions.md` 与本验证记录，另提供下列截图。

`scene.ts`、`editor.ts`、`trackbook.ts`、Save V2、存储/迁移/性能缓存、物理、几何、圈速与 RULES_VERSION 均未修改。没有新增依赖、转场等待或完整动效系统。

| 最终检查 | 结果 |
| --- | --- |
| `npm run build`（含 typecheck） | 通过，保留既有 Phaser chunk 提示 |
| `npm test` | 61/61，原 56 项 + 菜单状态 4 项 + 菜单按键 1 项；缓存安全和性能回归保留 |
| `npm run test:menu` | 13/13，最终单独完整运行，含非零圈时、Tab 首尾循环及 running 来源的写入失败 |
| `npm run test:trackbook` | 26/26，含真实有效圈新纪录与完整赛道管理回归 |
| `npm run test:editor` / `test:storage` / `test:sound` | 9/9、7/7、4/4 |
| `npm run test:browser` / `test:handling` | 15/15、4/4，含真实有效圈与连续两圈较快驾驶 |
| 改动源码/测试 Prettier、`git diff --check` | 通过 |

七套浏览器共 78 项，控制台错误均为 0；收集失败资源请求的六套均为 0。所有最终命令退出码为 0，浏览器和上下文均释放，本任务生产预览服务在验证后关闭。全部明确 headless、清除继承的 PWDEBUG、使用隔离上下文，未接管个人浏览器或进行系统级键鼠/前台操作。报告位于 `test-results/menu/report.json` 及原有各套报告位置。

交付截图为实际生产构建输出，已读取检查，原始 PNG 入库：

- [1366×768：驾驶中 Esc 暂停，冻结圈时与继续入口](screenshots/p1-04a-menu-running-1366.png)
- [1280×800：长赛道名与菜单键帽](screenshots/p1-04a-menu-1280.png)
- [900×700：紧凑菜单及焦点环](screenshots/p1-04a-menu-900.png)
- [900×700：操作说明](screenshots/p1-04a-controls-900.png)
- [900×700：有效预览的放弃确认，默认继续绘制](screenshots/p1-04a-discard-900.png)
- [900×700：reduced-motion 静态状态](screenshots/p1-04a-reduced-motion-900.png)
- [1366×768：菜单进入赛道本，换轨返回菜单，仍为 ready](screenshots/p1-04a-book-return-1366.png)

已知限制：草稿只保留在当前页面内，刷新不恢复；完整游戏动效仍留在 P1-04B。自动化覆盖 Chromium 和页面生命周期事件，Safari/Firefox、实际系统应用切换与人工听感未验证。键盘完整圈测试对主机并发负载敏感，本轮最终采用串行运行，并保留原驾驶断言和目标速度。未发现阻塞本轮验收的问题，继续等待用户试玩和 Code Review。

## P1-04B：全游戏交互动效与输入方式焦点

2026-10-27，先用 GitHub 原始 PR 状态确认 #9 已于 08:59:51 UTC 合并（`5e398b8`），更新 master 后创建 `feat/p1-04b-game-motion`。按 [Issue #8](https://github.com/muddyrain/paperlap/issues/8) 和追加焦点反馈，先写 [Motion Spec 与事件审计](game-motion.md)，再实现并迭代录屏。本轮没有修改 MenuState、Save V2、trackbook 控制层、场景/编辑器实现、车辆物理、圈速、几何、规则版本或缓存逻辑。

`GameMotion` 统一菜单/抽屉纸片落位、背景层、子页翻动、编辑进出纸页交接、按钮按压、模式/换轨/绘图提示、保存/纪录奖励；`MotionSlots` 持有有限动画槽，旧完成回调只能释放自身资源。真实状态、模态和焦点立即更新，退出只使用 aria-hidden/inert 的普通视觉副本。纸页只复制已有纹理与笔迹，不改真实 Canvas 大小、变换或 hit testing；触笔即移除旧页，blur/hidden/resize/reduce 清理视觉。长列表的退出副本保留滚动位置。

输入方式通过捕获阶段 pointerdown / keydown 呈现，不阻断原输入。保留 GameMenu.show 默认聚焦与安全默认动作；鼠标没有粗框，键盘使用 1.5px 细描边、2px 外扩（主按钮暖灰褐），按压与 aria-current 的静态赛道选中独立。说明、草稿确认、赛道本、关闭再开和 reduced-motion 都有鼠标与键盘路径。

录屏抽帧迭代修复了菜单居中 transform 与入场变换冲突造成的跳位，编辑标题/意图/名称始终直接显示，只对引导做展开。原 Canvas 单次故障注入会先命中可选视觉副本，测试现区分 capture / prepare / apply：视觉失败不影响提交，真正场景故障继续验证旧状态保护或重载。没有放宽原有存档、驾驶或圈速断言。4× CPU 的原赛道恢复成本单列在 Motion Spec，不将动画时长或无头帧率当作玩家实际流畅度。

实际修改文件：

- 新增 `src/game/game-motion.ts`、`src/game/motion-slots.ts`；修改 `src/main.ts`、`src/game/game-menu.ts`、`src/game/trackbook-ui.ts`、`src/style.css`。新增 `tests/motion-slots.test.ts`、`tests/motion-browser.mjs`；扩展 `tests/menu-browser.mjs`、`tests/trackbook-browser.mjs`、`tests/fixtures/trackbook-ux.mjs`。
- `package.json` 增加 `test:motion` / `record:motion`；新增 `docs/game-motion.md`，更新 `README.md`、`docs/game-menu.md`、`docs/trackbook-interactions.md` 与本记录。另入库 13 张原始 PNG。

| 检查 | 最终结果 |
| --- | --- |
| typecheck / production build | 通过，既有 Phaser 大 chunk 提示保留 |
| `npm test` | 63/63（原 61 + 两项动画资源所有权/中断单测） |
| `record:motion`（与 `test:motion` 同一套检查） | 14/14；六段录像，控制台与失败请求均为 0 |
| `test:menu` | 13/13，含恢复异常无遗留视觉遮罩 |
| `test:trackbook` | 27/27，原 26 + 可选视觉捕获异常；含场景准备/提交故障、长列表滚动退出 |
| `test:storage` / `test:browser` / `test:handling` | 7/7、15/15、4/4，保留真实有效圈与连续驾驶断言 |
| `test:editor` / `test:sound` | 9/9、4/4 |
| 源码/测试、新 Motion Spec、README/配置 Prettier；`git diff --check` | 通过 |

全部使用生产预览 `127.0.0.1:4175`、隔离无头 Chromium、明确 `headless: true`、清除 PWDEBUG。串行执行驾驶相关套件；没有个人浏览器/系统键鼠/前台操作。八套浏览器共 93 项，控制台错误均为 0，收集失败请求的七套均为 0；最终命令退出码均为 0。所有浏览器和上下文已关闭，本任务预览服务已释放。

关键帧（开始 / 中间 / 结束）：

| 场景 | 开始 | 中间 | 结束 |
| --- | --- | --- | --- |
| Esc 菜单 1366×768 | [开始](screenshots/p1-04b-menu-start-1366.png) | [落位](screenshots/p1-04b-menu-middle-1366.png) | [结束](screenshots/p1-04b-menu-end-1366.png) |
| 编辑进入 1366×768 | [原路线保留](screenshots/p1-04b-editor-start-1366.png) | [揭纸](screenshots/p1-04b-editor-middle-1366.png) | [绘图纸](screenshots/p1-04b-editor-end-1366.png) |

补充：[1280×800](screenshots/p1-04b-menu-1280.png)、[900×700](screenshots/p1-04b-menu-900.png)、[草稿确认](screenshots/p1-04b-discard-900.png)、[鼠标焦点](screenshots/p1-04b-focus-mouse.png)、[键盘焦点](screenshots/p1-04b-focus-keyboard.png)、[新纪录](screenshots/p1-04b-record.png)、[reduced-motion](screenshots/p1-04b-reduced-motion.png)。所有三尺寸的完整开始/中间/结束截图在 `test-results/motion/`；确定性截图只暂停视觉动画时钟，录屏使用实际时间播放，不写模拟状态。

六段原始 WebM 与便于播放的 MP4 位于 `test-results/motion/`，`review.html` 是手动播放入口，无自动播放或自动打开：菜单 7.24s、编辑/新建与返回 5.52s、有效草稿保存/继续/放弃 39.16s、A/B 6.76s、新纪录 8s、鼠标/键盘焦点 21.64s。新纪录 MP4 从真实驾驶原片末尾截取 8s，未生成假的车辆或圈时；原片保留。录屏无需提交大文件到 Git，可靠重录命令见 Motion Spec。报告：`test-results/motion/report.json`，视频信息：`video-files.json`。

已知限制：最终游戏手感仍需用户亲自试玩；Chromium 自动化和 CPU 降速不能代表 Safari/Firefox、真实低配 GPU 或高刷屏。4× CPU 时编辑恢复/重绘约 149–160ms、最长操作帧约 200–217ms，reduce 对照也存在，本轮保留原场景恢复实现；没有常驻新增动画。草稿仍只在当前页面保留。停在 Code Review，不自动合并。

## PR #10 Review 修复：非封闭式键盘焦点

2026-10-27，按最新 Review `5665212259` / inline `4387294631`，在原分支继续修复。修前基线 `ec8e7da`，先对该提交的生产构建采集相同键鼠路径和视口，再构建修后 CSS 对照。基线采集模式仅检查原有操作语义，不宣称旧的整圈 outline 满足新视觉标准。

产品源码仅修改 `src/style.css`：游戏按钮的键盘焦点改为 30×3px 局部铅笔短线与暖纸色底，主按钮使用浅色笔迹；不再绘制完整外轮廓。去掉赛道卡片的 focus-within 蓝色边框，保留 aria-current 橙框及“当前赛道”。鼠标 hover、按压与释放仍用原来的样式/动画，DOM focus、GameMenu.show、MenuState、GameMotion、返回链和所有保存/驾驶逻辑均未修改。全局 fallback、输入框和非按钮焦点 outline 保留；forced-colors 下笔迹用系统 Highlight，reduce 下静态可见。

测试新增 `tests/focus-browser.mjs`、共用 `tests/fixtures/focus-feedback.mjs`，`package.json` 增加 `test:focus`。`tests/motion-browser.mjs` 的强制 solid outline 断言改为检查可见的局部短线、受限宽高和无封闭外圈，并加入鼠标进入赛道本后 Esc 返回 menu-book 的路径。更新 README / Motion Spec / 本记录及截图，未改其它动效实现。

| 本次验证 | 结果 |
| --- | --- |
| `test:focus` | 9/9，含三尺寸、鼠标/键盘/混合输入、selected 独立、原生 Enter/Space、说明/草稿确认、重新打开、reduce 与 forced-colors |
| `npm test` | 63/63 |
| `test:motion` / `test:menu` / `test:sound` | 14/14、13/13、4/4；本次受影响浏览器检查合计 40/40，控制台错误与失败请求均为 0 |
| typecheck / build / 源码测试与规范格式 / diff whitespace | 全部通过 |

两次采集均为独立 headless Chromium、明确 headless: true、清除 PWDEBUG、浏览器静音；截图与录屏使用真实页面键鼠，不激活系统应用。修前/修后录像和报告位于 `test-results/focus-review/{before,after}/`，不将大型视频入库。原完整 93 项回归属于 ec8e7da 的交付记录；本次按 CSS 焦点范围运行上述受影响套件。

| 同视口实际画面 | 修前 | 修后 |
| --- | --- | --- |
| 鼠标打开菜单 1366×768 | [修前](screenshots/p1-04b-focus-mouse-menu-before.png) | [修后](screenshots/p1-04b-focus-mouse-menu-after.png) |
| Tab 到“我的赛道本” | [修前](screenshots/p1-04b-focus-keyboard-menu-before.png) | [修后](screenshots/p1-04b-focus-keyboard-menu-after.png) |
| 鼠标点赛道本 → Esc 返回 | [修前](screenshots/p1-04b-focus-mixed-return-before.png) | [修后](screenshots/p1-04b-focus-mixed-return-after.png) |
| 焦点与选中赛道分离 | [修前](screenshots/p1-04b-focus-keyboard-book-before.png) | [修后](screenshots/p1-04b-focus-keyboard-book-after.png) |

其它实拍：[说明页](screenshots/p1-04b-focus-keyboard-controls-after.png)、[草稿确认](screenshots/p1-04b-focus-keyboard-discard-after.png)、[1280×800](screenshots/p1-04b-focus-keyboard-1280-after.png)、[900×700](screenshots/p1-04b-focus-keyboard-900-after.png)、[forced-colors](screenshots/p1-04b-focus-forced-colors-after.png)。同路径短录屏见本地 before/after 的 `focus-flow.webm` / `focus-flow.mp4`（14.12s / 15.00s），另有 `test-results/focus-review/compare.html` 手动播放对照页。也刷新原 P1-04B 的交付截图为新焦点，避免旧轮廓被误认成修后；没有改变其它动效实现。测试浏览器、上下文和本任务预览服务均已释放。

复现修后：构建并启动 `npm run preview -- --port 4175 --strictPort`，在另一终端执行 `PAPERLAP_URL=http://127.0.0.1:4175 npm run test:focus`。修前对照需要让 URL 指向旧提交构建，再设置 `PAPERLAP_FOCUS_BASELINE=1`；该变量不会切换源码。保持 Code Review，等待用户视觉验收，不自动合并。

## P1-05A：赛道草稿安全与撤销恢复

基线 master `4eb52c81`，分支 `feat/p1-05a-draft-safety`，对应 Issue #11；未实现 P1-05B 的局部控制点编辑。先定义 [草稿状态表与失败策略](draft-safety.md)，再添加纯数据/存储测试并接入编辑器。

本轮新增 `src/game/draft.ts`、`draft-storage.ts`、`draft-ui.ts`：整笔状态最多 24 次撤销；R/撤销清空后保留一份可找回的 raw；独立 `paperlap.draft.v1` 有严格版本、长度、点数、有限坐标与归属校验。新建/替换分别绑定源 UID 和原路线指纹；恢复只作用于编辑器，复用 `fromDrawing` 重新校验，不写正式存档或起跑。完成/中断/历史操作立即备份，拖画最多每秒一次；内容未变时不重复写入。写入和清理会比较会话读到的原始字符串，拒绝覆盖已变化的数据。

`TrackEditor` 负责整笔历史、重新绘制和中断；`GameMenu` 保留返回链，并在对应草稿清理失败时继续编辑；`main.ts` 仅接入来源、组合键、页面退出 checkpoint、可靠正式保存后的清理。顶部提供图标、中文和平台键帽的撤销/重做按钮，继续沿用非封闭铅笔焦点与既有纸片动效。`save.ts`、`storage.ts`、`trackbook.ts`、`scene.ts`、`vehicle.ts`、`laps.ts`、`geometry.ts`、`config.ts`、`game-motion.ts` 均未修改。

### 实测结果

| 检查                                  | 结果                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck / build                     | 通过；保留既有 Phaser chunk 体积提示                                                                                                                                                    |
| unit                                  | 77/77；新增 13 项草稿数据/存储、1 项历史组合键检查                                                                                                                                      |
| 草稿主浏览器套件                      | 28/28；真实鼠标绘图、R/撤销/重做、reload/关闭页面、有效与无效恢复、中断、A/B 与意图/UID/几何归属、容量拒绝、两种正式保存失败、清理失败、真实第二标签冲突、节流、三尺寸与 reduced-motion |
| 草稿读取受限补充套件                  | 2/2；draft getItem 拒绝与 localStorage getter 拒绝；空编辑器安全退出，非空仍可真实绘制和撤销，提示正确的未备份原因                                                                      |
| test:editor / test:menu               | 9/9、13/13                                                                                                                                                                              |
| test:trackbook / test:storage         | 27/27、7/7；含 V1 无损迁移、V2 原文保护、管理事务和场景故障                                                                                                                             |
| test:motion / test:focus / test:sound | 14/14、9/9、4/4                                                                                                                                                                         |
| test:browser / test:handling          | 15/15、4/4；真实有效圈、连续两圈和规则隔离仍通过                                                                                                                                        |
| 格式 / diff                           | Prettier 与 git diff --check 通过                                                                                                                                                       |

浏览器检查合计 **132/132**，所有套件记录的错误/失败请求均为 0。`test:draft` 依次运行主套件和读取受限补充套件；本轮最终两套分别执行，报告为 `test-results/draft/report.json`（28）和 `test-results/draft/read-rejection/report.json`（2）。总表为 `test-results/draft/summary.json`，其余最终日志位于 `test-results/draft/regression-*.log` 与 `final-*.log`。菜单和动效旧测试中“R 清空即可直接退出”的断言已改为验证保留的撤销内容与明确放弃确认；菜单完整重跑通过。

全部浏览器串行运行，明确 `headless: true`、独立上下文、静音，清除 PWDEBUG；仅通过页面 API 发送鼠标/键盘与生命周期事件。测试的浏览器和上下文均由 finally 释放，不使用日常 Chrome、不抢占桌面焦点、不自动打开任何报告或预览窗口。

### 实际截图和录像

| 操作 / 视口              | 截图                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有效预览 → R → 撤销恢复  | [1366×768](screenshots/p1-05a-undo-1366.png)                                                                                                       |
| 刷新后恢复提示           | [1366×768](screenshots/p1-05a-recovery-1366.png)、[1280×800](screenshots/p1-05a-recovery-1280.png)、[900×700](screenshots/p1-05a-recovery-900.png) |
| 编辑器与历史按钮         | [1366×768](screenshots/p1-05a-editor-1366.png)、[1280×800](screenshots/p1-05a-editor-1280.png)、[900×700](screenshots/p1-05a-editor-900.png)       |
| 默认继续 / 明确放弃      | [确认页](screenshots/p1-05a-discard-1366.png)                                                                                                      |
| 未备份 / 清理失败        | [失败提示](screenshots/p1-05a-backup-failure.png)                                                                                                  |
| 无效笔迹恢复后仍不能保存 | [无效草稿](screenshots/p1-05a-invalid-recovered.png)                                                                                               |

实际无头页面录像保留在 `test-results/draft/`：`undo-redraw.webm`（21.72 秒）、`refresh-recovery.webm`（40.88 秒）、`discard-safety.webm`（20.52 秒）。对应 `.mp4` 用 H.264/yuv420p 编码，未改变帧顺序或速度；`review.html` 提供手动播放，`media.json` 记录时长与大小。录像与 JSON/日志为本地验收产物，不加入 Git；10 张原始 PNG 已入库。复现方式见草稿设计文档，运行 `npm run test:draft` 会重新生成实际操作录像。

已知边界：撤销单位是整笔，刷新不持久化完整撤销栈；中断笔迹可查看但不能接续原 pointer capture。草稿最多 12 份 / 600,000 字符，不自动淘汰或合并其他标签的工作；UID/指纹不匹配的旧草稿保留原文。存储完全不可用时无法保证刷新找回未备份内容。来源沿用现有 Save V2 的 UID/指纹身份，不新增存档实例 ID，也不处理后续 #12 的几何指纹精度议题。真实浏览器验证为 Chromium，未宣称 Safari/Firefox 或人工试玩已通过。提交 PR 后停在 Code Review，等待用户试玩，不自动合并。

## PR #13 Review 修复：初读失败退出、重画中断保留与进入性能

对应本轮 Review 的三条评论（`draft-ui.ts`、`draft.ts`、`draft-storage.ts`），审查基线 `f178383`。本轮保留原草稿模块与版本，不开发 P1-05B。

- **初始会话未确认：** 初始读取或归属检查失败时，确认页明确显示“仅放弃本次绘制”，说明浏览器里的旧备份不会删除，也不能确认清理。默认继续绘制，Esc 仍取消放弃；显式确认后仅放弃内存稿并沿游戏/菜单/赛道本返回。此路径不调用 setItem/removeItem。初始读取成功的已确认会话若后续清理失败，仍留在编辑器，不跳过安全保护。
- **A→R→未完成 B：** 历史另保留一份最近完整笔迹；未完成 B 的周期采样和生命周期中断均携带 A，不再写入 retained:null。该安全副本独立于 24 层历史淘汰，保持原单键、12 份/600k 上限。恢复后先展示 B 残笔，可撤销一次找回 A；A 仍通过 fromDrawing 重新校验。新笔整次结束（允许几何无效）后可成为新的完整状态。
- **精确原文复用：** storage.ts 新增只读 readTrackFingerprint，复用现有逐存储 checkedV2 原文缓存。只有同一存储且字节完全等于已严格验证的原文时，才从 JSON 提取 UID/指纹，避免重复全量几何验证。冷数据、外部原文变化仍调用完整 parseSave；不缓存可变 Save，不改 writeSave/loadSave 的验证和提交顺序。DraftView 持有原生 Storage 实例；getter 拒绝仍安全进入未确认会话。Save V2 schema、save.ts、几何、赛车、圈速、世界坐标和 GameMotion 均未修改。

先添加回归并实际验证失败：初读拒绝后显式放弃仍为 editing；周期 B 的 retained 为 null；20×900 已加载存档的热进入仍耗费完整解析时间。修复后专项、原有完整回归及性能检查均通过。旧草稿 resize 用例还发现视口模拟返回早于原生 resize 事件的竞态；测试现等待实际中断后才释放鼠标，仍验证真实 resize，没有放宽断言。

| 本轮检查                            | 最终结果                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck / build / 格式 / diff     | 通过；仅保留原有 Phaser chunk 提示                                                                                                                   |
| unit                                | 80/80，新增完整稿保留、近容量冷/热进入及原文复用安全检查                                                                                             |
| 初读拒绝专项                        | 4/4；getItem/getter × 新建/编辑，保留默认焦点和取消确认；含真实驾驶→菜单→编辑→放弃→暂停返回，核对车辆、计时、键盘、声音与未知备份字节，写入/删除均 0 |
| A/B 中断专项                        | 5/5；reload/pagehide/blur/resize/pointercancel，含 900×700 与 reduced-motion，真实鼠标 A→R→部分 B→恢复→键盘撤销回 A，正式赛道与纪录原文不变          |
| 草稿主套件                          | 28/28，修正 resize 等待条件后完整重跑；仍含已确认备份清理失败留在编辑、正式保存失败保留、错误归属、三尺寸                                            |
| editor / menu / trackbook / storage | 9/9、13/13、27/27、7/7                                                                                                                               |
| motion / focus / sound              | 14/14、9/9、4/4                                                                                                                                      |
| browser / handling                  | 15/15、4/4，真实有效圈、连续驾驶与规则隔离通过                                                                                                       |

功能浏览器检查合计 **139/139**，另有一套真实页面近容量性能基准通过；报告记录的错误和失败请求为 0。所有浏览器继续使用隔离 headless Chromium、静音、页面输入 API 和 finally 清理；未打开用户 Chrome、抢占前台或使用系统鼠标。最终汇总 `test-results/draft-review/summary.json`，完整日志在同目录；主草稿和专项结果分别位于 `test-results/draft/report.json`、`read-rejection/report.json`、`interruption/report.json`。

### 接近容量上限的实测

使用真实 20 条 × 900 点、838,217 字符的有效 Save V2。Node 基准调用实际 DraftStorage.open；浏览器通过真实鼠标点击“编辑当前”，计量同步点击处理至编辑器就绪，reduced-motion 用于排除视觉等待。热路径复用 loadSave 的既有原文验证；冷路径使用新存储对象（Node）或外部变更后的有效原文（浏览器），始终完整验证。

| 本机测量                   | 冷路径中位数 | 热路径中位数             |
| -------------------------- | ------------ | ------------------------ |
| 修前 Node                  | 758.35ms     | 741.11ms（重复几何验证） |
| 修后 Node，最终 unit 运行  | 744.52ms     | 3.34ms                   |
| 修后 Chromium 实际编辑点击 | 444.30ms     | 2.60ms                   |

浏览器三次热进入为 26.0 / 2.6 / 2.5ms；首次冷页面加载含游戏初始化约 1144.5ms，不与编辑点击混算。性能守卫使用 hot < cold×0.5 的相对阈值。新增安全回归验证：已验证原文被改成非法几何、错误 ID 或非法成绩后，查询拒绝信任，正式写入也继续拒绝并保留原文；另一存储对象不共享验证证据。外部变更后的冷验证仍可能阻塞数百毫秒，保留这一安全成本。

复现：构建并启动独立 `npm run preview -- --port 4185 --strictPort`；另一终端执行 `PAPERLAP_URL=http://127.0.0.1:4185 npm run test:draft-review` 与 `PAPERLAP_URL=http://127.0.0.1:4185 npm run bench:draft:browser`。Node 性能守卫包含在 npm test 中。实拍：[仅放弃内存的确认页](screenshots/p1-05a-review-memory-discard.png)、[恢复后撤销找回完整 A](screenshots/p1-05a-review-retained-a.png)。继续停在 Code Review，不自动合并。

## P1-05B-02A：Save V3 几何身份与旧纪录保护

基线 `0058e52e`，先提交 RFC `c109b69` 再实现。105/105 单元、147/147 正式游戏无头浏览器功能检查、23/23 独立原型检查全部通过，typecheck、正式/原型构建通过。旧 V1/V2 原文不写入或删除，完整旧纪录以未验证历史展示，新 PB 绑定独立几何修订；真实两个标签、旧客户端冲突、配额/损坏、严格正式保存和新旧整笔草稿隔离均有回归。

[完整验证与文件清单](save-v3-verification.md) 列出全部套件、20×900 冷/热性能、三桌面尺寸共 9 张截图及复现命令。[Save V3 RFC](save-v3-rfc.md) 固定 canonical、容量、单写入锁、迁移与回退合同。所有自动化使用隔离无头 Chromium，不影响用户桌面；控制台错误为 0，记录请求错误的套件均为 0。

近上限真实页面冷加载约 1 秒；改名提交中位数 43.50ms、编辑进入 3.20ms。写入需要 Web Locks；第二标签只读，无自动分支合并。旧版回滚仅看到保留 V1/V2，不能看到 V3 新作品。旧草稿原文仍在，不按旧弱指纹自动恢复到新身份。不开发 Issue #16 的局部编辑 UI/局部草稿，停在 Code Review，不自动合并。


## PR #17 第一轮 Review：计时 HUD 居中回归

上一轮缺少 HUD 边界断言，截图中的确存在计时卡片被右上按钮遮挡的问题。本轮删除覆盖 absolute 的 relative 规则，并固定历史按钮在键盘焦点下的绝对定位，保留原有焦点/动效。新增 `npm run test:hud`，三尺寸×四类存档共 12 场景、48 次真实 DOM 边界/文本范围/命中采样，覆盖 ready、running、历史返回与 paused。本轮 105/105 单元、64/64 浏览器检查及 typecheck/build 通过，控制台与请求错误均为 0。具体结果、三张同时包含本圈/PB/旧纪录的修后截图、更新的原 9 张截图与复现说明见 [Save V3 Review 验证](save-v3-verification.md#pr-17-第一轮-review修复顶部计时-hud)。Save V3、迁移、身份、锁和草稿保护代码未修改，停在 Code Review，不自动合并。

## P1-05B-02B：游戏内局部弯道编辑

基线 `347d2eb3`，分支 `feat/p1-05b-02b-local-editor`。117 项单元、204 项隔离无头浏览器检查（原有正式游戏 159＋局部编辑 22＋独立原型 23）、6 组正式游戏性能检查全部通过；正式与原型构建通过。浏览器覆盖三尺寸、连续两弯、非法拒绝、撤销重做、采用/保存、刷新恢复、旧 PB 归档、配额/读回/场景失败、真实双标签锁和冲突、入口返回焦点、驾驶/计时/声音冻结及原有全部游戏回归。

900 点预览 JS/Canvas 提交 P95：正常 0.40ms，4× CPU 1.80ms；4× 下严格采用中位 128.90ms、正式保存 444ms，仍可能有可见停顿。未修改物理、圈速、RULES_VERSION、几何校验或 Save V3 数据规则。

[完整报告、文件清单、兼容边界与复现方法](local-editor-verification.md) · [三尺寸截图](local-editor-verification.md#真实截图与录像) · [31.84 秒实际键盘/鼠标录屏](videos/p1-05b-02b-playthrough.mp4)。先提交的[状态图和失败恢复合同](local-editor-integration.md)。本轮停在 Code Review，等待玩家试玩，不自动合并。


## P1-06A：局部性能与可见操作反馈

基线`8f8c9ab0`，先提交优化前基线`be7e07a`。来源绑定的冻结精确快照证据减少重复局部校验，V3最终完整检查、身份/历史、Web Locks和可靠写后读回保留。900点/20赛道/4×：首次草稿备份232.6→5.4ms、热备份117.9→6.5ms，保存事务中位478.2→376.1ms；刷新读取仍严格校验，点击继续草稿259.8→6.9ms。忙碌文字与纸色先绘制，处理中防重入，Esc/失焦/来源变化取消排队工作；新一轮清除旧成功提示。

120项单元、223项隔离无头浏览器检查、18组阶段对照、6组原性能、6组冷恢复对照通过，typecheck与正式/原型构建通过。高点数严格计算仍可能阻塞；增加反馈绘制等待后，不保证所有小赛道总等待都更短。

[完整报告、原始数据、文件清单和复现](p1-06-performance.md) · [三尺寸状态图](p1-06-performance.md#截图实录和回归) · [实际操作MP4](videos/p1-06-response.mp4)。停在Code Review，不自动合并。
