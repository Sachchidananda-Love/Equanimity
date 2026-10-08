import type { CycleDayLog, CycleLog } from "./types";
import { dateOnlyDay } from "../dates/calendar";

export function cycleFieldRecorded(record: CycleDayLog | undefined, field: keyof CycleDayLog) {
  return Boolean(record && (record.recordedFields === undefined || record.recordedFields.includes(field)));
}

export function recordedCycleValue<K extends keyof CycleDayLog>(record: CycleDayLog | undefined, field: K): CycleDayLog[K] | undefined {
  return record && cycleFieldRecorded(record, field) ? record[field] : undefined;
}

export function cycleStartDates(log: CycleLog) {
  return [...new Set([
    ...(dateOnlyDay(log.lastPeriod) !== null ? [log.lastPeriod] : []),
    ...log.history.filter(day => recordedCycleValue(day, "cycleDayOne") === true && day.recordOrigin !== "sample" && dateOnlyDay(day.date) !== null).map(day => day.date),
  ])].sort();
}
