// Compatibility exports while screens are incrementally extracted. No persistence or fixtures.
export type { ActivityType, AssessmentValue, JournalEntry } from "../src/domain/journal/types";
export type { ActivityPreset, TimerPreset } from "../src/domain/practice/types";
export type { CycleFlow, CycleDayLog, CycleLog } from "../src/domain/cycle/types";
export type InsightWidgetId = "practice" | "cycle" | "factors" | "faculties" | "characteristics" | "hindrances" | "body" | "meditation" | "maintenance-yoga" | "workout-yoga" | "books";

export const sevenFactors = ["Mindfulness", "Investigation", "Energy", "Rapture", "Tranquility", "Concentration", "Equanimity"];
export const fiveFaculties = ["Faith", "Energy", "Mindfulness", "Concentration", "Wisdom"];
export const threeCharacteristics = ["Impermanence", "Not-self", "Unsatisfactoriness"];
export const fiveHindrances = ["Sense desire", "Ill will", "Sloth & torpor", "Restlessness", "Doubt"];
