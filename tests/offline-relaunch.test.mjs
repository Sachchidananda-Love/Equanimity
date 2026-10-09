import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import YiApp from "../app/YiApp.tsx";
import { createDeviceCloudAccess } from "../src/adapters/firebase/device-access.ts";
import { createDeviceCloudRecovery } from "../src/adapters/firebase/device-recovery.ts";
import { createIndexedDbSyncStore } from "../src/adapters/firebase/sync-store.ts";
import { createFirebaseRepository } from "../src/adapters/firebase/repository.ts";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createAppDataStore } from "../src/application/app-data-store.ts";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await delay(5); } assert.fail("Synthetic state did not settle"); }
const entry = { id: "offline-relaunch-test", type: "Journal", title: "Persisted synthetic account record", date: "2026-10-09", note: "Synthetic only" };
class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}
class Port {
  uid = "owner-a"; documents = new Map(); reads = 0; commits = 0; hold;
  currentUid() { return this.uid; }
  async read(path) { this.reads++; if (this.hold) await this.hold.promise; return structuredClone(this.documents.get(path) ?? null); }
  async list(path) { this.reads++; return [...this.documents].filter(([key]) => key.startsWith(path + "/")).map(([key, data]) => ({ id: key.slice(path.length + 1), data: structuredClone(data) })); }
  async commit(path, expected, writes) {
    const actual = this.documents.get(path)?.record;
    const mutation = writes.find(write => write.path === path)?.data.record.lastMutationId;
    if (mutation && actual?.lastMutationId === mutation && actual.revision === expected + 1) return;
    assert.equal(actual?.revision ?? 0, expected);
    for (const write of writes) this.documents.set(write.path, structuredClone(write.data)); this.commits++;
  }
}
function fixture() {
  const idb = new IDBFactory(), storage = new Storage(), port = new Port();
  const project = "demo-offline-relaunch", appId = "synthetic-app";
  function recovery() {
    return createDeviceCloudRecovery(project, appId, {
      access: createDeviceCloudAccess(project, appId, () => storage),
      store: createIndexedDbSyncStore(project, () => idb),
    });
  }
  function gateway(recovered, options = {}) {
    let observer;
    recovered.attach(port);
    return {
      observe(cb) { observer = cb; options.onObserve?.(cb); return () => {}; },
      async signIn() { const identity = { uid: port.uid, email: null }; observer(identity); return identity; },
      async signOut() { port.uid = null; observer(null); },
      repository: uid => recovered.repository(uid),
      emit: identity => observer(identity),
    };
  }
  async function seed() {
    const server = createFirebaseRepository(port, port.uid);
    await server.load([]);
    await server.saveMany({ journal: [entry], books: [{ id: "synthetic-book", title: "Persisted book" }], timers: [], activities: [], widgets: ["daily-quote", "insight-cycle"] });
    const recovered = recovery(), wire = gateway(recovered);
    const session = createCloudSession(async () => wire, { cloudPrimary: true, recovery: recovered });
    await session.signIn("unused", "unused");
    const view = createAppDataStore(session.repository(), []); await view.start();
    assert.equal(recovered.access.owner(), port.uid, "grant follows a usable persisted account baseline");
    view.dispose(); session.repository().dispose();
    return { recovered, session };
  }
  function relaunch(connect = deferred(), initialOnline = false) {
    const recovered = recovery();
    const session = createCloudSession(() => connect.promise, { cloudPrimary: true, restoreOnStart: true, recovery: recovered, initialOnline });
    return { recovered, connect, session };
  }
  return { port, storage, idb, project, appId, recovery, gateway, seed, relaunch };
}

