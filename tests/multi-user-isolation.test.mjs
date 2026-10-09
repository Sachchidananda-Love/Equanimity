import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import YiApp from "../app/YiApp.tsx";
import { cloudProjectId } from "../src/application/cloud-runtime.ts";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createIndexedDbSyncStore } from "../src/adapters/firebase/sync-store.ts";
import { createDeviceCloudRecovery } from "../src/adapters/firebase/device-recovery.ts";
import { createDeviceCloudAccess } from "../src/adapters/firebase/device-access.ts";
import { createFirebaseRepository } from "../src/adapters/firebase/repository.ts";
import { createLocalRepository, localRepository, LEGACY_KEYS } from "../src/adapters/local/repository.ts";
import { createHealthKitImportState } from "../src/adapters/local/healthkit-import-state.ts";
import { createHealthKitImportService } from "../src/services/healthkit-import-service.ts";
import { healthKitSample, UUID_B, timestamp } from "./helpers/healthkit-fixtures.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = uid => ({ id: `synthetic-${uid}`, type: "Journal", title: `Private synthetic ${uid}`, date: "2026-10-09", note: "Synthetic only" });
const practice = { mode: "Timer", duration: 600, endAt: Date.now() + 600000, openingGong: "Tripple Gong", closingGong: "Gong 1", intervalEnabled: false, intervalMinutes: 5, intervalGong: "Gong 3", customGongs: [], customGongSounds: [] };
class Storage {
  values = new Map(); get length() { return this.values.size; } key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; } setItem(key, value) { this.values.set(key, value); }
}
class Port {
  uid = null; documents = new Map(); commits = []; hold; holdRead; fail = false;
  currentUid() { return this.uid; }
  async read(path) { if (this.holdRead) await this.holdRead.promise; return structuredClone(this.documents.get(path) ?? null); }
  async list(path) { return [...this.documents].filter(([key]) => key.startsWith(path + "/")).map(([key, data]) => ({ id: key.slice(path.length + 1), data: structuredClone(data) })); }
  async commit(path, expected, writes, authorize) {
    if (this.fail) throw Object.assign(new Error("offline"), { code: "unavailable" });
    if (this.hold) await this.hold.promise;
    authorize?.();
    assert.equal(path.split("/")[1], this.uid);
    const current = this.documents.get(path)?.record, mutation = writes.find(write => write.path === path)?.data.record.lastMutationId;
    if (mutation && current?.lastMutationId === mutation && current.revision === expected + 1) return;
    assert.equal(current?.revision ?? 0, expected);
    for (const write of writes) { assert.equal(write.data.ownerUid, this.uid); assert.ok(write.path.startsWith(`users/${this.uid}/`)); this.documents.set(write.path, structuredClone(write.data)); }
    this.commits.push({ uid: this.uid, paths: writes.map(write => write.path) });
  }
}
function fixture() {
  const idb = new IDBFactory(), storage = new Storage(), port = new Port(), project = "demo-multi-user", appId = "synthetic-app";
  const store = () => createIndexedDbSyncStore(project, () => idb);
  const recovery = () => createDeviceCloudRecovery(project, appId, { access: createDeviceCloudAccess(project, appId, () => storage), store: store() });
  function connect(recovered) {
    recovered.attach(port); let observer;
    return { observe(cb) { observer = cb; return () => {}; }, async signIn(uid) { port.uid = uid; const identity = { uid, email: null }; observer(identity); return identity; }, async signOut() { port.uid = null; observer(null); }, repository: uid => recovered.repository(uid) };
  }
  function session() { const recovered = recovery(); return createCloudSession(async () => connect(recovered), { cloudPrimary: true, recovery: recovered }); }
  return { idb, storage, port, project, appId, store, recovery, session };
}
async function load(session, uid) { session.setOnline(true); await session.signIn(uid, "synthetic-unused"); await session.repository().load([]); return session.repository(); }

