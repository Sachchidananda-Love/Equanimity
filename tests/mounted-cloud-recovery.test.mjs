import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import YiApp from "../app/YiApp.tsx";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createCloudSyncRepository } from "../src/services/cloud-sync.ts";
import { createFirebaseRepository } from "../src/adapters/firebase/repository.ts";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = { id: "mounted-test", type: "Journal", title: "Synthetic mounted test", date: "2026-10-09", note: "Synthetic only" };
class Port {
  documents = new Map(); reads = 0; commits = 0;
  currentUid() { return "synthetic-owner"; }
  async read(path) { this.reads++; return structuredClone(this.documents.get(path) ?? null); }
  async list(path) { this.reads++; return [...this.documents].filter(([key]) => key.startsWith(path + "/")).map(([key, data]) => ({ id: key.slice(path.length + 1), data: structuredClone(data) })); }
  async commit(path, expected, writes) {
    const actual = this.documents.get(path)?.record;
    const mutation = writes.find(write => write.path === path)?.data.record.lastMutationId;
    if (mutation && mutation === actual?.lastMutationId && actual.revision === expected + 1) return;
    assert.equal(actual?.revision ?? 0, expected);
    writes.forEach(write => this.documents.set(write.path, structuredClone(write.data))); this.commits++;
  }
}
class Store {
  checkpoint = null; reads = 0; writes = 0;
  async read() { this.reads++; return structuredClone(this.checkpoint); }
  async write(_uid, next, expected) { assert.equal(this.checkpoint?.version ?? 0, expected); this.checkpoint = structuredClone(next); this.writes++; }
}
const repository = (port, store) => createCloudSyncRepository(createFirebaseRepository(port, port.currentUid()), port.currentUid(), store);

async function mounted(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/", pretendToBeVisual: true });
  const keys = ["window", "document", "HTMLElement", "HTMLCanvasElement", "CustomEvent", "Event", "Element"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const root = createRoot(document.getElementById("root"));
  try { await run(root, dom); }
  finally {
    await act(async () => root.unmount()); dom.window.close(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}
async function navigate(label) {
  await act(async () => [...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes(label)).click());
  assert.ok(document.querySelector(".bottom-nav button.active").textContent.includes(label));
  assert.equal(document.querySelector(".app-shell").hasAttribute("inert"), false);
  assert.equal(document.querySelectorAll(".modal-backdrop").length, 0);
}

test("mounted shell remains navigable after a two-second auth callback, cached activation and online/offline refresh", async () => {
  const port = new Port(), store = new Store(), seed = repository(port, store);
  await seed.load(["daily-quote", "insight-cycle"]); await seed.save("journal", [entry]); seed.dispose();
  let observer, activated = 0;
  const session = createCloudSession(async () => ({
    observe: cb => { observer = cb; return () => {}; }, signIn: async () => {}, signOut: async () => {},
    repository: () => { activated++; return repository(port, store); },
  }), { cloudPrimary: true, restoreOnStart: true });
  try {
    await mounted(async root => {
      await act(async () => root.render(createElement(YiApp, { initialNow: 1791475200000, session })));
      await navigate("Practice");
      await act(async () => { await delay(2000); observer({ uid: port.currentUid(), email: null }); await delay(20); });
      await navigate("Journal"); assert.ok(document.body.textContent.includes(entry.title));
      const active = session.repository(), reads = port.reads;
      await act(async () => { session.setOnline(false); session.setOnline(true); for (let i = 0; i < 5; i++) { session.resume(); observer({ uid: port.currentUid(), email: null }); } await delay(20); });
      assert.equal(session.repository(), active); assert.equal(activated, 1);
      assert.ok(port.reads <= reads + 9, "only one coalesced server read pass");
      await navigate("Insights"); await navigate("Practice");
      const writes = store.writes;
      await act(async () => delay(100)); assert.equal(store.writes, writes, "no autonomously rescheduled checkpoint loop");
    });
  } finally { session.repository()?.dispose(); }
});

test("mounted cached pending replay does not cause recursive saves or prevent navigation", async () => {
  const port = new Port(), store = new Store(), seed = repository(port, store);
  await seed.load(["daily-quote"]); seed.setOnline(false); await seed.enqueue({ journal: [entry] }); seed.dispose();
  let observer;
  const session = createCloudSession(async () => ({ observe: cb => { observer = cb; return () => {}; }, signIn: async () => {}, signOut: async () => {}, repository: () => repository(port, store) }), { cloudPrimary: true, restoreOnStart: true });
  try {
    await mounted(async root => {
      await act(async () => root.render(createElement(YiApp, { initialNow: 1791475200000, session })));
      await act(async () => { observer({ uid: port.currentUid(), email: null }); await delay(20); });
      await navigate("Journal"); assert.ok(document.body.textContent.includes(entry.title));
      assert.equal(port.commits, 1); assert.equal(store.checkpoint.pending.length, 0);
      await act(async () => delay(100)); assert.equal(port.commits, 1);
      await navigate("Practice");
    });
  } finally { session.repository()?.dispose(); }
});
