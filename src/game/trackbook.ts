import { profile } from "./local-profile";
import {
  activeTrack,
  addTrack,
  selectTrack,
  renameTrack,
  deleteTrack,
  replaceTrack,
  SAVE_LIMITS,
  type Save,
  type SaveResult,
  type TrackEntry,
} from "./save-model";
import { fingerprint, type Track, type Point } from "./geometry";
import * as v3 from "./save-v3";
import {
  localSource,
  sameLocalSource,
  samePoints,
  checkLocalPoints,
  type LocalSource,
} from "./local-source";
import type { StorageError, WriteResult } from "./storage-v3";

export type EditIntent = "create" | "replace";
export type TrackbookError =
  StorageError | "editing" | "no-draft" | "render" | "reload-required";
export type CommandResult =
  | { ok: true; persisted: boolean; changed: boolean; error?: StorageError }
  | { ok: false; error: TrackbookError };
interface Dependencies {
  uid: () => string;
  write: (save: Save) => WriteResult;
  stop: () => void;
  // Prepare without touching the live scene; apply only after write succeeds.
  prepare: (entry: TrackEntry) => () => void;
  recover: () => void;
  check?: () => WriteResult;
}

export class Trackbook {
  intent: EditIntent | null = null;
  reloadRequired = false;
  private local: LocalSource | null = null;
  get localSource() {
    return this.local ? { ...this.local } : null;
  }
  constructor(
    public save: Save,
    private deps: Dependencies,
  ) {}

  persist(): WriteResult {
    return this.write(this.save);
  }
  private write(save: Save): WriteResult {
    try {
      return this.deps.write(save);
    } catch {
      return { ok: false, error: "unavailable" };
    }
  }
  beginEdit(intent: EditIntent): CommandResult {
    if (this.reloadRequired) return { ok: false, error: "reload-required" };
    if (this.intent || this.local) return { ok: false, error: "editing" };
    if (intent === "create" && this.save.tracks.length >= SAVE_LIMITS.tracks)
      return { ok: false, error: "track-limit" };
    this.intent = intent;
    return { ok: true, persisted: false, changed: false };
  }
  cancelEdit() {
    this.intent = null;
  }
  beginLocal(): CommandResult {
    const blocked = this.available();
    if (blocked) return blocked;
    if (this.save.schemaVersion !== 3)
      return { ok: false, error: "invalid-v3" };
    const checked = this.deps.check?.() ?? {
      ok: false as const,
      error: "unavailable" as const,
    };
    if (!checked.ok) return checked;
    this.local = localSource(v3.activeTrack(this.save));
    return { ok: true, persisted: false, changed: false };
  }
  cancelLocal() {
    this.local = null;
  }
  commitLocal(source: LocalSource, points: readonly Point[]): CommandResult {
    if (this.reloadRequired) return { ok: false, error: "reload-required" };
    if (this.intent || !this.local || this.save.schemaVersion !== 3)
      return { ok: false, error: "editing" };
    const entry = v3.activeTrack(this.save);
    if (
      !sameLocalSource(source, this.local) ||
      !sameLocalSource(source, localSource(entry))
    )
      return { ok: false, error: "conflict" };
    const checked = this.deps.check?.() ?? {
      ok: false as const,
      error: "unavailable" as const,
    };
    if (!checked.ok) return checked;
    if (
      profile("local.commitValidate", () =>
        checkLocalPoints(entry.track.points, points),
      )
    )
      return { ok: false, error: "invalid-track" };
    if (samePoints(entry.track.points, points)) {
      this.local = null;
      return { ok: true, persisted: true, changed: false };
    }
    const track = {
      ...entry.track,
      points: points.map((p) => ({ ...p })),
      id: fingerprint([...points], entry.track.width),
    };
    const result = this.commit(
      profile("local.candidate", () =>
        v3.replaceTrack(this.save as v3.Save, entry.uid, track),
      ),
      true,
      true,
    );
    if (result.ok) this.local = null;
    return result;
  }
  private available(): CommandResult | null {
    if (this.reloadRequired) return { ok: false, error: "reload-required" };
    if (this.intent || this.local) return { ok: false, error: "editing" };
    return null;
  }
  select(uid: string): CommandResult {
    const blocked = this.available();
    if (blocked) return blocked;
    if (uid === this.save.activeTrackUid)
      return { ok: true, persisted: true, changed: false };
    return this.commit(selectTrack(this.save, uid), true);
  }
  rename(uid: string, name: string): CommandResult {
    return (
      this.available() ?? this.commit(renameTrack(this.save, uid, name), false)
    );
  }
  remove(uid: string, confirmed: boolean): CommandResult {
    const blocked = this.available();
    if (blocked) return blocked;
    if (!confirmed) return { ok: true, persisted: true, changed: false };
    return this.commit(
      deleteTrack(this.save, uid),
      uid === this.save.activeTrackUid,
    );
  }
  acceptDrawing(track: Track): CommandResult {
    if (!this.intent) return { ok: false, error: "no-draft" };
    const create = this.intent === "create";
    const candidate = create
      ? addTrack(this.save, track, this.deps.uid())
      : replaceTrack(this.save, this.save.activeTrackUid, track);
    const result = this.commit(
      candidate,
      true,
      create || this.save.schemaVersion === 3,
    );
    if (result.ok) this.intent = null;
    return result;
  }
  private commit(
    candidate: SaveResult,
    sceneChange: boolean,
    strict = true,
  ): CommandResult {
    if (this.reloadRequired) return { ok: false, error: "reload-required" };
    if (!candidate.ok) return candidate;
    let apply: (() => void) | undefined;
    if (sceneChange) {
      this.deps.stop();
      try {
        apply = profile("scene.prepare", () =>
          this.deps.prepare(activeTrack(candidate.save)),
        );
      } catch {
        return { ok: false, error: "render" };
      }
    }
    const written = profile("storage.write", () => this.write(candidate.save));
    if (!written.ok && strict) return written;
    const previous = this.save;
    this.save = candidate.save;
    try {
      profile("scene.apply", () => apply?.());
    } catch {
      // Reload the durable state; never operate a half-rendered scene.
      if (!written.ok) this.save = previous;
      this.reloadRequired = true;
      this.deps.recover();
      return { ok: false, error: "reload-required" };
    }
    return {
      ok: true,
      changed: true,
      persisted: written.ok,
      ...(!written.ok ? { error: written.error } : {}),
    };
  }
}

