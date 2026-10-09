import type { DataRepository } from "./repository-contracts";
import { lifecycleLog, lifecycleSpan } from "../platform/lifecycle-log";

export type AuthIdentity = { uid: string; email: string | null };
export type AuthState = "unauthenticated" | "authenticating" | "authenticated" | "authentication-error";
export type SaveState = "signed-out" | "local-only" | "pending" | "synced" | "failed";
export type CloudSnapshot = { auth: AuthState; identity: AuthIdentity | null; mode: "signed-out" | "local" | "cloud"; save: SaveState; operation: "loading" | "saving" | null; error: string; revision: number; online: boolean };
export interface CloudGateway {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  observe(callback: (identity: AuthIdentity | null) => void): () => void;
  repository(uid: string): DataRepository;
}

/** No local repository is accepted here: authentication cannot import data. */
export function createCloudSession(connect: () => Promise<CloudGateway>, { cloudPrimary = false, restoreOnStart = false } = {}) {
  const resting = cloudPrimary ? { mode: "signed-out" as const, save: "signed-out" as const } : { mode: "local" as const, save: "local-only" as const };
  let snapshot: CloudSnapshot = { auth: "unauthenticated", identity: null, ...resting, operation: null, error: "", revision: 0, online: true };
  let gateway: CloudGateway | undefined;
  let activeRepository: DataRepository | undefined;
  let generation = 0;
  let restoring = false;
  let signingOut = false;
  let explicitLocal = false;
  let connection: Promise<CloudGateway> | undefined;
  let stopSync: (() => void) | undefined;
  let finishAuth: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CloudSnapshot>) => { if (Object.entries(patch).every(([key, value]) => Object.is(snapshot[key as keyof CloudSnapshot], value))) return; snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const closeRepository = () => { stopSync?.(); stopSync = undefined; activeRepository?.dispose?.(); activeRepository = undefined; };
  const failure = (error: unknown, loading: boolean) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "permission-denied" || code === "firestore/permission-denied") return "Cloud permission denied. Check this UID's administrator approval and Firestore rules. No local data was uploaded. Reload after access is restored.";
    return loading ? "Private cloud data could not be loaded. Editing is disabled. Check connection and account access, then reload. No local data was uploaded." : "Cloud save failed or conflicted. Editing is paused; unsaved changes remain only in this view. Record them before reloading. No local copy or automatic retry was made.";
  };
  function connectOnce(): Promise<CloudGateway> {
    if (gateway) return Promise.resolve(gateway);
    if (!connection) connection = (async () => {
      gateway = await connect();
      gateway.observe(identity => {
        lifecycleLog("auth observer fired", { authenticated: Boolean(identity), changed: identity?.uid !== snapshot.identity?.uid });
        if (signingOut && identity) return;
        finishAuth?.(); finishAuth = undefined;
        const wasRestoring = restoring;
        restoring = false;
        const changed = identity?.uid !== snapshot.identity?.uid;
        if (changed) { generation++; closeRepository(); update({ ...(explicitLocal ? { mode: "local" as const, save: "local-only" as const } : resting), operation: null, error: "", revision: snapshot.revision + 1 }); }
        update({ identity, auth: identity ? "authenticated" : wasRestoring ? "unauthenticated" : snapshot.auth === "authenticating" ? "authenticating" : "unauthenticated" });
        if (changed && identity && cloudPrimary && !explicitLocal) session.selectCloud();
      });
      return gateway;
    })().catch(error => { connection = undefined; throw error; });
    return connection;
  }
  const session = {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    repository: () => activeRepository,
    async signIn(email: string, password: string) {
      if (snapshot.auth === "authenticating") return;
      update({ auth: "authenticating", error: "" });
      try { await (await connectOnce()).signIn(email, password); }
      catch { update({ auth: "authentication-error", error: "Sign-in failed. Check configuration, connection, and credentials." }); }
    },
    async signOut() {
      signingOut = true; explicitLocal = false;
      generation++; closeRepository();
      update({ identity: null, ...resting, operation: null, revision: snapshot.revision + 1, auth: "authenticating", error: "" });
      try { const connected = gateway ?? (connection ? await connection : undefined); await connected?.signOut(); restoring = false; finishAuth?.(); finishAuth = undefined; update({ auth: "unauthenticated" }); }
      catch { update({ auth: "authentication-error", error: "Sign-out failed. Reload to clear this in-memory session." }); }
      finally { signingOut = false; }
    },
    selectCloud() {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud operation before reloading");
      if (!gateway || snapshot.auth !== "authenticated" || !snapshot.identity) throw new Error("Sign in before selecting cloud data");
      lifecycleLog("cloud activation started");
      explicitLocal = false;
      const uid = snapshot.identity.uid; const captured = ++generation; const base = gateway.repository(uid);
      closeRepository();
      const guard = () => { if (captured !== generation || snapshot.identity?.uid !== uid || snapshot.auth !== "authenticated") throw new Error("Cloud session changed; operation cancelled"); };
      let queue = Promise.resolve();
      let pending = 0;
      const selected: DataRepository = {
        async load(widgets) {
          guard();
          if (pending) throw new Error("Wait for pending cloud writes before reloading");
          update({ save: "pending", operation: "loading", error: "" });
          try { const data = await base.load(widgets); guard(); queue = Promise.resolve(); if (!base.syncStatus) update({ save: "synced", operation: null }); return data; }
          catch (error) { if (captured === generation && !base.syncStatus) update({ save: "failed", operation: null, error: failure(error, true) }); throw error; }
        },
        save: (key, value) => selected.saveMany({ [key]: value }),
        saveMany(changes) {
          guard(); if (snapshot.save === "failed") throw new Error("Reload cloud data before retrying failed writes");
          pending++; update({ save: "pending", operation: "saving", error: "" });
          const immutable = structuredClone(changes);
          const operation = queue.then(async () => {
            guard(); await base.saveMany(immutable); guard();
          });
          // A rejected operation must not poison all subsequent queue entries.
          queue = operation.catch(() => {});
          void operation.then(() => { pending--; if (captured === generation && pending === 0 && !base.syncStatus) update({ save: "synced", operation: null }); }, error => { pending--; if (captured === generation && !base.syncStatus) update({ save: "failed", operation: null, error: failure(error, false) }); });
          return operation;
        },
      };
      if (base.restore) selected.restore = async () => { guard(); const data = await base.restore!(); guard(); return data; };
      if (base.enqueue) selected.enqueue = async changes => { guard(); await base.enqueue!(changes); guard(); };
      if (base.refresh) selected.refresh = async () => { guard(); await base.refresh!(); guard(); };
      if (base.subscribeData) selected.subscribeData = listener => base.subscribeData!(data => { if (captured === generation) listener(data); });
      if (base.subscribeSync) selected.subscribeSync = listener => base.subscribeSync!(() => { if (captured === generation) listener(); });
      selected.syncStatus = base.syncStatus;
      selected.dispose = base.dispose;
      selected.setOnline = base.setOnline;
      activeRepository = selected;
      update({ mode: "cloud", save: "pending", operation: "loading", error: "", revision: snapshot.revision + 1 });
      if (base.subscribeSync) {
        const sync = () => {
          if (captured !== generation) return;
          const state = base.syncStatus!();
          lifecycleLog("reconnect state changed", { phase: state.phase, pending: state.pending, ready: state.writable });
          update({ save: state.phase === "failed" ? "failed" : !state.writable || state.pending || state.phase === "loading" || state.phase === "saving" ? "pending" : "synced", operation: state.phase === "loading" ? "loading" : state.phase === "saving" ? "saving" : null, error: state.error });
        };
        stopSync = base.subscribeSync(sync);
        base.setOnline?.(snapshot.online);
      }
      lifecycleLog("cloud activation completed");
    },
    selectLocal() {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud write before switching");
      explicitLocal = true; generation++; closeRepository(); update({ mode: "local", save: "local-only", operation: null, error: "", revision: snapshot.revision + 1 });
    },
    setOnline(online: boolean) {
      update({ online }); activeRepository?.setOnline?.(online);
      if (online && snapshot.auth === "authentication-error" && restoreOnStart) session.restore();
    },
    resume() {
      lifecycleLog("cloud resume requested", { online: snapshot.online });
      if (snapshot.online && activeRepository?.refresh) void activeRepository.refresh().catch(() => {});
      else if (snapshot.online && snapshot.auth === "authentication-error" && restoreOnStart) session.restore();
    },
    retry() {
      if (activeRepository?.refresh) void activeRepository.refresh().catch(() => {});
      else if (snapshot.auth === "authenticated") session.selectCloud();
      else session.restore();
    },
    restore() {
      if (restoring) return;
      if (gateway) { update({ auth: snapshot.identity ? "authenticated" : "unauthenticated" }); return; }
      restoring = true; finishAuth = lifecycleSpan("auth restoration");
      update({ auth: "authenticating", error: "" });
      void connectOnce().catch(() => { finishAuth?.(); finishAuth = undefined; restoring = false; update({ auth: "authentication-error", error: "Could not restore the saved Firebase session. Navigation remains available. Check your connection and retry." }); });
    },
  };
  if (restoreOnStart && cloudPrimary) {
    session.restore();
  }
  return session;
}
