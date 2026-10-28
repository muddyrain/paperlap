# P1-05B-02A：Save V3 几何身份与安全升级

状态：先行 RFC 已提交，当前实现和回归完成，等待 Code Review。基线 master `0058e52e`，Issue #15。本阶段不开放局部编辑、不创建局部草稿、不改变物理/几何/圈速规则或 RULES_VERSION。

## 数据合同

正式新键为 `paperlap.save.v3`，旧 V1/V2 永不写入、删除或双写。V2 的 `save.ts` / `storage.ts` 保留独立解析/兼容测试，游戏经小型版本 adapter 接入 V3。

```ts
interface SaveV3 {
  schemaVersion: 3;
  rulesVersion: number;
  activeTrackUid: string;
  tracks: Array<{
    uid: string;
    track: Track;
    geometryIdentity: string;
    geometryDigest: string;
  }>;
  records: Record<`${string}:${string}:rules-${number}`, number>;
  legacyRecords: Record<string, number>; // 原 V2 孤立归档完整保留
  legacy: {
    source: "v1" | "v2" | "default";
    sourceRulesVersion: number;
    tracks: Array<{ uid: string; name: string; fingerprint: string }>;
    records: Record<string, number>; // 原 V2 records 的全部键值，不进入新 PB
  };
  legacySources: { v1: string | null; v2: string | null }; // 原键 UTF-16BE 码元串的 SHA-256
  muted: boolean;
}
```

容量：20 条、每条 12–900 点、名称最多 40、权威 records 最多 512、legacy.records 最多 512、legacyRecords 最多 128、整体最多 2,000,000 字符。UID/名称/时间/规则版本沿用 V2 的严格约束。legacy.tracks 保存迁入时名称与归属，删除正式作品也不清掉旧归档。任何超限整体拒绝，不裁剪。V1 沿既有 migrateV1 的有效数据规则映射到 V2 结构，再完整迁入；本条目的旧键增加 UID 前缀是可逆映射，历史面板显示原 V1 键。旧 V1 原文仍完整保留。实际实现增加完整性门槛：若名称会被截断、纪录会被过滤或字段类型不支持，整个正式升级拒绝，只可临时预览并导出原文，不把部分迁入当作成功。

每个 V3 条目必须有独立 identity，格式为 `g-` + UUID 的 32 位小写十六进制，或 `m-` + 64 位迁移摘要。条目间身份不可重复。geometryDigest 格式为 `geom-v1-sha256-` + 64 位十六进制。所有新 recordKey 使用 UID + geometryIdentity + rules，不使用 track.id；旧 track.id 保留为几何兼容字段，仍检查其值与既有 fingerprint 一致。

## 规范二进制与身份

canonical v1：16 字节 ASCII `PaperlapGeometry`；随后 uint32 big-endian 版本 1；float64 big-endian 道路宽度；uint32 big-endian 点数；依原点序逐点写 float64 big-endian x、y。总计 `32 + 16*n` 字节。所有数值有限，-0 写为 +0；不量化、旋转、反转、排序或忽略起点。摘要仅描述内容，不能代替结构/完整 validate；测试同时与 Node crypto、浏览器 WebCrypto 对照固定向量和变体。

采用同步、无依赖 SHA-256 模块，避免把异步候选直接接进现有同步场景事务。初始化与正式候选的摘要计算均在明确边界完成，驾驶积分和 pointermove 不计算摘要。SHA 实现需对标准向量及 Node/WebCrypto 进行交叉验证，不能凭自测输出自证。

迁入身份 = `m-` + SHA256(JSON 编码的 `[迁移版本, source, UID, geometryDigest]`)；同一源重试始终稳定。新建、实际中心线/宽度变化使用新的随机 identity；精确全点与宽度相同的保存沿用旧 identity/digest。改名、静音、切换与 best 更新不换身份。保存前取消/撤销不改变正式身份。已提交后重新画回旧路线仍建立新身份，不凭旧 hash 或摘要恢复旧修订成绩。复制同几何另 UID 也产生独立 identity。

