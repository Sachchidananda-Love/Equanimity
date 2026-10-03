import type { DataRepository } from "./repository-contracts";

export type AuthIdentity = { uid: string; email: string | null };
export type AuthState = "unauthenticated" | "authenticating" | "authenticated" | "authentication-error";
export type SaveState = "signed-out" | "local-only" | "pending" | "synced" | "failed";
export type CloudSnapshot = { auth: AuthState; identity: AuthIdentity | null; mode: "signed-out" | "local" | "cloud"; save: SaveState; operation: "loading" | "saving" | null; error: string; revision: number };
export interface CloudGateway {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  observe(callback: (identity: AuthIdentity | null) => void): () => void;
  repository(uid: string): DataRepository;
}

/** No local repository is accepted here: authentication cannot import data. */
export function createCloudSession(connect: () => Promise<CloudGateway>, { cloudPrimary = false } = {}) {
  const resting = cloudPrimary ? { mode: "signed-out" as const, save: "signed-out" as const } : { mode: "local" as const, save: "local-only" as const };
  let snapshot: CloudSnapshot = { auth: "unauthenticated", identity: null, ...resting, operation: null, error: "", revision: 0 };
  let gateway: CloudGateway | undefined;
  let activeRepository: DataRepository | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CloudSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const failure = (error: unknown, loading: boolean) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "permission-denied" || code === "firestore/permission-denied") return "Cloud permission denied. Check this UID's administrator approval and Firestore rules. No local data was uploaded. Reload after access is restored.";
    return loading ? "Private cloud data could not be loaded. Editing is disabled. Check connection and account access, then reload. No local data was uploaded." : "Cloud save failed or conflicted. Editing is paused; unsaved changes remain only in this view. Record them before reloading. No local copy or automatic retry was made.";
  };
  async function connectOnce() {
    if (!gateway) {
      gateway = await connect();
      gateway.observe(identity => {
        const changed = identity?.uid !== snapshot.identity?.uid;
        if (changed) { generation++; activeRepository = undefined; update({ ...resting, operation: null, error: "", revision: snapshot.revision + 1 }); }
        update({ identity, auth: identity ? "authenticated" : snapshot.auth === "authenticating" ? "authenticating" : "unauthenticated" });
        if (changed && identity && cloudPrimary) session.selectCloud();
      });
    }
    return gateway;
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
      generation++; activeRepository = undefined;
      update({ identity: null, ...resting, operation: null, revision: snapshot.revision + 1, auth: "authenticating", error: "" });
      try { await gateway?.signOut(); update({ auth: "unauthenticated" }); }
      catch { update({ auth: "authentication-error", error: "Sign-out failed. Reload to clear this in-memory session." }); }
    },
    selectCloud() {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud operation before reloading");
      if (!gateway || snapshot.auth !== "authenticated" || !snapshot.identity) throw new Error("Sign in before selecting cloud data");
      const uid = snapshot.identity.uid; const captured = ++generation; const base = gateway.repository(uid);
      const guard = () => { if (captured !== generation || snapshot.identity?.uid !== uid || snapshot.auth !== "authenticated") throw new Error("Cloud session changed; operation cancelled"); };
      let queue = Promise.resolve();
      let pending = 0;
      const selected: DataRepository = {
        async load(widgets) {
          guard();
          update({ save: "pending", operation: "loading", error: "" });
          try { const data = await base.load(widgets); guard(); update({ save: "synced", operation: null }); return data; }
          catch (error) { if (captured === generation) update({ save: "failed", operation: null, error: failure(error, true) }); throw error; }
        },
        save: (key, value) => selected.saveMany({ [key]: value }),
        saveMany(changes) {
          guard(); if (snapshot.save === "failed") throw new Error("Reload cloud data before retrying failed writes");
          pending++; update({ save: "pending", operation: "saving", error: "" });
          const immutable = structuredClone(changes);
          const operation = queue.then(async () => {
            guard(); await base.saveMany(immutable); guard();
          });
          queue = operation;
          void operation.then(() => { pending--; if (captured === generation && pending === 0) update({ save: "synced", operation: null }); }, error => { pending--; if (captured === generation) update({ save: "failed", operation: null, error: failure(error, false) }); });
          return operation;
        },
      };
      activeRepository = selected;
      update({ mode: "cloud", save: "pending", operation: "loading", error: "", revision: snapshot.revision + 1 });
    },
    selectLocal() {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud write before switching");
      generation++; activeRepository = undefined; update({ mode: "local", save: "local-only", operation: null, error: "", revision: snapshot.revision + 1 });
    },
  };
  return session;
}
