import type { HealthRecord } from "../domain/health/types";
import { persistedHealthKitRecord, verifiedHealthKitRecord } from "../domain/health/import-policy";
import { healthValid } from "../adapters/local/validation";
import type { HealthKitImportState } from "../adapters/local/healthkit-import-state";
import { healthKitStatus, inspectHealthKit, normalizeHealthKitRecords, requestHealthKitAuthorization } from "../adapters/healthkit";
import type { HealthKitInspection } from "../adapters/healthkit";
import type { AppData, DataRepository } from "./repository-contracts";

export type HealthImportReport = {
  found: number; new: number; alreadyImported: number; updated: number; skipped: number; superseded: number;
  providers: Record<string, number>; metrics: Record<string, number>; importedAt: string;
};
export type HealthImportResult = {
  report: HealthImportReport; records: HealthRecord[]; data?: AppData;
  state: "inspection-only" | "synced" | "pending";
  message: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (typeof value === "object" && value !== null) return JSON.stringify(Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, JSON.parse(canonical(child))])));
  return JSON.stringify(value);
}
function representation(record: HealthRecord) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = record;
  void _createdAt; void _updatedAt;
  return canonical(fields);
}

/** Reconcile by external UUID. Date is never an identity or deletion signal. */
export function reconcileHealthKitRecords(existing: HealthRecord[], samples: HealthRecord[], timestamp: string) {
  if (!samples.every(healthValid)) throw new Error("Invalid normalized HealthKit batch; existing records retained");
  const records = structuredClone(existing);
  const report: HealthImportReport = { found: samples.length, new: 0, alreadyImported: 0, updated: 0, skipped: 0, superseded: 0, providers: {}, metrics: {}, importedAt: timestamp };
  const seen = new Map<string, string>();
  for (const sample of samples) {
    report.providers[sample.provenance.provider] = (report.providers[sample.provenance.provider] ?? 0) + 1;
    report.metrics[sample.metric] = (report.metrics[sample.metric] ?? 0) + 1;
    if (!verifiedHealthKitRecord(sample)) { report.skipped++; continue; }
    const incoming = persistedHealthKitRecord(sample);
    const uuid = incoming.provenance.originalSourceId;
    if (!uuid || incoming.id !== `healthkit:${uuid}`) throw new Error("HealthKit UUID identity mismatch");
    if (seen.has(uuid)) {
      if (seen.get(uuid) !== representation(incoming)) throw new Error("Conflicting native records share a HealthKit UUID");
      report.alreadyImported++; continue;
    }
    seen.set(uuid, representation(incoming));
    const index = records.findIndex(record => record.provenance.ingestion === "healthkit" && record.provenance.originalSourceId?.toUpperCase() === uuid.toUpperCase());
    if (index >= 0) {
      const previous = records[index];
      incoming.id = previous.id; // Preserve an already persisted stable ID.
      if (previous.status === "deleted" || previous.status === "superseded" || representation(persistedHealthKitRecord(previous)) === representation(incoming)) { report.alreadyImported++; continue; }
      records[index] = { ...incoming, createdAt: previous.createdAt, updatedAt: timestamp };
      report.updated++;
    } else {
      // Replacement UUIDs are corrections only when the same source supplies an
      // explicit sync identity and an increasing sync version. Never infer from date.
      const syncId = incoming.provenance.metadata?.["healthkit.HKSyncIdentifier"];
      const syncVersion = Number(incoming.provenance.metadata?.["healthkit.HKSyncVersion"]);
      let obsolete = false;
      if (syncId && Number.isFinite(syncVersion)) {
        for (const previous of records.filter(record => record.provenance.ingestion === "healthkit" && record.metric === incoming.metric
          && record.provenance.sourceAppId === incoming.provenance.sourceAppId && record.provenance.metadata?.["healthkit.HKSyncIdentifier"] === syncId)) {
          const oldVersion = Number(previous.provenance.metadata?.["healthkit.HKSyncVersion"]);
          if (Number.isFinite(oldVersion) && oldVersion > syncVersion) obsolete = true;
          else if (Number.isFinite(oldVersion) && oldVersion < syncVersion && previous.status !== "deleted" && previous.status !== "superseded") {
            previous.status = "superseded"; previous.updatedAt = timestamp; report.superseded++;
          }
        }
      }
      records.push({ ...incoming, status: obsolete ? "superseded" : incoming.status, createdAt: timestamp, updatedAt: timestamp });
      report.new++;
    }
  }
  return { records, report };
}