test("online load -> new cache/session instances -> offline relaunch restores the complete baseline without SDK/auth", async () => {
  const f = fixture(); await f.seed(); const reads = f.port.reads;
  const { session } = f.relaunch();
  const view = createAppDataStore(session.repository(), []); await view.start();
  assert.equal(session.snapshot().cached, true); assert.equal(session.snapshot().auth, "authenticating");
  assert.deepEqual(view.snapshot().data.journal, [entry]);
  assert.equal(view.snapshot().data.books[0].title, "Persisted book");
  assert.deepEqual(view.snapshot().data.timers, []); assert.deepEqual(view.snapshot().data.activities, []);
  assert.deepEqual(view.snapshot().data.widgets, ["daily-quote", "insight-cycle"]);
  assert.deepEqual(view.snapshot().data, (await createIndexedDbSyncStore(f.project, () => f.idb).read("owner-a")).baseline.data, "all seven datasets survive, not only pending edits");
  assert.equal(f.port.reads, reads, "no Firestore call or SDK connection is needed to display cache");
  assert.equal(view.snapshot().ready, true);
  view.dispose(); session.repository().dispose();
});

test("offline edits survive another relaunch and sync once only after matching authentication", async () => {
  const f = fixture(); await f.seed(); const first = f.relaunch();
  const view = createAppDataStore(first.session.repository(), []); await view.start();
  const changed = { ...entry, note: "Offline edit persisted through relaunch" };
  view.set("journal", [changed]);
  await until(() => first.session.repository().syncStatus().pending === 1);
  const commits = f.port.commits;
  view.dispose(); first.session.repository().dispose();
  const second = f.relaunch(); const restored = createAppDataStore(second.session.repository(), []); await restored.start();
  assert.deepEqual(restored.snapshot().data.journal, [changed]);
  second.session.setOnline(true); await second.session.repository().refresh();
  assert.equal(f.port.commits, commits, "network hints cannot bypass matching Firebase auth");
  const repo = second.session.repository();
  const wire = f.gateway(second.recovered); second.connect.resolve(wire); await delay(0);
  wire.emit({ uid: "owner-a", email: null }); await repo.refresh();
  assert.equal(second.session.repository(), repo, "matching auth keeps the same cache/outbox/view");
  for (let i = 0; i < 4; i++) { second.session.resume(); second.session.setOnline(true); }
  await repo.refresh();
  assert.equal(f.port.commits, commits + 1); assert.equal(repo.syncStatus().pending, 0);
  assert.equal(f.port.documents.get("users/owner-a/journalEntries/s-offline-relaunch-test").record.note, changed.note);
  restored.dispose(); repo.dispose();
});

test("matching auth/reconnect never clears visible cached records while a server read is pending", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  const repo = boot.session.repository(), view = createAppDataStore(repo, []); await view.start();
  const before = view.snapshot().data; f.port.hold = deferred();
  const wire = f.gateway(boot.recovered); boot.connect.resolve(wire); await delay(0);
  boot.session.setOnline(true); wire.emit({ uid: "owner-a", email: null }); await delay(0);
  assert.equal(boot.session.repository(), repo); assert.equal(view.snapshot().data, before); assert.equal(view.snapshot().ready, true);
  f.port.hold.resolve(); await repo.refresh();
  assert.equal(view.snapshot().data, before, "unchanged refresh does not replace the baseline");
  view.dispose(); repo.dispose();
});

test("account A cache/outbox is never selected for B and late A hydration cannot become B's view", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  const old = boot.session.repository();
  f.port.uid = "owner-b";
  const wire = f.gateway(boot.recovered); boot.connect.resolve(wire); await delay(0);
  wire.emit({ uid: "owner-b", email: null });
  assert.notEqual(boot.session.repository(), old); assert.equal(boot.session.snapshot().identity.uid, "owner-b");
  await assert.rejects(old.restore(), /cancelled/);
  assert.equal(await boot.session.repository().restore(), null);
  const view = createAppDataStore(boot.session.repository(), []); await view.start();
  assert.deepEqual(view.snapshot().data.journal, []);
  assert.notEqual(boot.recovered.access.owner(), "owner-a");
  view.dispose(); boot.session.repository().dispose();
});

