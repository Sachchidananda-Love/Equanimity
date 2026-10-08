import type { HealthRecord } from "../../domain/health/types";
import { healthValid } from "./validation";
import type { StoragePort } from "./repository";
import { verifiedHealthKitRecord } from "../../domain/health/import-policy";

export type HealthKitPending = { schemaVersion: 1; uid: string; records: HealthRecord[]; capturedAt: string };
export interface HealthKitImportState {
  consent(uid: string): boolean;
  setConsent(uid: string, enabled: boolean): void;
  pending(uid: string): HealthKitPending | null;
  setPending(uid: string, pending: HealthKitPending | null): void;
  lastImport(uid: string): string | null;
  setLastImport(uid: string, timestamp: string): void;
}

/** This is a retry checkpoint, not an alternate health dataset. Nothing auto-flushes. */
export function createHealthKitImportState(storage: () => Pick<StoragePort, "getItem" | "setItem">): HealthKitImportState {
  function key(uid: string, suffix: string) {
    if (!uid || uid.includes("/")) throw new Error("A private account is required");
    return `equanimity:healthkit:${encodeURIComponent(uid)}:${suffix}:v1`;
  }
  function write(uid: string, suffix: string, value: string) {
    const port = storage(); const target = key(uid, suffix);
    port.setItem(target, value);
    if (port.getItem(target) !== value) throw new Error("Could not retain the Health import checkpoint on this device");
  }
  return {
    consent: uid => { try { return storage().getItem(key(uid, "consent")) === "true"; } catch { return false; } },
    setConsent: (uid, enabled) => write(uid, "consent", String(enabled)),
    pending: uid => {
      const raw = storage().getItem(key(uid, "pending"));
      if (!raw || raw === "null") return null;
      const pending = JSON.parse(raw) as HealthKitPending;
      if (pending.schemaVersion !== 1 || pending.uid !== uid || !Number.isFinite(Date.parse(pending.capturedAt))
        || !Array.isArray(pending.records) || !pending.records.every(record => healthValid(record) && verifiedHealthKitRecord(record))) {
        throw new Error("The pending Health import is malformed; its original checkpoint has been retained");
      }
      return pending;
    },
    setPending: (uid, pending) => {
      if (pending && pending.uid !== uid) throw new Error("Pending import belongs to another account");
      write(uid, "pending", JSON.stringify(pending));
    },
    lastImport: uid => storage().getItem(key(uid, "last-import")),
    setLastImport: (uid, timestamp) => write(uid, "last-import", timestamp),
  };
}

export const healthKitImportState = createHealthKitImportState(() => window.localStorage);
