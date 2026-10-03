import assert from "node:assert/strict";
import test from "node:test";
import { createFirebaseRepository, cloudRecordId } from "../src/adapters/firebase/repository.ts";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { readFirebaseConfiguration } from "../src/adapters/firebase/config.ts";
import { demoEntries, initialCycleHistory } from "../src/fixtures/demo-data.ts";
import { createCycleDraft, updateCycleField } from "../src/domain/cycle/records.ts";
import { manualHealthRecords } from "../src/services/health-service.ts";
import { createLocalRepository } from "../src/adapters/local/repository.ts";

class Port {
  uid="owner-a"; documents=new Map(); reads=0; writes=0; fail=false;
  currentUid(){return this.uid;}
  async read(path){this.reads++;return structuredClone(this.documents.get(path)??null);}
  async list(path){this.reads++;return [...this.documents].filter(([key])=>key.startsWith(path+"/")&&!key.slice(path.length+1).includes("/")).map(([key,data])=>({id:key.slice(path.length+1),data:structuredClone(data)}));}
  async commit(path,expected,writes){if(this.fail)throw Error("offline");if((this.documents.get(path)?.record.revision??0)!==expected)throw Error("revision conflict");for(const write of writes)this.documents.set(write.path,structuredClone(write.data));this.writes++;}
}
const entry={id:"throwaway-one",type:"Journal",title:"Phase3A test",date:"2026-10-03",loggedAt:1791028800000,note:"Synthetic test only"};

