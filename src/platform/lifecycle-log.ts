type DiagnosticWindow = Window & { __EQUANIMITY_LIFECYCLE_DEBUG__?: boolean; __EQUANIMITY_LIFECYCLE_START__?: number };
type DiagnosticDetail = {
  elapsedMs?: number; pending?: number; online?: boolean; ready?: boolean;
  changed?: boolean; authenticated?: boolean;
  phase?: "idle" | "loading" | "saving" | "offline" | "failed";
};
const started = performance.now();
const counts = new Map<string, number>();

export function lifecycleDiagnosticsEnabled() {
  return typeof window !== "undefined" && ((window as DiagnosticWindow).__EQUANIMITY_LIFECYCLE_DEBUG__ === true
    || import.meta.env?.DEV || import.meta.env?.MODE === "development"
    || (typeof process !== "undefined" && process.env.NODE_ENV === "development"));
}

/** Temporary, bounded development instrumentation. Only fixed caller-owned
 * event names, elapsed milliseconds, pending counts and state flags are allowed.
 * The native DEBUG flag works even with ordinary production-mode web assets. */
export function lifecycleLog(event: string, detail: DiagnosticDetail = {}) {
  if (!lifecycleDiagnosticsEnabled()) return;
  const count = (counts.get(event) ?? 0) + 1;
  counts.set(event, count);
  // Show repeated events without flooding the native bridge or amplifying a loop.
  if (event !== "JS heartbeat" && count > 8 && (count > 1024 || (count & (count - 1)) !== 0)) return;
  const safe: DiagnosticDetail = {};
  for (const key of ["elapsedMs", "pending"] as const) if (typeof detail[key] === "number" && Number.isFinite(detail[key])) safe[key] = detail[key];
  for (const key of ["online", "ready", "changed", "authenticated"] as const) if (typeof detail[key] === "boolean") safe[key] = detail[key];
  if (detail.phase && ["idle", "loading", "saving", "offline", "failed"].includes(detail.phase)) safe.phase = detail.phase;
  const origin = (window as DiagnosticWindow).__EQUANIMITY_LIFECYCLE_START__ ?? started;
  console.debug(`[Equanimity diag] +${Math.round(performance.now() - origin)}ms ${event} #${count}`, safe);
}
export function lifecycleSpan(event: string) {
  const started = performance.now();
  lifecycleLog(`${event} start`);
  return () => lifecycleLog(`${event} end`, { elapsedMs: Math.round(performance.now() - started) });
}

export function lifecycleMeasure<T>(event: string, action: () => T): T {
  if (!lifecycleDiagnosticsEnabled()) return action();
  const finish = lifecycleSpan(event);
  try { return action(); } finally { finish(); }
}

/** Independent JS liveness marker. No polling, recovery, data reads or state
 * updates. Stop after a minute and remove all handlers on unmount. */
export function observeUiDiagnostics(target: Window = window) {
  if (!lifecycleDiagnosticsEnabled()) return () => {};
  lifecycleLog("app shell mounted");
  let beats = 0;
  const timer = target.setInterval(() => {
    lifecycleLog("JS heartbeat");
    if (++beats === 60) { target.clearInterval(timer); lifecycleLog("JS heartbeat finished"); }
  }, 1000);
  const pointer = () => lifecycleLog("UI pointer received");
  const error = () => lifecycleLog("unexpected JS error");
  const rejection = () => lifecycleLog("unexpected promise rejection");
  target.addEventListener("pointerdown", pointer, true);
  target.addEventListener("error", error);
  target.addEventListener("unhandledrejection", rejection);
  return () => {
    target.clearInterval(timer);
    target.removeEventListener("pointerdown", pointer, true);
    target.removeEventListener("error", error);
    target.removeEventListener("unhandledrejection", rejection);
    lifecycleLog("app shell unmounted");
  };
}
