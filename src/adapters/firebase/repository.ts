import type { AppData, CloudBaselineRepository } from "../../services/repository-contracts";
import { defaultAppData, emptyCycle } from "../local/repository";
import { activityValid, bookValid, cycleValid, healthValid, journalValid, object, parseArray, timerValid } from "../local/validation";
import { separateLegacySamples } from "../../migrations/legacy";
import { HEALTHKIT_PERSISTED_METADATA, verifiedHealthKitRecord } from "../../domain/health/import-policy";
import { lifecycleSpan } from "../../platform/lifecycle-log";

export type CloudDocument = { id: string; data: unknown };
export type CloudWrite = { path: string; data: Record<string, unknown> };
export interface FirestorePort {
  currentUid(): string | null;
  read(path: string): Promise<unknown | null>;
  list(path: string): Promise<CloudDocument[]>;
  commit(revisionPath: string, expectedRevision: number, writes: CloudWrite[], authorize?: () => void): Promise<void>;
}
const collections = { journal: "journalEntries", timers: "timerPresets", activities: "activityPresets", books: "books", health: "healthRecords" } as const;
export function cloudRecordId(id: string | number) { return `${typeof id === "number" ? "n" : "s"}-${encodeURIComponent(String(id))}`; }
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function validateData(data: AppData) {
  parseArray(data.journal, journalValid); parseArray(data.timers, timerValid); parseArray(data.activities, activityValid); parseArray(data.books, bookValid); parseArray(data.health, healthValid);
  if (!cycleValid(data.cycle) || !Array.isArray(data.widgets) || !data.widgets.every(id => typeof id === "string") || new Set(data.widgets).size !== data.widgets.length) throw new Error("Invalid cloud data; writes blocked");
  if (separateLegacySamples(data).review.length || data.cycle.history.some(record => record.recordOrigin !== "user")) throw new Error("Samples and unverified legacy health history cannot be uploaded");
  function scan(value: unknown) {
    if (Array.isArray(value)) value.forEach(scan);
    else if (object(value)) for (const [key, child] of Object.entries(value)) {
      if (/^(?:rawCsv|csvFile|tempdropCsv|permissionState|healthKitPermissions|queryAnchor|healthKitAnchor|rawPayload)$/i.test(key)) throw new Error("Device-private/import payloads cannot be stored");
      scan(child);
    }
  }
  scan(data);
}
function validate(data: AppData) {
  const finish = lifecycleSpan("account validation");
  try { validateData(data); } finally { finish(); }
}

