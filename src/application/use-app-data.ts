"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { localRepository } from "../adapters/local/repository";
import type { AppData, DataRepository } from "../services/repository-contracts";
import { createAppDataStore } from "./app-data-store";

export function useAppData(defaultWidgets: string[], repository: DataRepository = localRepository) {
  const store = useMemo(() => createAppDataStore(repository, defaultWidgets, () => repository === localRepository ? localRepository.issues() : []), [repository, defaultWidgets]);
  const { data, ready, issues } = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => { void store.start(); return () => store.dispose(); }, [store]);
  const setter = <K extends keyof AppData>(key: K) => (next: AppData[K] | ((current: AppData[K]) => AppData[K])) => store.set(key, next);
  return { ...data, ready, issues, acceptImportedData: store.acceptImportedData, reload: store.reload, setEntries: setter("journal"), setTimers: setter("timers"), setActivities: setter("activities"), setBooks: setter("books"), setCycleLog: setter("cycle"), setDashboardWidgets: setter("widgets"), setHealth: setter("health") };
}