## 读取、写入和失败矩阵

| 情况                                | 游戏内数据                 | 持久动作与用户提示                                         |
| ----------------------------------- | -------------------------- | ---------------------------------------------------------- |
| 合法 V3，旧键与来源匹配，持有写入锁 | 正式 V3                    | 严格验证后启用                                             |
| 无 V3，有合法 V2                    | 完整稳定迁移候选           | 校验→可靠写入/读回 V3→启用；V2/V1 字节不变                 |
| 无 V3，无 V2，有合法 V1             | 同上，沿原 V1 约束         | 不先写 V2；直接稳定迁入 V3                                 |
| 无所有键                            | 默认路线稳定候选           | 仅写 V3                                                    |
| 升级 quota/拒绝/超限                | 明确的临时预览             | 原键保留，管理写入拒绝；重新加载重试升级，不谎称已升级     |
| V3 损坏/未知版本/摘要不匹配         | 受保护的默认临时预览       | 不自动回退旧版再覆盖 V3；保留所有原文，显示备份/恢复说明   |
| 无 V3，损坏 V2 但合法 V1            | 可沿旧优先级临时预览 V1    | 阻止升级写入，不跳过损坏 V2；保留原文                      |
| 旧标签改写 V2/V1                    | 使用已验证 V3 的只读视图   | 不合并、不覆盖，持久提示冲突；备份全部键、关闭旧标签后处理 |
| 新版另一个标签已经持有锁            | 只读视图/临时预览          | 提示关闭写入标签再刷新；不竞争写入                         |
| 本标签读到的 V3 原文发生变化        | 保留当前状态，拒绝写入     | 重新加载可靠版本；不得覆盖另一个分支                       |
| 场景准备失败                        | 旧内存/旧磁盘              | 不写盘；保持候选                                           |
| 已写盘，场景提交失败                | 停止操作、要求可靠重新加载 | 不清可恢复草稿，不继续半更新场景                           |

### 单写入标签与同步事务

启动时异步申请 origin 范围的 Web Lock `paperlap-save-v3-writer`，ifAvailable，持有到 pagehide/销毁；获得后才执行同步加载/迁移。锁内整个页面只有一个新版可写标签，既有 Trackbook prepare→write→scene commit 保持同步，不为每个管理动作引入异步旧候选竞态。第二个标签只读，不自动排队或夺锁；刷新重试。缺少 Web Locks 时只读，不能退回不可靠的 get/set 假 CAS。BFCache 恢复重新加载申请锁，锁释放后不继续写。

每次写前比较刚读到的 V3/V2/V1 精确原文与会话基线；V3 内 legacySources 使重新加载也能识别旧标签改变旧键。合法性证据缓存只能复用同一存储、完全相同的已严格验证原文；候选结构、数值、记录、摘要与上限始终检查，坐标缓存需比较私有完整快照。setItem 后读回相同原文才返回可靠成功。旧版不遵守锁但只写 V2：两个命名空间都保留，事后检测变化进入冲突保护，不冒充无损合并。外部脚本不合作地直接写 V3 不在 Web Lock 的互斥保证内，精确读回/后续检查仍会阻止继续静默覆盖。

## 旧纪录与回滚

新 PB 初始为空。HUD 保持“个人最佳”的当前 identity 语义，另有明确“旧纪录（旧几何身份，未验证）”及历史入口；赛道卡片同时区分当前 PB 和该 UID 的旧纪录。历史面板列出全部旧 records、不同规则、历史几何、孤立归档，含来源/UID/名称/原键/时间，并可导出全部存档键的备份。旧成绩不会与新 PB 比较或触发新纪录印章。旧修订的新制成绩也可在历史查看，不能冒充当前 PB。

回滚不是双向同步：旧客户端只能看到保留的 V2/V1，不会看到 V3 新作品。先导出所有键，关闭其他标签；任何人工恢复/删除都必须由用户明确操作，本轮不自动清理损坏 V3或提供“一键抹掉”按钮。正常升级提示旧记录已归档，失败/冲突提示不能仅用短暂 toast，需有持续可见状态。

