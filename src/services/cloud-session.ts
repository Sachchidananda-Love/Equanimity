import type { DataRepository } from "./repository-contracts";

export type AuthIdentity = { uid: string; email: string | null };
export type AuthState = "unauthenticated" | "authenticating" | "authenticated" | "authentication-error";
export type SaveState = "local-only" | "pending" | "synced" | "failed";
export type CloudSnapshot = { auth: AuthState; identity: AuthIdentity | null; mode: "local" | "cloud"; save: SaveState; error: string; revision: number };
export interface CloudGateway {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  observe(callback: (identity: AuthIdentity | null) => void): () => void;
  repository(uid: string): DataRepository;
}

/** No local repository is accepted here: authentication cannot import data. */
export function createCloudSession(connect: () => Promise<CloudGateway>) {
  let snapshot: CloudSnapshot = { auth: "unauthenticated", identity: null, mode: "local", save: "local-only", error: "", revision: 0 };
  let gateway: CloudGateway | undefined;
  let activeRepository: DataRepository | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CloudSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  async function connectOnce() {
    if (!gateway) {
      gateway = await connect();
      gateway.observe(identity => {
        if (identity?.uid !== snapshot.identity?.uid) { generation++; activeRepository = undefined; update({ mode: "local", save: "local-only", revision: snapshot.revision + 1 }); }
        update({ identity, auth: identity ? "authenticated" : snapshot.auth === "authenticating" ? "authenticating" : "unauthenticated" });
      });
    }
    return gateway;
  }
  return {
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
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud operation before signing out");
      generation++; activeRepository = undefined;
      update({ identity: null, mode: "local", save: "local-only", revision: snapshot.revision + 1, auth: "authenticating", error: "" });
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
          update({ save: "pending", error: "" });
          try { const data = await base.load(widgets); guard(); update({ save: "synced" }); return data; }
          catch (error) { if (captured === generation) update({ save: "failed", error: "Private cloud data could not be loaded. Editing is disabled. Check connection, account approval, and rules; no local fallback was uploaded." }); throw error; }
        },
        save: (key, value) => selected.saveMany({ [key]: value }),
        saveMany(changes) {
          guard(); pending++; update({ save: "pending", error: "" });
          const immutable = structuredClone(changes);
          const operation = queue.then(async () => {
            guard(); await base.saveMany(immutable); guard();
          });
          queue = operation;
          void operation.then(() => { pending--; if (captured === generation && pending === 0) update({ save: "synced" }); }, () => { pending--; if (captured === generation) update({ save: "failed", error: "Cloud save failed or conflicted. Unsaved changes remain in this view; they were not copied to local storage. Reload cloud data before retrying." }); });
          return operation;
        },
      };
      activeRepository = selected;
      update({ mode: "cloud", save: "synced", error: "", revision: snapshot.revision + 1 });
    },
    selectLocal() {
      if (snapshot.save === "pending") throw new Error("Wait for the pending cloud write before switching");
      generation++; activeRepository = undefined; update({ mode: "local", save: "local-only", error: "", revision: snapshot.revision + 1 });
    },
  };
}