test("sign-out revokes cached access synchronously even if SDK sign-out/connection never completes", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  await boot.session.repository().restore();
  await boot.session.repository().enqueue({ journal: [{ ...entry, note: "Pending before sign-out" }] });
  void boot.session.signOut();
  assert.equal(boot.recovered.access.owner(), null); assert.equal(boot.recovered.access.blocked(), true);
  assert.equal(boot.session.repository(), undefined);
  const restart = f.relaunch();
  assert.equal(restart.session.repository(), undefined); assert.equal(restart.session.snapshot().identity, null);
  const wire = f.gateway(restart.recovered); restart.connect.resolve(wire); await delay(0);
  wire.emit({ uid: "owner-a", email: null });
  assert.equal(restart.session.snapshot().mode, "signed-out", "old persisted SDK user cannot override explicit sign-out");
  assert.equal(restart.session.repository(), undefined);
  const saved = await createIndexedDbSyncStore(f.project, () => f.idb).read("owner-a");
  assert.ok(saved, "outbox/baseline is retained, not discarded"); assert.equal(saved.pending.length, 1);
  assert.equal(saved.pending[0].changes.journal[0].note, "Pending before sign-out");
});

test("a stale successful sign-in cannot reopen account data after sign-out", async () => {
  const f = fixture(); await f.seed(); const recovered = f.recovery(), signingIn = deferred();
  const wire = f.gateway(recovered); wire.signIn = () => signingIn.promise;
  const session = createCloudSession(async () => wire, { cloudPrimary: true, recovery: recovered });
  const attempt = session.signIn("unused", "unused"); await delay(0);
  await session.signOut();
  signingIn.resolve({ uid: "owner-a", email: null }); await attempt;
  assert.equal(session.snapshot().identity, null); assert.equal(session.repository(), undefined);
  assert.equal(recovered.access.blocked(), true);
});

test("failed access revocation closes this view and never claims sign-out success or reopens it", async () => {
  const f = fixture(); await f.seed(); const recovered = f.recovery(), wire = f.gateway(recovered);
  const session = createCloudSession(async () => wire, { cloudPrimary: true, recovery: recovered });
  await session.signIn("unused", "unused"); await session.repository().load([]);
  f.storage.setItem = () => { throw new Error("Synthetic storage failure"); };
  await session.signOut();
  assert.equal(session.snapshot().auth, "authentication-error");
  wire.emit({ uid: "owner-a", email: null });
  assert.equal(session.snapshot().identity, null); assert.equal(session.repository(), undefined);
  assert.equal(session.snapshot().auth, "authentication-error", "delayed auth cannot hide the retry-sign-out action");
});

test("switching to B closes A before sign-in and ignores the old SDK restoration callback", async () => {
  const f = fixture(); await f.seed(); const recovered = f.recovery(), login = deferred();
  const wire = f.gateway(recovered, { onObserve: cb => cb({ uid: "owner-a", email: null }) });
  wire.signIn = () => login.promise;
  const session = createCloudSession(async () => wire, { cloudPrimary: true, recovery: recovered });
  const attempt = session.signIn("synthetic-b", "unused"); await delay(0);
  assert.equal(session.snapshot().identity, null); assert.equal(session.repository(), undefined);
  assert.equal(recovered.access.owner(), null);
  f.port.uid = "owner-b"; login.resolve({ uid: "owner-b", email: null }); await attempt;
  assert.equal(session.snapshot().identity.uid, "owner-b");
  assert.equal(await session.repository().restore(), null);
  assert.deepEqual((await session.repository().load([])).journal, []);
  assert.equal(recovered.access.owner(), "owner-b"); session.repository().dispose();
});

test("device access is granted only after authenticated server data is durably checkpointed", async () => {
  const f = fixture(), recovered = f.recovery(), wire = f.gateway(recovered);
  const session = createCloudSession(async () => wire, { cloudPrimary: true, recovery: recovered });
  await session.signIn("unused", "unused");
  assert.equal(recovered.access.owner(), null);
  f.port.hold = deferred(); const loading = session.repository().load([]); await delay(0);
  assert.equal(recovered.access.owner(), null, "authentication alone cannot grant a nonexistent usable cache");
  f.port.hold.resolve(); await loading;
  assert.equal(recovered.access.owner(), "owner-a");
  assert.ok(await createIndexedDbSyncStore(f.project, () => f.idb).read("owner-a"));
  session.repository().dispose();
});

