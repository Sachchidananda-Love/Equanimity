import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativePracticePlan } from "../domain/practice/native-plan";

export type PracticeNativeStatus = {
  permission: string; soundEnabled: boolean; liveActivitiesEnabled: boolean;
  scheduled: number; requested: number; notificationScheduling: boolean;
};
type NotificationContentEvidence = { category?: string; thread?: string; titlePresent?: boolean; bodyPresent?: boolean; interruptionLevel?: number;
  mappedSoundFilename?: string; userInfoSoundFilename?: string; triggerType?: string; relevanceScore?: number };
export type PracticeNotificationEvidence = PracticeNativeStatus & {
  capturedAt: number;
  soundSetting: string; alertSetting: string; lockScreenSetting: string; scheduledDeliverySetting: string;
  delegateInstalled: boolean; pendingPracticeCount: number;
  requests: (NotificationContentEvidence & { id: string; intendedAt: number; triggerAt: number; soundFilename: string; soundPopulated: boolean; bundleExists: boolean; validSound: boolean; test: boolean })[];
  deliveredPracticeCount: number;
  deliveredRequests: (NotificationContentEvidence & { id: string; deliveredAt: number; soundFilename: string; soundPopulated: boolean })[];
  assets: { filename: string; exists: boolean; valid: boolean; duration: number; format: string }[];
};
export type PracticeDiagnostics = PracticeNotificationEvidence & {
  notificationTrace?: { at: number; event: string; id: string; reason: string; applicationState: number; banner?: boolean; list?: boolean; sound?: boolean }[];
  backgroundEvidence?: PracticeNotificationEvidence;
  foregroundEvidence?: PracticeNotificationEvidence;
};
type PracticeBridge = {
  status(): Promise<PracticeNativeStatus>;
  requestPermission(): Promise<PracticeNativeStatus>;
  sync(options: { plan: NativePracticePlan }): Promise<PracticeNativeStatus>;
  playDue(options: { sessionId: string; at: number }): Promise<void>;
  cancel(options: { completed: boolean; sessionId?: string }): Promise<void>;
  diagnostics(): Promise<PracticeDiagnostics>;
  testGong(options: { file: string }): Promise<PracticeDiagnostics>;
  testNotificationControl(options: { custom: boolean }): Promise<PracticeDiagnostics>;
};
const bridge = registerPlugin<PracticeBridge>("EquanimityPractice");
export const practiceNativeBridge: PracticeBridge = {
  status: () => bridge.status(), requestPermission: () => bridge.requestPermission(),
  sync: options => bridge.sync(options), cancel: options => bridge.cancel(options),
  playDue: options => bridge.playDue(options),
  diagnostics: () => bridge.diagnostics(), testGong: options => bridge.testGong(options),
  testNotificationControl: options => bridge.testNotificationControl(options),
};
export function isIosPractice() { return Capacitor.getPlatform() === "ios"; }

/** Serialize transitions, not ticks. A cancelled/account-switched operation
 * cannot make an old async result own playback or appear in a new view. */
export function createPracticeLockScreen({ native = practiceNativeBridge, isIos = isIosPractice } = {}) {
  let queue = Promise.resolve();
  let generation = 0;
  let ownsGongs = false;
  let plan: NativePracticePlan | null = null;
  let listener: ((status: PracticeNativeStatus | null) => void) | undefined;
  const enqueue = <T,>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action);
    queue = result.then(() => {}, () => {});
    return result;
  };
  function sync(next: NativePracticePlan) {
    if (!isIos()) return Promise.resolve();
    plan = next;
    const captured = ++generation;
    return enqueue(() => native.sync({ plan: next })).then(status => {
      if (captured !== generation) return;
      // A same-session reconcile after the final alert has no future requests;
      // keep ownership until cancellation so resume cannot replay that gong.
      ownsGongs = status.notificationScheduling || (ownsGongs && status.permission !== "denied" && status.permission !== "notDetermined");
      listener?.(status);
    }, () => { if (captured === generation) { ownsGongs = false; listener?.(null); } });
  }
  return {
    ownsGongs: () => ownsGongs,
    sync,
    reconcile: () => plan ? sync(plan) : Promise.resolve(),
    playDue(at: number) {
      if (!isIos() || !plan || !ownsGongs) return;
      const sessionId = plan.sessionId, captured = generation;
      void enqueue(async () => { if (captured === generation) await native.playDue({ sessionId, at }); }).catch(() => {});
    },
    cancel(completed = false) {
      const sessionId = plan?.sessionId;
      generation++; plan = null; ownsGongs = false;
      if (isIos()) void enqueue(() => native.cancel({ completed, ...(sessionId ? { sessionId } : {}) })).catch(() => {});
    },
    subscribe(callback: (status: PracticeNativeStatus | null) => void) {
      listener = callback;
      if (isIos()) void native.status().then(status => { if (listener === callback) callback(status); }, () => { if (listener === callback) callback(null); });
      return () => { if (listener === callback) listener = undefined; };
    },
    async requestPermission() {
      if (!isIos()) return;
      try { const status = await native.requestPermission(); listener?.(status); if (plan) await sync(plan); }
      catch { listener?.(null); }
    },
    async requestPermissionIfNeeded() {
      if (!isIos()) return;
      try {
        const status = await native.status();
        listener?.(status);
        // User-initiated timed Start only; not app launch or Stopwatch.
        if (status.permission === "notDetermined" || status.permission === "provisional") {
          listener?.(await native.requestPermission());
          if (plan) await sync(plan);
        }
      } catch { listener?.(null); }
    },
    diagnostics: () => native.diagnostics(),
    testGong: (file: string) => enqueue(() => native.testGong({ file })),
    testNotificationControl: (custom: boolean) => enqueue(() => native.testNotificationControl({ custom })),
  };
}
export type PracticeLockScreen = ReturnType<typeof createPracticeLockScreen>;
