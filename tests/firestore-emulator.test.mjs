import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, runTransaction } from "firebase/firestore";
import { deleteApp } from "firebase/app";
import { connectFirebase } from "../src/adapters/firebase/client.ts";
import { createCycleDraft, updateCycleField } from "../src/domain/cycle/records.ts";
import { manualHealthRecords } from "../src/services/health-service.ts";
import { exerciseCloudCrud } from "./helpers/cloud-crud.mjs";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createFirebaseRepository, cloudRecordId } from "../src/adapters/firebase/repository.ts";
import { normalizeHealthKitRecords } from "../src/adapters/healthkit.ts";
import { reconcileHealthKitRecords } from "../src/services/healthkit-import-service.ts";
import { healthKitSample, timestamp } from "./helpers/healthkit-fixtures.mjs";
import { createCloudSyncRepository } from "../src/services/cloud-sync.ts";

const projectId="demo-yi-phase3a";
test("actual Firestore transaction retry after lost acknowledgement and restart is idempotent under owner rules", async () => {
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST); assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "recovery-emulator@example.invalid", password: "throwaway-recovery-password", returnSecureToken: true }) });
  assert.equal(response.status, 200); const identity = await response.json();
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
  const values = new Map();
  const store = { read: async uid => structuredClone(values.get(uid) ?? null), write: async (uid, value, expected) => { assert.equal(values.get(uid)?.version ?? 0, expected); values.set(uid, structuredClone(value)); } };
  const gateway = connectFirebase({ enabled: true, emulators: true, options: { apiKey: "fake-key", authDomain: `${projectId}.firebaseapp.com`, projectId, appId: "fake-app-id" } });
  let first, restarted;
  try {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `privateAccess/${identity.localId}`), { enabled: true }));
    await gateway.signIn("recovery-emulator@example.invalid", "throwaway-recovery-password");
    const base = gateway.repository(identity.localId); const commit = base.commitQueued;
    base.commitQueued = async (...args) => { await commit(...args); throw Object.assign(new Error("offline"), { code: "unavailable" }); };
    first = createCloudSyncRepository(base, identity.localId, store); await first.load([]);
    const entry = { id: "lost-ack-emulator", type: "Journal", title: "Synthetic retry", date: "2026-10-08" };
    await first.enqueue({ journal: [entry] }); await assert.rejects(first.refresh()); first.dispose();
    restarted = createCloudSyncRepository(gateway.repository(identity.localId), identity.localId, store);
    await restarted.restore(); await restarted.refresh();
    assert.equal(restarted.syncStatus().pending, 0);
    const reference = doc(env.authenticatedContext(identity.localId).firestore(), `users/${identity.localId}/settings/repository`);
    assert.equal((await getDoc(reference)).data().record.revision, 1, "retry must not create a second transaction revision");
    assert.equal((await gateway.repository(identity.localId).load([])).journal.length, 1);
    await assertFails(getDoc(doc(env.authenticatedContext("other-owner").firestore(), `users/${identity.localId}/settings/repository`)));
  } finally { first?.dispose(); restarted?.dispose(); await gateway.signOut(); await env.cleanup(); const { getApp } = await import("firebase/app"); await deleteApp(getApp("yi-private-cloud")); }
});
test("reviewed HealthKit records require consent and round-trip under actual UID rules", async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
  const uid = "health-import-owner";
  try {
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `privateAccess/${uid}`), { enabled: true }));
    const db = env.authenticatedContext(uid).firestore(); let consent = false;
    const port = {
      currentUid: () => uid,
      read: async path => { const result = await getDoc(doc(db, path)); return result.exists() ? result.data() : null; },
      list: async path => (await getDocs(collection(db, path))).docs.map(row => ({ id: row.id, data: row.data() })),
      commit: (path, expected, writes, authorize) => runTransaction(db, async transaction => {
        const revision = await transaction.get(doc(db, path)); assert.equal(revision.data()?.record.revision ?? 0, expected);
        authorize?.(); for (const write of writes) transaction.set(doc(db, write.path), write.data);
      }),
    };
    const repository = createFirebaseRepository(port, uid, { healthKitConsent: () => consent }); await repository.load([]);
    const imported = reconcileHealthKitRecords([], normalizeHealthKitRecords([healthKitSample()], timestamp), timestamp).records;
    await assert.rejects(repository.save("health", imported), /disabled/);
    consent = true; await repository.save("health", imported);
    const reloaded = await createFirebaseRepository(port, uid).load([]);
    assert.deepEqual(reloaded.health, JSON.parse(JSON.stringify(imported)));
    const path = `users/${uid}/healthRecords/${cloudRecordId(imported[0].id)}`;
    assert.equal((await getDoc(doc(db, path))).data().ownerUid, uid);
    await assertFails(getDoc(doc(env.authenticatedContext("another-owner").firestore(), path)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
  } finally { await env.cleanup(); }
});
test("real Firestore rules deny anonymous, foreign UID and unapproved accounts",async()=>{
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,"Run via the emulator test command, never against a live project");
  const env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile(new URL("../firestore.rules",import.meta.url),"utf8"),host:"127.0.0.1",port:8080}});
  try{
    await env.withSecurityRulesDisabled(async context=>{for(const uid of ["owner-a","owner-b"])await setDoc(doc(context.firestore(),`privateAccess/${uid}`),{enabled:true});});
    const value={schemaVersion:1,ownerUid:"owner-a",record:{id:"test",type:"Journal",title:"Synthetic",date:"2026-10-03"},deleted:false};
    const anonymous=env.unauthenticatedContext().firestore(),a=env.authenticatedContext("owner-a").firestore(),b=env.authenticatedContext("owner-b").firestore(),unapproved=env.authenticatedContext("unapproved").firestore();
    await assertFails(getDoc(doc(anonymous,"users/owner-a/journalEntries/test")));await assertFails(setDoc(doc(anonymous,"users/owner-a/journalEntries/test"),value));
    await assertSucceeds(setDoc(doc(a,"users/owner-a/journalEntries/test"),value));await assertSucceeds(getDoc(doc(a,"users/owner-a/journalEntries/test")));await assertSucceeds(getDocs(collection(a,"users/owner-a/journalEntries")));
    await assertFails(getDoc(doc(b,"users/owner-a/journalEntries/test")));await assertFails(getDocs(collection(b,"users/owner-a/journalEntries")));await assertFails(setDoc(doc(b,"users/owner-a/journalEntries/test"),value));
    await assertFails(setDoc(doc(unapproved,"users/unapproved/journalEntries/test"),{...value,ownerUid:"unapproved"}));await assertFails(setDoc(doc(unapproved,"privateAccess/unapproved"),{enabled:true}));
    await assertFails(setDoc(doc(a,"users/owner-a/journalEntries/foreign-owner"),{...value,ownerUid:"owner-b"}));await assertFails(deleteDoc(doc(a,"users/owner-a/journalEntries/test")));
    await assertFails(setDoc(doc(a,"users/owner-a/migrations/not-yet"),value));await assertFails(setDoc(doc(a,"users/owner-a/importBatches/no-csv"),value));
    for (const section of ["settings","journalEntries","timerPresets","activityPresets","books","cycleEvents","healthRecords"]) {
      const path=`users/owner-a/${section}/ownership-test`;
      await assertSucceeds(setDoc(doc(a,path),value));await assertSucceeds(getDoc(doc(a,path)));
      await assertSucceeds(setDoc(doc(a,path),{...value,record:{...value.record,title:"Updated"}}));
      await assertSucceeds(setDoc(doc(a,path),{...value,deleted:true}));
      await assertFails(getDoc(doc(anonymous,path)));await assertFails(getDoc(doc(b,path)));await assertFails(getDocs(collection(b,`users/owner-a/${section}`)));await assertFails(setDoc(doc(b,path),value));
    }
  }finally{await env.cleanup();}
});

