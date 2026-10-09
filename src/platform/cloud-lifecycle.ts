import { lifecycleLog } from "./lifecycle-log";

type Session = { setOnline(online: boolean): void; resume(): void; checkDeviceAccess?(): void };
/** Online is a hint, not proof of Firebase reachability. SDK failures and the
 * outbox backoff handle captive portals and dropped connections separately. */
export function observeCloudLifecycle(session: Session, target: Window = window, page: Document = document) {
  lifecycleLog("network and lifecycle listeners attached");
  let online = target.navigator.onLine;
  let foreground = page.visibilityState !== "hidden";
  session.setOnline(online);
  const network = () => {
    const next = target.navigator.onLine;
    if (next === online) return;
    online = next; lifecycleLog(online ? "network online" : "network offline", { online }); session.setOnline(online);
  };
  const activity = (next: boolean) => {
    if (next === foreground) return;
    foreground = next; lifecycleLog(next ? "app foreground" : "app background");
    if (next) { network(); session.resume(); }
  };
  const visibility = () => activity(page.visibilityState !== "hidden");
  const native = (event: Event) => {
    lifecycleLog("native app-state received");
    activity(Boolean((event as CustomEvent<{ active: boolean }>).detail?.active));
  };
  const access = () => session.checkDeviceAccess?.();
  target.addEventListener("online", network); target.addEventListener("offline", network);
  target.addEventListener("equanimity:app-state", native); page.addEventListener("visibilitychange", visibility);
  target.addEventListener("storage", access);
  return () => {
    target.removeEventListener("online", network); target.removeEventListener("offline", network);
    target.removeEventListener("equanimity:app-state", native); page.removeEventListener("visibilitychange", visibility);
    target.removeEventListener("storage", access);
    lifecycleLog("network and lifecycle listeners detached");
  };
}
