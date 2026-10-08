import type { CycleLog, CycleDayLog } from "./types";
import { dateOnlyDay, displayDay } from "../dates/calendar";
import { cycleFieldRecorded } from "./observations";
import { detectSustainedTemperatureShift } from "./fertility";
export { cycleFieldRecorded } from "./observations";

export function cycleFieldText(record: CycleDayLog | undefined, field: keyof CycleDayLog) {
  if (!record || !cycleFieldRecorded(record, field) || record[field] === undefined) return "Not recorded";
  const value = record[field];
  return Array.isArray(value) ? value.length ? value.join(", ") : "None" : String(value);
}
export function cycleSummary(log: CycleLog, at: Date) {
  const lastDay = dateOnlyDay(log.lastPeriod);
  if (lastDay === null) return { day: 0, phase: "Cycle not recorded", nextPeriodIn: 0, fertileText: "Log a period start to see app-derived estimates", provenance: "app-derived-estimate" as const };
  const day = Math.max(1, lastDay === null ? 1 : displayDay(at.getTime()) - lastDay + 1);
  const ovulation = Math.max(8, log.averageCycle - 14); const fertileStart = ovulation - 5;
  const phase = day <= log.averagePeriod ? "Menstrual phase" : day < ovulation - 1 ? "Follicular phase" : day <= ovulation + 1 ? "Ovulation window" : "Luteal phase";
  return { provenance: "app-derived-estimate" as const, day, phase, nextPeriodIn: Math.max(0, log.averageCycle - day + 1), fertileText: day < fertileStart ? `Fertile window estimated in ${fertileStart - day} days` : day <= ovulation + 1 ? "Within estimated fertile window" : "Estimated fertile window has passed" };
}

export function deriveCycleInsights(history: CycleDayLog[]) {
  history = history.filter(record => record.recordOrigin !== "sample");
  // The compatibility form carries defaults; unknown fields cannot be inputs.
  const temperatureHistory = history.filter(record => cycleFieldRecorded(record, "temperature"));
  const mucusHistory = history.filter(record => cycleFieldRecorded(record, "cervicalMucus"));
  const sleepHistory = history.filter(record => cycleFieldRecorded(record, "sleepMinutes"));
  const symptomHistory = history.filter(record => cycleFieldRecorded(record, "symptoms"));
  const latestTemperatureDate = temperatureHistory.map(item => item.date).sort().at(-1);
  const shift = latestTemperatureDate ? detectSustainedTemperatureShift(temperatureHistory, latestTemperatureDate) : null;
  const coverline = shift?.threshold ?? null;
  const sustainedShift = shift !== null;
  const peakMucus = [...mucusHistory].sort((a, b) => b.date.localeCompare(a.date)).find((item) => item.cervicalMucus === "Egg white" || item.cervicalMucus === "Watery"); const sleep = sleepHistory.map((item) => item.sleepMinutes).filter((value): value is number => typeof value === "number"); const symptomCounts = new Map<string, number>(); symptomHistory.forEach((item) => item.symptoms.forEach((symptom) => symptomCounts.set(symptom, (symptomCounts.get(symptom) ?? 0) + 1))); const commonSymptoms = [...symptomCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([symptom]) => symptom);
  return { provenance: "app-derived-estimate" as const, coverline, sustainedShift, peakMucus, averageSleep: sleep.length ? Math.round(sleep.reduce((sum, value) => sum + value, 0) / sleep.length) : null, commonSymptoms };
}
