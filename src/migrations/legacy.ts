import { demoEntries, initialCycleHistory } from "../fixtures/demo-data";
import type { AppData, ReviewRecord } from "../services/repository-contracts";

// Key order does not affect exact sample matching. Edited samples are ambiguous,
// retained as legacy-unverified rather than guessed to be demo or real data.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function separateLegacySamples(data: AppData): { data: AppData; review: ReviewRecord[] } {
  const review: ReviewRecord[] = [];
  const journal = data.journal.filter(record => {
    if (demoEntries.some(sample => canonical(sample) === canonical(record))) { review.push({ dataset: "journal", record, reason: "matches-sample" }); return false; }
    return true;
  });
  const history = data.cycle.history.filter(record => {
    if (initialCycleHistory.some(sample => canonical(sample) === canonical(record))) { review.push({ dataset: "cycle", record, reason: "matches-sample" }); return false; }
    return true;
  }).map(record => ({ ...record, recordOrigin: record.recordOrigin ?? "legacy-unverified" as const }));
  // Never infer that a legacy period start is real from a fixture-derived setting.
  const sampleCycleOnly = data.cycle.history.length > 0 && history.length === 0;
  return { data: { ...data, journal: journal.map(record => record.type === "Yoga" ? { ...record, type: "Maintenance Yoga" } : record), activities: data.activities.map(record => record.name === "Yoga" ? { ...record, name: "Maintenance Yoga" } : record), cycle: { ...data.cycle, ...(sampleCycleOnly ? { lastPeriod: "", temperature: undefined, flow: "None" as const, symptoms: [] } : {}), history } }, review };
}
