import type { CycleDayLog, CycleLog } from "./types";
import { recordedCycleValue, cycleStartDates } from "./observations";
import { dateOnlyDay, MILLISECONDS_PER_DAY } from "../dates/calendar";

export { recordedCycleValue, cycleStartDates } from "./observations";

export type CycleChartDay = { date: string; record?: CycleDayLog; cycleDay: number | null; cycleStart: boolean };

/** Calendar spacing includes days without a measurement. A cycle day requires a recorded start. */
export function cycleChartDays(log: CycleLog, history: CycleDayLog[]): CycleChartDay[] {
  const sorted = history.filter(day => dateOnlyDay(day.date) !== null && day.recordOrigin !== "sample").sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];
  const starts = cycleStartDates(log);
  const records = new Map(sorted.map(record => [record.date, record]));
  const first = dateOnlyDay(sorted[0].date)!;
  const last = dateOnlyDay(sorted.at(-1)!.date)!;
  let startIndex = -1;
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const day = first + index;
    const date = new Date(day * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
    while (starts[startIndex + 1] && starts[startIndex + 1] <= date) startIndex += 1;
    const start = startIndex >= 0 ? dateOnlyDay(starts[startIndex]) : null;
    return { date, record: records.get(date), cycleDay: start === null ? null : day - start + 1, cycleStart: starts.includes(date) };
  });
}

export function cycleTemperatureScale(history: CycleDayLog[]) {
  const temperatures = history.flatMap(day => {
    const value = recordedCycleValue(day, "temperature");
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
  const low = temperatures.length ? Math.min(...temperatures) : 36.2;
  const high = temperatures.length ? Math.max(...temperatures) : 36.8;
  const step = high - low > 1.2 ? .2 : .1;
  const min = Math.floor((low - .1) / step) * step;
  const max = Math.max(min + .6, Math.ceil((high + .1) / step) * step);
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => Number((max - index * step).toFixed(2)));
  return { min, max, ticks, position: (temperature: number) => 6 + (max - temperature) / (max - min) * 88 };
}

/** Missing calendar days and unrecorded temperatures break the line. */
export function cycleTemperatureSegments(days: CycleChartDay[], position: (value: number) => number) {
  return days.flatMap((day, index) => {
    const temperature = recordedCycleValue(day.record, "temperature");
    const previous = recordedCycleValue(days[index - 1]?.record, "temperature");
    if (!index || typeof temperature !== "number" || typeof previous !== "number") return [];
    return [{ from: { x: (index - .5) / days.length * 100, y: position(previous) }, to: { x: (index + .5) / days.length * 100, y: position(temperature) }, questionable: Boolean(day.record?.questionableTemperature || days[index - 1].record?.questionableTemperature) }];
  });
}

export const cycleObservationFields: { field: keyof CycleDayLog; label: string; group: "Cycle" | "Body" | "Sleep" | "Notes" }[] = [
  { field: "flow", label: "Menses", group: "Cycle" },
  { field: "cervicalMucus", label: "Cervical mucus", group: "Cycle" },
  { field: "mucusSensation", label: "Sensation", group: "Cycle" },
  { field: "cervixPosition", label: "Cervix position", group: "Cycle" },
  { field: "cervixFirmness", label: "Cervix firmness", group: "Cycle" },
  { field: "cervixOpening", label: "Cervix opening", group: "Cycle" },
  { field: "ovulationTest", label: "Ovulation test", group: "Cycle" },
  { field: "pregnancyTest", label: "Pregnancy test", group: "Cycle" },
  { field: "intercourse", label: "Intercourse", group: "Cycle" },
  { field: "symptoms", label: "Symptoms", group: "Body" },
  { field: "energy", label: "Energy", group: "Body" },
  { field: "sexDrive", label: "Sex drive", group: "Body" },
  { field: "pms", label: "PMS", group: "Body" },
  { field: "sleepMinutes", label: "Sleep", group: "Sleep" },
  { field: "sleepScore", label: "Sleep score", group: "Sleep" },
  { field: "deepSleepMinutes", label: "Deep sleep", group: "Sleep" },
  { field: "sleepLatencyMinutes", label: "Sleep latency", group: "Sleep" },
  { field: "sleepInterruptions", label: "Awakenings", group: "Sleep" },
  { field: "disturbances", label: "Disturbances", group: "Notes" },
  { field: "medicationNote", label: "Medication", group: "Notes" },
  { field: "notes", label: "Notes", group: "Notes" },
];

export function cycleObservationText(record: CycleDayLog | undefined, field: keyof CycleDayLog) {
  const value = recordedCycleValue(record, field);
  if (value === undefined) return "Not recorded";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "temperature") return `${Number(value).toFixed(2)}°C`;
  if (["energy", "sexDrive", "pms", "sleepScore"].includes(field)) return `${value}/100`;
  if (field === "sleepMinutes" || field === "deepSleepMinutes") return `${Math.floor(Number(value) / 60)}h ${Number(value) % 60}m`;
  if (field === "sleepLatencyMinutes") return `${value} min`;
  return String(value) || "None";
}