test("durable IndexedDB baselines and outboxes are isolated by both project and UID", async () => {
  const f = fixture(), session = f.session(); const a = await load(session, "owner-a");
  session.setOnline(false); await a.enqueue({ journal: [entry("owner-a")], widgets: ["private-a"] });
  const saved = await f.store().read("owner-a");
  assert.equal(saved.ownerUid, "owner-a"); assert.equal(saved.pending.length, 1);
  assert.equal(await f.store().read("owner-b"), null);
  assert.equal(await createIndexedDbSyncStore("demo-other-project", () => f.idb).read("owner-a"), null);
  await session.signOut();
});

test("A's pending edits/settings cannot replay under B; they sync once only when A explicitly returns", async () => {
  const f = fixture(), session = f.session(); const a = await load(session, "owner-a");
  session.setOnline(false); await a.enqueue({ journal: [entry("owner-a")], widgets: ["private-a"], timers: [{ id: "a-timer", name: "A private preset", seconds: 90, color: "sage" }] });
  await session.signOut(); const b = await load(session, "owner-b");
  assert.deepEqual((await b.restore()).journal, []);
  await b.enqueue({ journal: [entry("owner-b")], widgets: ["private-b"] });
  session.setOnline(true); for (let i = 0; i < 4; i++) session.resume(); await b.refresh();
  assert.ok(f.port.commits.every(commit => commit.uid === "owner-b"));
  assert.equal((await f.store().read("owner-a")).pending.length, 1);
  assert.deepEqual((await f.store().read("owner-b")).baseline.data.widgets, ["private-b"]);
  await assert.rejects(a.refresh(), /cancelled/); await assert.rejects(a.enqueue({ journal: [] }), /cancelled/);
  await session.signOut(); await session.signIn("owner-a", "synthetic-unused");
  const own = session.repository(); await own.restore(); await own.refresh();
  assert.equal((await f.store().read("owner-a")).pending.length, 0);
  assert.deepEqual((await own.restore()).journal, [entry("owner-a")]);
  assert.equal(f.port.commits.filter(commit => commit.uid === "owner-a").length, 1);
  assert.deepEqual((await f.store().read("owner-b")).baseline.data.journal, [entry("owner-b")]);
  await session.signOut();
});

test("account change during an in-flight transaction rejects the old authorization and retains only A's queue", async () => {
  const f = fixture(), session = f.session(), a = await load(session, "owner-a");
  session.setOnline(false); await a.enqueue({ journal: [entry("owner-a")] });
  f.port.hold = deferred(); session.setOnline(true); const replay = a.refresh(); await delay(10);
  await session.signOut(); await session.signIn("owner-b", "synthetic-unused");
  f.port.hold.resolve(); await assert.rejects(replay, /UID|cancelled|own/); f.port.hold = undefined;
  await session.repository().load([]);
  assert.equal(f.port.commits.length, 0);
  assert.equal((await f.store().read("owner-a")).pending.length, 1);
  assert.deepEqual((await session.repository().restore()).journal, []);
  await session.signOut();
});

test("private device practice/quote state is UID/project-scoped, never adopts unowned legacy state, and is closed when signed out", () => {
  const storage = new Storage(), repo = createLocalRepository(() => storage), a = { project: "demo-runtime", uid: "owner-a" }, b = { ...a, uid: "owner-b" };
  repo.savePractice(practice); const old = storage.getItem(`${LEGACY_KEYS.practice}-v1`);
  assert.equal(repo.loadPractice(a), null, "old device-global checkpoint has no proven owner");
  repo.savePractice(practice, a); repo.saveQuote({ signature: "synthetic", order: [0, 1], day: 20000, position: 1 }, a);
  assert.deepEqual(repo.loadPractice(a), practice); assert.equal(repo.loadPractice(b), null); assert.equal(repo.loadQuote(b), null);
  assert.equal(repo.loadPractice({ ...a, project: "demo-other" }), null);
  assert.equal(repo.loadPractice(null), null); repo.savePractice(null, null); assert.deepEqual(repo.loadPractice(a), practice);
  assert.equal(storage.getItem(`${LEGACY_KEYS.practice}-v1`), old, "legacy checkpoint is retained, not deleted or rebound");
  const raw = JSON.parse(repo.exportRaw()); assert.ok(!Object.keys(raw.records).some(key => key.startsWith("equanimity:runtime:")), "local fallback export cannot enumerate another UID's private runtime state");
  const keyA = [...storage.values.keys()].find(key => key.includes(":owner-a:") && key.includes("active-practice"));
  const foreignKey = keyA.replace(":owner-a:", ":owner-b:"); storage.setItem(foreignKey, storage.getItem(keyA));
  assert.equal(repo.loadPractice(b), null, "wrong-owner envelope is rejected even when copied into B's key");
});

