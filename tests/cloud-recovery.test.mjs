import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import YiApp from "../app/YiApp.tsx";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createCloudSyncRepository } from "../src/services/cloud-sync.ts";
import { createFirebaseRepository } from "../src/adapters/firebase/repository.ts";
import { createAppDataStore } from "../src/application/app-data-store.ts";
import { observeCloudLifecycle } from "../src/platform/cloud-lifecycle.ts";

const entry = { id: "recovery-test", type: "Journal", title: "Synthetic recovery test", date: "2026-10-08", note: "Synthetic only" };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
class Port {
  uid = "owner-a"; documents = new Map(); reads = 0; commits = 0; fail = false; hold;
  currentUid() { return this.uid; }
  async read(path) { this.reads++; if (this.hold) await this.hold.promise; return structuredClone(this.documents.get(path) ?? null); }
  async list(path) { this.reads++; return [...this.documents].filter(([key]) => key.startsWith(path + "/")).map(([key, data]) => ({ id: key.slice(path.length + 1), data: structuredClone(data) })); }
  async commit(path, expected, writes) {
    if (this.fail) throw Object.assign(new Error("offline"), { code: "unavailable" });
    const actual = this.documents.get(path)?.record;
    const mutation = writes.find(write => write.path === path)?.data.record.lastMutationId;
    if (mutation && actual?.lastMutationId === mutation && actual.revision === expected + 1) return;
    if ((actual?.revision ?? 0) !== expected) throw new Error("revision conflict");
    for (const write of writes) this.documents.set(write.path, structuredClone(write.data));
    this.commits++;
  }
}
class Store {
  values = new Map(); fail = false;
  async read(uid) { return structuredClone(this.values.get(uid) ?? null); }
  async write(uid, value, expected) {
    if (this.fail) throw new Error("checkpoint failed");
    if ((this.values.get(uid)?.version ?? 0) !== expected) throw new Error("Device cloud cache changed in another view");
    this.values.set(uid, structuredClone(value));
  }
}
function sync(port, store, uid = port.uid) { return createCloudSyncRepository(createFirebaseRepository(port, uid), uid, store); }

test("auth restoration renders an interactive shell before Firebase or repository initialization completes", async () => {
  const connecting = deferred();
  const session = createCloudSession(() => connecting.promise, { cloudPrimary: true, restoreOnStart: true });
  assert.equal(session.snapshot().auth, "authenticating");
  const html = renderToString(createElement(YiApp, { initialNow: 1791475200000, session }));
  for (const label of ["Your wellbeing", "Meditation timer", "Insights", "Practice", "Journal", "Navigation is available"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /\sinert(?:=|\s|>)/);
  assert.equal(session.repository(), undefined);
  connecting.reject(new Error("unavailable")); await settle();
  assert.equal(session.snapshot().auth, "authentication-error");
  assert.doesNotMatch(renderToString(createElement(YiApp, { initialNow: 1791475200000, session })), /\sinert(?:=|\s|>)/);
});

test("offline edits are checkpointed without waiting for the network; reconnect preserves data and saves them", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store);
  const view = createAppDataStore(repo, ["cycle"]); await view.start();
  repo.setOnline(false); view.set("journal", [entry]); await settle();
  assert.deepEqual(view.snapshot().data.journal, [entry]); assert.equal(view.snapshot().ready, true);
  assert.equal(repo.syncStatus().pending, 1); assert.equal(port.commits, 0);
  assert.equal((await store.read("owner-a")).pending.length, 1);
  repo.setOnline(true); await repo.refresh();
  assert.equal(repo.syncStatus().pending, 0); assert.equal(port.commits, 1);
  assert.deepEqual(view.snapshot().data.journal, [entry]);
  repo.dispose(); view.dispose();
});

test("force quit / relaunch restores the authenticated UID cache and pending edits before server reads", async () => {
  const port = new Port(), store = new Store(), first = sync(port, store);
  await first.load(["cycle"]); first.setOnline(false); await first.enqueue({ journal: [entry] }); first.dispose();
  port.hold = deferred(); const repo = sync(port, store), view = createAppDataStore(repo, ["cycle"]);
  repo.setOnline(false); await view.start();
  assert.equal(view.snapshot().ready, true); assert.deepEqual(view.snapshot().data.journal, [entry]);
  assert.equal(repo.syncStatus().pending, 1);
  repo.setOnline(true); port.hold.resolve(); await repo.refresh();
  assert.equal(repo.syncStatus().pending, 0); assert.equal(port.commits, 1);
  view.dispose(); repo.dispose();
});