test("cloud reads require an authenticated matching UID",async()=>{
  const port=new Port();port.uid=null;const repo=createFirebaseRepository(port,"owner-a");await assert.rejects(repo.load([]),/UID/);assert.equal(port.reads,0);
  port.uid="owner-b";await assert.rejects(repo.load([]),/UID/);assert.equal(port.reads,0);
});
test("cloud round-trip preserves IDs and normalized provenance without user-document arrays",async()=>{
  const port=new Port();const repo=createFirebaseRepository(port,"owner-a");await repo.load(["cycle"]);assert.equal(port.writes,0);
  const cycle=updateCycleField(createCycleDraft("2026-10-03"),"temperature",36.5);const health=manualHealthRecords(cycle,"2026-10-03T12:00:00Z");
  await repo.saveMany({journal:[entry,{...entry,id:123,title:"Legacy numeric ID test"}],health});
  const loaded=await createFirebaseRepository(port,"owner-a").load([]);assert.deepEqual(loaded.journal,[entry,{...entry,id:123,title:"Legacy numeric ID test"}]);assert.deepEqual(loaded.health,health);
  assert.ok(port.documents.has("users/owner-a/journalEntries/s-throwaway-one"));assert.ok(port.documents.has("users/owner-a/journalEntries/n-123"));assert.ok(!port.documents.has("users/owner-a"));
  assert.equal(cloudRecordId("one/two"),"s-one%2Ftwo");
});
test("samples, unverified history and device-private payloads are rejected before a write",async()=>{
  const port=new Port();const repo=createFirebaseRepository(port,"owner-a");const data=await repo.load([]);
  await assert.rejects(repo.save("journal",demoEntries),/Samples/);
  await assert.rejects(repo.save("cycle",{...data.cycle,history:initialCycleHistory}),/Samples|unverified/);
  await assert.rejects(repo.save("journal",[{...entry,queryAnchor:"device-only"}]),/Device-private/);assert.equal(port.writes,0);
});
test("tombstones preserve source records, and intentionally empty configuration stays empty",async()=>{
  const port=new Port();const repo=createFirebaseRepository(port,"owner-a");await repo.load([]);await repo.save("journal",[entry]);await repo.save("journal",[]);
  assert.equal(port.documents.get("users/owner-a/journalEntries/s-throwaway-one").deleted,true);assert.deepEqual((await createFirebaseRepository(port,"owner-a").load([])).journal,[]);
  await repo.save("timers",[]);assert.deepEqual((await createFirebaseRepository(port,"owner-a").load([])).timers,[]);
});
test("a first preset edit preserves untouched default configuration on reload",async()=>{
  const port=new Port();const repo=createFirebaseRepository(port,"owner-a");const data=await repo.load([]);const timers=data.timers.map((record,i)=>i===0?{...record,name:"Edited"}:record);await repo.save("timers",timers);
  assert.deepEqual((await createFirebaseRepository(port,"owner-a").load([])).timers,timers);
});
test("malformed cloud documents disable writes instead of overwriting bad data",async()=>{
  const port=new Port();port.documents.set("users/owner-a/journalEntries/s-bad",{schemaVersion:1,ownerUid:"owner-a",record:{id:"bad",title:12},deleted:false});const repo=createFirebaseRepository(port,"owner-a");await assert.rejects(repo.load([]));await assert.rejects(repo.save("journal",[entry]),/Load/);assert.equal(port.writes,0);
});
test("conflicting snapshots cannot overwrite each other",async()=>{
  const port=new Port();const a=createFirebaseRepository(port,"owner-a"),b=createFirebaseRepository(port,"owner-a");await a.load([]);await b.load([]);await a.save("journal",[entry]);await assert.rejects(b.save("books",[{id:"book",title:"Synthetic"}]),/conflict/);assert.equal(port.writes,1);
});
function gateway(port){let observer=()=>{};return{signIn:async(email,password)=>{if(password!=="test-password")throw Error("denied");port.uid="owner-a";observer({uid:port.uid,email});},signOut:async()=>{port.uid=null;observer(null);},observe:cb=>{observer=cb;return()=>{};},repository:uid=>createFirebaseRepository(port,uid),change:identity=>{port.uid=identity?.uid??null;observer(identity);}};}
test("authentication and repository selection never read, upload or overwrite local records",async()=>{
  const values=new Map([["yi-journal",JSON.stringify([entry])]]);const storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const local=createLocalRepository(()=>storage);local.load([]);const original=[...values];const port=new Port();port.uid=null;const api=gateway(port);const session=createCloudSession(async()=>api);
  assert.equal(session.snapshot().save,"local-only");await session.signIn("display@example.invalid","wrong");assert.equal(session.snapshot().auth,"authentication-error");assert.equal(port.reads,0);
  await session.signIn("display@example.invalid","test-password");assert.equal(session.snapshot().auth,"authenticated");assert.equal(port.reads,0);assert.equal(port.writes,0);
  session.selectCloud();const cloud=session.repository();const data=await cloud.load([]);assert.deepEqual(data.journal,[]);await cloud.save("journal",[{...entry,id:"cloud-only"}]);assert.equal(session.snapshot().save,"synced");assert.deepEqual([...values],original);assert.deepEqual(local.load([]).journal,[entry]);
  await session.signOut();assert.equal(session.snapshot().mode,"local");assert.equal(session.snapshot().identity,null);await assert.rejects(cloud.load([]),/cancelled/);assert.deepEqual([...values],original);
});
test("account switches invalidate old views and failed cloud writes never become local fallback",async()=>{
  const port=new Port();const api=gateway(port);const session=createCloudSession(async()=>api);await session.signIn("a@example.invalid","test-password");session.selectCloud();const cloud=session.repository();await cloud.load([]);port.fail=true;await assert.rejects(cloud.save("journal",[entry]));assert.equal(session.snapshot().save,"failed");assert.equal(port.writes,0);
  api.change({uid:"owner-b",email:"b@example.invalid"});assert.equal(session.snapshot().mode,"local");await assert.rejects(cloud.load([]),/cancelled/);assert.throws(()=>cloud.save("journal",[entry]),/cancelled/);
});
test("disabled/missing config does not initialize Firebase, and emulator mode cannot target production",()=>{
  assert.equal(readFirebaseConfiguration({}).enabled,false);assert.throws(()=>readFirebaseConfiguration({VITE_FIREBASE_ENABLED:"true"}),/incomplete/);
  assert.throws(()=>readFirebaseConfiguration({VITE_FIREBASE_ENABLED:"true",VITE_FIREBASE_API_KEY:"key",VITE_FIREBASE_AUTH_DOMAIN:"domain",VITE_FIREBASE_PROJECT_ID:"production",VITE_FIREBASE_APP_ID:"app",VITE_FIREBASE_USE_EMULATORS:"true"}),/demo-/);
});

test("pending cloud operations prevent reload, local switching and sign-out",async()=>{
  const port=new Port();const api=gateway(port);const session=createCloudSession(async()=>api);
  await session.signIn("a@example.invalid","test-password");session.selectCloud();const cloud=session.repository();await cloud.load([]);
  let release;const commit=port.commit.bind(port);port.commit=async(...args)=>{await new Promise(resolve=>{release=resolve;});return commit(...args);};
  const saving=cloud.save("journal",[entry]);await Promise.resolve();
  assert.equal(session.snapshot().save,"pending");assert.throws(()=>session.selectCloud(),/pending/);assert.throws(()=>session.selectLocal(),/pending/);await assert.rejects(session.signOut(),/pending/);
  release();await saving;assert.equal(session.snapshot().save,"synced");session.selectLocal();assert.equal(session.snapshot().mode,"local");
});

test("cloud reload restores journal chronology instead of document ID order",async()=>{
  const port=new Port();const repo=createFirebaseRepository(port,"owner-a");await repo.load([]);
  const newer={...entry,id:"alphabetically-last",loggedAt:entry.loggedAt+1};await repo.save("journal",[entry,newer]);
  assert.deepEqual((await createFirebaseRepository(port,"owner-a").load([])).journal,[newer,entry]);
  await assert.rejects(repo.save("journal",[entry,entry]),/Duplicate IDs/);
});
