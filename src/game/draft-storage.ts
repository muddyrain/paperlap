import { validIdentity, validDigest } from "./geometry-identity";
import { ROAD, WORLD } from "./config";
import { readTrackFingerprint, STORAGE_KEY } from "./storage";
import {
  sameSource,
  type DraftCheckpoint,
  type DraftSnapshot,
  type DraftSource,
} from "./draft";

export const DRAFT_KEY = "paperlap.draft.v1";
export const DRAFT_LIMITS = { entries: 12, characters: 600_000 };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DraftError = "invalid" | "limit" | "unavailable" | "conflict";
export type DraftResult =
  | { ok: true; checkpoint?: DraftCheckpoint }
  | { ok: false; error: DraftError; checkpoint?: undefined };
interface Entry extends DraftCheckpoint {
  source: DraftSource;
  updatedAt: number;
}
interface Document {
  schemaVersion: number;
  entries: Entry[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function snapshot(v: unknown): v is DraftSnapshot {
  return (
    object(v) &&
    ["empty", "complete", "interrupted"].includes(v.phase as string) &&
    typeof v.overflow === "boolean" &&
    Array.isArray(v.raw) &&
    v.raw.length <= ROAD.maxRaw &&
    (v.phase === "empty"
      ? v.raw.length === 0 && !v.overflow
      : v.raw.length > 0) &&
    v.raw.every(
      (p) =>
        object(p) &&
        typeof p.x === "number" &&
        Number.isFinite(p.x) &&
        Math.abs(p.x) <= WORLD.width * 4 &&
        typeof p.y === "number" &&
        Number.isFinite(p.y) &&
        Math.abs(p.y) <= WORLD.height * 4,
    )
  );
}
function source(v: unknown, version = 1): v is DraftSource {
  return (
    object(v) &&
    ["create", "replace"].includes(v.intent as string) &&
    typeof v.uid === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v.uid) &&
    typeof v.fingerprint === "string" &&
    /^track-[a-f\d]{1,8}$/.test(v.fingerprint) &&
    (version === 1 ||
      (validIdentity(v.geometryIdentity) && validDigest(v.geometryDigest)))
  );
}

export interface DraftPolicy {
  key: string;
  version: number;
  officialKey: string;
  read: (
    store: Store,
    raw: string | null,
    uid: string,
  ) => {
    valid: boolean;
    fingerprint?: string;
    geometryIdentity?: string;
    geometryDigest?: string;
  };
  allow: () => boolean;
}
const originalPolicy: DraftPolicy = {
  key: DRAFT_KEY,
  version: 1,
  officialKey: STORAGE_KEY,
  read: readTrackFingerprint,
  allow: () => true,
};
function parse(raw: string | null, policy = originalPolicy): Document | null {
  if (raw === null) return { schemaVersion: policy.version, entries: [] };
  if (raw.length > DRAFT_LIMITS.characters) return null;
  try {
    const v = JSON.parse(raw);
    if (
      !object(v) ||
      v.schemaVersion !== policy.version ||
      !Array.isArray(v.entries) ||
      v.entries.length > DRAFT_LIMITS.entries
    )
      return null;
    const keys = new Set<string>();
    for (const e of v.entries) {
      if (
        !object(e) ||
        !source(e.source, policy.version) ||
        !snapshot(e.current) ||
        !(e.retained === null || snapshot(e.retained)) ||
        typeof e.updatedAt !== "number" ||
        !Number.isSafeInteger(e.updatedAt) ||
        e.updatedAt < 0
      )
        return null;
      const key = JSON.stringify([
        e.source.intent,
        e.source.uid,
        e.source.fingerprint,
        e.source.geometryIdentity,
        e.source.geometryDigest,
      ]);
      if (keys.has(key)) return null;
      keys.add(key);
    }
    return v as unknown as Document;
  } catch {
    return null;
  }
}

// Optimistic single-key transactions: never overwrite a changed, corrupt or
// unknown document, including changes from a second tab. No Save V2 writes.
export class DraftStorage {
  private failure: DraftError = "invalid";
  private expected: string | null = null;
  private official: string | null = null;
  private source: DraftSource | null = null;
  private document: Document | null = null;
  constructor(
    private storage: Store,
    private policy = originalPolicy,
  ) {}
  open(s: DraftSource): DraftResult {
    this.failure = "invalid";
    this.source = structuredClone(s);
    this.document = null;
    try {
      if (!this.policy.allow()) {
        this.failure = "conflict";
        return { ok: false, error: "conflict" };
      }
      this.expected = this.storage.getItem(this.policy.key);
      this.official = this.storage.getItem(this.policy.officialKey);
      this.document = parse(this.expected, this.policy);
      if (!this.document || !source(s, this.policy.version))
        return { ok: false, error: "invalid" };
      const official = this.policy.read(this.storage, this.official, s.uid);
      if (
        official.valid &&
        (official.fingerprint !== s.fingerprint ||
          (this.policy.version === 2 &&
            (official.geometryIdentity !== s.geometryIdentity ||
              official.geometryDigest !== s.geometryDigest)))
      ) {
        this.document = null;
        this.failure = "conflict";
        return { ok: false, error: "conflict" };
      }
      const e = this.document.entries.find((e) => sameSource(e.source, s));
      return {
        ok: true,
        ...(e
          ? {
              checkpoint: structuredClone({
                current: e.current,
                retained: e.retained,
              }),
            }
          : {}),
      };
    } catch {
      this.document = null;
      this.failure = "unavailable";
      return { ok: false, error: "unavailable" };
    }
  }
  private commit(entries: Entry[], committed = false): DraftResult {
    if (!this.document || !this.source)
      return { ok: false, error: this.failure };
    if (!this.policy.allow()) return { ok: false, error: "conflict" };
    try {
      if (
        this.storage.getItem(this.policy.key) !== this.expected ||
        (!committed &&
          this.storage.getItem(this.policy.officialKey) !== this.official)
      )
        return { ok: false, error: "conflict" };
      const raw = JSON.stringify({
        schemaVersion: this.policy.version,
        entries,
      });
      if (
        entries.length > DRAFT_LIMITS.entries ||
        raw.length > DRAFT_LIMITS.characters
      )
        return { ok: false, error: "limit" };
      if (!parse(raw, this.policy)) return { ok: false, error: "invalid" };
      if (entries.length && raw !== this.expected)
        this.storage.setItem(this.policy.key, raw);
      else if (!entries.length && this.expected !== null)
        this.storage.removeItem(this.policy.key);
      this.expected = entries.length ? raw : null;
      this.document = { schemaVersion: this.policy.version, entries };
      return { ok: true };
    } catch {
      return { ok: false, error: "unavailable" };
    }
  }
  write(checkpoint: DraftCheckpoint): DraftResult {
    if (!this.document || !this.source)
      return { ok: false, error: this.failure };
    const existing = this.document.entries.find((e) =>
      sameSource(e.source, this.source!),
    );
    if (
      existing &&
      JSON.stringify({
        current: existing.current,
        retained: existing.retained,
      }) === JSON.stringify(checkpoint)
    )
      return this.commit(this.document.entries);
    const entries = this.document.entries.filter(
      (e) => !sameSource(e.source, this.source!),
    );
    entries.push({
      ...structuredClone(checkpoint),
      source: this.source,
      updatedAt: Date.now(),
    });
    return this.commit(entries);
  }
  clear(committed = false): DraftResult {
    if (!this.document || !this.source)
      return { ok: false, error: this.failure };
    return this.commit(
      this.document.entries.filter((e) => !sameSource(e.source, this.source!)),
      committed,
    );
  }
}
export const draftMessage = (error: DraftError) =>
  ({
    invalid: "草稿数据损坏或版本不支持，原文已保留；本次绘制未备份。",
    limit: "草稿备份容量已满，已有草稿保留；本次绘制未备份。",
    unavailable: "草稿未备份：存储空间不足或不可用，请暂勿刷新。",
    conflict:
      "当前存档只读或检测到其他标签变更，已停止备份并保留原文；请暂勿刷新。",
  })[error];