test("actual email/password Auth and Firebase repository round-trip use only demo emulator records",async()=>{
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST);assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const response=await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"phase3a-test@example.invalid",password:"throwaway-password-123",returnSecureToken:true})});
  assert.equal(response.status,200);const user=await response.json();
  const env=await initializeTestEnvironment({projectId,firestore:{host:"127.0.0.1",port:8080}});
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),`privateAccess/${user.localId}`),{enabled:true}));
  const gateway=connectFirebase({enabled:true,emulators:true,options:{apiKey:"fake-key",authDomain:`${projectId}.firebaseapp.com`,projectId,appId:"fake-app-id"}});
  const events=[];const off=gateway.observe(identity=>events.push(identity));
  try{
    await assert.rejects(gateway.signIn("phase3a-test@example.invalid","wrong-password"));
    await gateway.signIn("phase3a-test@example.invalid","throwaway-password-123");
    const repository=gateway.repository(user.localId);const initial=await repository.load([]);assert.deepEqual(initial.journal,[]);
    const record={id:"emulator-only-test",type:"Journal",title:"Throwaway emulator test",date:"2026-10-03",note:"No personal data"};await repository.save("journal",[record]);assert.deepEqual((await gateway.repository(user.localId).load([])).journal,[record]);
    let cycle=createCycleDraft("2026-10-03");cycle=updateCycleField(cycle,"flow","None");cycle=updateCycleField(cycle,"sleepInterruptions",0);
    const health=manualHealthRecords(cycle,"2026-10-03T12:00:00Z");await repository.saveMany({health,cycle:{...initial.cycle,history:[cycle]}});
    const reloaded=await gateway.repository(user.localId).load([]);assert.deepEqual(reloaded.health.toSorted((a,b)=>a.id.localeCompare(b.id)),health.toSorted((a,b)=>a.id.localeCompare(b.id)));assert.deepEqual(reloaded.cycle.history,[cycle]);
    await repository.save("journal",[]);assert.deepEqual((await gateway.repository(user.localId).load([])).journal,[]);
    const saved=await getDoc(doc(env.authenticatedContext(user.localId).firestore(),`users/${user.localId}/journalEntries/s-emulator-only-test`));assert.equal(saved.data().deleted,true);assert.deepEqual(saved.data().record,record);
    const expected=await exerciseCloudCrud(()=>gateway.repository(user.localId),async(section,id)=>(await getDoc(doc(env.authenticatedContext(user.localId).firestore(),`users/${user.localId}/${section}/${id}`))).data());
    const session=createCloudSession(async()=>gateway,{cloudPrimary:true});await session.signIn("phase3a-test@example.invalid","throwaway-password-123");assert.equal(session.snapshot().mode,"cloud");const selected=session.repository();assert.deepEqual((await selected.load([])).journal,expected.journal);
    await session.signOut();assert.equal(session.snapshot().mode,"signed-out");await assert.rejects(selected.load([]),/cancelled/);await assert.rejects(repository.load([]),/UID/);assert.ok(events.some(event=>event?.uid===user.localId));
    await session.signIn("phase3a-test@example.invalid","throwaway-password-123");const restored=await session.repository().load([]);for(const key of Object.keys(expected))assert.deepEqual(restored[key],expected[key]);await session.signOut();
  }finally{off();await env.cleanup();const {getApp}=await import("firebase/app");await deleteApp(getApp("yi-private-cloud"));}
});
