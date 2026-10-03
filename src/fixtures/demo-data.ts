import type { JournalEntry } from "../domain/journal/types";
import type { CycleDayLog, CycleLog } from "../domain/cycle/types";
export const demoEntries: JournalEntry[] = [
  { id: 1, type: "Meditation", title: "Evening sit", date: "Sep 29 · 8:42 PM", duration: 20, mood: "Calm and spacious", note: "The breath softened once I stopped trying to arrange it." },
  { id: 2, type: "Gratitude", title: "Three small things", date: "Sep 29 · 9:05 AM", note: "Warm tea, the first red maple, and an unhurried conversation." },
  { id: 3, type: "Maintenance Yoga", title: "Slow morning flow", date: "Sep 28 · 7:15 AM", duration: 34, mood: "Grounded", note: "Hips felt open. Kept the pace gentle." },
  { id: 4, type: "Period", title: "Cycle day 1", date: "Sep 23", note: "Light flow · mild cramps" },
  { id: 5, type: "Meditation", title: "Open awareness", date: "Sep 22 · 6:10 PM", duration: 26, mood: "Bright" },
];

export const weeklyPractice = [
  { day: "Thu", meditation: 12, maintenanceYoga: 20, workoutYoga: 0 },
  { day: "Fri", meditation: 20, maintenanceYoga: 0, workoutYoga: 0 },
  { day: "Sat", meditation: 8, maintenanceYoga: 0, workoutYoga: 28 },
  { day: "Sun", meditation: 24, maintenanceYoga: 0, workoutYoga: 0 },
  { day: "Mon", meditation: 10, maintenanceYoga: 34, workoutYoga: 0 },
  { day: "Tue", meditation: 18, maintenanceYoga: 0, workoutYoga: 20 },
  { day: "Wed", meditation: 14, maintenanceYoga: 0, workoutYoga: 0 },
];

export const initialCycleHistory: CycleDayLog[] = [
  { id: 1, date: "2026-09-23", flow: "Light", cycleDayOne: true, temperature: 36.42, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "None / dry", mucusSensation: "Dry", cervixPosition: "Low", cervixFirmness: "Firm", cervixOpening: "Closed", ovulationTest: "Not tested", pregnancyTest: "Not tested", intercourse: false, symptoms: ["Cramps"], energy: 34, sexDrive: 28, pms: 42, disturbances: [], sleepScore: 79, sleepMinutes: 458, deepSleepMinutes: 82, sleepLatencyMinutes: 14, sleepInterruptions: 2 },
  { id: 2, date: "2026-09-24", flow: "Medium", cycleDayOne: false, temperature: 36.39, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "None / dry", mucusSensation: "Dry", cervixPosition: "Low", cervixFirmness: "Firm", cervixOpening: "Closed", ovulationTest: "Not tested", pregnancyTest: "Not tested", intercourse: false, symptoms: ["Cramps", "Fatigue"], energy: 31, sexDrive: 24, pms: 35, disturbances: [], sleepScore: 74, sleepMinutes: 431, deepSleepMinutes: 76, sleepLatencyMinutes: 18, sleepInterruptions: 3 },
  { id: 3, date: "2026-09-25", flow: "Medium", cycleDayOne: false, temperature: 36.41, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "Sticky", mucusSensation: "Damp", cervixPosition: "Low", cervixFirmness: "Firm", cervixOpening: "Closed", ovulationTest: "Negative", pregnancyTest: "Not tested", intercourse: false, symptoms: ["Bloating"], energy: 43, sexDrive: 31, pms: 27, disturbances: [], sleepScore: 82, sleepMinutes: 472, deepSleepMinutes: 91, sleepLatencyMinutes: 11, sleepInterruptions: 1 },
  { id: 4, date: "2026-09-26", flow: "Light", cycleDayOne: false, temperature: 36.38, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "Creamy", mucusSensation: "Damp", cervixPosition: "Medium", cervixFirmness: "Medium", cervixOpening: "Medium", ovulationTest: "Low", pregnancyTest: "Not tested", intercourse: true, symptoms: [], energy: 56, sexDrive: 46, pms: 18, disturbances: [], sleepScore: 86, sleepMinutes: 489, deepSleepMinutes: 97, sleepLatencyMinutes: 9, sleepInterruptions: 1 },
  { id: 5, date: "2026-09-27", flow: "Spotting", cycleDayOne: false, temperature: 36.44, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "Creamy", mucusSensation: "Wet", cervixPosition: "Medium", cervixFirmness: "Medium", cervixOpening: "Medium", ovulationTest: "High", pregnancyTest: "Not tested", intercourse: false, symptoms: ["Headache"], energy: 62, sexDrive: 58, pms: 14, disturbances: ["Alcohol"], sleepScore: 70, sleepMinutes: 405, deepSleepMinutes: 63, sleepLatencyMinutes: 24, sleepInterruptions: 4 },
  { id: 6, date: "2026-09-28", flow: "None", cycleDayOne: false, temperature: 36.47, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "Watery", mucusSensation: "Wet", cervixPosition: "High", cervixFirmness: "Soft", cervixOpening: "Open", ovulationTest: "Peak", pregnancyTest: "Not tested", intercourse: true, symptoms: [], energy: 72, sexDrive: 73, pms: 10, disturbances: [], sleepScore: 88, sleepMinutes: 496, deepSleepMinutes: 104, sleepLatencyMinutes: 8, sleepInterruptions: 1 },
  { id: 7, date: "2026-09-29", flow: "None", cycleDayOne: false, temperature: 36.51, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "Egg white", mucusSensation: "Slippery", cervixPosition: "High", cervixFirmness: "Soft", cervixOpening: "Open", ovulationTest: "Positive", pregnancyTest: "Not tested", intercourse: false, symptoms: ["Tenderness"], energy: 76, sexDrive: 81, pms: 8, disturbances: [], sleepScore: 90, sleepMinutes: 501, deepSleepMinutes: 108, sleepLatencyMinutes: 7, sleepInterruptions: 1 },
  { id: 8, date: "2026-09-30", flow: "None", cycleDayOne: false, temperature: 36.58, temperatureSource: "Tempdrop", questionableTemperature: false, cervicalMucus: "Creamy", mucusSensation: "Damp", cervixPosition: "Medium", cervixFirmness: "Medium", cervixOpening: "Closed", ovulationTest: "High", pregnancyTest: "Not tested", intercourse: false, symptoms: [], energy: 69, sexDrive: 64, pms: 12, disturbances: [], sleepScore: 84, sleepMinutes: 475, deepSleepMinutes: 94, sleepLatencyMinutes: 12, sleepInterruptions: 2 },
];
export const initialCycleLog: CycleLog = { lastPeriod: "2026-09-23", averageCycle: 29, averagePeriod: 5, flow: "None", symptoms: [], temperature: 36.58, history: initialCycleHistory };
