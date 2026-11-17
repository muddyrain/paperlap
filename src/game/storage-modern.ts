import { profile } from "./local-profile";
import type { createSaveModel, ModernSave, ModernSaveResult, SaveError } from "./save-modern";
import { parseSave as parseV3 } from "./save-v3";
import { freshSave as freshV2, parseSave as parseV2, migrateV1 } from "./save";
import { storageTextDigest } from "./geometry-identity";

export const OLD_KEYS = { v1: "paperlap.save.v1", v2: "paperlap.save.v2" };
export type Store = Pick<Storage, "getItem" | "setItem">;
export type StorageError =
  | SaveError
  | "invalid-v4"
  | "invalid-v3"
  | "invalid-v2"
  | "invalid-v1"
  | "quota"
  | "unavailable"
  | "conflict"
  | "writer-busy"
  | "lock-unavailable"
  | "upgrade-required";
export type WriteResult = { ok: true } | { ok: false; error: StorageError };
export interface WriterLease {
  readonly owned: boolean;
  release: () => void;
  error?: StorageError;
}
export async function acquireWriter(): Promise<WriterLease> {
  if (!navigator.locks)
    return { owned: false, release() {}, error: "lock-unavailable" };
  return new Promise((resolve) => {
    let held = false,
      finish: () => void = () => {};
    const wait = new Promise<void>((done) => (finish = done));
    void navigator.locks
      .request(
        "paperlap-save-v3-writer",
        { ifAvailable: true },
        async (lock) => {
          held = !!lock;
          resolve({
            get owned() {
              return held;
            },
            release() {
              held = false;
              finish();
            },
            ...(!lock ? { error: "writer-busy" as const } : {}),
          });
          if (lock) await wait;
        },
      )
      .catch(() =>
        resolve({ owned: false, release() {}, error: "lock-unavailable" }),
      );
  });
}

