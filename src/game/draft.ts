import { fromDrawing, type Point, type Track } from "./geometry";
import { activeTrack, type Save } from "./save-model";
import type { EditIntent } from "./trackbook";

export interface DraftSource {
  intent: EditIntent;
  uid: string;
  fingerprint: string;
  geometryIdentity?: string;
  geometryDigest?: string;
}
export interface DraftSnapshot {
  phase: "empty" | "complete" | "interrupted";
  raw: Point[];
  overflow: boolean;
}
export interface DraftCheckpoint {
  current: DraftSnapshot;
  retained: DraftSnapshot | null;
}
export const emptyDraft = (): DraftSnapshot => ({
  phase: "empty",
  raw: [],
  overflow: false,
});
const copy = (s: DraftSnapshot): DraftSnapshot => ({
  ...s,
  raw: s.raw.map((p) => ({ ...p })),
});
export function draftSource(save: Save, intent: EditIntent): DraftSource {
  const entry = activeTrack(save);
  return {
    intent,
    uid: entry.uid,
    fingerprint: entry.track.id,
    ...("geometryIdentity" in entry
      ? {
          geometryIdentity: entry.geometryIdentity,
          geometryDigest: entry.geometryDigest,
        }
      : {}),
  };
}
export const sameSource = (a: DraftSource, b: DraftSource) =>
  a.intent === b.intent &&
  a.uid === b.uid &&
  a.fingerprint === b.fingerprint &&
  a.geometryIdentity === b.geometryIdentity &&
  a.geometryDigest === b.geometryDigest;

export function evaluateDraft(s: DraftSnapshot): {
  valid: boolean;
  track: Track | null;
  message: string;
  kind: "hint" | "error" | "success";
  point?: Point;
} {
  if (s.phase === "empty")
    return {
      valid: false,
      track: null,
      message: "在虚线范围内画一个大圈，回到起点圆圈内松开",
      kind: "hint",
    };
  if (s.phase === "interrupted")
    return {
      valid: false,
      track: null,
      message:
        "绘制已中断，笔迹已保留供查看；不能接着原手势画，请重新画一圈或按 R 重画",
      kind: "hint",
    };
  const result = s.overflow
    ? { ok: false as const, reason: "路线画得太久了，请重新画一个简洁的圈" }
    : fromDrawing(s.raw);
  return result.ok
    ? {
        valid: true,
        track: result.track,
        message: "赛道画好了！",
        kind: "success",
      }
    : {
        valid: false,
        track: null,
        message: result.reason,
        kind: "error",
        point: result.point,
      };
}

// Whole strokes only. Blank/incomplete checkpoints retain the last completed
// stroke, independently of history eviction, until a replacement finishes.
export class DraftHistory {
  current = emptyDraft();
  private past: DraftSnapshot[] = [];
  private future: DraftSnapshot[] = [];
  private lastComplete: DraftSnapshot | null = null;
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get dirty() {
    return !!(this.current.raw.length || this.checkpoint().retained);
  }
  commit(s: DraftSnapshot) {
    if (JSON.stringify(s) === JSON.stringify(this.current)) return;
    this.past.push(copy(this.current));
    if (this.past.length > 24) this.past.shift();
    this.current = copy(s);
    if (s.phase === "complete") this.lastComplete = copy(s);
    this.future = [];
  }
  undo() {
    const s = this.past.pop();
    if (!s) return false;
    this.future.push(copy(this.current));
    this.current = s;
    if (s.phase === "complete") this.lastComplete = copy(s);
    return true;
  }
  redo() {
    const s = this.future.pop();
    if (!s) return false;
    this.past.push(copy(this.current));
    this.current = s;
    if (s.phase === "complete") this.lastComplete = copy(s);
    return true;
  }
  checkpoint(current = this.current): DraftCheckpoint {
    const retained =
      current.phase === "complete"
        ? null
        : (this.lastComplete ??
          (current.raw.length
            ? null
            : ([...this.past].reverse().find((s) => s.raw.length) ??
              this.future.find((s) => s.raw.length) ??
              null)));
    return {
      current: copy(current),
      retained: retained ? copy(retained) : null,
    };
  }
  restore(checkpoint: DraftCheckpoint) {
    this.past = [];
    this.future = [];
    this.current = emptyDraft();
    this.lastComplete = null;
    if (checkpoint.retained) this.commit(checkpoint.retained);
    this.commit(checkpoint.current);
  }
}
