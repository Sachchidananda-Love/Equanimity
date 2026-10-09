export interface DeviceCloudAccess {
  owner(): string | null;
  blocked(): boolean;
  remember(uid: string): void;
  revoke(): void;
  key: string;
}

/** Local authorization to reopen this device's last usable account cache, not
 * Firebase authentication. No token, password, email or dataset is copied here.
 * A durable tombstone prevents a delayed/failed SDK sign-out from reopening it. */
export function createDeviceCloudAccess(project: string, appId: string, storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.localStorage): DeviceCloudAccess {
  const key = `equanimity-cloud-access:${encodeURIComponent(project)}:${encodeURIComponent(appId)}`;
  type State = { schema: 1; project: string; appId: string; uid: string | null };
  function read(): State | null {
    const raw = storage().getItem(key);
    if (raw === null) return null;
    const state = JSON.parse(raw) as State;
    if (!state || state.schema !== 1 || state.project !== project || state.appId !== appId
      || !(state.uid === null || (typeof state.uid === "string" && state.uid.length > 0 && state.uid.length <= 128 && !state.uid.includes("/")))) throw new Error("Invalid device account access");
    return state;
  }
  function write(uid: string | null) {
    const raw = JSON.stringify({ schema: 1, project, appId, uid });
    const port = storage();
    port.setItem(key, raw);
    if (port.getItem(key) !== raw) throw new Error("Device account access could not be persisted");
  }
  return {
    key,
    owner() { try { return read()?.uid ?? null; } catch { return null; } },
    blocked() { try { return read()?.uid === null; } catch { return true; } },
    remember(uid) {
      if (!uid || uid.length > 128 || uid.includes("/")) throw new Error("Invalid account UID");
      if (this.owner() !== uid) write(uid);
    },
    revoke() { write(null); },
  };
}
