import type { HealthRecord } from "./types";

export const VERIFIED_HEALTHKIT_METRICS = ["basal-temperature", "cervical-mucus", "menstrual-flow"] as const;
export const HEALTHKIT_PERSISTED_METADATA = [
  "sourceName", "sourceVersion", "sourceProductType", "name", "manufacturer", "model",
  "hardwareVersion", "firmwareVersion", "softwareVersion", "localIdentifier",
  "healthkit.HKTimeZone", "healthkit.HKWasUserEntered", "healthkit.HKMenstrualCycleStart",
  "healthkit.HKMetadataKeyMenstrualCycleStart", "healthkit.HKSyncIdentifier", "healthkit.HKSyncVersion",
] as const;

/** Attribution comes from the writing application's identity, never the metric. */
export function healthKitProvider(name: string, bundle: string): string {
  if (/tempdrop/i.test(name) || /(?:^|[.-])tempdrop(?:[.-]|$)/i.test(bundle)) return "Tempdrop";
  if (/^com\.apple\./i.test(bundle)) return "Apple";
  return "other source";
}

export function verifiedHealthKitRecord(record: HealthRecord): boolean {
  return record.provenance.ingestion === "healthkit"
    && VERIFIED_HEALTHKIT_METRICS.some(metric => record.metric === metric)
    && record.provenance.provider === "Tempdrop"
    && healthKitProvider(record.provenance.metadata?.sourceName ?? "", record.provenance.sourceAppId ?? "") === "Tempdrop";
}

/** Explicit allowlist: inspection metadata is richer than the persisted payload. */
export function persistedHealthKitRecord(record: HealthRecord): HealthRecord {
  return {
    id: record.id, schemaVersion: 1, metric: record.metric, value: structuredClone(record.value),
    observedAt: record.observedAt, startAt: record.startAt, endAt: record.endAt,
    localDate: record.localDate, timeZone: record.timeZone, status: record.status,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    provenance: {
      provider: record.provenance.provider, ingestion: "healthkit", originalSourceId: record.provenance.originalSourceId,
      sourceAppId: record.provenance.sourceAppId, sourceDeviceId: record.provenance.sourceDeviceId,
      method: record.provenance.method, storage: "cloud",
      metadata: Object.fromEntries(HEALTHKIT_PERSISTED_METADATA.flatMap(key => {
        const value = record.provenance.metadata?.[key];
        return value === undefined ? [] : [[key, value]];
      })),
    },
  };
}
