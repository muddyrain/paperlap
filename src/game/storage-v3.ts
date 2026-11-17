import * as model from "./save-v3";
import { createStorageModel } from "./storage-modern";
export { OLD_KEYS, acquireWriter, type Store, type StorageError, type WriteResult, type WriterLease } from "./storage-modern";
export const STORAGE_KEY = "paperlap.save.v3";
const storage = createStorageModel(3, model);
export const SaveSession = storage.SaveSession;
export type SaveSession = InstanceType<typeof SaveSession>;
export const readV3Identity = storage.readIdentity;
export const storageMessage = storage.storageMessage;
