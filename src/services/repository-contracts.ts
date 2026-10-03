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
