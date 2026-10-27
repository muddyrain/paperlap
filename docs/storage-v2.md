# Save V2：赛道本数据层

对应 [P1-01 / Issue #1](https://github.com/muddyrain/paperlap/issues/1)。本轮提供纯数据模型、迁移、存档管理与当前单赛道流程接入。可视化赛道本由后续任务实现。

## 结构与身份

`src/game/save.ts` 不依赖 Phaser、DOM 或存储，`src/game/storage.ts` 负责同步 localStorage I/O。存档键是 `paperlap.save.v2`：

```ts
interface TrackEntry {
  uid: string;
  track: Track; // 原有 schemaVersion: 1、id、name、width、points
}
interface Save {
  schemaVersion: 2;
  rulesVersion: number;
  activeTrackUid: string;
  tracks: TrackEntry[];
  records: Record<string, number>;
  legacyRecords: Record<string, number>;
  muted: boolean;
}
```

`TrackEntry.uid` 标识赛道条目，改名、修改几何均保持不变；新增时由调用方提供唯一 UID（例如 `crypto.randomUUID()`），函数本身没有随机副作用。默认条目使用 `entry-default`。`Track.name` 是唯一名称来源，不再维护另一份名称。

`Track.id` 沿用现有几何指纹：由固定道路宽度与最终中心线计算，名称不参与。V2 加载必须匹配重新计算的指纹；不重新平滑、重采样或改变旧中心线。检查点、长度和绘图资源仍由现有游戏逻辑重建。

成绩键为 **`${uid}:${track.id}:rules-${rulesVersion}`**。例如 `entry-default:track-abc123:rules-2`。HUD 仅查活动条目、当前几何与 `RULES_VERSION`（仍为 2）的精确组合。同几何但不同 UID 的条目拥有独立成绩；改名保留成绩；改线后旧几何成绩继续保存，但不会作为新路线的最佳显示。规则版本 1、2 以及其他合法的正整数版本可同时保留；顶层 `rulesVersion` 是存档元数据，不决定 HUD 该显示哪一条历史成绩。

## 数据操作与约束

所有修改函数返回 `{ ok: true, save }` 或 `{ ok: false, error }`，不修改输入，也不自行持久化。只有成功结果才交给 `writeSave()`。

| 函数 | 行为 |
| --- | --- |
| `freshSave` / `activeTrack` | 新建含一条默认路线的存档 / 查询活动条目；活动条目存在是有效 Save 的不变量 |
| `addTrack` | 校验 UID、名称、容量和几何，新增后设为活动条目 |
| `renameTrack` / `selectTrack` | 修改名称 / 切换活动条目；保持所有成绩 |
| `replaceTrack` | 更新指定条目的几何，保留原 UID、名称及历史成绩 |
| `deleteTrack` | 删除指定条目及属于它的全部几何/规则成绩；删除活动条目后选剩余第一条；拒绝删除最后一条 |
| `setBest` | 按条目当前几何和指定规则写入更快成绩；默认规则为当前 `RULES_VERSION` |
| `validateSave` / `parseSave` | 校验并复制有效结构；验证失败返回错误 / `null`，不伪装成有效默认存档 |

| 限制 | 上限或规则 |
| --- | --- |
| 条目 | 1–20 条，UID 唯一且活动 UID 必须存在 |
| UID | 1–80 个 ASCII 字母、数字、下划线或短横线，首字符必须是字母或数字 |
| 名称 | 最多 40 个 JavaScript 字符串码元；新增、改名拒绝空白名称；历史 V1 的空名称兼容保留 |
| 几何 | 原有道路规则：宽度 108，12–900 个有限坐标点，闭合路线的边界、长度、交叉、间距和弯道检查 |
| 成绩 | 最多 512 条；值为有限秒数，严格大于 2 且小于 3600；规则为安全正整数 |
| 旧孤立成绩 | `legacyRecords` 最多 128 条，值和规则校验同上 |
| 序列化长度 | V2 最多 1,500,000 个 JavaScript 字符串码元；V1 读取最多 150,000 |

超限时整次操作失败，**不按最近使用裁剪或淘汰有效赛道/成绩**。替换一个已有纪录不会因已达到 512 条上限而失败，新增第 513 条则明确失败。删除条目的成绩只发生在显式调用 `deleteTrack` 时。V2 的非法几何、UID 冲突、无效成绩、指纹不符等均拒绝整份存档，保留原始数据供恢复。

## 验证复用

`setBest`、`renameTrack`、`selectTrack` 和持久化会重复检查结构、成绩和上限，但不会对未变化的已验证路线重复运行 O(点数²) 几何校验。数据层用 WeakMap 保存不对外暴露的完整坐标快照；每次先复制并检查当前有限坐标，再按完整精度、顺序、数量和道路宽度比对。可变对象被修改后无法凭原对象身份或相同指纹绕过验证。新增、替换几何及 V1 迁移强制完整检查目标路线，外部 JSON 也始终严格检查。

存储层每次都重新读取 V2 键，只有原文与该存储对象最近完整验证或成功写入的字符串逐字相同时才复用验证。外部改动、损坏原文、另一个存储对象都会重新检查；写入失败不把尝试写入的字符串视为已保存。缓存不改变 Save V2 格式、可变 Track API 或 V1 的保留策略。实测数据、安全回归和复现命令见 [storage-performance.md](storage-performance.md)。

## V1 迁移

1. 优先读取并校验 `paperlap.save.v2`；合法时直接使用，不访问 V1，也不重写 V2。
2. V2 不存在时读取 `paperlap.save.v1`。验证 V1 版本、规则元数据和几何，按照原 V1 语义复制名称（最多 40 个码元，缺失名称使用原默认名称）、最终中心线和声音偏好。重新计算几何指纹，避免信任伪造的 `id`。
3. 旧当前路线构成唯一条目，UID 为 `entry-v1-${track.id}`。同一份 V1 即使多次迁移、写入失败再刷新，也得到相同 UID。
4. 遍历全部旧成绩，不沿用旧解析器只取最后 32 条的行为。有效键 `${当前几何指纹}:rules-N` 转成带条目 UID 的 V2 键；其他有效几何键原样进入 `legacyRecords`。规则 1 和 2 同时保留。非法键/时间沿用 V1 的校验降级策略，不转成有效纪录。
5. 仅向 V2 键写入完整验证成功的结果。写入成功后，下次加载才优先使用持久化 V2。全过程**不修改、不删除、不覆盖 V1 原始键值**。

`legacyRecords` 只是归档。V1 已覆盖的路线没有中心线，无法凭成绩恢复；既不创建虚构赛道，也不把孤立成绩附着到当前条目。归档不参与 HUD，后续恢复方案必须拿到对应路线和明确条目身份后再决定归属。

## 失败策略

`loadSave()` 返回 `{ save, source, persisted, error? }`，`source` 为 `v2`、`v1` 或 `default`。`writeSave()` 返回 `{ ok: true }` 或明确的错误类型，包括配额 `quota`、存储不可用 `unavailable`、损坏版本和各类容量错误。

- 首次无存档：创建一条默认路线并尝试保存 V2；失败仍能驾驶，并显示未保存提示。
- 迁移写入失败：本次从 V1 派生数据继续游戏，`source: "v1"`、`persisted: false`；V1 保持原样，后续写入或刷新可重试。不设置额外“迁移完成”标记。
- 已有 V2 损坏或版本不支持：优先从有效 V1 临时恢复，否则使用默认路线。原 V2 保留，自动写入被拒绝；用户需要先备份并人工修复原始数据。不能用默认存档覆盖恢复线索。
- V1 损坏或超过可迁移容量，且没有有效 V2：默认路线临时可玩，显示失败提示，不自动写入 V2、不裁剪迁移。V1 原文保留。
- `getItem`、`setItem` 或访问 `window.localStorage` 失败：捕获异常，不影响现有驾驶、暂停或编辑。已成功持久化的 V2 不被删除；内存中的新结果可能在刷新后丢失，界面明确提示。
- 旧几何或旧规则成绩累积到上限：拒绝新增纪录，保留全部已有有效内容；本轮不提供清理历史成绩的 UI。

P1-02 通过 `trackbook.ts` 接入新建、切换、改名和删除，以及最小文字列表。管理命令先写入候选 Save，成功才提交内存及场景；新建写入失败保留草稿。编辑当前条目沿用未保存仍可试玩的行为。详细状态转换和渲染异常恢复见 [trackbook-flow.md](trackbook-flow.md)。Save V2 模型、V1 保护和验证缓存保持不变。localStorage 按 origin 隔离；没有跨标签页合并协议，多标签页同时修改仍采用最后一次成功写入，建议只在一个标签页游戏。

## 验证入口

```bash
npm run typecheck
npm test
npm run build
# 保持 dev 或 preview 服务运行，以下脚本全部使用隔离无头 Chromium
npm run test:storage
npm run test:browser
npm run test:handling
npm run test:editor
npm run test:trackbook
```

单测覆盖纯函数与模拟存储失败；`test:storage` 验证真实 localStorage 的初始化、V1 迁移、V1 原文保留、改线/双 UID 成绩、损坏 V2、配额异常与受限存储下继续驾驶。浏览器报告位于 `test-results/storage/report.json`。完整结果参见 [verification.md](verification.md)。
