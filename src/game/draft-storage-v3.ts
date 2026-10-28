import type { DraftPolicy } from "./draft-storage";
import { readV3Identity, STORAGE_KEY } from "./storage-v3";
export const V3_DRAFT_KEY = "paperlap.draft.v2";
export const v3DraftPolicy = (allow: () => boolean): DraftPolicy => ({
  key: V3_DRAFT_KEY,
  version: 2,
  officialKey: STORAGE_KEY,
  read: readV3Identity,
  allow,
});
