import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { Capacitor } from "@capacitor/core";
import YiApp from "../app/YiApp.tsx";
import { localRepository, defaultAppData } from "../src/adapters/local/repository.ts";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { practiceNativeBridge } from "../src/platform/practice-lock-screen.ts";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(selector) {
  const node = typeof selector === "string" ? document.querySelector(selector) : selector;
  assert.ok(node); await act(async () => node.click());
}
async function navigate(label) {
  await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes(label)));
  assert.ok(document.querySelector(".bottom-nav .active").textContent.includes(label));
  assert.equal(document.querySelector(".app-shell").hasAttribute("inert"), false);
}

async function mounted(t, options, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/", pretendToBeVisual: true });
  const keys = ["window", "document", "HTMLElement", "HTMLCanvasElement", "CustomEvent", "Event", "Element", "Audio"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const state = { audio: 0, writes: [], intervals: new Map(), intervalCreations: 0, cloudWrites: 0, parentRenders: 0, logs: [], nativeCalls: [] };
  let now = 1791475200000, nextId = 100000;
  window.__EQUANIMITY_LIFECYCLE_DEBUG__ = true;
  t.mock.method(console, "debug", message => { state.logs.push(message); if (message.includes("account view render started")) state.parentRenders++; });
  t.mock.method(Date, "now", () => now);
  t.mock.method(Capacitor, "getPlatform", () => options.ios ? "ios" : "web");
  if (options.nativeScheduling) {
    const status = { permission: "authorized", soundEnabled: true, liveActivitiesEnabled: true, scheduled: 0, requested: 0, notificationScheduling: false };
    t.mock.method(practiceNativeBridge, "status", async () => status);
    t.mock.method(practiceNativeBridge, "sync", async ({ plan }) => {
      state.nativeCalls.push({ kind: "sync", plan: structuredClone(plan) });
      return { ...status, notificationScheduling: true, scheduled: plan.events.length, requested: plan.events.length };
    });
    t.mock.method(practiceNativeBridge, "cancel", async options => { state.nativeCalls.push({ kind: "cancel", ...options }); });
    t.mock.method(practiceNativeBridge, "playDue", async options => { state.nativeCalls.push({ kind: "playDue", ...options }); });
  }
  globalThis.Audio = class {
    constructor() { state.audio++; }
    pause() {}
    play() { return options.audioFailure ? Promise.reject(new Error("Synthetic audio failure")) : Promise.resolve(); }
  };
  t.mock.method(localRepository, "loadPractice", () => options.saved ?? null);
  t.mock.method(localRepository, "savePractice", record => state.writes.push(structuredClone(record)));
  const realInterval = window.setInterval.bind(window), realClear = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => {
    if (ms !== 500) return realInterval(fn, ms, ...args);
    state.intervalCreations++; const id = nextId++; state.intervals.set(id, fn); return id;
  };
  window.clearInterval = id => { if (!state.intervals.delete(id)) realClear(id); };
  let observer;
  const repo = { load: widgets => defaultAppData(widgets), save() { state.cloudWrites++; }, saveMany() { state.cloudWrites++; } };
  const session = createCloudSession(async () => ({
    observe: cb => { observer = cb; return () => {}; }, signIn: async () => {}, signOut: async () => {}, repository: () => repo,
  }), { cloudPrimary: Boolean(options.cloud), restoreOnStart: Boolean(options.cloud) });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => { root.render(createElement(YiApp, { initialNow: now, session })); await delay(20); });
    if (options.cloud) await act(async () => { observer({ uid: "synthetic-practice", email: null }); await delay(20); });
    await act(async () => delay(20));
    if (options.offline) await act(async () => session.setOnline(false));
    await navigate("Practice");
    state.tick = async seconds => { now += seconds * 1000; await act(async () => { for (const callback of [...state.intervals.values()]) callback(); }); };
    await run(state, session);
  } finally {
    await act(async () => root.unmount()); assert.equal(state.intervals.size, 0);
    dom.window.close(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    t.mock.restoreAll();
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}

test("Start once creates one checkpoint/interval; ticks do not rerender the app or persist", async t => {
  await mounted(t, {}, async state => {
    const renders = state.parentRenders;
    await click(".start-button");
    assert.equal(document.querySelector(".start-button").textContent, "Pause");
    assert.equal(state.writes.length, 1); assert.equal(state.intervalCreations, 1);
    for (let i = 0; i < 10; i++) await state.tick(1);
    assert.equal(state.writes.length, 1); assert.equal(state.intervalCreations, 1);
    assert.equal(state.parentRenders, renders);
    for (const event of ["practice start tapped", "active-practice checkpoint write start", "active-practice checkpoint write end", "practice active timer state set", "practice timer interval created", "practice first timer tick"]) assert.ok(state.logs.some(message => message.includes(event)), event);
    await navigate("Journal"); await navigate("Practice");
    await click(".start-button"); assert.equal(state.intervals.size, 0);
  });
});

test("foreground/online events before and during practice neither duplicate intervals nor checkpoints", async t => {
  await mounted(t, { cloud: true }, async (state, session) => {
    await act(async () => {
      session.setOnline(false); session.resume();
      window.dispatchEvent(new window.Event("pageshow"));
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    await click(".start-button");
    for (let i = 0; i < 5; i++) {
      await act(async () => { session.setOnline(true); session.resume(); window.dispatchEvent(new window.Event("pageshow")); document.dispatchEvent(new window.Event("visibilitychange")); });
      await state.tick(1);
    }
    assert.equal(state.intervalCreations, 1); assert.equal(state.writes.length, 1); assert.equal(state.cloudWrites, 0);
    await navigate("Journal"); await navigate("Practice"); await click(".start-button");
    assert.equal(state.intervals.size, 0);
  });
});

test("iOS Timer Start, Try and Stopwatch Finish must never enter WKWebView media playback", async t => {
  await mounted(t, { ios: true }, async state => {
    await click(".sound-button");
    await click(".start-button");
    await click(".start-button");
    await click([...document.querySelectorAll('.practice-page [role="tab"]')].find(button => button.textContent === "Stopwatch"));
    await click(".start-button"); await state.tick(2);
    await click('[aria-label="Finish practice"]');
    assert.equal(state.audio, 0, "native iOS must bypass the reported freezing HTML Audio path");
    assert.ok(document.querySelector(".modal-backdrop"), "Finish still opens reflection");
  });
});

for (const options of [{ cloud: true }, { cloud: true, offline: true }, { audioFailure: true }]) {
  test(`repeated Start/Pause works without cloud writes or interval leaks: ${JSON.stringify(options)}`, async t => {
    await mounted(t, options, async state => {
      const writes = state.cloudWrites;
      for (let i = 0; i < 5; i++) {
        await click(".start-button"); await state.tick(1); await click(".start-button");
        assert.equal(state.intervals.size, 0);
      }
      assert.equal(state.writes.length, 10); assert.equal(state.intervalCreations, 5);
      assert.equal(state.cloudWrites, writes);
      await navigate("Insights");
    });
  });
}

test("relaunch restores the deadline without replaying opening audio or rewriting checkpoints", async t => {
  const saved = { mode: "Timer", duration: 600, endAt: 1791475260000, openingGong: "Gong 1", closingGong: "Gong 1", intervalEnabled: true, intervalMinutes: 5, intervalGong: "Gong 3", customGongs: [], customGongSounds: [] };
  await mounted(t, { saved }, async state => {
    assert.equal(document.querySelector(".start-button").textContent, "Pause");
    assert.equal(state.writes.length, 0); assert.equal(state.audio, 0);
    await state.tick(5);
    await act(async () => { document.dispatchEvent(new window.Event("visibilitychange")); window.dispatchEvent(new window.Event("pageshow")); });
    assert.equal(state.intervalCreations, 1); assert.equal(state.writes.length, 0);
    await click(".start-button"); await click(".start-button");
    assert.equal(state.intervals.size, 1); await navigate("Insights");
  });
});

test("custom, repeating and completion gongs can fail without interrupting ticks or reflection", async t => {
  await mounted(t, { audioFailure: true }, async state => {
    await click(".start-button"); assert.equal(state.audio, 1);
    await state.tick(180); assert.equal(state.audio, 2, "custom gong");
    await state.tick(120); assert.equal(state.audio, 3, "repeating gong");
    await state.tick(300); assert.equal(state.audio, 4, "closing gong");
    assert.equal(state.intervalCreations, 1); assert.equal(state.intervals.size, 0);
    assert.equal(state.writes.length, 2); assert.equal(state.writes[1], null);
    assert.ok(document.querySelector(".modal-backdrop"));
  });
});

test("iOS Start schedules exact selected events once; ticks never reschedule or double-play", async t => {
  await mounted(t, { ios: true, nativeScheduling: true }, async state => {
    await click(".start-button");
    const plans = () => state.nativeCalls.filter(call => call.kind === "sync");
    assert.equal(plans().length, 1);
    assert.deepEqual(plans()[0].plan.events.map(event => [event.at - plans()[0].plan.startedAt, event.file]), [
      [180000, "gong-3.wav"], [300000, "gong-3.wav"], [480000, "tripple-gong.wav"], [600000, "gong-1.wav"],
    ]);
    assert.equal(state.writes.length, 1);
    await state.tick(180); await state.tick(120); await state.tick(180);
    assert.equal(plans().length, 1); assert.equal(state.writes.length, 1);
    await state.tick(120);
    assert.equal(state.nativeCalls.at(-1).kind, "cancel");
    assert.equal(state.nativeCalls.at(-1).completed, true);
    assert.ok(document.querySelector(".modal-backdrop"));
  });
});

test("iOS pause/reset cancels its schedule and Resume uses a new ID/deadline", async t => {
  await mounted(t, { ios: true, nativeScheduling: true }, async state => {
    await click(".start-button");
    const first = state.nativeCalls.find(call => call.kind === "sync").plan;
    await state.tick(10); await click(".start-button");
    assert.equal(state.nativeCalls.at(-1).kind, "cancel");
    await click(".start-button");
    const second = state.nativeCalls.filter(call => call.kind === "sync").at(-1).plan;
    assert.notEqual(first.sessionId, second.sessionId);
    assert.equal(first.endAt, second.endAt);
    await click('[aria-label="Reset timer"]');
    assert.equal(state.nativeCalls.at(-1).kind, "cancel");
  });
});

test("iOS relaunch/resume reconciles the persisted session ID without a new checkpoint", async t => {
  const saved = { sessionId: "synthetic-session", mode: "Timer", duration: 600, endAt: 1791475500000, openingGong: "Gong 1", closingGong: "Tripple Gong", intervalEnabled: true, intervalMinutes: 2, intervalGong: "Gong 2", customGongs: [], customGongSounds: [] };
  await mounted(t, { ios: true, nativeScheduling: true, saved }, async state => {
    const first = state.nativeCalls.find(call => call.kind === "sync").plan;
    assert.equal(first.sessionId, saved.sessionId); assert.equal(first.endAt, saved.endAt);
    assert.equal(state.writes.length, 0);
    await act(async () => window.dispatchEvent(new window.CustomEvent("equanimity:app-state", { detail: { active: true } })));
    const second = state.nativeCalls.filter(call => call.kind === "sync").at(-1).plan;
    assert.deepEqual(second, first); assert.equal(state.writes.length, 0);
  });
});

test("hidden iOS webview cannot cancel the final notification just before suspension", async t => {
  await mounted(t, { ios: true, nativeScheduling: true }, async state => {
    await click(".start-button");
    const cancellations = () => state.nativeCalls.filter(call => call.kind === "cancel").length;
    const before = cancellations();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await state.tick(600);
    assert.equal(cancellations(), before);
    assert.equal(document.querySelector(".modal-backdrop"), null);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    assert.ok(document.querySelector(".modal-backdrop"));
    assert.equal(state.nativeCalls.at(-1).completed, true);
  });
});

test("editing the active repeating interval updates the same native session, not its deadline", async t => {
  await mounted(t, { ios: true, nativeScheduling: true }, async state => {
    await click(".start-button");
    const first = state.nativeCalls.find(call => call.kind === "sync").plan;
    const checkbox = document.querySelector('[aria-label="Enable repeating gong"]');
    await click(checkbox);
    const next = state.nativeCalls.filter(call => call.kind === "sync").at(-1).plan;
    assert.equal(next.sessionId, first.sessionId); assert.equal(next.endAt, first.endAt);
    assert.equal(next.events.some(event => event.at === next.startedAt + 300000), false);
    assert.equal(state.writes.length, 2, "one edit checkpoint, not per-tick persistence");
    await state.tick(1); assert.equal(state.writes.length, 2);
  });
});