test("explicit local fallback never uploads or adopts its journal, preferences or runtime into a Firebase account", async () => {
  const f = fixture(), local = createLocalRepository(() => f.storage); local.load([]);
  local.saveMany({ journal: [entry("local-fallback")], widgets: ["private-local"] }); local.savePractice(practice);
  const original = f.storage.getItem("yi-local-data-v1"), session = f.session(); await load(session, "owner-a");
  session.selectLocal(); assert.equal(session.snapshot().mode, "local");
  const b = await load(session, "owner-b"); assert.deepEqual((await b.restore()).journal, []);
  assert.ok(!(await b.restore()).widgets.includes("private-local")); assert.equal(f.port.commits.length, 0);
  assert.equal(f.storage.getItem("yi-local-data-v1"), original);
  await session.signOut();
});

test("offline relaunch chooses only the last granted B cache; sign-out tombstone exposes neither A nor B", async () => {
  const f = fixture(), session = f.session();
  for (const uid of ["owner-a", "owner-b"]) {
    const repo = await load(session, uid); session.setOnline(false); await repo.enqueue({ journal: [entry(uid)] }); await session.signOut();
  }
  await session.signIn("owner-b", "synthetic-unused"); await session.repository().restore(); session.repository().dispose();
  const recovered = f.recovery(), pending = deferred();
  const reboot = createCloudSession(() => pending.promise, { cloudPrimary: true, restoreOnStart: true, recovery: recovered, initialOnline: false });
  assert.equal(reboot.snapshot().identity.uid, "owner-b"); assert.deepEqual((await reboot.repository().restore()).journal, [entry("owner-b")]);
  void reboot.signOut();
  const signedOut = createCloudSession(() => deferred().promise, { cloudPrimary: true, restoreOnStart: true, recovery: f.recovery(), initialOnline: false });
  assert.equal(signedOut.repository(), undefined); assert.equal(signedOut.snapshot().identity, null);
});

test("HealthKit consent/pending batches are per UID; switch during query cancels A without staging into B", async () => {
  const f = fixture(), session = f.session(), a = await load(session, "owner-a");
  const state = createHealthKitImportState(() => f.storage), query = deferred(); state.setConsent("owner-a", true);
  const service = createHealthKitImportService({ uid: "owner-a", repository: a, state, isCurrent: () => session.repository() === a && session.snapshot().identity?.uid === "owner-a", query: () => query.promise });
  const importing = service.importRecent(); await session.signOut(); await load(session, "owner-b");
  query.resolve({ available: true, records: [healthKitSample()], errors: [], message: "Synthetic" }); await assert.rejects(importing, /cancelled/);
  assert.equal(state.consent("owner-b"), false); assert.equal(state.pending("owner-b"), null); assert.equal(state.lastImport("owner-b"), null);
  assert.deepEqual((await session.repository().restore()).health, []); await session.signOut();
});

test("an A HealthKit retry checkpoint is not used by B, even when B independently enables consent", async () => {
  const f = fixture(), session = f.session(), a = await load(session, "owner-a"), state = createHealthKitImportState(() => f.storage);
  state.setConsent("owner-a", true); session.setOnline(false);
  const serviceA = createHealthKitImportService({ uid: "owner-a", repository: a, state, isCurrent: () => session.repository() === a, query: async () => ({ available: true, records: [healthKitSample()], errors: [], message: "Synthetic" }), now: () => timestamp });
  assert.equal((await serviceA.importRecent()).state, "pending"); assert.equal(state.pending("owner-a").records.length, 1);
  await session.signOut(); const b = await load(session, "owner-b"); session.setOnline(true); state.setConsent("owner-b", true);
  const serviceB = createHealthKitImportService({ uid: "owner-b", repository: b, state, isCurrent: () => session.repository() === b });
  assert.equal(serviceB.pendingCount(), 0); assert.equal((await serviceB.retryPending()).state, "synced");
  assert.deepEqual((await b.restore()).health, []); assert.equal(state.pending("owner-a").records.length, 1);
  await assert.rejects(serviceA.retryPending(), /cancelled/); assert.equal(f.port.commits.length, 0);
  await session.signOut();
});

