import { profile } from "./local-profile";
import { ROAD } from "./config";
import type { Point } from "./geometry";
import {
  geometryDigest,
  validIdentity,
  validDigest,
} from "./geometry-identity";
import { STORAGE_KEY, readV3Identity } from "./storage-v3";
import { STORAGE_KEY as V4_KEY, readV4Identity } from "./storage-v4";
import {
  LocalGeometryProof,
  sameLocalSource,
  type LocalSource,
  type LocalCheckpoint,
} from "./local-source";
export const LOCAL_DRAFT_KEY = "paperlap.local-draft.v1";
export const LOCAL_DRAFT_V2_KEY = "paperlap.local-draft.v2";
export const LOCAL_DRAFT_LIMITS = { entries: 8, characters: 1_200_000 };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ErrorKind = "invalid" | "conflict" | "unavailable" | "limit";
export type LocalDraftResult =
  | { ok: true; checkpoint?: LocalCheckpoint; foreign?: boolean }
  | { ok: false; error: ErrorKind };
interface Entry {
  source: LocalSource;
  checkpoint: LocalCheckpoint;
  updatedAt: number;
}
interface Document {
  schemaVersion: 1 | 2;
  entries: Entry[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const points = (v: unknown): v is Point[] =>
  Array.isArray(v) &&
  v.length >= 12 &&
  v.length <= ROAD.maxPoints &&
  v.every(
    (p) =>
      object(p) &&
      typeof p.x === "number" &&
      Number.isFinite(p.x) &&
      typeof p.y === "number" &&
      Number.isFinite(p.y),
  );
function parse(raw: string | null, version: 1 | 2 = 1): Document | null {
  if (raw === null) return { schemaVersion: version, entries: [] };
  if (raw.length > LOCAL_DRAFT_LIMITS.characters) return null;
  try {
    const v = JSON.parse(raw);
    if (
      !object(v) ||
      v.schemaVersion !== version ||
      !Array.isArray(v.entries) ||
      v.entries.length > LOCAL_DRAFT_LIMITS.entries
    )
      return null;
    const seen = new Set<string>();
    for (const e of v.entries) {
      if (
        !object(e) ||
        !object(e.source) ||
        !object(e.checkpoint) ||
        typeof e.source.uid !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(e.source.uid) ||
        !validIdentity(e.source.geometryIdentity) ||
        !validDigest(e.source.geometryDigest) ||
        e.source.algorithmVersion !== 1 ||
        (e.source.spaceVersion !== undefined && e.source.spaceVersion !== 1 &&
          !(version === 2 && e.source.spaceVersion === 2)) ||
        typeof e.updatedAt !== "number" ||
        !Number.isFinite(e.updatedAt) ||
        e.updatedAt < 0
      )
        return null;
      const c = e.checkpoint;
      if (
        !points(c.current) ||
        !(c.previous === null || points(c.previous)) ||
        !(c.next === null || points(c.next))
      )
        return null;
      const key = JSON.stringify([
        e.source.uid,
        e.source.geometryIdentity,
        e.source.geometryDigest,
        e.source.algorithmVersion,
        e.source.spaceVersion ?? 1,
      ]);
      if (seen.has(key)) return null;
      seen.add(key);
    }
    return v as unknown as Document;
  } catch {
    return null;
  }
}
export class LocalDraftStorage {
  private document: Document | null = null;
  private expected: string | null = null;
  private official: string | null = null;
  private source: LocalSource | null = null;
  private proof: LocalGeometryProof | null = null;
  private failure: ErrorKind = "invalid";
  get confirmed() {
    return this.document !== null;
  }
  constructor(
    private store: Store,
    private allow: () => boolean,
    private sharedProof?: LocalGeometryProof,
    private storageVersion: 3 | 4 = 3,
  ) {}
  private get key() { return this.storageVersion === 4 ? LOCAL_DRAFT_V2_KEY : LOCAL_DRAFT_KEY; }
  private get officialKey() { return this.storageVersion === 4 ? V4_KEY : STORAGE_KEY; }
  private get documentVersion(): 1 | 2 { return this.storageVersion === 4 ? 2 : 1; }
  private valid(c: LocalCheckpoint, fresh = false) {
    for (const p of [c.current, c.previous, c.next]) {
      if (!p) continue;
      if (profile("draft.validate", () => this.proof!.check(p, fresh)))
        return false;
    }
    return true;
  }
  open(source: LocalSource, base: readonly Point[]): LocalDraftResult {
    this.failure = "invalid";
    this.document = null;
    this.source = { ...source };
    this.proof = this.sharedProof?.matches(source, base)
      ? this.sharedProof
      : new LocalGeometryProof(source, base);
    try {
      if (source.algorithmVersion !== 1) return { ok: false, error: "invalid" };
      if (!this.allow()) {
        this.failure = "conflict";
        return { ok: false, error: "conflict" };
      }
      this.official = this.store.getItem(this.officialKey);
      const found = profile("draft.source", () =>
        (this.storageVersion === 4 ? readV4Identity : readV3Identity)(this.store, this.official, source.uid),
      );
      if (
        !found.valid ||
        found.geometryIdentity !== source.geometryIdentity ||
        found.geometryDigest !== source.geometryDigest ||
        geometryDigest(base, ROAD.width) !== source.geometryDigest ||
        JSON.parse(this.official!).activeTrackUid !== source.uid ||
        JSON.parse(this.official!).tracks.find((e: { uid: string }) => e.uid === source.uid)?.track.schemaVersion !== (source.spaceVersion ?? 1)
      ) {
        this.failure = "conflict";
        return { ok: false, error: "conflict" };
      }
      this.expected = this.store.getItem(this.key);
      // Copy compatible legacy drafts once. The old bytes remain untouched;
      // an empty V2 document records that this import has already happened.
      if (this.storageVersion === 4 && this.expected === null) {
        const previousRaw = this.store.getItem(LOCAL_DRAFT_KEY);
        const old = parse(previousRaw);
        if (old) {
          const matching = old.entries.find((e) => sameLocalSource(e.source, source));
          // Validate the matching bytes before writing an upgraded document.
          if (matching && !this.valid(matching.checkpoint, true))
            return { ok: false, error: "invalid" };
          const migrated = JSON.stringify({ schemaVersion: 2, entries: old.entries });
          if (!this.allow() || this.store.getItem(this.key) !== null ||
            this.store.getItem(this.officialKey) !== this.official ||
            this.store.getItem(LOCAL_DRAFT_KEY) !== previousRaw)
            return { ok: false, error: "conflict" };
          this.store.setItem(this.key, migrated);
          if (this.store.getItem(this.key) !== migrated ||
            this.store.getItem(LOCAL_DRAFT_KEY) !== previousRaw ||
            this.store.getItem(this.officialKey) !== this.official || !this.allow())
            return { ok: false, error: "conflict" };
          this.expected = migrated;
        }
      }
      const doc = profile("draft.parse", () => parse(this.expected, this.documentVersion));
      if (!doc) return { ok: false, error: "invalid" };
      const matching = doc.entries.find((e) =>
        sameLocalSource(e.source, source),
      );
      // Disk bytes are never trusted through an in-memory cache, even if equal.
      if (matching && !this.valid(matching.checkpoint, true))
        return { ok: false, error: "invalid" };
      this.document = doc;
      return {
        ok: true,
        ...(matching
          ? { checkpoint: structuredClone(matching.checkpoint) }
          : {}),
        foreign: doc.entries.some((e) => !sameLocalSource(e.source, source)),
      };
    } catch {
      this.failure = "unavailable";
      return { ok: false, error: "unavailable" };
    }
  }
  private commit(entries: Entry[], committed = false): LocalDraftResult {
    if (!this.document || !this.source)
      return { ok: false, error: this.failure };
    try {
      if (
        !this.allow() ||
        this.store.getItem(this.key) !== this.expected ||
        (!committed && this.store.getItem(this.officialKey) !== this.official)
      )
        return { ok: false, error: "conflict" };
      const raw = entries.length || this.storageVersion === 4
        ? profile("draft.serialize", () =>
            JSON.stringify({ schemaVersion: this.documentVersion, entries }),
          )
        : null;
      if (
        entries.length > LOCAL_DRAFT_LIMITS.entries ||
        (raw?.length ?? 0) > LOCAL_DRAFT_LIMITS.characters
      )
        return { ok: false, error: "limit" };
      if (raw !== null && !profile("draft.roundtrip", () => parse(raw, this.documentVersion)))
        return { ok: false, error: "invalid" };
      if (raw !== this.expected) {
        if (raw === null) this.store.removeItem(this.key);
        else
          profile("draft.setItem", () =>
            this.store.setItem(this.key, raw),
          );
      }
      if (
        profile("draft.readback", () => this.store.getItem(this.key)) !==
        raw
      )
        return { ok: false, error: "conflict" };
      this.expected = raw;
      this.document = { schemaVersion: this.documentVersion, entries };
      return { ok: true };
    } catch {
      return { ok: false, error: "unavailable" };
    }
  }
  write(checkpoint: LocalCheckpoint): LocalDraftResult {
    if (!this.document || !this.source)
      return { ok: false, error: this.failure };
    if (!this.valid(checkpoint)) return { ok: false, error: "invalid" };
    const old = this.document.entries.find((e) =>
      sameLocalSource(e.source, this.source!),
    );
    if (old && JSON.stringify(old.checkpoint) === JSON.stringify(checkpoint))
      return this.commit(this.document.entries);
    return this.commit([
      ...this.document.entries.filter(
        (e) => !sameLocalSource(e.source, this.source!),
      ),
      {
        source: this.source,
        checkpoint: structuredClone(checkpoint),
        updatedAt: Date.now(),
      },
    ]);
  }
  clear(committed = false): LocalDraftResult {
    if (!this.document || !this.source)
      return { ok: false, error: this.failure };
    return this.commit(
      this.document.entries.filter(
        (e) => !sameLocalSource(e.source, this.source!),
      ),
      committed,
    );
  }
}
export const localDraftMessage = (result: LocalDraftResult) =>
  result.ok
    ? "局部草稿已备份；刷新可恢复最近一步撤销/重做。"
    : {
        invalid: "局部草稿损坏或版本不支持，原文保留。本次未备份，请勿刷新。",
        conflict:
          "来源或其他标签已变化，停止备份并保留原文；本次未备份，请勿刷新。",
        unavailable: "局部草稿未备份：空间不足或读取受限，请勿刷新。",
        limit: "局部草稿容量已满，已有备份保留；本次未备份，请勿刷新。",
      }[result.error];
