import { createFirebaseRepository, type FirestorePort } from "./repository";
import { createIndexedDbSyncStore, type CloudSyncStore } from "./sync-store";
import { createDeviceCloudAccess } from "./device-access";
import { createCloudSyncRepository } from "../../services/cloud-sync";
import type { DeviceCloudRecovery } from "../../services/cloud-session";
import { healthKitImportState } from "../local/healthkit-import-state";

/** Bootstrap the existing cache/outbox without importing or waiting for the SDK.
 * Attaching the real port later changes only transport, not repository identity. */
export function createDeviceCloudRecovery(project: string, appId: string, {
  access = createDeviceCloudAccess(project, appId),
  store = createIndexedDbSyncStore(project),
}: { access?: ReturnType<typeof createDeviceCloudAccess>; store?: CloudSyncStore } = {}): DeviceCloudRecovery & { attach(port: FirestorePort): void } {
  let connected: FirestorePort | undefined;
  const port = (): FirestorePort => {
    if (!connected) throw Object.assign(new Error("Cloud transport is not ready"), { code: "unavailable" });
    return connected;
  };
  const deferredPort: FirestorePort = {
    currentUid: () => connected?.currentUid() ?? null,
    read: path => port().read(path),
    list: path => port().list(path),
    commit: (path, expected, writes, authorize) => port().commit(path, expected, writes, authorize),
  };
  return {
    access,
    attach(next) { connected = next; },
    repository(uid) {
      const base = createFirebaseRepository(deferredPort, uid, {
        cachedUid: () => access.owner(),
        healthKitConsent: () => healthKitImportState.consent(uid),
      });
      return createCloudSyncRepository(base, uid, store);
    },
  };
}
