import { RULES_VERSION } from "./config";
import * as v2 from "./save";
import type { Track } from "./geometry";
import {
  geometryDigest,
  migratedIdentity,
  newGeometryIdentity,
  validDigest,
  validIdentity,
} from "./geometry-identity";
export const V3_LIMITS = {
  ...v2.SAVE_LIMITS,
  characters: 2_000_000,
  archiveRecords: 512,
};
export interface TrackEntry extends v2.TrackEntry {
  geometryIdentity: string;
  geometryDigest: string;
}
export interface Save extends Omit<v2.Save, "schemaVersion" | "tracks"> {
  schemaVersion: 3;
  tracks: TrackEntry[];
  legacy: {
    source: "v1" | "v2" | "default";
    sourceRulesVersion: number;
    tracks: { uid: string; name: string; fingerprint: string }[];
    records: Record<string, number>;
  };
  legacySources: { v1: string | null; v2: string | null };
}
export type SaveError =
  v2.SaveError | "invalid-identity" | "invalid-digest" | "archive-limit";
export type SaveResult =
  { ok: true; save: Save } | { ok: false; error: SaveError };
const fail = (error: SaveError): SaveResult => ({ ok: false, error });
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v);
const time = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 2 && v < 3600;
const rules = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const oldKey =
  /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,79}):track-[a-f\d]+:rules-([1-9]\d*)$/;
const newKey =
  /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,79}):((?:g-[a-f0-9]{32}|m-[a-f0-9]{64})):rules-([1-9]\d*)$/;
export const recordKey = (entry: TrackEntry, version = RULES_VERSION) =>
  `${entry.uid}:${entry.geometryIdentity}:rules-${version}`;
