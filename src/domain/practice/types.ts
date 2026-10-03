import type { RecordId } from "../ids";
export type TimerPreset = {
  id: RecordId;
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
  id: RecordId;
  name: string;
  icon: string;
  color: "sage" | "gold" | "coral" | "plum";
};


export type StoredPractice = {
  mode: "Timer" | "Stopwatch";
  duration: number;
  endAt?: number;
  startedAt?: number;
  openingGong: string;
  closingGong: string;
  intervalEnabled: boolean;
  intervalMinutes: number;
  intervalGong: string;
  customGongs: number[];
  customGongSounds: string[];
};

export type StoredQuoteRotation = { signature: string; order: number[]; day: number; position: number };
