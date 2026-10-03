import type { AppData, ApplicationRepository, RepositoryIssue, ReviewRecord } from "../../services/repository-contracts";
import type { StoredPractice, StoredQuoteRotation } from "../../domain/practice/types";
import { defaultActivities, defaultTimers } from "../../domain/practice/defaults";
import { separateLegacySamples } from "../../migrations/legacy";
import { activityValid, bookValid, cycleValid, healthValid, journalValid, object, parseArray, practiceValid, quoteValid, timerValid } from "./validation";

export interface StoragePort { readonly length: number; key(index: number): string | null; getItem(key: string): string | null; setItem(key: string, value: string): void; }
export const LEGACY_KEYS = { journal: "yi-journal", timers: "yi-timers", activities: "yi-activities", cycle: "yi-cycle", books: "yi-books", widgets: "yi-dashboard-widgets", practice: "yi-active-practice", quote: "yi-daily-quote-rotation", layoutVersion: "yi-insights-workspace-v2" };
export const DATA_KEY = "yi-local-data-v1";
export const BACKUP_KEY = "yi-original-backup-v1";
export const emptyCycle = () => ({ lastPeriod: "", averageCycle: 29, averagePeriod: 5, flow: "None" as const, symptoms: [] as string[], history: [] });
export const defaultAppData = (widgets: string[] = []): AppData => ({ journal: [], timers: structuredClone(defaultTimers), activities: structuredClone(defaultActivities), cycle: emptyCycle(), books: [], widgets: [...widgets], health: [] });
type Envelope = { schemaVersion: 1; migrationVersion: 1; updatedAt: string; data: AppData; review: ReviewRecord[]; protectedDatasets: string[] };

