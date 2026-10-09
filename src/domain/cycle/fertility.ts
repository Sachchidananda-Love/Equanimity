import type { CycleDayLog, CycleLog } from "./types";
import { cycleStartDates } from "./observations";
import { dateOnlyDay, MILLISECONDS_PER_DAY } from "../dates/calendar";

export const FERTILITY_CALCULATION_VERSION = "fertility-observations-v1";
export const fertilityStateLabels = {
  likely: "Likely fertile",
  possible: "Possible fertile",
  lower: "Post-ovulation / lower fertility likelihood",
  uncertain: "Uncertain / insufficient data",
} as const;
export type FertilityState = keyof typeof fertilityStateLabels;
export type TemperatureShift = {
  firstHighDate: string;
  supportedOn: string;
  baselineMaximum: number;
  threshold: number;
  source: CycleDayLog["temperatureSource"];
  dates: string[];
};
export type FertilityEvidence = {
  kind: "cycle" | "calendar" | "mucus" | "test" | "temperature";
  description: string;
  dates: string[];
  sourceRecordIds: string[];
  manualOverride: boolean;
};
export type FertilityDayEstimate = {
  date: string;
  state: FertilityState;
  label: string;
  calculationVersion: typeof FERTILITY_CALCULATION_VERSION;
  cycleStart: string | null;
  cycleDay: number | null;
  calendarWindow: { start: string; end: string; lengths: number[]; irregular: boolean } | null;
  temperatureShift: TemperatureShift | null;
  peakMucusDate: string | null;
  reasons: string[];
  evidence: FertilityEvidence[];
};