export function trackbookMessage(error: TrackbookError): string {
  const messages: Partial<Record<TrackbookError, string>> = {
    "invalid-v3": "新存档损坏或摘要不匹配，原文已保留，未能保存。",
    conflict: "其他标签或旧版数据已变化，保存已停止；请导出备份并重新加载。",
    "writer-busy": "另一个标签持有写入权限，本标签只读。关闭该标签后刷新重试。",
    "lock-unavailable": "浏览器不支持安全保存锁，本次只读。",
    "invalid-name": "名称不能为空，且最多 40 个字符。",
    "track-limit": "最多保存 20 条赛道，请先删除不需要的赛道。",
    "last-track": "至少保留一条赛道，不能删除最后一条。",
    "data-limit": "存档容量已达上限，未能保存；已有数据已保留。",
    "record-limit": "成绩数量已达上限，未能保存；已有纪录已保留。",
    quota: "存储空间不足，未能保存；原赛道已保留。",
    unavailable: "存储不可用，未能保存；原赛道已保留。",
    "invalid-v2": "存档损坏或版本不支持，未能保存；原始存档已保留。",
    "invalid-v1": "旧存档无法读取，未能保存；原始存档已保留。",
    render: "画面准备失败，原赛道已保留，请重试。",
    "reload-required": "画面加载失败，请重新加载以恢复已保存的赛道。",
    editing: "请先完成或取消当前绘制。",
  };
  return messages[error] ?? "本次操作未能保存，原赛道已保留。";
}