export function createLocalRepository(storage: () => StoragePort, now = () => new Date().toISOString()): ApplicationRepository {
  let envelope: Envelope | undefined;
  let readOnly = false;
  let expectedRaw: string | null = null;
  const problems: RepositoryIssue[] = [];
  const protectedSets = new Set<string>();
  function issue(dataset: string, message: string) { if (!problems.some(p => p.dataset === dataset && p.message === message)) problems.push({ dataset, message }); }
  function rawRecords() {
    const port = storage(); const keys = new Set<string>(Object.values(LEGACY_KEYS));
    for (let i = 0; i < port.length; i++) { const k = port.key(i); if (k?.startsWith("yi-") && k !== BACKUP_KEY) keys.add(k); }
    return Object.fromEntries([...keys].sort().map(k => [k, port.getItem(k)]));
  }
  function backup() {
    const port = storage();
    const existing = port.getItem(BACKUP_KEY);
    if (existing !== null) {
      const saved: unknown = JSON.parse(existing);
      if (!object(saved) || saved.format !== "yi-raw-storage-backup" || saved.schemaVersion !== 1 || !object(saved.records) || !Object.values(saved.records).every(v => v === null || typeof v === "string")) throw new Error("Existing backup is malformed; it was retained and no migration was written");
    } else {
      const text = JSON.stringify({ format: "yi-raw-storage-backup", schemaVersion: 1, exportedAt: now(), records: rawRecords() });
      port.setItem(BACKUP_KEY, text);
      if (port.getItem(BACKUP_KEY) !== text) throw new Error("Original-data backup could not be verified; no migration was written");
    }
  }
  function validate<K extends keyof AppData>(dataset: K, value: unknown): AppData[K] {
    if (dataset === "cycle") { if (!cycleValid(value)) throw new Error("Invalid cycle record; original retained"); }
    else if (dataset === "widgets") { if (!Array.isArray(value) || !value.every(x => typeof x === "string") || new Set(value).size !== value.length) throw new Error("Invalid dashboard layout"); }
    else { const guards = { journal: journalValid, timers: timerValid, activities: activityValid, books: bookValid, health: healthValid }; parseArray(value, guards[dataset as keyof typeof guards]); }
    return value as AppData[K];
  }
  function persist() {
    if (readOnly || !envelope) throw new Error("Local data is protected; download a backup before repairing it");
    if (storage().getItem(DATA_KEY) !== expectedRaw) throw new Error("Another tab changed local data; reload this page before saving");
    const next = { ...envelope, updatedAt: now(), protectedDatasets: [...protectedSets] };
    const raw = JSON.stringify(next);
    storage().setItem(DATA_KEY, raw);
    expectedRaw = raw;
    envelope = next;
  }
  function load(widgets: string[]): AppData {
    if (envelope) return structuredClone(envelope.data);
    const defaults = defaultAppData(widgets);
    const data = structuredClone(defaults);
    let review: ReviewRecord[] = [];
    try {
      const saved = storage().getItem(DATA_KEY);
      expectedRaw = saved;
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (!object(parsed) || parsed.schemaVersion !== 1 || parsed.migrationVersion !== 1 || !object(parsed.data) || !Array.isArray(parsed.review) || !Array.isArray(parsed.protectedDatasets) || !parsed.protectedDatasets.every(x => typeof x === "string")) throw new Error("Unsupported or malformed storage version; original retained");
        parsed.protectedDatasets.forEach(x => { protectedSets.add(x); issue(x, "Legacy data needs repair; writes to this collection are blocked"); });
        for (const dataset of Object.keys(data) as (keyof AppData)[]) {
          try { Object.assign(data, { [dataset]: validate(dataset, parsed.data[dataset]) }); }
          catch (e) { readOnly = true; protectedSets.add(dataset); issue(dataset, String(e)); }
        }
        review = parsed.review.filter((x): x is ReviewRecord => object(x) && x.reason === "matches-sample" && ((x.dataset === "journal" && journalValid(x.record)) || (x.dataset === "cycle" && cycleValid({ ...emptyCycle(), history: [x.record] }))));
        if (review.length !== parsed.review.length) { readOnly = true; issue("review", "Invalid review records; writes are blocked to preserve them"); }
      } else {
        backup();
        for (const dataset of Object.keys(LEGACY_KEYS).filter(k => k in data) as (keyof AppData)[]) {
          const raw = storage().getItem(LEGACY_KEYS[dataset as keyof typeof LEGACY_KEYS]);
          if (raw === null) continue;
          try {
            const parsed: unknown = JSON.parse(raw);
            const value = dataset === "cycle" && object(parsed) ? { ...emptyCycle(), ...parsed } : parsed;
            Object.assign(data, { [dataset]: validate(dataset, value) });
          }
          catch (e) { protectedSets.add(dataset); issue(dataset, String(e)); }
        }
        const separated = separateLegacySamples(data); Object.assign(data, separated.data); review = separated.review;
      }
      envelope = { schemaVersion: 1, migrationVersion: 1, updatedAt: now(), data, review, protectedDatasets: [...protectedSets] };
      if (saved === null) persist();
    } catch (e) {
      readOnly = true; issue("storage", String(e));
      envelope = { schemaVersion: 1, migrationVersion: 1, updatedAt: now(), data, review, protectedDatasets: [...protectedSets] };
    }
    if (review.length) issue("samples", `${review.length} records match sample content and are kept separately for review`);
    if (data.cycle.history.some(r => r.recordOrigin === "legacy-unverified")) issue("provenance", "Legacy cycle history has unverified source information; originals are retained");
    return structuredClone(envelope.data);
  }
  function save<K extends keyof AppData>(dataset: K, value: AppData[K]) {
    saveMany({ [dataset]: value });
  }
  function saveMany(changes: Partial<AppData>) {
    if (!envelope) throw new Error("Load the repository before saving");
    for (const dataset of Object.keys(changes) as (keyof AppData)[]) {
      if (protectedSets.has(dataset)) throw new Error(`${dataset} is protected because saved records failed validation`);
      validate(dataset, changes[dataset]);
    }
    const previous = envelope;
    envelope = { ...envelope, data: { ...envelope.data, ...structuredClone(changes) } };
    try { persist(); } catch (e) { envelope = previous; throw e; }
  }
  function readAux<T>(key: string, valid: (v: unknown) => boolean): T | null {
    try { const raw = storage().getItem(`${key}-v1`) ?? storage().getItem(key); if (raw === null) return null; const parsed: unknown = JSON.parse(raw); const value = object(parsed) && parsed.schemaVersion === 1 ? parsed.value : parsed; if (!valid(value)) throw new Error("Invalid saved device state; original retained"); return value as T; }
    catch (e) { protectedSets.add(key); issue(key, String(e)); return null; }
  }
  function writeAux(key: string, value: unknown, valid: (v: unknown) => boolean) {
    if (readOnly || protectedSets.has(key)) throw new Error("Device state is protected; original retained");
    if (value !== null && !valid(value)) throw new Error("Invalid device state");
    backup(); storage().setItem(`${key}-v1`, JSON.stringify({ schemaVersion: 1, value }));
  }
  return {
    load, save, saveMany,
    loadPractice: () => readAux<StoredPractice>(LEGACY_KEYS.practice, v => v === null || practiceValid(v)),
    savePractice: v => writeAux(LEGACY_KEYS.practice, v, practiceValid),
    loadQuote: () => readAux<StoredQuoteRotation>(LEGACY_KEYS.quote, quoteValid),
    saveQuote: v => writeAux(LEGACY_KEYS.quote, v, quoteValid),
    exportRaw: () => JSON.stringify({ format: "yi-raw-storage-backup", schemaVersion: 1, exportedAt: now(), records: { ...rawRecords(), [BACKUP_KEY]: storage().getItem(BACKUP_KEY) } }, null, 2),
    issues: () => [...problems.filter(problem => problem.dataset !== "samples"), ...(envelope?.review.length ? [{ dataset: "samples", message: `${envelope.review.length} records match sample content and are kept separately for review` }] : [])],
    reviewRecords: () => structuredClone(envelope?.review ?? []),
    restoreReviewRecord: index => {
      if (!envelope || !envelope.review[index]) throw new Error("Review record unavailable");
      const item = envelope.review[index]; const dataset = item.dataset;
      if (protectedSets.has(dataset)) throw new Error("Repair protected collection first");
      const previous = structuredClone(envelope);
      if (dataset === "journal") { if (envelope.data.journal.some(r => r.id === item.record.id)) throw new Error("ID already exists"); envelope.data.journal.push(item.record as AppData["journal"][number]); }
      else { const record = item.record as AppData["cycle"]["history"][number]; if (envelope.data.cycle.history.some(r => r.id === record.id || r.date === record.date)) throw new Error("A record already exists for that ID or date"); envelope.data.cycle.history.push({ ...record, recordOrigin: "user" }); envelope.data.cycle.history.sort((a, b) => a.date.localeCompare(b.date)); if (record.cycleDayOne) envelope.data.cycle.lastPeriod = record.date; }
      envelope.review.splice(index, 1);
      try { persist(); } catch (e) { envelope = previous; throw e; }
    },
  };
}

// Browser storage is acquired only when a service action runs, never during SSR.
export const localRepository = createLocalRepository(() => window.localStorage);
