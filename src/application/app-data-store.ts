import { defaultAppData } from "../adapters/local/repository";
import type { AppData, DataRepository, RepositoryIssue } from "../services/repository-contracts";
import { lifecycleLog, lifecycleSpan } from "../platform/lifecycle-log";

/** Repository hydration and edits have separate generations. Late reads cannot
 * replace a newer local edit, and navigation never waits for this store. */
export function createAppDataStore(repository: DataRepository, widgets: string[], localIssues: () => RepositoryIssue[] = () => []) {
  let snapshot = { data: defaultAppData(widgets), ready: false, issues: [] as RepositoryIssue[] };
  let active = true;
  let started = false;
  let generation = 0;
  let editEpoch = 0;
  let scheduled = false;
  let writes = 0;
  let changes: Partial<AppData> = {};
  let failedEdits = false;
  let offData: (() => void) | undefined;
  let offSync: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof snapshot>) => { if (!active) return; snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const issue = (message: string) => update({ issues: [...localIssues(), { dataset: "storage", message }] });
  const adopt = (data: AppData) => {
    lifecycleLog("account state replacement started");
    update({ data, ready: true, issues: localIssues() });
    lifecycleLog("account state replaced");
  };
  async function load() {
    const captured = ++generation; const epoch = editEpoch;
    const finish = lifecycleSpan("repository initialization");
    try {
      const data = await repository.load(widgets);
      if (active && captured === generation && epoch === editEpoch && !writes && !Object.keys(changes).length) { failedEdits = false; adopt(data); }
    } catch {
      if (active && captured === generation) issue("Cloud data could not be refreshed. Navigation remains available; existing data and pending changes are retained. Retry sync when connected.");
    } finally { finish(); }
  }
  function flush() {
    scheduled = false;
    if (!active || !Object.keys(changes).length) return;
    const sending = changes; changes = {}; writes++;
    void Promise.resolve().then(() => repository.enqueue ? repository.enqueue(sending) : repository.saveMany(sending)).then(() => {
      if (active) { failedEdits = false; update({ issues: localIssues() }); }
    }).catch(() => {
      failedEdits = true;
      issue("Changes have not been confirmed by cloud. Keep this view open and retry sync. Navigation remains available.");
    }).finally(() => { writes--; });
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async start() {
      if (started) return; started = true; active = true;
      lifecycleLog("account data subscriptions attached");
      const captured = ++generation;
      offData = repository.subscribeData?.(data => {
        if (active && !failedEdits && !writes && !Object.keys(changes).length) adopt(data);
      });
      offSync = repository.subscribeSync?.(() => {
        const state = repository.syncStatus?.();
        if (active && failedEdits && state?.phase === "idle" && state.writable && !state.pending && !writes && !Object.keys(changes).length) {
          failedEdits = false; update({ issues: localIssues() });
        }
      });
      try {
        const cached = await repository.restore?.();
        if (!active || captured !== generation) return;
        if (cached) { adopt(cached); void repository.refresh?.().catch(() => {}); return; }
      } catch { /* A cold account can load from server while the shell is usable. */ }
      if (active && captured === generation) await load();
    },
    set<K extends keyof AppData>(key: K, next: AppData[K] | ((current: AppData[K]) => AppData[K])) {
      if (!active || !snapshot.ready || repository.syncStatus?.().writable === false) return;
      const value = typeof next === "function" ? next(snapshot.data[key]) : next;
      if (value === snapshot.data[key]) return;
      editEpoch++;
      changes = { ...changes, [key]: value };
      update({ data: { ...snapshot.data, [key]: value } });
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    acceptImportedData(loaded: AppData) {
      if (!active) return;
      const unsavedManual = failedEdits ? snapshot.data.health.filter(record => record.provenance.ingestion === "manual") : [];
      const health = [...loaded.health.filter(record => !unsavedManual.some(manual => manual.id === record.id)), ...unsavedManual];
      const next = failedEdits ? { ...snapshot.data, health } : loaded;
      editEpoch++; update({ data: next, ready: true, ...(failedEdits ? {} : { issues: [] }) });
    },
    reload: load,
    dispose() { flush(); active = false; started = false; generation++; offData?.(); offSync?.(); listeners.clear(); lifecycleLog("account data subscriptions detached"); },
  };
}
