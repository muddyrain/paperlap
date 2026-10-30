# Issue #21 精选提交证据

本目录是 Git 中的精选副本；原始大目录和 Review ZIP 保留在本地，没有移动或删除。

- `c1/`：P1-06C-01，未修复 P2 的 master 3904352。20 命令基线、跨引擎逐次结果、原始 FAIL、真实驾驶/存档安全和性能数据。
- `c2/`：P1-06C-02，经过 Review 的两个 P2 修复；before、首次 after-dev 的测试能力断言 FAIL、最终 production PASS 分开保留。
- `final/`：P1-06C-03 提交前，在仅含计划代码的独立检出中重新执行的命令、输出和三引擎专项。没有旧审计 JSON 依赖。
- `origins.json`：逐文件本地来源、原始/精选 SHA-256、用途。`.log` 副本仅去掉行尾空白和末尾空行，大 JSON 仅压缩空白并校验解析内容相等；结果未变，原始材料不变。
- `manifest.json`：完整计划提交清单、用途、体积、敏感信息检查。包含自身路径但不计算自身递归哈希。

**路径口径：** 正文报告中的 Markdown 证据链接均指向本次 Git 提交。原始 JSON 的 `screens`、`video`、样本路径保持当次输出原文；未出现在 manifest 中的目标明确属于“仅本地 QA / Review 材料”，不是 PR 中的相对链接或运行依赖。命令索引的 log/report 已按原目录层次纳入。

以下仅本地保存，未加入 Git：`docs/p1-06-release-evidence/`、`docs/p1-06c-p2-fix-evidence/` 的完整截图/录像/存档导出，`docs/paperlap-p1-06c-02-review.zip`（22,844,915 bytes，SHA-256 c522eb7dd5b50fdefb172c9d7b1478c1d697a55b1c60a9bc94ea61b20e45ea1c），以及旧 Issue #20 审计和 ZIP。已审核报告原稿仅本地保留在 `docs/p1-06c-submit-local/reviewed-*.md`。本 PR 的两份报告仅整理结构与链接，未改变已审核实现或历史结果。

截图来自专用上下文的游戏 Canvas/DOM，未包含桌面、个人浏览器或真实用户存档；PNG 元数据已检查，WebKit EXIF 仅有色彩空间和尺寸。测试成绩来自隔离页面真实方向键，故障/性能 fixture 明确是受控输入。
