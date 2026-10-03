import type { CycleDayLog } from "../domain/cycle/types";
import type { DailyHealthSummary, HealthMetric, HealthRecord, HealthValue } from "../domain/health/types";
import type { ApplicationRepository } from "./repository-contracts";
import { DISPLAY_TIME_ZONE } from "../domain/dates/calendar";

/** The compatibility daily form is not a source summary. Only explicit fields
 * become source records; defaults on untouched controls never do. */
export function manualHealthRecords(log: CycleDayLog, updatedAt: string, existing: HealthRecord[] = []): HealthRecord[] {
  const fields: Record<string, { metric: HealthMetric; unit: string }> = {
    temperature: { metric: "basal-temperature", unit: "Cel" }, flow: { metric: "menstrual-flow", unit: "category" },
    cervicalMucus: { metric: "cervical-mucus", unit: "category" }, mucusSensation: { metric: "mucus-sensation", unit: "category" },
    cervixPosition: { metric: "cervix-position", unit: "category" }, cervixFirmness: { metric: "cervix-firmness", unit: "category" }, cervixOpening: { metric: "cervix-opening", unit: "category" },
    ovulationTest: { metric: "ovulation-test", unit: "category" }, pregnancyTest: { metric: "pregnancy-test", unit: "category" }, intercourse: { metric: "intercourse", unit: "boolean" },
    symptoms: { metric: "symptoms", unit: "category" }, disturbances: { metric: "disturbances", unit: "category" },
    energy: { metric: "energy", unit: "score/100" }, sexDrive: { metric: "sex-drive", unit: "score/100" }, pms: { metric: "pms", unit: "score/100" },
    sleepScore: { metric: "sleep-score", unit: "score" }, sleepMinutes: { metric: "sleep-duration", unit: "min" }, deepSleepMinutes: { metric: "sleep-stage", unit: "min" }, sleepLatencyMinutes: { metric: "sleep-latency", unit: "min" }, sleepInterruptions: { metric: "sleep-interruptions", unit: "count" },
  };
  return (log.recordedFields ?? []).flatMap(field => {
    const spec = fields[field]; const raw = log[field as keyof CycleDayLog];
    if (!spec || raw === undefined || raw === null) return [];
    let value: HealthValue;
    if (typeof raw === "number") value = { kind: "quantity", value: raw, unit: spec.unit };
    else if (typeof raw === "boolean") value = { kind: "boolean", value: raw, unit: "boolean" };
    else if (Array.isArray(raw)) value = { kind: "list", value: raw, unit: "category" };
    else value = { kind: "category", value: String(raw), unit: "category" };
    const id = `manual:${typeof log.id}:${log.id}:${field}`; const previous = existing.find(r => r.id === id);
    const source = log.temperatureSource;
    const method = field === "temperature" ? source === "Tempdrop" ? "processed-overnight-transcribed" : source.toLowerCase() : field === "deepSleepMinutes" ? "deep-sleep-total" : undefined;
    return [{ id, schemaVersion: 1 as const, metric: spec.metric, value, localDate: log.date, timeZone: DISPLAY_TIME_ZONE,
      provenance: { provider: field === "temperature" && source === "Tempdrop" ? "tempdrop" : "manual", ingestion: "manual" as const, originalSourceId: String(log.id), ...(method ? { method } : {}) },
      status: field === "temperature" && log.questionableTemperature ? "questionable" as const : "recorded" as const,
      createdAt: previous?.createdAt ?? updatedAt, updatedAt }];
  });
}

/** Future provider imports and aggregation are implemented behind this boundary. */
export interface HealthService {
  sourceRecords(): HealthRecord[];
  dailySummary(date: string, timeZone: string): DailyHealthSummary;
}

/** Clearing a previously recorded field retains a source tombstone, not deletion. */
export function reconcileManualHealthRecords(log: CycleDayLog, existing: HealthRecord[], timestamp: string): HealthRecord[] {
  const prefix = `manual:${typeof log.id}:${log.id}:`;
  const next = manualHealthRecords(log, timestamp, existing);
  return [...existing.filter(record => !record.id.startsWith(prefix)), ...existing.filter(record => record.id.startsWith(prefix) && !next.some(item => item.id === record.id)).map(record => ({ ...record, status: "deleted" as const, updatedAt: timestamp })), ...next];
}
export function createHealthService(repository: ApplicationRepository): HealthService {
  return {
    sourceRecords: () => repository.load([]).health,
    dailySummary: (date, timeZone) => {
      const records = repository.load([]).health.filter(r => r.localDate === date && r.timeZone === timeZone && r.status !== "deleted" && r.status !== "superseded" && r.status !== "legacy-unverified");
      const values: DailyHealthSummary["values"] = {};
      // Only explicit manual records exist in phase 1. Provider-specific selection
      // and sleep-overlap policies must precede enabling external imports.
      for (const record of records.filter(r => r.provenance.ingestion === "manual").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) values[record.metric] = { value: record.value, sourceRecordIds: [record.id] };
      return { localDate: date, timeZone, schemaVersion: 1, calculationVersion: "manual-selection-v1", sourceRecordIds: Object.values(values).flatMap(v => v?.sourceRecordIds ?? []), values, computedAt: new Date().toISOString() };
    },
  };
}
