"use client";
import { useEffect, useRef, useState } from "react";
import { defaultAppData, localRepository } from "../adapters/local/repository";
import type { AppData, DataRepository, RepositoryIssue } from "../services/repository-contracts";

/** A keyed view hydrates only from its explicitly selected repository. */
export function useAppData(defaultWidgets: string[], repository: DataRepository = localRepository) {
  const [data, setData] = useState<AppData>(() => defaultAppData(defaultWidgets));
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<RepositoryIssue[]>([]);
  const previous = useRef<AppData | null>(null);
  const mounted = useRef(false);
  const failedEdits = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => repository.load(defaultWidgets)).then(loaded => {
        if (!mounted.current) return;
        failedEdits.current = false; previous.current = loaded; setData(loaded); setIssues(repository === localRepository ? localRepository.issues() : []); setReady(true);
      }).catch(() => { if (mounted.current) setIssues([{ dataset: "storage", message: "Data could not be loaded safely. Editing is disabled; no fallback data was uploaded. Return to local mode or reload cloud data." }]); });
    }, 0);
    return () => { mounted.current = false; clearTimeout(timer); };
    // Defaults are stable configuration, not a reactive query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);
  useEffect(() => {
    if (!ready || !previous.current) return;
    const changes: Partial<AppData> = {};
    for (const dataset of Object.keys(data) as (keyof AppData)[]) {
      if (JSON.stringify(data[dataset]) !== JSON.stringify(previous.current[dataset])) Object.assign(changes, { [dataset]: data[dataset] });
    }
    if (!Object.keys(changes).length) return;
    // Advance comparison before queued async I/O. Rejection is visible and never
    // redirects cloud edits into the local repository.
    previous.current = data;
    try {
      void Promise.resolve(repository.saveMany(changes)).catch(() => { failedEdits.current = true; if (mounted.current) setIssues([{ dataset: "storage", message: "Not saved. Keep this view open; reload the selected repository before retrying. No data was copied to another repository." }]); });
    } catch (error) { failedEdits.current = true; setTimeout(() => { if (mounted.current) setIssues([...(repository === localRepository ? localRepository.issues() : []), { dataset: "storage", message: `Not saved: ${String(error)}` }]); }, 0); }
  }, [data, ready, repository]);
  const setter = <K extends keyof AppData>(key: K) => (next: AppData[K] | ((current: AppData[K]) => AppData[K])) => { if (ready) setData(current => ({ ...current, [key]: typeof next === "function" ? next(current[key]) : next })); };
  /** Adopt a repository-committed import without issuing a second automatic save. */
  function acceptImportedData(loaded: AppData) {
    if (!mounted.current) return;
    // Import retry must not discard manual edits left in this view after a failed save.
    const unsavedManual = failedEdits.current ? previous.current?.health.filter(record => record.provenance.ingestion === "manual") ?? [] : [];
    const health = [...loaded.health.filter(record => !unsavedManual.some(manual => manual.id === record.id)), ...unsavedManual];
    const next = failedEdits.current && previous.current ? { ...previous.current, health } : loaded;
    previous.current = next; setData(next); if (!failedEdits.current) setIssues([]); setReady(true);
  }
  return { ...data, acceptImportedData, ready, issues, setEntries: setter("journal"), setTimers: setter("timers"), setActivities: setter("activities"), setBooks: setter("books"), setCycleLog: setter("cycle"), setDashboardWidgets: setter("widgets"), setHealth: setter("health"), reload: () => {
    void Promise.resolve(repository.load(defaultWidgets)).then(loaded => { if (mounted.current) { failedEdits.current = false; previous.current = loaded; setData(loaded); setIssues(repository === localRepository ? localRepository.issues() : []); setReady(true); } }).catch(() => { if (mounted.current) setIssues([{ dataset: "storage", message: "Reload failed; editing remains disabled." }]); });
  } };
}
