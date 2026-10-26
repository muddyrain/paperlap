import { ROAD, RULES_VERSION } from "./config";
import { defaultTrack, fingerprint, validate, type Track } from "./geometry";

export const SAVE_LIMITS = {
  tracks: 20,
  name: 40,
  records: 512,
  legacyRecords: 128,
  characters: 1_500_000,
  v1Characters: 150_000,
};
export interface TrackEntry {
  uid: string;
  track: Track;
}
export interface Save {
  schemaVersion: 2;
  rulesVersion: number;
  activeTrackUid: string;
  tracks: TrackEntry[];
  records: Record<string, number>;
  legacyRecords: Record<string, number>;
  muted: boolean;
}
export type SaveError =
  | "invalid-save"
  | "invalid-track"
  | "invalid-name"
  | "invalid-uid"
  | "invalid-record"
  | "not-found"
  | "last-track"
  | "track-limit"
  | "record-limit"
  | "legacy-record-limit"
  | "data-limit";
export type SaveResult =
  | { ok: true; save: Save }
  | { ok: false; error: SaveError };

export const recordKey = (entry: TrackEntry, rules = RULES_VERSION) =>
  `${entry.uid}:${entry.track.id}:rules-${rules}`;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validUid = (uid: unknown): uid is string =>
  typeof uid === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(uid);
const validName = (name: unknown): name is string =>
  typeof name === "string" &&
  name.trim().length > 0 &&
  name.length <= SAVE_LIMITS.name;
const validRules = (rules: unknown): rules is number =>
  typeof rules === "number" && Number.isSafeInteger(rules) && rules >= 1;
const validTime = (time: unknown): time is number =>
  typeof time === "number" && Number.isFinite(time) && time > 2 && time < 3600;
const legacyKey = /^track-[a-f\d]+:rules-([1-9]\d*)$/;
const entryKey =
  /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,79}):track-[a-f\d]+:rules-([1-9]\d*)$/;
const failure = (error: SaveError): SaveResult => ({ ok: false, error });

function readTrack(value: unknown, legacy = false): Track | null {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.width !== ROAD.width ||
    !Array.isArray(value.points) ||
    validate(value.points, value.width)
  )
    return null;
  const points = value.points.map((p: { x: number; y: number }) => ({
    x: p.x,
    y: p.y,
  }));
  const id = fingerprint(points, value.width);
  const name = legacy
    ? typeof value.name === "string"
      ? value.name.slice(0, SAVE_LIMITS.name)
      : "我的手绘赛道"
    : value.name;
  // V1 allowed empty names. Preserve those on disk; new names use validName().
  if (
    typeof name !== "string" ||
    name.length > SAVE_LIMITS.name ||
    (!legacy && value.id !== id)
  )
    return null;
  return { schemaVersion: 1, id, name, width: value.width, points };
}

export const freshSave = (): Save => ({
  schemaVersion: 2,
  rulesVersion: RULES_VERSION,
  activeTrackUid: "entry-default",
  tracks: [{ uid: "entry-default", track: defaultTrack() }],
  records: {},
  legacyRecords: {},
  muted: true,
});

// Callers operate on validated Saves; an absent active entry is an invariant violation.
export function activeTrack(save: Save): TrackEntry {
  const entry = save.tracks.find((entry) => entry.uid === save.activeTrackUid);
  if (!entry) throw Error("Missing active track");
  return entry;
}

export function validateSave(value: unknown): SaveResult {
  if (
    !object(value) ||
    value.schemaVersion !== 2 ||
    !validRules(value.rulesVersion) ||
    !validUid(value.activeTrackUid) ||
    typeof value.muted !== "boolean" ||
    !Array.isArray(value.tracks) ||
    !value.tracks.length ||
    !object(value.records) ||
    !object(value.legacyRecords)
  )
    return failure("invalid-save");
  if (value.tracks.length > SAVE_LIMITS.tracks) return failure("track-limit");
  const tracks: TrackEntry[] = [],
    uids = new Set<string>();
  for (const entry of value.tracks) {
    if (!object(entry) || !validUid(entry.uid) || uids.has(entry.uid))
      return failure("invalid-uid");
    const track = readTrack(entry.track);
    if (!track) return failure("invalid-track");
    tracks.push({ uid: entry.uid, track });
    uids.add(entry.uid);
  }
  if (!uids.has(value.activeTrackUid)) return failure("invalid-save");
  if (Object.keys(value.records).length > SAVE_LIMITS.records)
    return failure("record-limit");
  if (Object.keys(value.legacyRecords).length > SAVE_LIMITS.legacyRecords)
    return failure("legacy-record-limit");
  const records: Record<string, number> = {},
    legacyRecords: Record<string, number> = {};
  for (const [key, time] of Object.entries(value.records)) {
    const match = entryKey.exec(key);
    if (
      !match ||
      !uids.has(match[1]) ||
      !validRules(Number(match[2])) ||
      !validTime(time)
    )
      return failure("invalid-record");
    records[key] = time;
  }
  for (const [key, time] of Object.entries(value.legacyRecords)) {
    const match = legacyKey.exec(key);
    if (!match || !validRules(Number(match[1])) || !validTime(time))
      return failure("invalid-record");
    legacyRecords[key] = time;
  }
  const save: Save = {
    schemaVersion: 2,
    rulesVersion: value.rulesVersion,
    activeTrackUid: value.activeTrackUid,
    tracks,
    records,
    legacyRecords,
    muted: value.muted,
  };
  if (JSON.stringify(save).length > SAVE_LIMITS.characters)
    return failure("data-limit");
  return { ok: true, save };
}