test("same UID auth notifications, repeated reconnects and app resume do not replace the repository or fan out reads", async () => {
  const port = new Port(), store = new Store(); let observer;
  const gateway = { observe: cb => { observer = cb; return () => {}; }, signIn: async () => observer({ uid: port.uid, email: null }), signOut: async () => {}, repository: uid => sync(port, store, uid) };
  const session = createCloudSession(async () => gateway, { cloudPrimary: true });
  await session.signIn("unused", "unused"); const repo = session.repository(); await repo.load([]);
  const revision = session.snapshot().revision;
  port.hold = deferred(); session.setOnline(false); session.setOnline(true);
  for (let i = 0; i < 5; i++) { session.setOnline(true); session.resume(); observer({ uid: "owner-a", email: null }); }
  assert.equal(session.repository(), repo); assert.equal(session.snapshot().revision, revision);
  await settle(); const reads = port.reads;
  session.resume(); await settle(); assert.equal(port.reads, reads);
  port.hold.resolve(); await repo.refresh(); repo.dispose();
});

test("transient transaction failure retains every pending edit and retry drains the queue", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store); await repo.load([]);
  port.fail = true; await repo.enqueue({ journal: [entry] }); await assert.rejects(repo.refresh());
  assert.equal(repo.syncStatus().phase, "offline"); assert.equal(repo.syncStatus().writable, true);
  repo.setOnline(false); await repo.enqueue({ journal: [{ ...entry, note: "Second synthetic edit" }] });
  assert.equal(repo.syncStatus().pending, 2);
  port.fail = false; repo.setOnline(true); await repo.refresh();
  assert.equal(repo.syncStatus().pending, 0);
  assert.equal(port.documents.get("users/owner-a/journalEntries/s-recovery-test").record.note, "Second synthetic edit"); repo.dispose();
});

test("lost write acknowledgement followed by relaunch uses a stable mutation ID and does not duplicate the commit", async () => {
  const port = new Port(), store = new Store(), base = createFirebaseRepository(port, port.uid);
  const original = base.commitQueued; let lose = true;
  base.commitQueued = async (...args) => { await original(...args); if (lose) { lose = false; throw Object.assign(new Error("offline"), { code: "unavailable" }); } };
  const first = createCloudSyncRepository(base, port.uid, store); await first.load([]);
  await first.enqueue({ journal: [entry] }); await assert.rejects(first.refresh());
  assert.equal(port.commits, 1); assert.equal((await store.read(port.uid)).pending.length, 1); first.dispose();
  const restarted = sync(port, store); await restarted.restore(); await restarted.refresh();
  assert.equal(port.commits, 1); assert.equal(restarted.syncStatus().pending, 0); restarted.dispose();
});

test("failed Firestore reads leave the ready dataset usable and retain the validated write baseline", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store), view = createAppDataStore(repo, []); await view.start();
  const prior = view.snapshot().data;
  const read = port.read.bind(port); port.read = async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); };
  await assert.rejects(repo.refresh()); assert.equal(view.snapshot().data, prior); assert.equal(view.snapshot().ready, true);
  repo.setOnline(false); view.set("journal", [entry]); await settle(); assert.equal(repo.syncStatus().pending, 1);
  port.read = read; repo.setOnline(true); await repo.refresh(); assert.equal(port.commits, 1); view.dispose(); repo.dispose();
});

test("a local edit during a refresh is never replaced or rebased over another device's revision", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store), view = createAppDataStore(repo, []); await view.start();
  const remote = createFirebaseRepository(port, port.uid); await remote.load([]); await remote.save("journal", [{ ...entry, note: "Other device" }]);
  port.hold = deferred(); const refreshing = repo.refresh(); await settle();
  view.set("journal", [entry]); await settle(); port.hold.resolve(); await refreshing;
  assert.deepEqual(view.snapshot().data.journal, [entry]);
  await assert.rejects(repo.refresh(), /conflict/);
  assert.equal(repo.syncStatus().pending, 1); assert.equal(repo.syncStatus().writable, false);
  assert.equal(port.documents.get("users/owner-a/journalEntries/s-recovery-test").record.note, "Other device"); view.dispose(); repo.dispose();
});

