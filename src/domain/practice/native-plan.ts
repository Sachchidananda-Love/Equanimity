import type { StoredPractice } from "./types";

export type PracticeGongEvent = { id: string; at: number; file: string; final: boolean };
export type NativePracticePlan = { sessionId: string; startedAt: number; endAt: number; title: string; events: PracticeGongEvent[] };
export const PRACTICE_GONG_FILES: Record<string, string> = {
  "Gong 1": "gong-1.wav", "Gong 2": "gong-2.wav", "Gong 3": "gong-3.wav", "Tripple Gong": "tripple-gong.wav",
};
const sounds = PRACTICE_GONG_FILES;

/** A projection of the existing deadline/config, never a separate clock. Custom
 * gongs take precedence over repeating gongs at the same offset, as in Practice. */
export function nativePracticePlan(record: StoredPractice): NativePracticePlan | null {
  if (record.mode !== "Timer" || !record.endAt || !Number.isFinite(record.endAt)
    || !Number.isFinite(record.duration) || record.duration <= 0) return null;
  const sessionId = record.sessionId ?? `legacy-${record.endAt}`;
  const startedAt = record.endAt - record.duration * 1000;
  const offsets = new Map<number, string>();
  const interval = Math.max(1, record.intervalMinutes) * 60;
  if (record.intervalEnabled && Number.isFinite(interval)) {
    for (let seconds = interval; seconds < record.duration; seconds += interval) offsets.set(seconds, sounds[record.intervalGong] ?? sounds["Gong 3"]);
  }
  record.customGongs.forEach((minutes, index) => {
    const seconds = minutes * 60;
    if (Number.isFinite(seconds) && seconds > 0 && seconds < record.duration) {
      // Existing UI uses the first custom gong when offsets coincide.
      if (record.customGongs.indexOf(minutes) === index) offsets.set(seconds, sounds[record.customGongSounds?.[index]] ?? sounds["Gong 3"]);
    }
  });
  offsets.set(record.duration, sounds[record.closingGong] ?? sounds["Gong 1"]);
  return { sessionId, startedAt, endAt: record.endAt, title: "Practice",
    events: [...offsets].sort(([a], [b]) => a - b).map(([seconds, file]) => ({
      id: `equanimity.practice.${sessionId}.gong.${seconds}`, at: startedAt + seconds * 1000,
      file, final: seconds === record.duration,
    })),
  };
}
