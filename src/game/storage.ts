import { RULES_VERSION, ROAD } from "./config";
import { defaultTrack, fingerprint, validate, type Track } from "./geometry";
export const STORAGE_KEY = "paperlap.save.v1";
export interface Save {
  schemaVersion: 1;
  rulesVersion: number;
  track: Track;
  records: Record<string, number>;
  muted: boolean;
}
export const recordKey = (track: Track) => `${track.id}:rules-${RULES_VERSION}`;
export const freshSave = (): Save => ({
  schemaVersion: 1,
  rulesVersion: RULES_VERSION,
  track: defaultTrack(),
  records: {},
  muted: true,
});
export function parseSave(raw: string | null): Save {
  const fallback = freshSave();
  if (!raw || raw.length > 150000) return fallback;
  try {
    const value = JSON.parse(raw),
      t = value?.track;
    if (
      value.schemaVersion !== 1 ||
      !t ||
      t.schemaVersion !== 1 ||
      t.width !== ROAD.width ||
      !Array.isArray(t.points) ||
      validate(t.points, t.width)
    )
      return fallback;
    if (t.points.some((p: unknown) => typeof p !== "object" || p === null))
      return fallback;
    const points = t.points.map((p: { x: number; y: number }) => ({
      x: p.x,
      y: p.y,
    }));
    const track: Track = {
      schemaVersion: 1,
      id: fingerprint(points, t.width),
      width: t.width,
      points,
      name: typeof t.name === "string" ? t.name.slice(0, 40) : "我的手绘赛道",
    };
    const records: Record<string, number> = {};
    if (
      Number.isInteger(value.rulesVersion) &&
      value.rulesVersion >= 1 &&
      value.rulesVersion <= RULES_VERSION &&
      value.records &&
      typeof value.records === "object"
    )
      for (const [key, time] of Object.entries(value.records).slice(-32)) {
        if (
          /^track-[a-f\d]+:rules-\d+$/.test(key) &&
          typeof time === "number" &&
          Number.isFinite(time) &&
          time > 2 &&
          time < 3600
        )
          records[key] = time;
      }
    return {
      schemaVersion: 1,
      rulesVersion: RULES_VERSION,
      track,
      records,
      muted: typeof value.muted === "boolean" ? value.muted : true,
    };
  } catch {
    return fallback;
  }
}
export function loadSave(storage: Pick<Storage, "getItem">): Save {
  try {
    return parseSave(storage.getItem(STORAGE_KEY));
  } catch {
    return freshSave();
  }
}
export function writeSave(
  storage: Pick<Storage, "setItem">,
  save: Save,
): boolean {
  try {
    const entries = Object.entries(save.records);
    const current = recordKey(save.track);
    const records = Object.fromEntries(
      entries.filter(([key]) => key !== current).slice(-31),
    );
    if (save.records[current] !== undefined)
      records[current] = save.records[current];
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...save, records }));
    return true;
  } catch {
    return false;
  }
}
