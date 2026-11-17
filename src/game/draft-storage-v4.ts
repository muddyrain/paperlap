import type { DraftPolicy } from "./draft-storage";
import { readV4Identity, STORAGE_KEY } from "./storage-v4";

export const V4_DRAFT_KEY = "paperlap.draft.v3";
export const v4DraftPolicy = (allow: () => boolean): DraftPolicy => ({
  key: V4_DRAFT_KEY,
  version: 3,
  officialKey: STORAGE_KEY,
  read: readV4Identity,
  allow,
});
