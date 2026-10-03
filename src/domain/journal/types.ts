import type { RecordId } from "../ids";
export type ActivityType = string;

export type AssessmentValue = {
  value: number;
  note?: string;
};

export type JournalEntry = {
  id: RecordId;
  type: ActivityType | "Journal" | "Gratitude" | "Period";
  title: string;
  date: string;
  duration?: number;
  note?: string;
  mood?: string;
  assessments?: Record<string, AssessmentValue>;
  tags?: string[];
  lunarContext?: string;
  cycleContext?: string;
  loggedAt?: number;
};


export type BookRecord = { id: RecordId; title: string; author?: string; startedOn?: string; finishedOn?: string; yearRead?: number; finished?: boolean; assessments?: Record<string, AssessmentValue> };
