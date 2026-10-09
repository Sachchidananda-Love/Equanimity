import { initializeApp } from "firebase/app";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, memoryLocalCache, getDocFromServer, getDocsFromServer, collection, doc, runTransaction, connectFirestoreEmulator } from "firebase/firestore";
import type { CloudGateway } from "../../services/cloud-session";
import { createFirebaseRepository, type FirestorePort } from "./repository";
import type { FirebaseConfiguration } from "./config";
import { healthKitImportState } from "../local/healthkit-import-state";
import { createIndexedDbSyncStore } from "./sync-store";
import { createCloudSyncRepository } from "../../services/cloud-sync";
import { lifecycleLog, lifecycleSpan } from "../../platform/lifecycle-log";

export function connectFirebase(configuration: FirebaseConfiguration): CloudGateway {
  lifecycleLog("Firebase initialization started");
  if (!configuration.enabled) throw new Error("Firebase is disabled; configure it before signing in");
  const app = initializeApp(configuration.options, "yi-private-cloud");
  // Persist Firebase's managed user session, never the user's password or a custom secret.
  // IndexedDB is preferred for the bundled WKWebView; local persistence is the supported
  // fallback for environments where IndexedDB is unavailable or restricted.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  const syncStore = createIndexedDbSyncStore(configuration.options.projectId);
  if (configuration.emulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  const port: FirestorePort = {
    currentUid: () => auth.currentUser?.uid ?? null,
    async read(path) {
      const finish = lifecycleSpan("Firestore document read");
      try { const snapshot = await getDocFromServer(doc(db, path)); return snapshot.exists() ? snapshot.data() : null; } finally { finish(); }
    },
    async list(path) {
      const finish = lifecycleSpan("Firestore collection read");
      try { const snapshot = await getDocsFromServer(collection(db, path)); return snapshot.docs.map(document => ({ id: document.id, data: document.data() })); } finally { finish(); }
    },
    async commit(path, expected, writes, authorize) {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Authentication required");
      await runTransaction(db, async transaction => {
        if (auth.currentUser?.uid !== uid) throw new Error("Authentication changed");
        const snapshot = await transaction.get(doc(db, path));
        const actual = snapshot.exists() ? snapshot.data().record?.revision : 0;
        if (auth.currentUser?.uid !== uid) throw new Error("Authentication changed during the write");
        authorize?.();
        const mutation = writes.find(write => write.path === path)?.data.record as { lastMutationId?: string } | undefined;
        if (mutation?.lastMutationId && snapshot.data()?.record?.lastMutationId === mutation.lastMutationId && actual === expected + 1) return;
        if (actual !== expected) throw new Error("Cloud revision conflict; reload before editing");
        for (const write of writes) transaction.set(doc(db, write.path), write.data);
      });
    },
  };
  lifecycleLog("Firebase initialization completed");
  return {
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    signOut: () => signOut(auth),
    observe: callback => {
      lifecycleLog("Firebase auth listener attached");
      return onAuthStateChanged(auth, user => callback(user ? { uid: user.uid, email: user.email } : null));
    },
    repository: uid => {
      const repository = createFirebaseRepository(port, uid, { healthKitConsent: () => healthKitImportState.consent(uid) });
      // Node/emulator consumers have no WKWebView IndexedDB device cache.
      return typeof window === "undefined" ? repository : createCloudSyncRepository(repository, uid, syncStore);
    },
  };
}
