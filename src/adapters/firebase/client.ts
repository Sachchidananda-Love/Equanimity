import { initializeApp } from "firebase/app";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, memoryLocalCache, getDocFromServer, getDocsFromServer, collection, doc, runTransaction, connectFirestoreEmulator } from "firebase/firestore";
import type { CloudGateway } from "../../services/cloud-session";
import { createFirebaseRepository, type FirestorePort } from "./repository";
import type { FirebaseConfiguration } from "./config";
import { healthKitImportState } from "../local/healthkit-import-state";

export function connectFirebase(configuration: FirebaseConfiguration): CloudGateway {
  if (!configuration.enabled) throw new Error("Firebase is disabled; configure it before signing in");
  const app = initializeApp(configuration.options, "yi-private-cloud");
  // Persist Firebase's managed user session, never the user's password or a custom secret.
  // IndexedDB is preferred for the bundled WKWebView; local persistence is the supported
  // fallback for environments where IndexedDB is unavailable or restricted.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  if (configuration.emulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  const port: FirestorePort = {
    currentUid: () => auth.currentUser?.uid ?? null,
    async read(path) { const snapshot = await getDocFromServer(doc(db, path)); return snapshot.exists() ? snapshot.data() : null; },
    async list(path) { const snapshot = await getDocsFromServer(collection(db, path)); return snapshot.docs.map(document => ({ id: document.id, data: document.data() })); },
    async commit(path, expected, writes, authorize) {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Authentication required");
      await runTransaction(db, async transaction => {
        if (auth.currentUser?.uid !== uid) throw new Error("Authentication changed");
        const snapshot = await transaction.get(doc(db, path));
        const actual = snapshot.exists() ? snapshot.data().record?.revision : 0;
        if (actual !== expected) throw new Error("Cloud revision conflict; reload before editing");
        if (auth.currentUser?.uid !== uid) throw new Error("Authentication changed during the write");
        authorize?.();
        for (const write of writes) transaction.set(doc(db, write.path), write.data);
      });
    },
  };
  return {
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    signOut: () => signOut(auth),
    observe: callback => onAuthStateChanged(auth, user => callback(user ? { uid: user.uid, email: user.email } : null)),
    repository: uid => createFirebaseRepository(port, uid, { healthKitConsent: () => healthKitImportState.consent(uid) }),
  };
}
