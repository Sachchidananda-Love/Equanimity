import type { CycleDayLog, CycleLog } from "../domain/cycle/types";
import type { DailyHealthSummary, HealthMetric, HealthRecord, HealthValue } from "../domain/health/types";
import type { ApplicationRepository } from "./repository-contracts";
import { DISPLAY_TIME_ZONE } from "../domain/dates/calendar";
import { verifiedHealthKitRecord } from "../domain/health/import-policy";
import { createCycleDraft } from "../domain/cycle/records";

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
      ...(field === "temperature" && log.temperatureDisplayOverride ? { displayOverride: true } : {}),
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
      return dailyHealthSummary(repository.load([]).health.filter(record => record.timeZone === timeZone), date, timeZone);
    },
  };
}

export function selectDailyHealthRecords(records: HealthRecord[], date: string): Partial<Record<HealthMetric, HealthRecord>> {
  const selected: Partial<Record<HealthMetric, HealthRecord>> = {};
  const priority = (record: HealthRecord) => {
    if (record.provenance.ingestion === "manual") return record.metric === "basal-temperature" ? record.displayOverride ? 3 : 1 : 3;
    return verifiedHealthKitRecord(record) ? 2 : 0;
  };
  const candidates = records.filter(record => record.localDate === date && ["recorded", "questionable"].includes(record.status) && priority(record))
    .sort((a, b) => priority(a) - priority(b)
      || (a.observedAt ?? a.startAt ?? a.updatedAt).localeCompare(b.observedAt ?? b.startAt ?? b.updatedAt)
      || a.id.localeCompare(b.id));
  for (const record of candidates) selected[record.metric] = record;
  return selected;
}

export function dailyHealthSummary(records: HealthRecord[], date: string, timeZone: string): DailyHealthSummary {
  const values: DailyHealthSummary["values"] = {};
  for (const [metric, record] of Object.entries(selectDailyHealthRecords(records, date))) {
    values[metric as HealthMetric] = { value: record.value, sourceRecordIds: [record.id] };
  }
  return { localDate: date, timeZone, schemaVersion: 1, calculationVersion: "tempdrop-manual-selection-v2",
    values, sourceRecordIds: Object.values(values).flatMap(value => value?.sourceRecordIds ?? []), computedAt: new Date().toISOString() };
}

/** A view projection only. Source records and manually saved cycle events stay intact. */
export function cycleDisplayLog(log: CycleLog, health: HealthRecord[]): CycleLog {
  const sources = [...health];
  for (const day of log.history.filter(record => record.recordOrigin === "user")) {
    for (const record of manualHealthRecords(day, `${day.date}T12:00:00.000Z`)) if (!sources.some(source => source.id === record.id)) sources.push(record);
  }
  const days = new Map(log.history.map(day => [day.date, structuredClone(day)]));
  for (const date of new Set(sources.map(record => record.localDate))) {
    const selected = selectDailyHealthRecords(sources, date);
    if (!Object.keys(selected).length) continue;
    const day = days.get(date) ?? createCycleDraft(date, `health-summary:${date}`);
    const fields = new Set(day.recordedFields ?? Object.keys(day));
    const ids: Record<string, string[]> = {};
    const temperature = selected["basal-temperature"];
    if (temperature?.value.kind === "quantity" && temperature.value.unit === "Cel") {
      day.temperature = temperature.value.value;
      day.temperatureSource = temperature.provenance.provider.toLowerCase() === "tempdrop" ? "Tempdrop" : day.temperatureSource;
      day.questionableTemperature = temperature.status === "questionable";
      fields.add("temperature"); ids.temperature = [temperature.id];
    }
    const mucus = selected["cervical-mucus"];
    if (mucus?.value.kind === "category" && ["None / dry", "Sticky", "Creamy", "Watery", "Egg white"].includes(mucus.value.value)) {
      day.cervicalMucus = mucus.value.value as CycleDayLog["cervicalMucus"]; fields.add("cervicalMucus"); ids.cervicalMucus = [mucus.id];
    }
    const flow = selected["menstrual-flow"];
    if (flow?.value.kind === "category" && ["None", "Spotting", "Light", "Medium", "Heavy"].includes(flow.value.value)) {
      day.flow = flow.value.value as CycleDayLog["flow"]; fields.add("flow"); ids.flow = [flow.id];
    }
    if (!days.has(date) && !Object.keys(ids).length) continue;
    day.recordedFields = [...fields]; day.healthSourceRecordIds = ids;
    if (Object.values(selected).some(record => record.provenance.ingestion === "healthkit")) day.recordOrigin = "health-summary";
    days.set(date, day);
  }
  const history = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const latestTemperature = [...history].reverse().find(day => typeof day.temperature === "number" && day.recordedFields?.includes("temperature"));
  return { ...log, history, temperature: latestTemperature?.temperature ?? log.temperature };
}