const isoDay = (day: number) => new Date(day * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
const trusted = (record: CycleDayLog) => record.recordOrigin !== "sample" && record.recordOrigin !== "legacy-unverified";

/** Explicit, trusted starts plus the compatible last-period setting. An explicit
 * false/manual correction wins over that setting. Shared with journal context. */
export function fertilityCycleStartDates(log: CycleLog) {
  const excludedLastPeriod = log.history.some(record => record.date === log.lastPeriod && (!trusted(record) || value(record, "cycleDayOne") === false));
  return cycleStartDates({ ...log, lastPeriod: excludedLastPeriod ? "" : log.lastPeriod, history: log.history.filter(record => value(record, "cycleDayOne") === true) });
}

/** Fertility estimates intentionally require explicit observations, not legacy form defaults. */
function value<K extends keyof CycleDayLog>(record: CycleDayLog | undefined, field: K): CycleDayLog[K] | undefined {
  return record && trusted(record) && record.recordedFields?.includes(field) ? record[field] : undefined;
}

function reliableTemperature(record: CycleDayLog | undefined) {
  const temperature = value(record, "temperature");
  // Fever-range values must not become ovulation support, even if unflagged.
  return typeof temperature === "number" && Number.isFinite(temperature) && temperature >= 34 && temperature < 38
    && !record?.questionableTemperature && !value(record, "disturbances")?.length && !value(record, "medicationNote")
    ? temperature : null;
}

function peakMucus(record: CycleDayLog | undefined) {
  return ["Egg white", "Watery"].includes(value(record, "cervicalMucus") ?? "")
    || ["Wet", "Slippery"].includes(value(record, "mucusSensation") ?? "");
}

function lowerTypeMucus(record: CycleDayLog | undefined) {
  return ["None / dry", "Sticky"].includes(value(record, "cervicalMucus") ?? "")
    && !["Wet", "Slippery", "Damp"].includes(value(record, "mucusSensation") ?? "");
}

/** Strict app signal detector, NOT a complete/validated symptothermal contraceptive method.
 * Six consecutive baselines and three consecutive highs, all >= baseline max + 0.2°C.
 * A gap, disturbance, questionable value, source change or cycle start breaks the sequence. */
export function detectSustainedTemperatureShift(history: CycleDayLog[], throughDate: string): TemperatureShift | null {
  const end = dateOnlyDay(throughDate);
  if (end === null) return null;
  const records = new Map(history.filter(record => trusted(record) && dateOnlyDay(record.date) !== null).map(record => [record.date, record]));
  return shiftEndingOn(records, end);
}

function shiftEndingOn(records: Map<string, CycleDayLog>, end: number): TemperatureShift | null {
  const sequence = Array.from({ length: 9 }, (_, index) => records.get(isoDay(end - 8 + index)));
  const temperatures = sequence.map(reliableTemperature);
  if (temperatures.some(temperature => temperature === null) || sequence.slice(1).some(record => value(record, "cycleDayOne") === true)) return null;
  const source = sequence[0]!.temperatureSource;
  if (sequence.some(record => record?.temperatureSource !== source)) return null;
  const baselineMaximum = Math.max(...(temperatures.slice(0, 6) as number[]));
  const threshold = Number((baselineMaximum + .2).toFixed(2));
  if (!(temperatures.slice(6) as number[]).every(temperature => temperature >= threshold - 1e-8)) return null;
  return { firstHighDate: isoDay(end - 2), supportedOn: isoDay(end), baselineMaximum, threshold, source, dates: sequence.map(record => record!.date) };
}

/** App caution flag, not a diagnosis. Shared by calendar-only journal phases. */
export function cycleLengthsIrregular(lengths: number[]) {
  return lengths.length > 0 && (Math.max(...lengths) - Math.min(...lengths) > 7 || lengths.some(length => length < 26 || length > 32));
}

function preliminaryWindow(starts: string[], cycleStart: string) {
  const completed = starts.filter(start => start <= cycleStart);
  const lengths = completed.slice(1).map((start, index) => dateOnlyDay(start)! - dateOnlyDay(completed[index])!).slice(-6);
  if (lengths.length < 6 || lengths.some(length => length < 15 || length > 60)
    || dateOnlyDay(completed.at(-7)!)! < dateOnlyDay(cycleStart)! - 366) return null;
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  const start = dateOnlyDay(cycleStart)!;
  return {
    start: isoDay(start + Math.max(1, shortest - 18) - 1),
    end: isoDay(start + longest - 11 - 1),
    lengths,
    // This is an app caution flag, not a diagnosis of an irregular-cycle disorder.
    irregular: cycleLengthsIrregular(lengths),
  };
}

/** Pure, causal view calculation: uses the already-selected display observations, never
 * writes records and never reads observations or period starts from a later date.
 * Calculate over full saved history so changing the chart's range cannot alter a state. */
export function deriveFertilityTimeline(log: CycleLog, dates: string[]): FertilityDayEstimate[] {
  const requested = dates.filter(date => dateOnlyDay(date) !== null);
  if (!requested.length) return [];
  const end = Math.max(...requested.map(date => dateOnlyDay(date)!));
  const history = log.history.filter(record => trusted(record) && dateOnlyDay(record.date) !== null && dateOnlyDay(record.date)! <= end).sort((a, b) => a.date.localeCompare(b.date));
  const records = new Map(history.map(record => [record.date, record]));
  const starts = fertilityCycleStartDates(log).filter(date => dateOnlyDay(date)! <= end);
  const first = Math.min(...requested.map(date => dateOnlyDay(date)!), ...history.map(record => dateOnlyDay(record.date)!), ...starts.map(date => dateOnlyDay(date)!));
  const wanted = new Set(requested);
  const results = new Map<string, FertilityDayEstimate>();
  let cycleStart: string | null = null;
  let calendarWindow: FertilityDayEstimate["calendarWindow"] = null;
  let shift: TemperatureShift | null = null;
  let lastPeak: string | null = null;
  let lastPositive: string | null = null;
  let unresolvedSignal = false;
  let invalidatedOn: string | null = null;
  let pregnancyObserved = false;

  const evidence = (kind: FertilityEvidence["kind"], description: string, evidenceDates: string[], fields: (keyof CycleDayLog)[]): FertilityEvidence => ({
    kind, description, dates: evidenceDates,
    sourceRecordIds: [...new Set(evidenceDates.flatMap(date => fields.flatMap(field => records.get(date)?.healthSourceRecordIds?.[field] ?? [])))],
    manualOverride: evidenceDates.some(date => records.get(date)?.temperatureDisplayOverride === true && fields.includes("temperature")),
  });

  for (let day = first; day <= end; day += 1) {
    const date = isoDay(day);
    const record = records.get(date);
    if (starts.includes(date)) {
      cycleStart = date;
      calendarWindow = preliminaryWindow(starts.filter(start => start <= date), date);
      shift = null; lastPeak = null; lastPositive = null; unresolvedSignal = false; invalidatedOn = null; pregnancyObserved = false;
    }
    const cycleDay = cycleStart ? day - dateOnlyDay(cycleStart)! + 1 : null;
    const mucus = value(record, "cervicalMucus");
    const sensation = value(record, "mucusSensation");
    const test = value(record, "ovulationTest");
    const flow = value(record, "flow");
    const bleeding = flow !== undefined && flow !== "None";
    const peak = peakMucus(record);
    const positive = test === "Positive" || test === "Peak";
    const otherSignal = (mucus !== undefined && mucus !== "None / dry") || sensation === "Damp" || test === "High";
    if (peak) lastPeak = date;
    if (positive) lastPositive = date;
    if (peak || positive || otherSignal) unresolvedSignal = true;

    const temperature = reliableTemperature(record);
    // Never carry lower likelihood through missing/conflicting evidence. A later
    // candidate needs a NEW first high day after the invalidating observation.
    if (shift && (peak || positive || test === "High" || bleeding || temperature === null
      || record?.temperatureSource !== shift.source || temperature < shift.threshold - 1e-8)) {
      shift = null; invalidatedOn = date; unresolvedSignal = true;
    }
    if (!shift && cycleStart) {
      const candidate = shiftEndingOn(records, day);
      if (candidate && candidate.dates[0] >= cycleStart && (!invalidatedOn || candidate.firstHighDate > invalidatedOn)) shift = candidate;
    }
    const postPeakDays = lastPeak ? day - dateOnlyDay(lastPeak)! : null;
    const lowerMucusSequence = postPeakDays !== null && postPeakDays >= 4
      && Array.from({ length: postPeakDays }, (_, index) => records.get(isoDay(dateOnlyDay(lastPeak!)! + index + 1))).every(lowerTypeMucus);
    const recentPositive = lastPositive !== null && day - dateOnlyDay(lastPositive)! <= 2;
    const inCalendarWindow = Boolean(calendarWindow && date >= calendarWindow.start && date <= calendarWindow.end);
    const lower = Boolean(shift && date > shift.supportedOn && lowerMucusSequence && !recentPositive && !bleeding && !peak && !positive && test !== "High");
    let state: FertilityState = "uncertain";
    const reasons: string[] = [];
    if (peak || recentPositive) {
      state = "likely";
      reasons.push(peak ? "Fertile-type mucus or wet/slippery sensation is recorded." : "A positive/peak ovulation test is recorded within the last two days.");
      if (invalidatedOn === date) reasons.push("New fertility signs conflict with the earlier temperature rise; lower likelihood is suspended.");
    } else if (lower) {
      state = "lower";
      unresolvedSignal = false;
      reasons.push("A sustained temperature rise and continued lower-type mucus support a retrospective post-ovulation pattern, not confirmed infertility.");
    } else if (otherSignal || unresolvedSignal || inCalendarWindow) {
      state = "possible";
      reasons.push(otherSignal ? "Mucus, sensation or a high ovulation test suggests possible fertility." : unresolvedSignal ? "An earlier fertility signal remains unresolved; missing or conflicting observations cannot close the window." : "This date falls in the preliminary window from recorded cycle lengths.");
    } else {
      reasons.push(cycleStart ? "Cycle timing or dry observations alone cannot establish lower fertility likelihood." : "A recorded cycle start and sufficient physiologic observations are not available.");
    }
    if (!calendarWindow) reasons.push("No calendar forecast: six recent completed recorded cycles are required; default average-cycle settings are not used.");
    else if (calendarWindow.irregular) reasons.push("Recorded cycle lengths vary or fall outside 26–32 days; the broad calendar estimate is especially uncertain.");
    if (state !== "lower") {
      if (temperature === null) reasons.push("Temperature is missing or not usable (questionable, disturbed or fever-range) on this date.");
      if (mucus === undefined) reasons.push("Cervical mucus is not explicitly recorded on this date.");
      if (shift) reasons.push("Temperature rise detected; waiting for complete post-peak mucus observations before considering lower likelihood.");
      if (bleeding) reasons.push("Bleeding may obscure mucus; it does not identify an infertile day or establish a new cycle without a recorded start.");
    }
    if (value(record, "pregnancyTest") === "Positive") pregnancyObserved = true;
    if (pregnancyObserved) {
      state = "uncertain";
      reasons.unshift("A positive pregnancy test makes a cycle-based fertility estimate inappropriate.");
      shift = null; unresolvedSignal = true; invalidatedOn = date;
    }

    if (!wanted.has(date)) continue;
    const inputs: FertilityEvidence[] = [];
    if (cycleStart) inputs.push(evidence("cycle", `Recorded cycle start: ${cycleStart}.`, [cycleStart], ["cycleDayOne", "flow"]));
    if (calendarWindow) inputs.push(evidence("calendar", `Last six completed cycles: ${calendarWindow.lengths.join(", ")} days; shortest − 18 to longest − 11.`, starts.filter(start => start <= cycleStart!).slice(-7), ["cycleDayOne"]));
    if (mucus !== undefined || sensation !== undefined) inputs.push(evidence("mucus", `Recorded mucus: ${mucus ?? "not recorded"}; sensation: ${sensation ?? "not recorded"}.`, [date], ["cervicalMucus", "mucusSensation"]));
    if (lastPeak && lastPeak !== date) {
      const peakDay = dateOnlyDay(lastPeak)!;
      const mucusDates = lowerMucusSequence ? Array.from({ length: day - peakDay + 1 }, (_, index) => isoDay(peakDay + index)) : [lastPeak];
      inputs.push(evidence("mucus", `Latest recorded fertile-type mucus: ${lastPeak}; ${postPeakDays} calendar days since. ${lowerMucusSequence ? "Every subsequent day has explicitly recorded lower-type mucus." : "A complete post-peak lower-type mucus sequence is not available."}`, mucusDates, ["cervicalMucus", "mucusSensation"]));
    }
    if (lastPositive && recentPositive) inputs.push(evidence("test", `Positive/peak test: ${lastPositive}; suggests an LH surge, not proof of ovulation.`, [lastPositive], ["ovulationTest"]));
    else if (test !== undefined && test !== "Not tested") inputs.push(evidence("test", `Recorded ovulation test: ${test}. A negative result does not rule out fertility.`, [date], ["ovulationTest"]));
    if (shift) inputs.push(evidence("temperature", `Six consecutive baseline readings followed by three readings ≥ ${shift.threshold.toFixed(2)}°C; rise supported on ${shift.supportedOn} (${shift.source}).`, shift.dates, ["temperature"]));
    if (shift && date > shift.supportedOn) {
      const supportDay = dateOnlyDay(shift.supportedOn)!;
      const continuedDates = Array.from({ length: day - supportDay }, (_, index) => isoDay(supportDay + index + 1));
      inputs.push(evidence("temperature", `Temperature continues at or above the rise threshold through ${date}, with the same recorded source label.`, continuedDates, ["temperature"]));
    }
    if (record?.temperatureDisplayOverride && value(record, "temperature") !== undefined) inputs.push(evidence("temperature", "The existing explicit manual temperature display override is used; imported source records are unchanged.", [date], ["temperature"]));
    results.set(date, { date, state, label: fertilityStateLabels[state], calculationVersion: FERTILITY_CALCULATION_VERSION, cycleStart, cycleDay, calendarWindow, temperatureShift: shift ? { ...shift, dates: [...shift.dates] } : null, peakMucusDate: lastPeak, reasons, evidence: inputs });
  }
  return dates.flatMap(date => results.has(date) ? [results.get(date)!] : []);
}

export function deriveFertilityDay(log: CycleLog, date: string) {
  return deriveFertilityTimeline(log, [date])[0];
}