export function activeTrack(save: Save): TrackEntry {
  const e = save.tracks.find((e) => e.uid === save.activeTrackUid);
  if (!e) throw Error("Missing active track");
  return e;
}
export function validateSave(value: unknown): SaveResult {
  if (
    !object(value) ||
    value.schemaVersion !== 3 ||
    !object(value.legacy) ||
    !object(value.legacySources) ||
    !object(value.records)
  )
    return fail("invalid-save");
  // Reuse all original track/metadata and geometric safety checks. Never feed
  // identity keys into the old record parser or trust a digest instead of geometry.
  const base = v2.validateSave({ ...value, schemaVersion: 2, records: {} });
  if (!base.ok) return base;
  const legacy = value.legacy;
  if (
    !["v1", "v2", "default"].includes(legacy.source as string) ||
    !rules(legacy.sourceRulesVersion) ||
    !Array.isArray(legacy.tracks) ||
    legacy.tracks.length > 20 ||
    !object(legacy.records)
  )
    return fail("invalid-save");
  const archivedUids = new Set<string>();
  for (const e of legacy.tracks) {
    if (
      !object(e) ||
      !uid(e.uid) ||
      archivedUids.has(e.uid) ||
      typeof e.name !== "string" ||
      e.name.length > 40 ||
      typeof e.fingerprint !== "string" ||
      !/^track-[a-f\d]+$/.test(e.fingerprint)
    )
      return fail("invalid-save");
    archivedUids.add(e.uid);
  }
  if (Object.keys(legacy.records).length > V3_LIMITS.archiveRecords)
    return fail("archive-limit");
  for (const [key, best] of Object.entries(legacy.records)) {
    const m = oldKey.exec(key);
    if (!m || !archivedUids.has(m[1]) || !rules(Number(m[2])) || !time(best))
      return fail("invalid-record");
  }
  if (
    ![value.legacySources.v1, value.legacySources.v2].every(
      (d) => d === null || (typeof d === "string" && /^[a-f0-9]{64}$/.test(d)),
    )
  )
    return fail("invalid-save");
  const ids = new Set<string>(),
    tracks: TrackEntry[] = [];
  for (let i = 0; i < base.save.tracks.length; i++) {
    const raw = (value.tracks as Record<string, unknown>[])[i],
      entry = base.save.tracks[i];
    if (!validIdentity(raw.geometryIdentity) || ids.has(raw.geometryIdentity))
      return fail("invalid-identity");
    if (
      !validDigest(raw.geometryDigest) ||
      geometryDigest(entry.track.points, entry.track.width) !==
        raw.geometryDigest
    )
      return fail("invalid-digest");
    ids.add(raw.geometryIdentity);
    tracks.push({
      ...entry,
      geometryIdentity: raw.geometryIdentity,
      geometryDigest: raw.geometryDigest,
    });
  }
  if (Object.keys(value.records).length > V3_LIMITS.records)
    return fail("record-limit");
  const uids = new Set(tracks.map((e) => e.uid));
  for (const [key, best] of Object.entries(value.records)) {
    const m = newKey.exec(key);
    if (!m || !uids.has(m[1]) || !rules(Number(m[3])) || !time(best))
      return fail("invalid-record");
  }
  const save: Save = {
    ...base.save,
    schemaVersion: 3,
    tracks,
    records: { ...value.records } as Record<string, number>,
    legacy: structuredClone(legacy) as unknown as Save["legacy"],
    legacySources: { ...value.legacySources } as Save["legacySources"],
  };
  if (JSON.stringify(save).length > V3_LIMITS.characters)
    return fail("data-limit");
  return { ok: true, save };
}
export function parseSave(raw: string | null): Save | null {
  if (!raw || raw.length > V3_LIMITS.characters) return null;
  try {
    const r = validateSave(JSON.parse(raw));
    return r.ok ? r.save : null;
  } catch {
    return null;
  }
}
export function migrateSave(
  old: v2.Save,
  source: Save["legacy"]["source"],
  legacySources: Save["legacySources"],
): SaveResult {
  const checked = v2.validateSave(old);
  if (!checked.ok) return checked;
  const save = checked.save;
  return validateSave({
    ...save,
    schemaVersion: 3,
    tracks: save.tracks.map((e) => {
      const digest = geometryDigest(e.track.points, e.track.width);
      return {
        ...e,
        geometryIdentity: migratedIdentity(source, e.uid, digest),
        geometryDigest: digest,
      };
    }),
    records: {},
    legacy: {
      source,
      sourceRulesVersion: save.rulesVersion,
      tracks:
        source === "default"
          ? []
          : save.tracks.map((e) => ({
              uid: e.uid,
              name: e.track.name,
              fingerprint: e.track.id,
            })),
      records: source === "default" ? {} : save.records,
    },
    legacySources,
  });
}
export function freshSave(): Save {
  const result = migrateSave(v2.freshSave(), "default", { v1: null, v2: null });
  if (!result.ok) throw Error(result.error);
  return result.save;
}
export function addTrack(save: Save, track: Track, id: string): SaveResult {
  if (save.tracks.length >= V3_LIMITS.tracks) return fail("track-limit");
  if (!uid(id) || save.tracks.some((e) => e.uid === id))
    return fail("invalid-uid");
  if (!track.name.trim() || track.name.length > 40) return fail("invalid-name");
  return validateSave({
    ...save,
    activeTrackUid: id,
    tracks: [
      ...save.tracks,
      {
        uid: id,
        track,
        geometryIdentity: newGeometryIdentity(),
        geometryDigest: geometryDigest(track.points, track.width),
      },
    ],
  });
}
export function replaceTrack(save: Save, id: string, track: Track): SaveResult {
  const previous = save.tracks.find((e) => e.uid === id);
  if (!previous) return fail("not-found");
  const same =
    track.width === previous.track.width &&
    track.points.length === previous.track.points.length &&
    track.points.every(
      (p, i) =>
        p.x === previous.track.points[i].x &&
        p.y === previous.track.points[i].y,
    );
  return validateSave({
    ...save,
    tracks: save.tracks.map((e) =>
      e.uid !== id
        ? e
        : {
            ...e,
            track: { ...track, name: e.track.name },
            geometryIdentity: same ? e.geometryIdentity : newGeometryIdentity(),
            geometryDigest: same
              ? e.geometryDigest
              : geometryDigest(track.points, track.width),
          },
    ),
  });
}
export function selectTrack(save: Save, id: string): SaveResult {
  return save.tracks.some((e) => e.uid === id)
    ? validateSave({ ...save, activeTrackUid: id })
    : fail("not-found");
}
export function renameTrack(save: Save, id: string, name: string): SaveResult {
  if (!name.trim() || name.length > 40) return fail("invalid-name");
  return save.tracks.some((e) => e.uid === id)
    ? validateSave({
        ...save,
        tracks: save.tracks.map((e) =>
          e.uid === id ? { ...e, track: { ...e.track, name } } : e,
        ),
      })
    : fail("not-found");
}
export function deleteTrack(save: Save, id: string): SaveResult {
  if (!save.tracks.some((e) => e.uid === id)) return fail("not-found");
  if (save.tracks.length === 1) return fail("last-track");
  const tracks = save.tracks.filter((e) => e.uid !== id);
  return validateSave({
    ...save,
    tracks,
    activeTrackUid:
      save.activeTrackUid === id ? tracks[0].uid : save.activeTrackUid,
    records: Object.fromEntries(
      Object.entries(save.records).filter(([k]) => !k.startsWith(`${id}:`)),
    ),
  });
}
export function setBest(
  save: Save,
  id: string,
  best: number,
  version = RULES_VERSION,
): SaveResult {
  const entry = save.tracks.find((e) => e.uid === id);
  if (!entry) return fail("not-found");
  if (!time(best) || !rules(version)) return fail("invalid-record");
  const key = recordKey(entry, version),
    old = save.records[key];
  return validateSave({
    ...save,
    records: {
      ...save.records,
      [key]: old === undefined ? best : Math.min(old, best),
    },
  });
}