/** Stores validated observations, not domain calculations; never reads localStorage. */
export function createFirebaseRepository(port: FirestorePort, uid: string, { healthKitConsent = () => false }: { healthKitConsent?: () => boolean } = {}): CloudBaselineRepository {
  if (!uid || uid.includes("/")) throw new Error("Invalid Firebase UID");
  const root = `users/${uid}`; const revisionPath = `${root}/settings/repository`;
  let baseline: AppData | undefined; let revision = 0;
  let existingCollections = new Set<string>();
  const guard = () => { if (port.currentUid() !== uid) throw new Error("Authenticated UID does not own this repository"); };
  function unwrap(value: unknown) {
    if (!object(value) || value.ownerUid !== uid || value.schemaVersion !== 1 || typeof value.deleted !== "boolean" || !object(value.record)) throw new Error("Malformed or foreign cloud record; writes blocked");
    return value;
  }
  function revisionOf(raw: unknown | null) {
    if (raw === null) return 0;
    const value = unwrap(raw);
    if (!object(value.record) || !Number.isSafeInteger(value.record.revision) || Number(value.record.revision) < 0) throw new Error("Invalid cloud revision");
    return Number(value.record.revision);
  }
  const envelope = (record: unknown, deleted = false) => clean({ schemaVersion: 1, ownerUid: uid, record, deleted });
  async function load(widgets: string[]): Promise<AppData> {
    guard();
    const before = revisionOf(await port.read(revisionPath)); guard();
    const sections = await Promise.all([...Object.values(collections), "cycleEvents", "settings"].map(async name => [name, await port.list(`${root}/${name}`)] as const)); guard();
    const after = revisionOf(await port.read(revisionPath)); guard();
    if (before !== after) throw new Error("Cloud changed while loading. Reload before editing");
    const map = Object.fromEntries(sections); const data = defaultAppData(widgets);
    const loadedCollections = new Set(sections.filter(([, documents]) => documents.length > 0).map(([name]) => name));
    function rows(name: string) {
      return map[name].flatMap(document => {
        const value = unwrap(document.data);
        if (value.deleted) {
          const record = value.record;
          // Keep imported UUID tombstones in the normalized health baseline so a
          // later manual import cannot resurrect a removed source observation.
          if (name === "healthRecords" && object(record) && object(record.provenance) && record.provenance.ingestion === "healthkit") {
            if (!healthValid(record) || document.id !== cloudRecordId(record.id as string)) throw new Error("Malformed HealthKit tombstone; writes blocked");
            return [{ ...record, status: "deleted" }];
          }
          return [];
        }
        if (!object(value.record) || document.id !== cloudRecordId(value.record.id as string | number)) throw new Error("Cloud record ID mismatch");
        return [value.record];
      });
    }
    for (const [key, name] of Object.entries(collections)) { const records = rows(name); if (records.length || map[name].length) Object.assign(data, { [key]: records }); }
    const settings = new Map(map.settings.map(document => [document.id, unwrap(document.data)]));
    const cycle = settings.get("cycle"); const dashboard = settings.get("dashboard");
    data.cycle = { ...emptyCycle(), ...(cycle?.record as object ?? {}), history: rows("cycleEvents") as AppData["cycle"]["history"] };
    if (dashboard) { if (!object(dashboard.record)) throw new Error("Invalid dashboard configuration"); data.widgets = dashboard.record.widgets as string[]; }
    validate(data);
    // Collection queries sort by document ID, not by the UI's chronology.
    data.journal.sort((a, b) => (b.loggedAt ?? 0) - (a.loggedAt ?? 0));
    data.cycle.history.sort((a, b) => a.date.localeCompare(b.date));
    revision = after; baseline = clean(data); existingCollections = loadedCollections; return structuredClone(data);
  }
  async function saveMany(changes: Partial<AppData>, mutationId?: string) {
    guard(); if (!baseline) throw new Error("Load cloud records successfully before writing");
    const next = clean({ ...baseline, ...changes }); validate(next);
    const writes: CloudWrite[] = [];
    function diff(name: string, old: { id: string | number }[], current: { id: string | number }[]) {
      const previous = new Map(old.map(record => [cloudRecordId(record.id), record]));
      for (const record of current) { const id = cloudRecordId(record.id); if (JSON.stringify(record) !== JSON.stringify(previous.get(id))) writes.push({ path: `${root}/${name}/${id}`, data: envelope(record) }); previous.delete(id); }
      for (const [id, record] of previous) writes.push({ path: `${root}/${name}/${id}`, data: envelope(record, true) });
    }
    for (const [key, name] of Object.entries(collections) as [keyof typeof collections, string][]) if (key in changes) {
      const configurationBootstrap = (key === "timers" || key === "activities") && !existingCollections.has(name) && next[key].length > 0;
      diff(name, configurationBootstrap ? [] : baseline[key], next[key]);
    }
    if ("cycle" in changes) {
      diff("cycleEvents", baseline.cycle.history, next.cycle.history);
      const { history: _history, ...settings } = next.cycle;
      void _history;
      writes.push({ path: `${root}/settings/cycle`, data: envelope(settings) });
    }
    if ("widgets" in changes) writes.push({ path: `${root}/settings/dashboard`, data: envelope({ widgets: next.widgets }) });
    if (!writes.length) return;
    const authorize = () => {
      guard();
      for (const write of writes) {
        const record = write.data.record;
        if (!object(record) || !object(record.provenance) || record.provenance.ingestion !== "healthkit") continue;
        if (!healthKitConsent()) throw new Error("Selected Apple Health cloud sync is disabled for this account");
        if (!verifiedHealthKitRecord(record as AppData["health"][number]) || record.provenance.storage !== "cloud") throw new Error("HealthKit provider or metric is not approved for cloud import");
        if (!object(record.provenance.metadata) || Object.keys(record.provenance.metadata).some(key => !HEALTHKIT_PERSISTED_METADATA.some(allowed => key === allowed))) throw new Error("Inspection metadata cannot be uploaded to cloud");
      }
    };
    if (writes.length > 400) throw new Error("Too many records changed in one operation (maximum 400). No partial write performed");
    writes.push({ path: revisionPath, data: envelope({ revision: revision + 1, ...(mutationId ? { lastMutationId: mutationId } : {}) }) });
    authorize(); await port.commit(revisionPath, revision, writes, authorize); guard();
    writes.forEach(write => existingCollections.add(write.path.split("/")[2]));
    revision++; baseline = next;
  }
  return {
    load, save: (key, value) => saveMany({ [key]: value }), saveMany,
    commitQueued: (changes, mutationId) => saveMany(changes, mutationId),
    validateChanges(changes) { guard(); if (!baseline) throw new Error("Load cloud records successfully before writing"); validate(clean({ ...baseline, ...changes })); },
    exportBaseline() { guard(); if (!baseline) throw new Error("No cloud baseline"); return structuredClone({ data: baseline, revision, collections: [...existingCollections] }); },
    restoreBaseline(state) {
      const finish = lifecycleSpan("cached baseline restore");
      try {
        guard(); validate(state.data);
        if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.collections) || state.collections.some(name => ![...Object.values(collections), "cycleEvents", "settings"].includes(name))) throw new Error("Invalid cloud cache baseline");
        baseline = clean(state.data); revision = state.revision; existingCollections = new Set(state.collections);
      } finally { finish(); }
    },
  };
}
