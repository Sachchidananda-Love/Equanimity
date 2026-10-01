export type ActivityType = string;

export type AssessmentValue = {
  value: number;
  note?: string;
};

export type JournalEntry = {
  id: number;
  type: ActivityType | "Journal" | "Gratitude" | "Period";
  title: string;
  date: string;
  duration?: number;
  note?: string;
  mood?: string;
  assessments?: Record<string, AssessmentValue>;
  tags?: string[];
};

export type TimerPreset = {
  id: number;
  name: string;
  seconds: number;
  color: "sage" | "gold" | "coral";
  interval?: number;
  gongs?: number[];
  gongSounds?: string[];
  startGong?: string;
  endGong?: string;
  intervalGong?: string;
};

export type ActivityPreset = {
  id: number;
  name: string;
  icon: string;
  color: "sage" | "gold" | "coral" | "plum";
};

export type CycleFlow = "None" | "Spotting" | "Light" | "Medium" | "Heavy";

export type CycleDayLog = {
  id: number;
  date: string;
  flow: CycleFlow;
  cycleDayOne: boolean;
  temperature?: number;
  temperatureSource: "Tempdrop" | "Oral" | "Vaginal";
  questionableTemperature: boolean;
  cervicalMucus: "None / dry" | "Sticky" | "Creamy" | "Watery" | "Egg white";
  mucusSensation: "Dry" | "Damp" | "Wet" | "Slippery";
  cervixPosition: "Low" | "Medium" | "High";
  cervixFirmness: "Firm" | "Medium" | "Soft";
  cervixOpening: "Closed" | "Medium" | "Open";
  ovulationTest: "Not tested" | "Negative" | "Positive" | "Low" | "High" | "Peak";
  pregnancyTest: "Not tested" | "Negative" | "Positive";
  intercourse: boolean;
  symptoms: string[];
  energy: number;
  sexDrive: number;
  pms: number;
  disturbances: string[];
  medicationNote?: string;
  notes?: string;
  sleepScore?: number;
  sleepMinutes?: number;
  deepSleepMinutes?: number;
  sleepLatencyMinutes?: number;
  sleepInterruptions?: number;
};

export type CycleLog = {
  lastPeriod: string;
  averageCycle: number;
  averagePeriod: number;
  flow: CycleFlow;
  symptoms: string[];
  temperature?: number;
  history: CycleDayLog[];
};

export type InsightWidgetId = "practice" | "cycle" | "factors" | "faculties" | "characteristics" | "hindrances" | "body" | "meditation" | "yoga";

export const demoCycle = {
  day: 8,
  phase: "Follicular phase",
  nextPeriodIn: 16,
  fertileWindowIn: 4,
  averageCycle: 29,
  lastPeriod: "September 23",
};

export const demoTimers: TimerPreset[] = [
  { id: 1, name: "Morning clarity", seconds: 600, color: "sage", gongs: [300], startGong: "Deep temple bowl", endGong: "Deep temple bowl" },
  { id: 2, name: "Deep sit", seconds: 1200, color: "gold", interval: 300, intervalGong: "Soft woodblock", startGong: "Bright singing bowl", endGong: "Deep temple bowl" },
  { id: 3, name: "Evening release", seconds: 900, color: "coral", gongs: [180, 780], startGong: "Deep temple bowl", endGong: "Bright singing bowl" },
];

export const demoActivities: ActivityPreset[] = [
  { id: 1, name: "Meditation", icon: "◌", color: "sage" },
  { id: 2, name: "Yoga", icon: "⌁", color: "gold" },
  { id: 3, name: "Workout", icon: "↯", color: "coral" },
  { id: 4, name: "Walking", icon: "↟", color: "plum" },
];

export const defaultInsightWidgets: InsightWidgetId[] = ["practice", "cycle", "factors", "faculties", "characteristics", "hindrances", "meditation", "yoga"];

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
export const fiveFaculties = ["Faith", "Energy", "Mindfulness", "Concentration", "Wisdom"];
export const threeCharacteristics = ["Impermanence", "Not-self", "Unsatisfactoriness"];
export const fiveHindrances = ["Sense desire", "Ill will", "Sloth & torpor", "Restlessness", "Doubt"];

// Screens read through this boundary so demo data can later be replaced by
// an Apple Health / HealthKit-backed connector without rewriting the UI.
export const demoWellnessConnector = {
  source: "Demo data",
  cycle: () => demoCycle,
  timers: () => demoTimers,
  activities: () => demoActivities,
  journal: () => demoEntries,
  weeklyPractice: () => weeklyPractice,
};
