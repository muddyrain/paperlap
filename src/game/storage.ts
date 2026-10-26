import {
  freshSave,
  migrateV1,
  parseSave,
  validateSave,
  type Save,
  type SaveError,
} from "./save";

export const STORAGE_KEY = "paperlap.save.v2";
export const V1_STORAGE_KEY = "paperlap.save.v1";
type SaveStorage = Pick<Storage, "getItem" | "setItem">;
export type StorageError =
  | SaveError
  | "invalid-v1"
  | "invalid-v2"
  | "quota"
  | "unavailable";
export type WriteResult = { ok: true } | { ok: false; error: StorageError };
export interface LoadResult {
  save: Save;
  source: "v2" | "v1" | "default";
  persisted: boolean;
  error?: StorageError;
}

function storageError(error: unknown): StorageError {
  return error instanceof Error && error.name === "QuotaExceededError"
    ? "quota"
    : "unavailable";
}

export function writeSave(storage: SaveStorage, save: Save): WriteResult {
  try {
    const result = validateSave(save);
    if (!result.ok) return result;
    // Preserve corrupt/unsupported data for recovery instead of overwriting it with a fallback.
    const existing = storage.getItem(STORAGE_KEY);
    if (existing !== null && !parseSave(existing))
      return { ok: false, error: "invalid-v2" };
    if (existing === null) {
      const legacy = storage.getItem(V1_STORAGE_KEY);
      if (legacy !== null && !migrateV1(legacy))
        return { ok: false, error: "invalid-v1" };
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(result.save));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: storageError(error) };
  }
}

export function loadSave(storage: SaveStorage): LoadResult {
  try {
    const rawV2 = storage.getItem(STORAGE_KEY);
    if (rawV2 !== null) {
      const save = parseSave(rawV2);
      if (save) return { save, source: "v2", persisted: true };
    }
    const rawV1 = storage.getItem(V1_STORAGE_KEY);
    const migrated = migrateV1(rawV1);
    const save = migrated ?? freshSave();
    const source = migrated ? "v1" : "default";
    if (rawV2 !== null)
      return { save, source, persisted: false, error: "invalid-v2" };
    if (rawV1 !== null && !migrated)
      return { save, source, persisted: false, error: "invalid-v1" };
    const result = writeSave(storage, save);
    return {
      save,
      source,
      persisted: result.ok,
      ...(!result.ok ? { error: result.error } : {}),
    };
  } catch (error) {
    return {
      save: freshSave(),
      source: "default",
      persisted: false,
      error: storageError(error),
    };
  }
}
