import type { AppData, CloudBaselineRepository, DataRepository, RepositorySyncStatus } from "./repository-contracts";
import type { CloudCheckpoint, CloudSyncStore } from "../adapters/firebase/sync-store";
import { createRecordId } from "../domain/ids";
import { lifecycleLog, lifecycleSpan } from "../platform/lifecycle-log";

export function transientCloudError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace("firestore/", "") : "";
  return ["unavailable", "deadline-exceeded", "network-request-failed"].includes(code) || (error instanceof Error && /^(offline|network unavailable)$/i.test(error.message));
}

/** Cloud remains authoritative. The UID cache stores a validated baseline and
 * pending edits; transactions still check its original revision on the server.
 * Only enqueue() acknowledges a device checkpoint. saveMany() continues to
 * await the server, including for the existing explicit HealthKit workflow. */
export function createCloudSyncRepository(base: CloudBaselineRepository, uid: string, store: CloudSyncStore): DataRepository {
  let checkpoint: CloudCheckpoint | undefined;
  let version = 0;
  let restored: Promise<AppData | null> | undefined;
  let active = true;
  let online = true;
  let editEpoch = 0;
  let job: Promise<void> | undefined;
  let storageQueue = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;
  let defaultWidgets: string[] = [];
  let cacheError = false;
  let status: RepositorySyncStatus = { phase: "idle", pending: 0, error: "", writable: false };
  const statusListeners = new Set<() => void>();
  const dataListeners = new Set<(data: AppData) => void>();
  const guard = () => { if (!active) throw new Error("Cloud session changed; operation cancelled"); };
  const publish = (patch: Partial<RepositorySyncStatus>) => {
    if (!active) return;
    status = { ...status, ...patch, pending: checkpoint?.pending.length ?? 0 };
    statusListeners.forEach(listener => listener());
  };
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const next = storageQueue.catch(() => {}).then(task);
    storageQueue = next.then(() => {}, () => {});
    return next;
  };
  const projected = () => {
    if (!checkpoint) return null;
    const finish = lifecycleSpan("cached account projection");
    try { return structuredClone(checkpoint.pending.reduce((data, item) => ({ ...data, ...item.changes }), checkpoint.baseline.data)); }
    finally { finish(); }
  };
  async function persist() {
    guard();
    if (!checkpoint) return;
    const next = { ...checkpoint, version: version + 1 };
    const finish = lifecycleSpan("device checkpoint");
    try { await store.write(uid, next, version); guard(); version++; checkpoint.version = version; cacheError = false; }
    catch (error) { cacheError = true; throw error; }
    finally { finish(); }
  }
  function scheduleRetry() {
    if (!active || !online || retryTimer) return;
    lifecycleLog("cloud retry scheduled", { elapsedMs: retryDelay });
    retryTimer = setTimeout(() => { retryTimer = undefined; void refresh().catch(() => {}); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }
  function failure(error: unknown) {
    if (!active) return;
    if (!cacheError && transientCloudError(error)) {
      publish({ phase: "offline", error: "Cloud connection interrupted. Pending changes are retained; reconnection runs in the background.", writable: Boolean(checkpoint) });
      scheduleRetry();
    } else {
      const permission = typeof error === "object" && error !== null && "code" in error && String(error.code).includes("permission-denied");
      publish({ phase: "failed", writable: false, error: cacheError ? "Device cloud checkpoint unavailable. Keep this view open and retry sync; pending changes are retained in memory." : permission ? "Cloud permission denied. Existing data and pending changes are retained. Retry after account access is restored." : "Cloud sync needs attention (access, conflict or invalid data). Existing data and pending changes are retained. Retry sync after resolving the error." });
    }
  }
  function restore() {
    guard();
    if (checkpoint) return Promise.resolve(projected());
    if (!restored) {
      const finish = lifecycleSpan("cached account restore");
      restored = (async () => {
      guard();
      const saved = await store.read(uid); guard();
      if (!saved) return null;
      if (saved.schema !== 1 || saved.ownerUid !== uid || !Number.isSafeInteger(saved.version) || saved.version < 1 || !Array.isArray(saved.pending)) throw new Error("Invalid or foreign device cloud checkpoint");
      base.restoreBaseline(saved.baseline);
      let data = saved.baseline.data;
      for (const item of saved.pending) {
        if (!item || typeof item.id !== "string" || !item.id || !item.changes || Object.keys(item.changes).some(key => !(key in data))) throw new Error("Invalid pending cloud change");
        data = { ...data, ...item.changes }; base.validateChanges(data);
      }
      checkpoint = structuredClone(saved); version = saved.version;
      lifecycleLog("pending writes restored", { pending: saved.pending.length });
      publish({ writable: true, phase: saved.pending.length ? "offline" : "idle" });
      return projected();
      })().catch(error => { restored = undefined; cacheError = true; failure(error); throw error; }).finally(finish);
    }
    return restored;
  }
  function refresh(): Promise<void> {
    guard();
    lifecycleLog("cloud refresh requested");
    if (job) { lifecycleLog("cloud refresh coalesced"); return job; }
    if (!online) { publish({ phase: "offline" }); return Promise.resolve(); }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
    const finish = lifecycleSpan("Firestore reconnect");
    const operation = (async () => {
      try {
        await restore().catch(() => {}); guard();
        if (checkpoint?.pending.length) {
          lifecycleLog("outbox replay started", { pending: checkpoint.pending.length });
          // Retry a failed device checkpoint before sending anything to cloud.
          await exclusive(persist);
          publish({ phase: "saving", error: "", writable: true });
          while (checkpoint.pending.length && online) {
            guard(); const item = checkpoint.pending[0];
            lifecycleLog("outbox transaction started", { pending: checkpoint.pending.length });
            await base.commitQueued(item.changes, item.id); guard();
            lifecycleLog("outbox transaction completed", { pending: checkpoint.pending.length });
            await exclusive(async () => {
              guard();
              checkpoint!.baseline = base.exportBaseline();
              checkpoint!.pending.shift();
              // If checkpointing an acknowledgement fails, restore the entry.
              // Its stable mutation ID makes re-delivery idempotent.
              try { await persist(); } catch (error) { checkpoint!.pending.unshift(item); throw error; }
            });
          }
          lifecycleLog("outbox replay completed", { pending: checkpoint.pending.length });
        } else {
          publish({ phase: "loading", error: "" });
          const epoch = editEpoch;
          const previous = checkpoint?.baseline;
          const loaded = await base.load(defaultWidgets); guard();
          await exclusive(async () => {
            guard();
            if (epoch !== editEpoch && previous) { base.restoreBaseline(previous); return; }
            const finishComparison = lifecycleSpan("account refresh comparison");
            let unchanged;
            try { unchanged = checkpoint && JSON.stringify(checkpoint.baseline.data) === JSON.stringify(loaded); } finally { finishComparison(); }
            checkpoint = { schema: 1, ownerUid: uid, version, baseline: base.exportBaseline(), pending: [] };
            await persist();
            if (!unchanged && epoch === editEpoch) dataListeners.forEach(listener => listener(structuredClone(loaded)));
          });
          // A user edit during the background read is still pinned to its
          // pre-read revision. Flush it instead of rebasing over remote edits.
          if (checkpoint?.pending.length) { scheduleRetry(); }
        }
        guard(); retryDelay = 1000;
        publish({ phase: online && !checkpoint?.pending.length ? "idle" : "offline", writable: !cacheError && Boolean(checkpoint), error: "" });
      } catch (error) { failure(error); throw error; }
      finally { finish(); }
    })();
    job = operation;
    void operation.finally(() => { if (job === operation) job = undefined; }).catch(() => {});
    return operation;
  }
  const repository: DataRepository = {
    restore, refresh,
    async load(widgets) {
      defaultWidgets = widgets;
      guard(); await restore().catch(() => {});
      if (checkpoint?.pending.length) throw new Error("Wait for pending cloud writes before reloading");
      if (!online) throw Object.assign(new Error("offline"), { code: "unavailable" });
      try { await refresh(); } catch (error) { if (!cacheError || !checkpoint || checkpoint.pending.length) throw error; }
      guard();
      // Preserve caller defaults on first load of a completely empty account.
      // Normal cached baselines have already been fully validated.
      if (!checkpoint) return base.load(widgets);
      return structuredClone(checkpoint.baseline.data);
    },
    save: (key, value) => repository.saveMany({ [key]: value }),
    async saveMany(changes) {
      guard();
      if (checkpoint?.pending.length) throw new Error("Wait for pending cloud writes before saving imported data");
      const previousJob = job;
      const operation = (async () => {
        await previousJob?.catch(() => {}); guard();
        publish({ phase: "saving", error: "" });
        try {
          await base.saveMany(changes); guard();
          try {
            await exclusive(async () => {
              checkpoint = { schema: 1, ownerUid: uid, version, baseline: base.exportBaseline(), pending: [] }; await persist();
            });
            publish({ phase: "idle", writable: true });
          } catch (error) { failure(error); /* Server acknowledgement still stands for explicit imports. */ }
        } catch (error) { failure(error); throw error; }
      })();
      job = operation;
      try { await operation; } finally { if (job === operation) job = undefined; }
    },
    enqueue(changes) {
      guard(); editEpoch++;
      const immutable = structuredClone(changes);
      return exclusive(async () => {
        guard();
        if (!checkpoint || !status.writable) throw new Error("Cloud data is not ready for editing; pending changes are retained");
        base.validateChanges({ ...projected()!, ...immutable });
        checkpoint.pending.push({ id: createRecordId(), changes: immutable });
        try { await persist(); } catch (error) { failure(error); throw error; }
        publish({ phase: online ? "saving" : "offline", error: "", writable: true });
        // Do not await the network from a local UI mutation.
        void refresh().catch(() => {});
      });
    },
    syncStatus: () => status,
    subscribeSync(listener) { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; },
    subscribeData(listener) { dataListeners.add(listener); return () => { dataListeners.delete(listener); }; },
    setOnline(value) {
      lifecycleLog("repository connectivity hint", { online: value });
      online = value;
      if (!online) { if (retryTimer) clearTimeout(retryTimer); retryTimer = undefined; publish(status.phase === "failed" ? {} : { phase: "offline" }); }
      else if (status.phase === "offline") void refresh().catch(() => {});
    },
    dispose() { active = false; if (retryTimer) clearTimeout(retryTimer); statusListeners.clear(); dataListeners.clear(); },
  };
  return repository;
}
