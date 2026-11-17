import { createSaveModel, type ModernSave, type ModernSaveResult } from "./save-modern";
import * as v3 from "./save-v3";
import { longTrack } from "./geometry";
import { geometryDigest, migratedIdentity, storageTextDigest } from "./geometry-identity";
export { V3_LIMITS as V4_LIMITS, type TrackEntry, type SaveError } from "./save-modern";
export type Save = ModernSave<4>;
export type SaveResult = ModernSaveResult<4>;
export const { validateSave, parseSave, migrateSave, activeTrack,
  recordKey, addTrack, replaceTrack, selectTrack, renameTrack, deleteTrack,
  setBest } = createSaveModel(4);
export function migrateV3(old: v3.Save, raw: string | null): SaveResult {
  const checked = v3.validateSave(old);
  if (!checked.ok) return checked;
  return validateSave({ ...checked.save, schemaVersion: 4,
    legacySources: { ...checked.save.legacySources,
      v3: raw === null ? null : storageTextDigest(raw) } });
}
export function freshSave(): Save {
  const base = v3.freshSave(), track = longTrack();
  const digest = geometryDigest(track.points, track.width);
  const result = validateSave({ ...base, schemaVersion: 4,
    tracks: [{ uid: base.activeTrackUid, track,
      geometryIdentity: migratedIdentity("default-v4", base.activeTrackUid, digest),
      geometryDigest: digest }],
    legacySources: { v1: null, v2: null, v3: null } });
  if (!result.ok) throw Error(result.error);
  return result.save;
}