test("permission failure pauses account writes without discarding cached data or queued changes", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store); await repo.load([]);
  repo.setOnline(false); await repo.enqueue({ journal: [entry] });
  port.commit = async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); };
  repo.setOnline(true); await assert.rejects(repo.refresh());
  assert.equal(repo.syncStatus().phase, "failed"); assert.equal(repo.syncStatus().pending, 1);
  assert.equal((await store.read(port.uid)).pending.length, 1); repo.dispose();
});

test("cache checkpoint failure retains the edit in memory and never claims durable sync", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store); await repo.load([]); repo.setOnline(false);
  store.fail = true; await assert.rejects(repo.enqueue({ journal: [entry] }));
  assert.equal(repo.syncStatus().pending, 1); assert.equal(repo.syncStatus().writable, false); assert.equal(port.commits, 0);
  store.fail = false; repo.setOnline(true); await repo.refresh(); assert.equal(port.commits, 1); repo.dispose();
});

test("recovery clears a failed checkpoint warning only after the retained edit is synced", async () => {
  const port = new Port(), store = new Store(); let observer;
  const session = createCloudSession(async () => ({ observe: cb => { observer = cb; return () => {}; }, signIn: async () => observer({ uid: port.uid, email: null }), signOut: async () => {}, repository: uid => sync(port, store, uid) }), { cloudPrimary: true });
  await session.signIn("unused", "unused"); const repo = session.repository(), view = createAppDataStore(repo, []);
  await view.start(); repo.setOnline(false); store.fail = true;
  view.set("journal", [entry]); await settle();
  assert.equal(view.snapshot().issues.length, 1); assert.equal(repo.syncStatus().phase, "failed");
  repo.setOnline(false); assert.equal(repo.syncStatus().phase, "failed");
  store.fail = false; repo.setOnline(true); await repo.refresh();
  assert.equal(view.snapshot().issues.length, 0); assert.deepEqual(view.snapshot().data.journal, [entry]);
  view.dispose(); repo.dispose();
});

test("offline cold account never reports cloud changes saved before loading a baseline", async () => {
  const port = new Port(), store = new Store(); let observer;
  const session = createCloudSession(async () => ({ observe: cb => { observer = cb; return () => {}; }, signIn: async () => observer({ uid: port.uid, email: null }), signOut: async () => {}, repository: uid => sync(port, store, uid) }), { cloudPrimary: true });
  session.setOnline(false); await session.signIn("unused", "unused");
  assert.equal(session.snapshot().save, "pending"); await assert.rejects(session.repository().load([]));
  assert.equal(session.snapshot().save, "pending"); session.repository().dispose();
});

test("another UID cannot restore cached data and late old-account reads cannot notify the current view", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store); await repo.load([]); await repo.save("journal", [entry]);
  port.hold = deferred(); let notified = 0; repo.subscribeData(() => notified++); const loading = repo.refresh(); await settle();
  repo.dispose(); port.uid = "owner-b"; const b = sync(port, store); assert.equal(await b.restore(), null);
  port.hold.resolve(); await assert.rejects(loading); assert.equal(notified, 0); b.dispose();
});

test("device checkpoint CAS protects a queue written by another view", async () => {
  const port = new Port(), store = new Store(), first = sync(port, store); await first.load([]);
  const second = sync(port, store); await second.restore(); first.setOnline(false); second.setOnline(false);
  await first.enqueue({ journal: [entry] }); await assert.rejects(second.enqueue({ books: [{ id: "book", title: "Synthetic" }] }));
  const saved = await store.read(port.uid); assert.equal(saved.pending.length, 1); assert.deepEqual(saved.pending[0].changes.journal, [entry]);
  first.dispose(); second.dispose();
});

