// V3 keeps its original envelope and schema-1 track contract.
import { createSaveModel, type ModernSave, type ModernSaveResult } from "./save-modern";
export { V3_LIMITS, type TrackEntry, type SaveError } from "./save-modern";
export type Save = ModernSave<3>;
export type SaveResult = ModernSaveResult<3>;
export const { validateSave, parseSave, migrateSave, freshSave, activeTrack,
  recordKey, addTrack, replaceTrack, selectTrack, renameTrack, deleteTrack,
  setBest } = createSaveModel(3);