test("HealthKit rechecks the real UID at commit; B's own explicit import persists only beneath B", async () => {
  const f = fixture(), state = createHealthKitImportState(() => f.storage); f.port.uid = "owner-a";
  state.setConsent("owner-a", true);
  const a = createFirebaseRepository(f.port, "owner-a", { healthKitConsent: () => state.consent("owner-a") });
  const serviceA = createHealthKitImportService({ uid: "owner-a", repository: a, state, isCurrent: () => f.port.uid === "owner-a", query: async () => ({ available: true, records: [healthKitSample()], errors: [], message: "Synthetic" }), now: () => timestamp });
  f.port.hold = deferred(); const importing = serviceA.importRecent(); await delay(10);
  assert.equal(state.pending("owner-a").records.length, 1);
  f.port.uid = "owner-b"; f.port.hold.resolve(); await assert.rejects(importing, /cancelled/); f.port.hold = undefined;
  assert.equal(f.port.commits.length, 0); assert.equal(state.pending("owner-b"), null);
  const b = createFirebaseRepository(f.port, "owner-b", { healthKitConsent: () => state.consent("owner-b") });
  const serviceB = createHealthKitImportService({ uid: "owner-b", repository: b, state, isCurrent: () => f.port.uid === "owner-b", query: async () => ({ available: true, records: [healthKitSample({ uuid: UUID_B })], errors: [], message: "Synthetic" }), now: () => timestamp });
  await assert.rejects(serviceB.importRecent(), /Enable/); serviceB.setConsent(true);
  assert.equal((await serviceB.importRecent()).state, "synced");
  assert.ok(f.port.commits.every(commit => commit.uid === "owner-b"));
  assert.equal((await b.load([])).health[0].id, `healthkit:${UUID_B}`);
  assert.equal(state.pending("owner-a").records.length, 1); assert.equal(state.lastImport("owner-a"), null);
});

test("mounted account switch clears A's records and active practice while B loads; sign-out cannot recover either", async () => {
  const f = fixture(), session = f.session(), a = await load(session, "owner-a");
  session.setOnline(false); await a.enqueue({ journal: [entry("owner-a")] });
  const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/", pretendToBeVisual: true });
  const keys = ["window", "document", "HTMLElement", "HTMLCanvasElement", "CustomEvent", "Event", "Element", "Audio"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.Audio = class { pause() {} play() { return Promise.resolve(); } };
  localRepository.savePractice(practice, { project: cloudProjectId, uid: "owner-a" });
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => { root.render(createElement(YiApp, { initialNow: Date.now(), session })); await delay(30); });
    await act(async () => delay(30));
    assert.ok(document.body.textContent.includes(entry("owner-a").title)); assert.equal(document.querySelector(".start-button").textContent, "Pause");
    await act(async () => { await session.signOut(); await delay(10); });
    assert.ok(!document.body.textContent.includes(entry("owner-a").title)); assert.equal(document.querySelector(".start-button").textContent, "Start");
    f.port.holdRead = deferred();
    await act(async () => { session.setOnline(true); await session.signIn("owner-b", "synthetic-unused"); await delay(10); });
    assert.ok(!document.body.textContent.includes(entry("owner-a").title)); assert.equal(document.querySelector(".start-button").textContent, "Start");
    await act(async () => { f.port.holdRead.resolve(); await delay(20); }); f.port.holdRead = undefined;
    assert.equal(localRepository.loadPractice({ project: cloudProjectId, uid: "owner-b" }), null);
    await act(async () => { await session.signOut(); await delay(10); });
    assert.equal(document.querySelector(".start-button").textContent, "Start");
  } finally {
    await act(async () => root.unmount()); session.repository()?.dispose?.(); dom.window.close(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
