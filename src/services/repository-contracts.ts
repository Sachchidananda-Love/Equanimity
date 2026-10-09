import type { JournalEntry, BookRecord } from "../domain/journal/types";
import type { ActivityPreset, TimerPreset, StoredPractice, StoredQuoteRotation } from "../domain/practice/types";
import type { CycleLog } from "../domain/cycle/types";
import type { HealthRecord } from "../domain/health/types";

export type AppData = {
  journal: JournalEntry[];
  timers: TimerPreset[];
  activities: ActivityPreset[];
  cycle: CycleLog;
  books: BookRecord[];
  widgets: string[];
  health: HealthRecord[];
};
export type RepositoryIssue = { dataset: string; message: string };
export type ReviewRecord = { dataset: "journal" | "cycle"; record: JournalEntry | CycleLog["history"][number]; reason: "matches-sample" };
/** The common data boundary supports async cloud I/O; local stays synchronous. */
export interface DataRepository {
  load(defaultWidgets: string[]): AppData | Promise<AppData>;
  save<K extends keyof AppData>(dataset: K, value: AppData[K]): void | Promise<void>;
  saveMany(changes: Partial<AppData>): void | Promise<void>;
  /** Cloud cache and outbox are separate from the explicit local repository. */
  restore?(): Promise<AppData | null>;
  enqueue?(changes: Partial<AppData>): Promise<void>;
  refresh?(): Promise<void>;
  subscribeData?(listener: (data: AppData) => void): () => void;
  syncStatus?(): RepositorySyncStatus;
  subscribeSync?(listener: () => void): () => void;
  setOnline?(online: boolean): void;
  dispose?(): void;
}
export type RepositorySyncStatus = { phase: "idle" | "loading" | "saving" | "offline" | "failed"; pending: number; error: string; writable: boolean };
export type CloudBaseline = { data: AppData; revision: number; collections: string[] };
export interface CloudBaselineRepository extends DataRepository {
  exportBaseline(): CloudBaseline;
  restoreBaseline(state: CloudBaseline): void;
  validateChanges(changes: Partial<AppData>): void;
  commitQueued(changes: Partial<AppData>, mutationId: string): Promise<void>;
}
export interface ApplicationRepository extends DataRepository {
  load(defaultWidgets: string[]): AppData;
  save<K extends keyof AppData>(dataset: K, value: AppData[K]): void;
  saveMany(changes: Partial<AppData>): void;
  loadPractice(): StoredPractice | null;
  savePractice(value: StoredPractice | null): void;
  loadQuote(): StoredQuoteRotation | null;
  saveQuote(value: StoredQuoteRotation): void;
  exportRaw(): string;
  issues(): RepositoryIssue[];
  reviewRecords(): ReviewRecord[];
  restoreReviewRecord(index: number): void;
}