test("missing, malformed, foreign-project and revoked access never bootstrap private cached records", async () => {
  const f = fixture(); await f.seed();
  const access = createDeviceCloudAccess(f.project, f.appId, () => f.storage);
  for (const raw of [null, "not-json", JSON.stringify({ schema: 1, project: "foreign", appId: f.appId, uid: "owner-a" }), JSON.stringify({ schema: 1, project: f.project, appId: f.appId, uid: null })]) {
    if (raw === null) f.storage.values.delete(access.key); else f.storage.setItem(access.key, raw);
    const boot = f.relaunch(); assert.equal(boot.session.repository(), undefined); assert.equal(boot.session.snapshot().identity, null);
  }
});

test("device-only cache access never authorizes Firestore reads or writes", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  const repo = boot.session.repository(); await repo.restore();
  await assert.rejects(repo.load([]), /matching Firebase/);
  assert.throws(() => repo.saveMany({ journal: [] }), /matching Firebase/);
  repo.dispose();
  f.port.uid = null;
  const baseline = (await createIndexedDbSyncStore(f.project, () => f.idb).read("owner-a")).baseline;
  const base = createFirebaseRepository(f.port, "owner-a", { cachedUid: () => "owner-a" }); base.restoreBaseline(baseline);
  await assert.rejects(base.load([]), /Authenticated UID/);
  await assert.rejects(base.saveMany({ journal: [] }), /Authenticated UID/);
  f.port.uid = "owner-b"; assert.throws(() => base.restoreBaseline(baseline), /does not own/);
});

test("failed SDK import preserves the cached view and durable pending edits", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  const view = createAppDataStore(boot.session.repository(), []); await view.start();
  boot.connect.reject(new Error("Synthetic SDK unavailable")); await delay(0);
  assert.equal(boot.session.snapshot().cached, true); assert.equal(boot.session.snapshot().auth, "authentication-error");
  assert.deepEqual(view.snapshot().data.journal, [entry]);
  view.set("journal", [{ ...entry, note: "Saved without SDK availability" }]);
  await until(() => boot.session.repository().syncStatus().pending === 1);
  view.dispose(); boot.session.repository().dispose();
});

test("cross-view access revocation closes an already rendered cached account", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  await boot.session.repository().restore();
  f.recovery().access.revoke(); boot.session.checkDeviceAccess();
  assert.equal(boot.session.repository(), undefined); assert.equal(boot.session.snapshot().mode, "signed-out");
});

test("actual mounted offline launch displays cached entries with no demo records before auth resolves", async () => {
  const f = fixture(); await f.seed(); const boot = f.relaunch();
  const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/", pretendToBeVisual: true });
  const keys = ["window", "document", "HTMLElement", "HTMLCanvasElement", "CustomEvent", "Event", "Element"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window.navigator, "onLine", { value: false });
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const { createRoot } = await import("react-dom/client"), root = createRoot(document.getElementById("root"));
  try {
    await act(async () => { root.render(createElement(YiApp, { initialNow: 1791475200000, session: boot.session })); await delay(30); });
    await act(async () => delay(30));
    await act(async () => [...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Journal")).click());
    assert.ok(document.body.textContent.includes(entry.title));
    assert.ok(document.body.textContent.includes("Offline · showing cached account data"));
    assert.equal(document.querySelector(".app-shell").hasAttribute("inert"), false);
    assert.doesNotMatch(document.body.textContent, /Morning clarity|Deep sit|Evening release/);
    let signingOut;
    // A never-settled SDK connection must not keep cached records on screen.
    await act(async () => { signingOut = boot.session.signOut(); await delay(0); });
    assert.equal(document.body.textContent.includes(entry.title), false);
    void signingOut;
  } finally {
    await act(async () => root.unmount()); dom.window.close(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
