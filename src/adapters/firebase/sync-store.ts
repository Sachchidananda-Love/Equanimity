import type { AppData, CloudBaseline } from "../../services/repository-contracts";
import { lifecycleSpan } from "../../platform/lifecycle-log";

export type CloudCheckpoint = { schema: 1; ownerUid: string; version: number; baseline: CloudBaseline; pending: { id: string; changes: Partial<AppData> }[] };
export interface CloudSyncStore {
  read(uid: string): Promise<CloudCheckpoint | null>;
  write(uid: string, state: CloudCheckpoint, expectedVersion: number): Promise<void>;
}

/** One validated UID snapshot plus an atomic outbox. Never reads local fallback
 * keys. Compare-and-swap prevents a second tab from dropping another queue. */
export function createIndexedDbSyncStore(project: string, factory: () => IDBFactory | undefined = () => globalThis.indexedDB): CloudSyncStore {
  let opening: Promise<IDBDatabase> | undefined;
  function database() {
    if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
      const idb = factory();
      if (!idb) { reject(new Error("Device cloud cache is unavailable")); return; }
      const request = idb.open(`equanimity-cloud-${project}`, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("accounts"); };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
      request.onerror = () => reject(new Error("Device cloud cache could not be opened"));
      request.onblocked = () => reject(new Error("Device cloud cache is busy in another view"));
    }).catch(error => { opening = undefined; throw error; });
    return opening;
  }
  return {
    async read(uid) {
      const finish = lifecycleSpan("device cache read");
      try {
        const db = await database();
        return await new Promise((resolve, reject) => {
        const transaction = db.transaction("accounts", "readonly");
        const request = transaction.objectStore("accounts").get(uid);
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onabort = transaction.onerror = () => reject(new Error("Device cloud cache read failed"));
        });
      } finally { finish(); }
    },
    async write(uid, state, expectedVersion) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("accounts", "readwrite");
        const store = transaction.objectStore("accounts");
        const request = store.get(uid);
        let conflict = false;
        request.onsuccess = () => {
          if ((request.result?.version ?? 0) !== expectedVersion) { conflict = true; transaction.abort(); return; }
          store.put(state, uid);
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(new Error(conflict ? "Device cloud cache changed in another view; pending changes retained" : "Device cloud checkpoint failed; keep this view open"));
      });
    },
  };
}
