import type { DataRepository } from "./repository-contracts";
import { lifecycleLog, lifecycleSpan } from "../platform/lifecycle-log";
import type { DeviceCloudAccess } from "../adapters/firebase/device-access";

export type AuthIdentity = { uid: string; email: string | null };
export type AuthState = "unauthenticated" | "authenticating" | "authenticated" | "authentication-error";
export type SaveState = "signed-out" | "local-only" | "pending" | "synced" | "failed";
export type CloudSnapshot = { auth: AuthState; identity: AuthIdentity | null; mode: "signed-out" | "local" | "cloud"; save: SaveState; operation: "loading" | "saving" | null; error: string; revision: number; online: boolean; cached: boolean };
export interface DeviceCloudRecovery { access: DeviceCloudAccess; repository(uid: string): DataRepository }
export interface CloudGateway {
  signIn(email: string, password: string): Promise<AuthIdentity | void>;
  signOut(): Promise<void>;
  observe(callback: (identity: AuthIdentity | null) => void): () => void;
  repository(uid: string): DataRepository;
}

/** No local repository is accepted here: authentication cannot import data. */
export function createCloudSession(connect: () => Promise<CloudGateway>, { cloudPrimary = false, restoreOnStart = false, recovery, initialOnline = true }: { cloudPrimary?: boolean; restoreOnStart?: boolean; recovery?: DeviceCloudRecovery; initialOnline?: boolean } = {}) {
  const resting = cloudPrimary ? { mode: "signed-out" as const, save: "signed-out" as const } : { mode: "local" as const, save: "local-only" as const };
  let snapshot: CloudSnapshot = { auth: "unauthenticated", identity: null, ...resting, operation: null, error: "", revision: 0, online: initialOnline, cached: false };
  let gateway: CloudGateway | undefined;
  let activeRepository: DataRepository | undefined;
  let generation = 0;
  let restoring = false;
  let signingOut = false;
  let signingIn = false;
  let signInIdentity: AuthIdentity | null | undefined;
  let allowAuthenticatedActivation = false;
  let accessClosed = recovery?.access.blocked() ?? false;
  let authIntent = 0;
  let explicitLocal = false;
  let connection: Promise<CloudGateway> | undefined;
  let stopSync: (() => void) | undefined;
  let finishAuth: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CloudSnapshot>) => { if (Object.entries(patch).every(([key, value]) => Object.is(snapshot[key as keyof CloudSnapshot], value))) return; snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const closeRepository = () => { stopSync?.(); stopSync = undefined; activeRepository?.dispose?.(); activeRepository = undefined; };
  const transportOnline = () => snapshot.online && snapshot.auth === "authenticated" && !snapshot.cached;
  function revokeAccess() { recovery?.access.revoke(); }
  function observeIdentity(identity: AuthIdentity | null) {
    lifecycleLog("auth observer fired", { authenticated: Boolean(identity), changed: identity?.uid !== snapshot.identity?.uid });
    if (signingOut && identity) return;
    if (signingIn) { signInIdentity = identity; return; }
    // A durable explicit sign-out/account-switch intent wins over an old SDK
    // user surviving a interrupted/slow signOut(). Only a new sign-in clears it.
    if (identity && (accessClosed || recovery?.access.blocked()) && !allowAuthenticatedActivation) identity = null;
    finishAuth?.(); finishAuth = undefined;
    const wasRestoring = restoring;
    restoring = false;
    const changed = identity?.uid !== snapshot.identity?.uid;
    if (!identity || (changed && snapshot.identity)) {
      try { revokeAccess(); } catch { lifecycleLog("device account access revocation failed"); }
    }
    if (changed) { generation++; closeRepository(); update({ ...(explicitLocal ? { mode: "local" as const, save: "local-only" as const } : resting), cached: false, operation: null, error: "", revision: snapshot.revision + 1 }); }
    allowAuthenticatedActivation = Boolean(identity);
    accessClosed = !identity;
    const signOutFailed = !identity && snapshot.auth === "authentication-error" && snapshot.error.startsWith("Sign-out");
    update({ identity, cached: false, auth: identity ? "authenticated" : signOutFailed ? "authentication-error" : wasRestoring ? "unauthenticated" : snapshot.auth === "authenticating" ? "authenticating" : "unauthenticated" });
    if (identity && cloudPrimary && !explicitLocal) {
      if (changed || !activeRepository) session.selectCloud();
      else { activeRepository.setOnline?.(transportOnline()); rememberUsableAccount(); }
    }
  }
  function rememberUsableAccount() {
    if (!recovery || snapshot.cached || snapshot.auth !== "authenticated" || !snapshot.identity || !activeRepository?.syncStatus?.().writable) return;
    try { recovery.access.remember(snapshot.identity.uid); }
    catch { update({ error: "Device account access could not be saved. Offline relaunch may require sign-in; current data remains available." }); }
  }
  const failure = (error: unknown, loading: boolean) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "permission-denied" || code === "firestore/permission-denied") return "Cloud permission denied. Check this UID's administrator approval and Firestore rules. No local data was uploaded. Reload after access is restored.";
    return loading ? "Private cloud data could not be loaded. Editing is disabled. Check connection and account access, then reload. No local data was uploaded." : "Cloud save failed or conflicted. Editing is paused; unsaved changes remain only in this view. Record them before reloading. No local copy or automatic retry was made.";
  };
  function connectOnce(): Promise<CloudGateway> {
    if (gateway) return Promise.resolve(gateway);
    if (!connection) connection = (async () => {
      gateway = await connect();
      gateway.observe(observeIdentity);
      return gateway;
    })().catch(error => { connection = undefined; throw error; });
    return connection;
  }
  const session = {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    repository: () => activeRepository,
    async signIn(email: string, password: string) {
      if (signingOut || snapshot.auth === "authenticating") return;
      try { revokeAccess(); } catch { update({ error: "Could not close previous device account access. Sign-in was not started; retry on this device." }); return; }
      // Explicit sign-in returns to the cloud account; only passive restoration
      // should preserve a user's deliberate local-fallback selection.
      explicitLocal = false;
      signingIn = true; signInIdentity = undefined; allowAuthenticatedActivation = false;
      accessClosed = true; const attempt = ++authIntent;
      generation++; closeRepository();
      update({ identity: null, cached: false, ...resting, operation: null, revision: snapshot.revision + 1 });
      update({ auth: "authenticating", error: "" });
      try {
        const identity = await (await connectOnce()).signIn(email, password);
        if (attempt !== authIntent) return;
        signingIn = false; allowAuthenticatedActivation = true;
        if (identity || signInIdentity !== undefined) observeIdentity(identity || signInIdentity || null);
      } catch { if (attempt === authIntent) { signingIn = false; update({ auth: "authentication-error", error: "Sign-in failed. Check configuration, connection, and credentials." }); } }
    },
    async signOut() {
      signingOut = true; explicitLocal = false;
      authIntent++; signingIn = false; signInIdentity = undefined;
      allowAuthenticatedActivation = false; accessClosed = true;
      generation++; closeRepository();
      update({ identity: null, cached: false, ...resting, operation: null, revision: snapshot.revision + 1, auth: "authenticating", error: "" });
      try { revokeAccess(); const connected = gateway ?? (connection ? await connection : undefined); await connected?.signOut(); restoring = false; finishAuth?.(); finishAuth = undefined; update({ auth: "unauthenticated" }); }
      catch { update({ auth: "authentication-error", error: "Sign-out could not be completed. Private data is closed in this view; retry sign-out before sharing this device." }); }
      finally { signingOut = false; }
    },
    selectCloud(cacheOnly = false) {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud operation before reloading");
      if (!snapshot.identity || (cacheOnly ? recovery?.access.owner() !== snapshot.identity.uid : !gateway || snapshot.auth !== "authenticated")) throw new Error("Sign in before selecting cloud data");
      lifecycleLog("cloud activation started");
      explicitLocal = false;
      const uid = snapshot.identity.uid; const captured = ++generation; const base = recovery ? recovery.repository(uid) : gateway!.repository(uid);
      closeRepository();
      const guard = () => { if (captured !== generation || snapshot.identity?.uid !== uid || (snapshot.auth !== "authenticated" && !(snapshot.cached && recovery?.access.owner() === uid))) throw new Error("Cloud session changed; operation cancelled"); };
      const serverGuard = () => { guard(); if (snapshot.cached || snapshot.auth !== "authenticated") throw Object.assign(new Error("Waiting for matching Firebase authentication"), { code: "unavailable" }); };
      let queue = Promise.resolve();
      let pending = 0;
      const selected: DataRepository = {
        async load(widgets) {
          serverGuard();
          if (pending) throw new Error("Wait for pending cloud writes before reloading");
          update({ save: "pending", operation: "loading", error: "" });
          try { const data = await base.load(widgets); guard(); queue = Promise.resolve(); if (!base.syncStatus) update({ save: "synced", operation: null }); return data; }
          catch (error) { if (captured === generation && !base.syncStatus) update({ save: "failed", operation: null, error: failure(error, true) }); throw error; }
        },
        save: (key, value) => selected.saveMany({ [key]: value }),
        saveMany(changes) {
          serverGuard(); if (snapshot.save === "failed") throw new Error("Reload cloud data before retrying failed writes");
          pending++; update({ save: "pending", operation: "saving", error: "" });
          const immutable = structuredClone(changes);
          const operation = queue.then(async () => {
            serverGuard(); await base.saveMany(immutable); serverGuard();
          });
          // A rejected operation must not poison all subsequent queue entries.
          queue = operation.catch(() => {});
          void operation.then(() => { pending--; if (captured === generation && pending === 0 && !base.syncStatus) update({ save: "synced", operation: null }); }, error => { pending--; if (captured === generation && !base.syncStatus) update({ save: "failed", operation: null, error: failure(error, false) }); });
          return operation;
        },
      };
      if (base.restore) selected.restore = async () => { guard(); const data = await base.restore!(); guard(); return data; };
      if (base.enqueue) selected.enqueue = async changes => { guard(); await base.enqueue!(changes); guard(); };
      if (base.refresh) selected.refresh = async () => { guard(); if (!transportOnline()) return; await base.refresh!(); guard(); };
      if (base.subscribeData) selected.subscribeData = listener => base.subscribeData!(data => { if (captured === generation) listener(data); });
      if (base.subscribeSync) selected.subscribeSync = listener => base.subscribeSync!(() => { if (captured === generation) listener(); });
      selected.syncStatus = base.syncStatus;
      selected.dispose = base.dispose;
      if (base.setOnline) selected.setOnline = online => base.setOnline!(online && snapshot.auth === "authenticated" && !snapshot.cached);
      activeRepository = selected;
      update({ mode: "cloud", cached: cacheOnly, save: "pending", operation: "loading", error: "", revision: snapshot.revision + 1 });
      if (base.subscribeSync) {
        const sync = () => {
          if (captured !== generation) return;
          const state = base.syncStatus!();
          lifecycleLog("reconnect state changed", { phase: state.phase, pending: state.pending, ready: state.writable });
          update({ save: state.phase === "failed" ? "failed" : snapshot.cached || !state.writable || state.pending || state.phase === "loading" || state.phase === "saving" ? "pending" : "synced", operation: state.phase === "loading" ? "loading" : state.phase === "saving" ? "saving" : null, error: state.error });
          rememberUsableAccount();
        };
        stopSync = base.subscribeSync(sync);
        base.setOnline?.(transportOnline());
      }
      lifecycleLog("cloud activation completed");
    },
    selectLocal() {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud write before switching");
      revokeAccess(); explicitLocal = true; generation++; closeRepository(); update({ mode: "local", cached: false, save: "local-only", operation: null, error: "", revision: snapshot.revision + 1 });
    },
    setOnline(online: boolean) {
      update({ online }); activeRepository?.setOnline?.(online);
      if (online && snapshot.auth === "authentication-error" && restoreOnStart) session.restore();
    },
    resume() {
      lifecycleLog("cloud resume requested", { online: snapshot.online });
      if (snapshot.online && activeRepository?.refresh) void activeRepository.refresh().catch(() => {});
      if (snapshot.online && snapshot.auth === "authentication-error" && restoreOnStart) session.restore();
    },
    retry() {
      if (snapshot.cached && snapshot.auth === "authentication-error") session.restore();
      else if (activeRepository?.refresh) void activeRepository.refresh().catch(() => {});
      else if (snapshot.auth === "authenticated") session.selectCloud();
      else session.restore();
    },
    restore() {
      if (restoring) return;
      if (gateway) return; // Only the SDK observer can confirm authentication.
      restoring = true; finishAuth = lifecycleSpan("auth restoration");
      const attempt = authIntent;
      update({ auth: "authenticating", error: "" });
      void connectOnce().catch(() => { finishAuth?.(); finishAuth = undefined; restoring = false; if (attempt === authIntent) update({ auth: "authentication-error", error: "Could not restore the saved Firebase session. Navigation remains available. Check your connection and retry." }); });
    },
    checkDeviceAccess() {
      if (!recovery || !snapshot.identity || recovery.access.owner() === snapshot.identity.uid) return;
      authIntent++; generation++; closeRepository(); allowAuthenticatedActivation = false; accessClosed = true;
      update({ identity: null, cached: false, ...resting, auth: "unauthenticated", operation: null, error: "", revision: snapshot.revision + 1 });
    },
  };
  if (restoreOnStart && cloudPrimary) {
    const uid = recovery?.access.owner();
    if (uid) { update({ identity: { uid, email: null }, auth: "authenticating" }); session.selectCloud(true); }
    session.restore();
  }
  return session;
}