export function createStorageModel<V extends 3 | 4>(
  version: V,
  model: Pick<ReturnType<typeof createSaveModel<V>>, "freshSave" | "parseSave" | "validateSave" | "migrateSave">,
) {
  type Save = ModernSave<V>;
  const { freshSave, parseSave, validateSave, migrateSave } = model;
  const STORAGE_KEY = `paperlap.save.v${version}`;
  const checked = new WeakMap<Store, string>();
  function readIdentity(
    storage: Store,
    raw: string | null,
    uid: string,
  ) {
    const save =
      raw !== null && checked.get(storage) === raw
        ? (JSON.parse(raw) as Save)
        : parseSave(raw);
    if (!save) return { valid: false as const };
    if (raw !== null) checked.set(storage, raw);
    const e = save.tracks.find((e) => e.uid === uid);
    return {
      valid: true as const,
      fingerprint: e?.track.id,
      geometryIdentity: e?.geometryIdentity,
      geometryDigest: e?.geometryDigest,
    };
  }
  const errorOf = (e: unknown): StorageError =>
    e instanceof Error && e.name === "QuotaExceededError"
      ? "quota"
      : "unavailable";
  class SaveSession {
    private expected: {
      v1: string | null;
      v2: string | null;
      current: string | null;
      legacyV3: string | null;
    } = { v1: null, v2: null, current: null, legacyV3: null };
    private blocked: StorageError | null = null;
    private baseline: Save | null = null;
    private history = "";
    onStatus: () => void = () => {};
    get error() {
      return this.blocked;
    }
    get writable() {
      return !!this.baseline && this.lease.owned && !this.blocked;
    }
    constructor(
      private storage: Store | null,
      readonly lease: WriterLease,
    ) {}
    private read() {
      if (!this.storage) throw Error("Storage unavailable");
      return {
        current: this.storage.getItem(STORAGE_KEY),
        legacyV3: version === 4 ? this.storage.getItem("paperlap.save.v3") : null,
        v2: this.storage.getItem(OLD_KEYS.v2),
        v1: this.storage.getItem(OLD_KEYS.v1),
      };
    }
    private block(error: StorageError): WriteResult {
      this.blocked = error;
      this.onStatus();
      return { ok: false, error };
    }
    private archive(save: Save) {
      return JSON.stringify([
        save.legacy,
        save.legacyRecords,
        save.legacySources,
      ]);
    }
    open(): {
      save: Save;
      persisted: boolean;
      source: "v4" | "v3" | "v2" | "v1" | "default";
      error?: StorageError;
    } {
      try {
        this.expected = this.read();
        const sources: Save["legacySources"] = {
          v1:
            this.expected.v1 === null
              ? null
              : storageTextDigest(this.expected.v1),
          v2:
            this.expected.v2 === null
              ? null
              : storageTextDigest(this.expected.v2),
          ...(version === 4 ? { v3: this.expected.legacyV3 === null
            ? null : storageTextDigest(this.expected.legacyV3) } : {}),
        };
        if (this.expected.current !== null) {
          const save = parseSave(this.expected.current);
          if (!save) {
            this.block(version === 4 ? "invalid-v4" : "invalid-v3");
            return {
              save: freshSave(),
              source: "default",
              persisted: false,
              error: version === 4 ? "invalid-v4" : "invalid-v3",
            };
          }
          this.baseline = structuredClone(save);
          this.history = this.archive(save);
          checked.set(this.storage!, this.expected.current);
          if (JSON.stringify(sources) !== JSON.stringify(save.legacySources))
            this.block("conflict");
          else if (!this.lease.owned)
            this.block(this.lease.error ?? "writer-busy");
          return {
            save,
            source: version === 4 ? "v4" : "v3",
            persisted: true,
            ...(this.blocked ? { error: this.blocked } : {}),
          };
        }
        if (version === 4 && this.expected.legacyV3 !== null) {
          const previous = parseV3(this.expected.legacyV3);
          if (!previous) {
            this.block("invalid-v3");
            return { save: freshSave(), source: "default", persisted: false, error: "invalid-v3" };
          }
          const migrated = validateSave({ ...previous, schemaVersion: version, legacySources: sources });
          if (!migrated.ok) {
            this.block(migrated.error);
            return { save: freshSave(), source: "default", persisted: false, error: migrated.error };
          }
          const save = migrated.save;
          this.baseline = structuredClone(save);
          this.history = this.archive(save);
          if (sources.v1 !== previous.legacySources.v1 || sources.v2 !== previous.legacySources.v2)
            this.block("conflict");
          else if (!this.lease.owned) this.block(this.lease.error ?? "writer-busy");
          const result = this.blocked ? { ok: false as const, error: this.blocked } : this.write(save);
          if (!result.ok) this.block(result.error);
          return { save, source: "v3", persisted: result.ok, ...(!result.ok ? { error: result.error } : {}) };
        }
        const v2 = this.expected.v2 === null ? null : parseV2(this.expected.v2);
        const v1 = this.expected.v1 === null ? null : migrateV1(this.expected.v1);
        const source = v2 ? "v2" : v1 ? "v1" : "default";
        const migrated: ModernSaveResult<V> = version === 4 && source === "default"
          ? { ok: true, save: freshSave() }
          : migrateSave(v2 ?? v1 ?? freshV2(), source, sources);
        if (!migrated.ok) {
          this.block(migrated.error);
          return {
            save: freshSave(),
            source: "default",
            persisted: false,
            error: migrated.error,
          };
        }
        const save = migrated.save;
        if (source === "v1" && this.expected.v1 !== null) {
          const original = JSON.parse(this.expected.v1);
          save.legacy.sourceRulesVersion = original.rulesVersion;
          if (
            typeof original.track?.name === "string" &&
            original.track.name.length > 40
          )
            this.block("invalid-name");
          const records = original.records;
          if (
            (records !== undefined &&
              (!records ||
                typeof records !== "object" ||
                Array.isArray(records))) ||
            Object.keys(records ?? {}).length !==
              Object.keys(save.legacy.records).length +
                Object.keys(save.legacyRecords).length ||
            (original.muted !== undefined &&
              typeof original.muted !== "boolean") ||
            (original.track?.name !== undefined &&
              typeof original.track.name !== "string")
          )
            this.block("invalid-v1");
        }
        this.baseline = structuredClone(save);
        this.history = this.archive(save);
        if (this.expected.v2 !== null && !v2) this.block("invalid-v2");
        else if (this.expected.v1 !== null && !v1 && this.expected.v2 === null)
          this.block("invalid-v1");
        else if (!this.lease.owned) this.block(this.lease.error ?? "writer-busy");
        const result = this.blocked
          ? { ok: false as const, error: this.blocked }
          : this.write(save);
        if (!result.ok) this.block(result.error);
        return {
          save,
          source,
          persisted: result.ok,
          ...(!result.ok ? { error: result.error } : {}),
        };
      } catch (e) {
        const error = errorOf(e);
        this.block(error);
        return { save: freshSave(), source: "default", persisted: false, error };
      }
    }
    check(): WriteResult {
      if (this.blocked) return { ok: false, error: this.blocked };
      if (!this.lease.owned) return this.block(this.lease.error ?? "writer-busy");
      try {
        const now = this.read();
        if (
          now.current !== this.expected.current ||
          now.legacyV3 !== this.expected.legacyV3 ||
          now.v1 !== this.expected.v1 ||
          now.v2 !== this.expected.v2
        )
          return this.block("conflict");
        return { ok: true };
      } catch (e) {
        return this.block(errorOf(e));
      }
    }
    write(candidate: Save): WriteResult {
      const state = this.check();
      if (!state.ok) return state;
      try {
        const result = profile("storage.validate", () => validateSave(candidate));
        if (!result.ok) return result;
        const save = result.save;
        if (profile("storage.archive", () => this.archive(save)) !== this.history)
          return { ok: false, error: "invalid-save" };
        // A revision identity cannot be rebound to different coordinates, even if
        // its old 32-bit fingerprint is unchanged or its digest was forged anew.
        for (const entry of save.tracks) {
          const old = this.baseline?.tracks.find(
            (e) => e.geometryIdentity === entry.geometryIdentity,
          );
          if (
            old &&
            (old.uid !== entry.uid ||
              old.track.schemaVersion !== entry.track.schemaVersion ||
              old.track.width !== entry.track.width ||
              old.track.points.length !== entry.track.points.length ||
              !old.track.points.every(
                (p, i) =>
                  p.x === entry.track.points[i].x &&
                  p.y === entry.track.points[i].y,
              ))
          )
            return { ok: false, error: "invalid-identity" };
          if (
            !old &&
            Object.keys(this.baseline?.records ?? {}).some((k) =>
              k.startsWith(`${entry.uid}:${entry.geometryIdentity}:`),
            )
          )
            return { ok: false, error: "invalid-identity" };
        }
        const raw = profile("storage.serialize", () => JSON.stringify(save));
        if (raw !== this.expected.current)
          profile("storage.setItem", () =>
            this.storage!.setItem(STORAGE_KEY, raw),
          );
        if (
          profile("storage.readback", () =>
            this.storage!.getItem(STORAGE_KEY),
          ) !== raw
        )
          return this.block("conflict");
        this.expected.current = raw;
        this.baseline = structuredClone(save);
        checked.set(this.storage!, raw);
        const after = this.read();
        if (
          after.current !== this.expected.current ||
          after.legacyV3 !== this.expected.legacyV3 ||
          after.v1 !== this.expected.v1 ||
          after.v2 !== this.expected.v2
        )
          return this.block("conflict");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errorOf(e) };
      }
    }
    backup(): string {
      const data = this.read();
      return JSON.stringify(
        {
          format: "paperlap-backup-v1",
          v1: data.v1,
          v2: data.v2,
          v3: version === 3 ? data.current : data.legacyV3,
          ...(version === 4 ? { v4: data.current,
            draftV3: this.storage!.getItem("paperlap.draft.v3"),
            localDraftV2: this.storage!.getItem("paperlap.local-draft.v2") } : {}),
          draftV1: this.storage!.getItem("paperlap.draft.v1"),
          draftV2: this.storage!.getItem("paperlap.draft.v2"),
          localDraftV1: this.storage!.getItem("paperlap.local-draft.v1"),
        },
        null,
        2,
      );
    }
    release() {
      this.lease.release();
    }
  }
  function storageMessage(error: StorageError | null): string {
    const messages: Partial<Record<StorageError, string>> = {
      "invalid-v4": "V4 存档损坏、摘要不匹配或版本不支持。原文已保留；当前仅临时试玩。",
      "invalid-v3":
        "V3 存档损坏、摘要不匹配或版本不支持。原文已保留；当前仅临时试玩，不会覆盖或自动回退旧存档。",
      "invalid-v2": "旧 V2 无法验证，原文已保留；升级未完成，当前仅临时试玩。",
      "invalid-v1":
        "旧 V1 字段或纪录无法完整验证，原文已保留；未升级或丢弃数据，当前仅临时试玩。",
      "invalid-name":
        "旧赛道名称超过支持范围，原文已保留；未自动截断升级。请导出备份后处理。",
      "writer-busy":
        "另一个标签正在管理此存档。本标签只读；请关闭写入标签后刷新重试。",
      "lock-unavailable": "浏览器不支持安全写入锁。本次只读试玩，已有存档保留。",
      conflict:
        "检测到其他标签或旧版存档变更，已停止保存。请先导出全部备份并关闭其他标签；刷新不会合并分支，仍冲突时需恢复一份一致备份。",
      quota:
        "空间不足，存档未能保存。旧数据已保留；升级失败时请释放空间后重新加载重试。",
      unavailable: "存储不可用，本次未保存。已有数据保留；可继续临时试玩。",
      "data-limit": "存档容量超限，未升级或裁剪任何旧数据。请导出备份后处理。",
      "archive-limit": "历史纪录容量超限，整个升级已拒绝；旧数据保留。",
    };
    return error
      ? (messages[error] ?? "存档未能保存，原数据保留；请导出备份后重新加载。")
      : version === 4
        ? "Save V4 已启用；旧存档原文保留，原有作品与成绩可继续使用。"
        : "Save V3 已启用；V1/V2 旧原文保留，旧纪录可在历史中查看。";
  }

  return { SaveSession, readIdentity, storageMessage };
}
