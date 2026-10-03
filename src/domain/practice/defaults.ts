import type { TimerPreset, ActivityPreset } from "./types";
export const defaultTimers: TimerPreset[] = [
  { id: 1, name: "Morning clarity", seconds: 600, color: "sage", gongs: [300], startGong: "Gong 1", endGong: "Gong 1" },
  { id: 2, name: "Deep sit", seconds: 1200, color: "gold", interval: 300, intervalGong: "Gong 3", startGong: "Gong 2", endGong: "Gong 1" },
  { id: 3, name: "Evening release", seconds: 900, color: "coral", gongs: [180, 780], startGong: "Gong 1", endGong: "Gong 2" },
];

export const defaultActivities: ActivityPreset[] = [
  { id: 1, name: "Meditation", icon: "◌", color: "sage" },
  { id: 2, name: "Maintenance Yoga", icon: "⌁", color: "gold" },
  { id: 3, name: "Work Out Yoga", icon: "△", color: "coral" },
  { id: 4, name: "Workout", icon: "↯", color: "coral" },
  { id: 5, name: "Walking", icon: "↟", color: "plum" },
];