## 整笔草稿兼容

P1-05A `paperlap.draft.v1` 字节保留，只读兼容提示，不自动套用到 V3，因为旧 UID+32 位 fingerprint 无法证明未过期。现有整笔 raw/retained/undo 不重构；V3 会话的新整笔备份写独立 `paperlap.draft.v2`，schemaVersion 2，来源额外绑定 geometryIdentity 和 geometryDigest，恢复须全部一致。旧版本/未知原文不迁移/不删除。新键仍是整笔草稿，不包含局部操作，不创建 Issue #16 的 local-draft。

## 验证计划与边界

固定编码向量（仅编码验证，两个点不代表合法正式赛道）：width=108，points=[(-0,1.25),(2.5,-3)]，总计 64 字节；16 字节头之后的 hex 为 `00000001405b0000000000000000000200000000000000003ff40000000000004004000000000000c008000000000000`，完整 SHA-256 为 `ef9662c730bad41e7fb2db2b862053f7e69baf199694254bae014598b58e7e8e`。固定向量由独立 Node crypto 核对，见 `tests/geometry-identity.test.ts`。

升级向量见 `tests/save-v3.test.ts`：V2 当前规则 24.68、旧规则 20.12、历史指纹 21.1、孤立 22.2 全部保留而新 PB 为空；V1 规则 1、当前 24.5 和孤立 29 直接升级且不创建 V2；quota 第一次失败、第二次成功仍为同一迁入身份；已保存点 x+0.001 保持旧指纹但得到不同新身份；512 条旧 records＋128 条孤立归档完整迁入，513 条拒绝。测试同时逐字比较原键。

失败优先覆盖：canonical 固定向量与双运行时对照、微调同旧 hash、新身份/PB 隔离、稳定重试迁入、旧成绩全量归档、所有容量边界、损坏 V3/错误 digest/重复 UID、锁竞争/旧客户端/外部原文变更、写后场景失败、旧草稿原文与新草稿归属。真实无头浏览器覆盖三桌面尺寸、旧/新纪录 UI、实际绘制与驾驶、quota/拒绝和两个标签；20×900 冷/热性能必须区分完整几何与安全缓存路径。运行全部既有指定回归，诚实记录未覆盖环境。

待 Review 取舍：单写入标签的只读策略；新整笔草稿独立键；升级失败须刷新重试；同步 SHA256 的启动成本。以上优先数据完整性，不隐式丢弃分支或旧纪录。实现后补充实际性能、截图与兼容报告。停在 Code Review，不自动合并。

## 实现复核补充

V1 迁入还保留原 sourceRulesVersion；拒绝原解析器的有损规范化升级。V3 整圈保存采用严格持久化，成绩失败恢复旧 PB；声音本次开关可继续生效但持续显示未保存。新草稿键只有可写且来源可验证时备份，损坏 V3 的新绘制仅在内存中保留，原有 draft.v1/v2 均不会被清除。

单写入锁解决合作新版标签的互斥；旧键冲突刷新不会自动解决。此阶段提供完整原文导出、只读保护与一致备份恢复说明，不实现分支合并或危险的一键覆盖。canonical 与同步 SHA256 的测试参考 [NIST FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final) 和 [NIST 测试向量说明](https://csrc.nist.gov/Projects/Cryptographic-Algorithm-Validation-Program/Secure-Hashing)，并与 Node crypto / WebCrypto 对照；不宣称获得密码模块认证。

来源原文摘要采用 UTF-16BE 逐码元编码（无归一化/BOM），覆盖 localStorage 字符串的完整值；不能用会替换未配对代理项的 UTF-8 TextEncoder 作为“原文未变”的证明。迁入 identity 的 JSON 编码使用 UTF-8，几何 canonical 则固定为上文的版本化二进制。三者用途和编码分开，均由测试向量固定。
