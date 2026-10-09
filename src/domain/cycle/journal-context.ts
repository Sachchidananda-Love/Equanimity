import type { CycleLog } from "./types";
import { cycleSummary } from "./calculations";
import { deriveFertilityTimeline, fertilityCycleStartDates, cycleLengthsIrregular, type FertilityDayEstimate } from "./fertility";
import { dateOnlyDay, dateOnlyTimestamp } from "../dates/calendar";

export type JournalCycleContext = {
  date: string | null;
  cycleDay: number | null;
  cycleStart: string | null;
  label: string;
  basis: "observed" | "estimated" | "uncertain";
  observations: string[];
  fertility: FertilityDayEstimate | null;
};

/** Read-only historical context, not a contraception forecast. Later recorded
 * starts can refine a completed cycle's calendar phase, but future physiology
 * never retroactively confirms ovulation or changes the causal fertility state.
 * Batch once per journal view, rather than scanning full history for every card. */
export function deriveJournalCycleContexts(log: CycleLog, dates: (string | null)[]): JournalCycleContext[] {
  const validDates = [...new Set(dates.filter((date): date is string => date !== null && dateOnlyDay(date) !== null))];
  const estimates = new Map(deriveFertilityTimeline(log, validDates).map(estimate => [estimate.date, estimate]));
  const starts = fertilityCycleStartDates(log);
  return dates.map(date => {
    const fertility = date ? estimates.get(date) ?? null : null;
    const cycleDay = fertility?.cycleDay ?? null, cycleStart = fertility?.cycleStart ?? null;
    const context: JournalCycleContext = { date, cycleDay, cycleStart, label: "Cycle context uncertain", basis: "uncertain", observations: [], fertility };
    if (!fertility) return context;
    const record = log.history.find(day => day.date === date && day.recordOrigin !== "sample" && day.recordOrigin !== "legacy-unverified");
    const flow = record?.recordedFields?.includes("flow") ? record.flow : undefined;
    if (flow !== undefined) context.observations.push(`${flow} flow observed`);
    if (record?.recordedFields?.includes("cycleDayOne") && record.cycleDayOne) context.observations.push("Period start observed");
    for (const input of fertility.evidence.filter(input => (input.kind === "mucus" || input.kind === "test") && input.dates.includes(date!))) context.observations.push(input.description);

    function label(detail: string, basis: JournalCycleContext["basis"] = "estimated") {
      context.label = cycleDay === null ? detail : `Cycle day ${cycleDay} · ${detail}`;
      context.basis = basis;
      return context;
    }
    // A positive pregnancy observation suspends cycle-based interpretation.
    if (fertility.reasons.some(reason => reason.startsWith("A positive pregnancy test"))) return label("cycle context uncertain", "uncertain");
    if (fertility.state === "likely") return label("likely fertile");
    if (flow === "Light" || flow === "Medium" || flow === "Heavy") return label("menstrual flow observed", "observed");
    if (flow === "Spotting") return label("spotting observed · phase uncertain", "observed");
    if (context.observations.includes("Period start observed")) return label("period start observed", "observed");
    if (fertility.state === "lower") return label("post-ovulation estimate");
    if (fertility.state === "possible") return label("possible fertile");
    if (fertility.temperatureShift) return label("post-ovulation estimate");
    if (cycleStart === null || cycleDay === null) return context;

    const priorStarts = starts.filter(start => start <= cycleStart);
    const lengths = priorStarts.slice(1).map((start, index) => dateOnlyDay(start)! - dateOnlyDay(priorStarts[index])!).slice(-6);
    const nextStart = starts.find(start => start > date!);
    const completedLength = nextStart ? dateOnlyDay(nextStart)! - dateOnlyDay(cycleStart)! : null;
    const usable = (length: number) => Number.isFinite(length) && length >= 15 && length <= 60;
    const irregular = fertility.calendarWindow?.irregular || cycleLengthsIrregular([...lengths, ...(completedLength === null ? [] : [completedLength])]);
    const recentLength = lengths.length ? Math.round(lengths.reduce((sum, length) => sum + length, 0) / lengths.length) : log.averageCycle;
    const length = completedLength ?? recentLength;
    if (irregular || !usable(length) || cycleDay > length) return label("phase uncertain", "uncertain");
    const summary = cycleSummary({ ...log, lastPeriod: cycleStart, averageCycle: length }, new Date(dateOnlyTimestamp(date!)));
    const phase = summary.phase === "Menstrual phase" ? flow === "None" ? "phase uncertain" : "menstrual estimate"
      : summary.phase === "Follicular phase" ? "follicular estimate"
      : summary.phase === "Ovulation window" ? "ovulation-window estimate"
      : "post-ovulation estimate";
    return label(phase, phase === "phase uncertain" ? "uncertain" : "estimated");
  });
}

export function deriveJournalCycleContext(log: CycleLog, date: string | null) {
  return deriveJournalCycleContexts(log, [date])[0];
}
