import { Capacitor, registerPlugin } from "@capacitor/core";
import { lifecycleLog, lifecycleMeasure, lifecycleSpan } from "./lifecycle-log";

type NativeGong = { play(options: { file: string }): Promise<{ played: boolean }> };
const nativeGong = registerPlugin<NativeGong>("EquanimityGong");

/** iOS must not initialize WKWebView media in a UI/timer callback. Native file
 * preparation/playback runs on its own queue. Never fall back to that failing
 * web path on iOS; an unavailable gong must not interrupt practice. */
export function createGongPlayer({
  isIos = () => Capacitor.getPlatform() === "ios",
  playNative = (file: string) => nativeGong.play({ file }),
  createAudio = (source: string) => new Audio(source),
} = {}) {
  let active: HTMLAudioElement | null = null;
  return (source: string): void => {
    const finish = lifecycleSpan("practice audio initialization");
    try {
      if (isIos()) {
        lifecycleLog("practice native gong dispatched");
        void playNative(source.split("/").at(-1) ?? "").then(result => {
          lifecycleLog(result.played ? "practice gong playback started" : "practice gong unavailable");
          finish();
        }, () => { lifecycleLog("practice gong unavailable"); finish(); });
        return;
      }
      if (active) { active.pause(); active.currentTime = 0; }
      const audio = lifecycleMeasure("practice web audio construction", () => createAudio(source));
      active = audio;
      audio.volume = 0.82;
      audio.onended = () => { if (active === audio) active = null; };
      const fail = () => { if (active === audio) active = null; lifecycleLog("practice gong unavailable"); finish(); };
      audio.onerror = fail;
      void lifecycleMeasure("practice web audio play call", () => audio.play()).then(() => {
        lifecycleLog("practice gong playback started"); finish();
      }, fail);
    } catch { lifecycleLog("practice gong unavailable"); finish(); }
  };
}

export const playGong = createGongPlayer();
