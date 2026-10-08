import type { RecordId } from "../ids";
export type CycleFlow = "None" | "Spotting" | "Light" | "Medium" | "Heavy";

export type CycleDayLog = {
  id: RecordId;
  date: string;
  flow: CycleFlow;
  cycleDayOne: boolean;
  temperature?: number;
  temperatureSource: "Manual" | "Tempdrop" | "Oral" | "Vaginal";
  temperatureDisplayOverride?: boolean;
  recordOrigin?: "user" | "legacy-unverified" | "sample" | "health-summary";
  healthSourceRecordIds?: Record<string, string[]>;
  recordedFields?: string[];
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
