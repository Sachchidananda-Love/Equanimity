export type ActivityType = "Meditation" | "Yoga" | "Workout" | "Other";

export type JournalEntry = {
  id: number;
  type: ActivityType | "Journal" | "Gratitude" | "Period";
  title: string;
  date: string;
  duration?: number;
  note?: string;
  mood?: string;
};

export type TimerPreset = {
  id: number;
  name: string;
  seconds: number;
  color: "sage" | "gold" | "coral";
  interval?: number;
  gongs?: number[];
};

export const demoCycle = {
  day: 8,
  phase: "Follicular phase",
  nextPeriodIn: 16,
  fertileWindowIn: 4,
  averageCycle: 29,
  lastPeriod: "September 23",
};

export const demoTimers: TimerPreset[] = [
  { id: 1, name: "Morning clarity", seconds: 600, color: "sage", gongs: [300] },
  { id: 2, name: "Deep sit", seconds: 1200, color: "gold", interval: 300 },
  { id: 3, name: "Evening release", seconds: 900, color: "coral", gongs: [180, 780] },
];

export const demoEntries: JournalEntry[] = [
  { id: 1, type: "Meditation", title: "Evening sit", date: "Sep 29 · 8:42 PM", duration: 20, mood: "Calm and spacious", note: "The breath softened once I stopped trying to arrange it." },
  { id: 2, type: "Gratitude", title: "Three small things", date: "Sep 29 · 9:05 AM", note: "Warm tea, the first red maple, and an unhurried conversation." },
  { id: 3, type: "Yoga", title: "Slow morning flow", date: "Sep 28 · 7:15 AM", duration: 34, mood: "Grounded", note: "Hips felt open. Kept the pace gentle." },
  { id: 4, type: "Period", title: "Cycle day 1", date: "Sep 23", note: "Light flow · mild cramps" },
  { id: 5, type: "Meditation", title: "Open awareness", date: "Sep 22 · 6:10 PM", duration: 26, mood: "Bright" },
];

export const weeklyPractice = [
  { day: "Thu", meditation: 12, yoga: 20 },
  { day: "Fri", meditation: 20, yoga: 0 },
  { day: "Sat", meditation: 8, yoga: 28 },
  { day: "Sun", meditation: 24, yoga: 0 },
  { day: "Mon", meditation: 10, yoga: 34 },
  { day: "Tue", meditation: 18, yoga: 20 },
  { day: "Wed", meditation: 14, yoga: 0 },
];

export const sevenFactors = ["Mindfulness", "Investigation", "Energy", "Rapture", "Tranquility", "Concentration", "Equanimity"];
export const threeCharacteristics = ["Impermanence", "Not-self", "Unsatisfactoriness"];
export const fiveHindrances = ["Sense desire", "Ill will", "Sloth & torpor", "Restlessness", "Doubt"];

// Screens read through this boundary so demo data can later be replaced by
// an Apple Health / HealthKit-backed connector without rewriting the UI.
export const demoWellnessConnector = {
  source: "Demo data",
  cycle: () => demoCycle,
  timers: () => demoTimers,
  journal: () => demoEntries,
  weeklyPractice: () => weeklyPractice,
};