test("read generations ignore stale reload results and preserve edits made while a read is pending", async () => {
  const initial = new Port(); const base = createFirebaseRepository(initial, initial.uid); const data = await base.load([]);
  let reading = deferred(); const repository = { load: () => reading.promise, saveMany: async () => {} };
  const view = createAppDataStore(repository, []); const start = view.start(); reading.resolve(data); await start;
  reading = deferred(); const old = view.reload(); const stale = reading;
  reading = deferred(); const current = view.reload(); reading.resolve({ ...data, journal: [entry] }); await current;
  stale.resolve(data); await old; assert.deepEqual(view.snapshot().data.journal, [entry]);
  reading = deferred(); const waiting = view.reload(); view.set("journal", [{ ...entry, note: "Local draft" }]); await settle(); reading.resolve(data); await waiting;
  assert.equal(view.snapshot().data.journal[0].note, "Local draft"); view.dispose();
});

test("native and DOM foreground events coalesce, and lifecycle listeners are removed on unmount", () => {
  const target = new EventTarget(), page = new EventTarget(); target.navigator = { onLine: true }; page.visibilityState = "visible";
  const transitions = []; let resumes = 0;
  const off = observeCloudLifecycle({ setOnline: value => transitions.push(value), resume: () => resumes++ }, target, page);
  target.navigator.onLine = false; target.dispatchEvent(new Event("offline")); target.dispatchEvent(new Event("offline"));
  page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"));
  page.visibilityState = "visible"; target.navigator.onLine = true; target.dispatchEvent(new Event("online")); page.dispatchEvent(new Event("visibilitychange"));
  const event = new Event("equanimity:app-state"); event.detail = { active: true }; target.dispatchEvent(event);
  assert.deepEqual(transitions, [true, false, true]); assert.equal(resumes, 1);
  off(); target.navigator.onLine = false; target.dispatchEvent(new Event("offline")); assert.deepEqual(transitions, [true, false, true]);
});

test("a foreign cache envelope is rejected even if placed under the current account key", async () => {
  const port = new Port(), store = new Store(), a = sync(port, store); await a.load([]); a.dispose();
  store.values.set("owner-b", await store.read("owner-a")); port.uid = "owner-b";
  const b = sync(port, store); await assert.rejects(b.restore(), /foreign/); assert.equal(b.syncStatus().writable, false); b.dispose();
});

test("explicit imported saves still await the server and succeed if only the optional cache checkpoint fails", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store); await repo.load([]);
  store.fail = true; await repo.save("journal", [entry]);
  assert.equal(port.commits, 1); assert.equal(repo.syncStatus().phase, "failed");
  assert.deepEqual((await repo.load([])).journal, [entry]); repo.dispose();
});

test("sign-out during slow Firebase connection cannot reopen the restored account", async () => {
  const connecting = deferred(); let callback, signedOut = false;
  const session = createCloudSession(() => connecting.promise, { cloudPrimary: true, restoreOnStart: true });
  const signingOut = session.signOut();
  connecting.resolve({ observe: cb => { callback = cb; cb({ uid: "owner-a", email: null }); return () => {}; }, signIn: async () => {}, signOut: async () => { signedOut = true; callback(null); }, repository: () => { throw Error("Must not select a private repository"); } });
  await signingOut; assert.equal(signedOut, true); assert.equal(session.snapshot().mode, "signed-out"); assert.equal(session.repository(), undefined);
});

test("explicit local selection during restoration is not overridden by the auth callback", async () => {
  const connecting = deferred(); let callback;
  const session = createCloudSession(() => connecting.promise, { cloudPrimary: true, restoreOnStart: true });
  session.selectLocal(); connecting.resolve({ observe: cb => { callback = cb; return () => {}; }, signIn: async () => {}, signOut: async () => {}, repository: () => { throw Error("Must stay local"); } });
  await settle(); callback({ uid: "owner-a", email: null }); assert.equal(session.snapshot().mode, "local");
});

test("an effect cleanup/restart rehydrates, and unmount checkpoints already accepted UI edits", async () => {
  const port = new Port(), store = new Store(), repo = sync(port, store), view = createAppDataStore(repo, []);
  await view.start(); view.dispose(); await view.start(); assert.equal(view.snapshot().ready, true);
  repo.setOnline(false); view.set("journal", [entry]); view.dispose(); await settle();
  assert.deepEqual((await store.read(port.uid)).pending[0].changes.journal, [entry]); repo.dispose();
});