export function createHealthKitImportService({ uid, repository, state, isCurrent, query = inspectHealthKit, now = () => new Date().toISOString() }: {
  uid: string; repository: DataRepository; state: HealthKitImportState; isCurrent: () => boolean;
  query?: (days: number) => Promise<HealthKitInspection>; now?: () => string;
}) {
  let running = false;
  let staged: HealthRecord[] = [];
  const guard = () => { if (!isCurrent()) throw new Error("Health import cancelled because the account or data mode changed"); };
  const consent = () => { guard(); if (!state.consent(uid)) throw new Error("Enable selected Apple Health cloud sync before importing"); };
  async function exclusive(action: () => Promise<HealthImportResult>) {
    if (running) throw new Error("A Health import is already running");
    running = true;
    try { guard(); return await action(); } finally { running = false; }
  }
  async function persist(samples: HealthRecord[], inspected = samples): Promise<HealthImportResult> {
    consent();
    const timestamp = now();
    const fallback = reconcileHealthKitRecords([], inspected, timestamp).report;
    staged = samples.filter(verifiedHealthKitRecord).map(persistedHealthKitRecord);
    let retained = false;
    try {
      const previous = state.pending(uid)?.records ?? [];
      // The latest query represents the same UUID; merge with pending records that
      // fall outside this query or were not returned. Missing records never delete.
      const merged = new Map(previous.map(record => [record.provenance.originalSourceId, record]));
      for (const record of samples.filter(verifiedHealthKitRecord)) merged.set(record.provenance.originalSourceId, persistedHealthKitRecord(record));
      const pending = [...merged.values()];
      staged = pending;
      state.setPending(uid, { schemaVersion: 1, uid, capturedAt: timestamp, records: pending });
      retained = true;
      const data = await repository.load([]); consent();
      const reconciliation = reconcileHealthKitRecords(data.health, pending, timestamp);
      const report = reconcileHealthKitRecords(data.health, inspected, timestamp).report;
      if (representationList(data.health) !== representationList(reconciliation.records)) {
        consent(); await repository.save("health", reconciliation.records); guard();
      }
      data.health = reconciliation.records;
      state.setLastImport(uid, timestamp);
      state.setPending(uid, null); staged = [];
      return { state: "synced", data, records: inspected, report, message: "Selected Tempdrop records saved to your private cloud account." };
    } catch {
      guard();
      return { state: "pending", records: inspected, report: fallback, message: retained
        ? "This Health import is not fully confirmed. Selected records are pending on this device; existing records are retained. Restore the connection or account access, then retry safely."
        : "Device storage could not retain this Health import. Results remain in this open view only; keep it open and retry. No cloud upload was started." };
    }
  }
  return {
    status: healthKitStatus,
    requestAuthorization: requestHealthKitAuthorization,
    consent: () => { guard(); return state.consent(uid); },
    setConsent: (enabled: boolean) => { guard(); state.setConsent(uid, enabled); },
    pendingCount: () => { guard(); return staged.length || state.pending(uid)?.records.length || 0; },
    lastImport: () => { guard(); return state.lastImport(uid); },
    inspect: () => exclusive(async () => {
      const result = await query(90); guard();
      const records = normalizeHealthKitRecords(result.records, now());
      return { state: "inspection-only", records, report: reconcileHealthKitRecords([], records, now()).report,
        message: `${result.message}${result.errors.length ? ` ${result.errors.length} category queries failed; returned records remain available for inspection.` : ""}` };
    }),
    importRecent: () => exclusive(async () => {
      consent();
      const result = await query(90); guard();
      if (!result.available || result.errors.some(error => /BasalBodyTemperature|CervicalMucusQuality|MenstrualFlow/.test(error.typeIdentifier))) throw new Error("Selected Health data could not be read. Existing and pending records were retained.");
      const records = normalizeHealthKitRecords(result.records, now());
      consent(); return persist(records);
    }),
    retryPending: () => exclusive(async () => { consent(); return persist(staged.length ? staged : state.pending(uid)?.records ?? []); }),
  };
}

function representationList(records: HealthRecord[]) { return canonical(records); }

export const healthKitInspectionService = {
  status: healthKitStatus,
  requestAuthorization: requestHealthKitAuthorization,
  async inspect(): Promise<HealthImportResult> {
    const result = await inspectHealthKit(90);
    const records = normalizeHealthKitRecords(result.records);
    return { state: "inspection-only", records, report: reconcileHealthKitRecords([], records, new Date().toISOString()).report,
      message: `${result.message}${result.errors.length ? ` ${result.errors.length} category queries failed.` : ""}` };
  },
};
