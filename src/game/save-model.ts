// Narrow compatibility adapter. V2 remains separately testable; the running game
// uses V3. Controllers share their existing synchronous transaction boundaries.
import * as v2 from "./save";
import * as v3 from "./save-v3";
import type { Track } from "./geometry";
export type Save = v2.Save | v3.Save;
export type TrackEntry = v2.TrackEntry | v3.TrackEntry;
export type SaveResult = v2.SaveResult | v3.SaveResult;
export const SAVE_LIMITS = v2.SAVE_LIMITS;
export const activeTrack = (save: Save): TrackEntry =>
  save.schemaVersion === 3 ? v3.activeTrack(save) : v2.activeTrack(save);
export const recordKey = (entry: TrackEntry, version?: number) =>
  "geometryIdentity" in entry
    ? v3.recordKey(entry, version)
    : v2.recordKey(entry, version);
export const addTrack = (save: Save, track: Track, uid: string): SaveResult =>
  save.schemaVersion === 3
    ? v3.addTrack(save, track, uid)
    : v2.addTrack(save, track, uid);
export const replaceTrack = (
  save: Save,
  uid: string,
  track: Track,
): SaveResult =>
  save.schemaVersion === 3
    ? v3.replaceTrack(save, uid, track)
    : v2.replaceTrack(save, uid, track);
export const selectTrack = (save: Save, uid: string): SaveResult =>
  save.schemaVersion === 3
    ? v3.selectTrack(save, uid)
    : v2.selectTrack(save, uid);
export const renameTrack = (
  save: Save,
  uid: string,
  name: string,
): SaveResult =>
  save.schemaVersion === 3
    ? v3.renameTrack(save, uid, name)
    : v2.renameTrack(save, uid, name);
export const deleteTrack = (save: Save, uid: string): SaveResult =>
  save.schemaVersion === 3
    ? v3.deleteTrack(save, uid)
    : v2.deleteTrack(save, uid);
export const setBest = (
  save: Save,
  uid: string,
  time: number,
  version?: number,
): SaveResult =>
  save.schemaVersion === 3
    ? v3.setBest(save, uid, time, version)
    : v2.setBest(save, uid, time, version);
