import type { CycleDayLog, CycleLog } from "./types";
import { createRecordId } from "../ids";

/** Defaults support the existing controls, but are not recorded observations. */
export function createCycleDraft(date: string, id = createRecordId()): CycleDayLog {
  return { id, date, flow: "None", cycleDayOne: false, recordOrigin: "user", recordedFields: [], temperatureSource: "Manual", questionableTemperature: false, cervicalMucus: "None / dry", mucusSensation: "Dry", cervixPosition: "Medium", cervixFirmness: "Medium", cervixOpening: "Medium", ovulationTest: "Not tested", pregnancyTest: "Not tested", intercourse: false, symptoms: [], energy: 50, sexDrive: 50, pms: 0, disturbances: [] };
}

export function updateCycleField<K extends keyof CycleDayLog>(current: CycleDayLog, key: K, value: CycleDayLog[K]): CycleDayLog {
  const fields = current.recordedFields ?? [];
  // A legacy default of Tempdrop is not evidence of a Tempdrop measurement.
  const source = key === "temperature" && current.temperatureSource === "Tempdrop" && !fields.includes("temperatureSource") ? "Manual" : current.temperatureSource;
  return { ...current, recordOrigin: "user", recordedFields: [...new Set([...fields, key])], temperatureSource: source, [key]: value };
}

export function saveCycleDraft(log: CycleLog, draft: CycleDayLog, averageCycle: number, averagePeriod: number): CycleLog {
  const sameDate = log.history.find(record => record.date === draft.date);
  let edited = draft;
  if (sameDate && sameDate.id !== draft.id) {
    // Selecting another existing date must not replace its untouched observations.
    edited = { ...sameDate, recordOrigin: "user", recordedFields: [...new Set([...(sameDate.recordedFields ?? []), ...(draft.recordedFields ?? [])])] };
    for (const field of draft.recordedFields ?? []) Object.assign(edited, { [field]: draft[field as keyof CycleDayLog] });
    if (draft.recordedFields?.includes("temperature")) edited.temperatureSource = draft.temperatureSource;
  }
  // Changing the date must not duplicate an old ID across two daily records.
  const record = { ...edited, id: sameDate?.id ?? (log.history.some(item => item.id === draft.id) ? createRecordId() : draft.id) };
  const history = [...log.history.filter(item => item.date !== record.date), record].sort((a, b) => a.date.localeCompare(b.date));
  return { ...log, lastPeriod: record.cycleDayOne ? record.date : log.lastPeriod, averageCycle, averagePeriod, flow: record.flow, symptoms: record.symptoms, temperature: record.temperature, history };
}