export function parseSave(raw: string | null): Save | null {
  if (!raw || raw.length > SAVE_LIMITS.characters) return null;
  try {
    const result = validateSave(JSON.parse(raw));
    return result.ok ? result.save : null;
  } catch {
    return null;
  }
}

export function migrateV1(raw: string | null): Save | null {
  if (!raw || raw.length > SAVE_LIMITS.v1Characters) return null;
  try {
    const old = JSON.parse(raw);
    if (
      !object(old) ||
      old.schemaVersion !== 1 ||
      !validRules(old.rulesVersion)
    )
      return null;
    const track = readTrack(old.track, true);
    if (!track) return null;
    // Deterministic across failed writes/reloads. A migrated entry is never duplicated.
    const entry = { uid: `entry-v1-${track.id}`, track };
    const save: Save = {
      schemaVersion: 2,
      rulesVersion: RULES_VERSION,
      activeTrackUid: entry.uid,
      tracks: [entry],
      records: {},
      legacyRecords: {},
      muted: typeof old.muted === "boolean" ? old.muted : true,
    };
    if (object(old.records))
      for (const [key, time] of Object.entries(old.records)) {
        const match = legacyKey.exec(key);
        if (!match || !validRules(Number(match[1])) || !validTime(time))
          continue;
        if (key === `${track.id}:rules-${match[1]}`)
          save.records[recordKey(entry, Number(match[1]))] = time;
        else save.legacyRecords[key] = time;
      }
    const result = validateSave(save);
    return result.ok ? result.save : null;
  } catch {
    return null;
  }
}

export function addTrack(save: Save, track: Track, uid: string): SaveResult {
  if (save.tracks.length >= SAVE_LIMITS.tracks) return failure("track-limit");
  if (!validUid(uid) || save.tracks.some((entry) => entry.uid === uid))
    return failure("invalid-uid");
  if (!validName(track.name)) return failure("invalid-name");
  return validateSave({
    ...save,
    activeTrackUid: uid,
    tracks: [...save.tracks, { uid, track }],
  });
}

export function selectTrack(save: Save, uid: string): SaveResult {
  if (!save.tracks.some((entry) => entry.uid === uid))
    return failure("not-found");
  return validateSave({ ...save, activeTrackUid: uid });
}

export function renameTrack(save: Save, uid: string, name: string): SaveResult {
  if (!validName(name)) return failure("invalid-name");
  if (!save.tracks.some((entry) => entry.uid === uid))
    return failure("not-found");
  return validateSave({
    ...save,
    tracks: save.tracks.map((entry) =>
      entry.uid === uid ? { ...entry, track: { ...entry.track, name } } : entry,
    ),
  });
}

export function replaceTrack(
  save: Save,
  uid: string,
  track: Track,
): SaveResult {
  if (!save.tracks.some((entry) => entry.uid === uid))
    return failure("not-found");
  return validateSave({
    ...save,
    tracks: save.tracks.map((entry) =>
      entry.uid === uid
        ? { ...entry, track: { ...track, name: entry.track.name } }
        : entry,
    ),
  });
}

export function deleteTrack(save: Save, uid: string): SaveResult {
  if (!save.tracks.some((entry) => entry.uid === uid))
    return failure("not-found");
  if (save.tracks.length === 1) return failure("last-track");
  const tracks = save.tracks.filter((entry) => entry.uid !== uid);
  return validateSave({
    ...save,
    tracks,
    activeTrackUid:
      save.activeTrackUid === uid ? tracks[0].uid : save.activeTrackUid,
    records: Object.fromEntries(
      Object.entries(save.records).filter(
        ([key]) => !key.startsWith(`${uid}:`),
      ),
    ),
  });
}

export function setBest(
  save: Save,
  uid: string,
  time: number,
  rules = RULES_VERSION,
): SaveResult {
  const entry = save.tracks.find((entry) => entry.uid === uid);
  if (!entry) return failure("not-found");
  if (!validTime(time) || !validRules(rules)) return failure("invalid-record");
  const key = recordKey(entry, rules),
    best = save.records[key];
  return validateSave({
    ...save,
    records: {
      ...save.records,
      [key]: best === undefined ? time : Math.min(best, time),
    },
  });
}
