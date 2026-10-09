import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import YiApp from "../app/YiApp.tsx";
import { emptyCycle, defaultAppData } from "../src/adapters/local/repository.ts";
import { createCycleDraft, updateCycleField } from "../src/domain/cycle/records.ts";
import { deriveJournalCycleContext, deriveJournalCycleContexts } from "../src/domain/cycle/journal-context.ts";
import { deriveFertilityDay } from "../src/domain/cycle/fertility.ts";
import { journalEntryDate } from "../src/domain/journal/dates.ts";
import { cycleDisplayLog } from "../src/services/health-service.ts";
import { normalizeHealthKitRecords } from "../src/adapters/healthkit.ts";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { healthKitSample, UUID_A, UUID_B } from "./helpers/healthkit-fixtures.mjs";

const record = (date, fields) => Object.entries(fields).reduce((day, [field, value]) => updateCycleField(day, field, value), createCycleDraft(date, `synthetic:${date}`));
const logOf = history => ({ ...emptyCycle(), history });
const start = date => record(date, { cycleDayOne: true });
const context = (log, date) => deriveJournalCycleContext(log, date);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = { id: "synthetic-journal-context", type: "Journal", title: "Synthetic historical entry", date: "2026-09-08", note: "Synthetic only", cycleContext: "Cycle Not Recorded · day 0" };
const flowSample = (date, uuid = UUID_A, isStart = true) => healthKitSample({
  uuid, localDate: date, typeIdentifier: "HKCategoryTypeIdentifierMenstrualFlow", sampleType: "Menstrual flow",
  startDate: `${date}T12:00:00Z`, endDate: `${date}T12:00:00Z`,
  value: { kind: "category", value: "medium", unit: "category" },
  metadata: isStart ? { "healthkit.HKMenstrualCycleStart": "1" } : {},
});

test("a journal date needs a prior start, not an exact-day cycle observation", () => {
  const log = logOf([start("2026-09-01")]);
  assert.equal(context(log, "2026-09-08").label, "Cycle day 8 · follicular estimate");
  assert.equal(context(log, "2026-09-23").label, "Cycle day 23 · post-ovulation estimate");
  assert.equal(context(log, "2026-09-08").basis, "estimated");
  assert.equal(context({ ...emptyCycle(), lastPeriod: "2026-09-01" }, "2026-09-08").cycleDay, 8);
});

test("historical dates use their own prior cycle, never the most recent start or a day-one clamp", () => {
  const log = { ...logOf([start("2026-08-04"), start("2026-09-01"), start("2026-09-29")]), lastPeriod: "2026-09-29" };
  const dates = ["2026-08-11", "2026-09-28", "2026-09-29", "2026-09-30"];
  assert.deepEqual(deriveJournalCycleContexts(log, dates).map(item => item.cycleDay), [8, 28, 1, 2]);
  assert.equal(context(log, "2026-08-11").label, "Cycle day 8 · follicular estimate");
  assert.equal(context(log, "2026-08-03").cycleDay, null);
});

test("a later confirmed/backfilled start corrects historical context on both sides without mutating records", () => {
  const before = { ...emptyCycle(), lastPeriod: "2026-09-01", averageCycle: 32 };
  const later = { ...before, lastPeriod: "2026-09-29", history: [start("2026-09-01"), start("2026-09-29")] };
  const saved = structuredClone(later);
  assert.equal(context(before, "2026-09-16").label, "Cycle day 16 · follicular estimate");
  assert.equal(context(later, "2026-09-16").label, "Cycle day 16 · post-ovulation estimate");
  assert.equal(context(before, "2026-09-30").cycleDay, 30);
  assert.equal(context(later, "2026-09-30").cycleDay, 2);
  assert.deepEqual(later, saved);
});

test("recent completed cycle lengths refine configured averages without inventing future period starts", () => {
  const log = { ...logOf([start("2026-08-04"), start("2026-09-01")]), averageCycle: 32 };
  assert.equal(context(log, "2026-09-16").label, "Cycle day 16 · post-ovulation estimate");
  assert.equal(context(log, "2026-10-09").cycleDay, 39);
  assert.equal(context(log, "2026-10-09").label, "Cycle day 39 · phase uncertain");
});

test("insufficient data, invalid dates, sample/legacy defaults and explicitly denied starts stay uncertain", () => {
  for (const date of ["2026-09-08", "not-a-date", null]) assert.equal(context(emptyCycle(), date).label, "Cycle context uncertain");
  const uncertain = logOf([record("2026-09-08", { temperature: 36.4 })]);
  assert.equal(context(uncertain, "2026-09-08").cycleDay, null);
  for (const origin of ["sample", "legacy-unverified"]) {
    assert.equal(context({ ...logOf([{ ...start("2026-09-01"), recordOrigin: origin }]), lastPeriod: "2026-09-01" }, "2026-09-08").cycleDay, null);
  }
  assert.equal(context(logOf([createCycleDraft("2026-09-01")]), "2026-09-08").cycleDay, null);
  assert.equal(context({ ...logOf([record("2026-09-01", { cycleDayOne: false })]), lastPeriod: "2026-09-01" }, "2026-09-08").cycleDay, null);
});

test("direct flow refines estimated phase while mucus/LH observations yield likelihood, never certainty", () => {
  const log = logOf([start("2026-09-01"), record("2026-09-02", { flow: "Heavy" }), record("2026-09-03", { flow: "None" }), record("2026-09-15", { cervicalMucus: "Egg white" }), record("2026-09-18", { ovulationTest: "Peak" })]);
  assert.equal(context(log, "2026-09-02").label, "Cycle day 2 · menstrual flow observed");
  assert.equal(context(log, "2026-09-02").basis, "observed");
  assert.equal(context(log, "2026-09-03").label, "Cycle day 3 · phase uncertain");
  assert.equal(context(log, "2026-09-15").label, "Cycle day 15 · likely fertile");
  assert.equal(context(log, "2026-09-15").basis, "estimated");
  assert.ok(context(log, "2026-09-15").observations.some(item => item.includes("Egg white")));
  assert.equal(context(log, "2026-09-19").label, "Cycle day 19 · likely fertile", "a recent positive test does not require an observation today");
  assert.equal(context(logOf([record("2026-09-02", { flow: "Medium" })]), "2026-09-02").label, "menstrual flow observed", "flow alone does not invent cycle day one");
  assert.equal(context(logOf([record("2026-09-02", { flow: "Spotting" })]), "2026-09-02").cycleDay, null);
});

test("temperature-supported context reuses causal fertility rules and later readings do not backdate confirmation", () => {
  const history = Array.from({ length: 12 }, (_, i) => record(`2026-09-${String(i + 1).padStart(2, "0")}`, {
    temperature: i < 6 ? 36.35 : 36.65, temperatureSource: "Tempdrop", cervicalMucus: i === 5 ? "Egg white" : "None / dry", ...(i === 0 ? { cycleDayOne: true } : {}),
  }));
  const log = logOf(history);
  assert.equal(context(log, "2026-09-10").label, "Cycle day 10 · post-ovulation estimate");
  assert.deepEqual(context(log, "2026-09-10").fertility, deriveFertilityDay(log, "2026-09-10"));
  assert.equal(context(log, "2026-09-08").label, "Cycle day 8 · possible fertile");
  assert.deepEqual(context(log, "2026-09-08"), context(logOf(history.slice(0, 8)), "2026-09-08"));
});

test("irregular cycles retain a known cycle day but avoid a confident calendar phase; physiology still refines it", () => {
  const log = logOf([start("2026-07-03"), start("2026-08-06"), start("2026-09-01")]);
  assert.equal(context(log, "2026-09-08").label, "Cycle day 8 · phase uncertain");
  const observed = { ...log, history: [...log.history, record("2026-09-08", { cervicalMucus: "Watery" })] };
  assert.equal(context(observed, "2026-09-08").label, "Cycle day 8 · likely fertile");
});

test("new verified Tempdrop menstrual data updates historical anchors without altering imported records", () => {
  const health = normalizeHealthKitRecords([flowSample("2026-09-01"), flowSample("2026-09-29", UUID_B)], "2026-10-09T12:00:00Z");
  const saved = structuredClone(health), log = emptyCycle();
  const display = cycleDisplayLog(log, health);
  assert.equal(context(display, "2026-09-08").label, "Cycle day 8 · follicular estimate");
  assert.equal(context(display, "2026-09-30").cycleDay, 2);
  assert.ok(context(display, "2026-09-08").fertility.evidence.some(input => input.sourceRecordIds.includes(health[0].id)));
  assert.deepEqual(health, saved); assert.deepEqual(log, emptyCycle());
  const flowOnly = cycleDisplayLog(log, normalizeHealthKitRecords([flowSample("2026-09-01", UUID_A, false)], "2026-10-09T12:00:00Z"));
  assert.equal(context(flowOnly, "2026-09-08").cycleDay, null, "unmarked bleeding cannot silently anchor a cycle");
});

test("entry dates follow normalized Toronto calendar rules across midnight, DST and year boundaries", () => {
  const now = Date.parse("2026-10-09T16:00:00Z");
  assert.equal(journalEntryDate(entry, now), "2026-09-08");
  assert.equal(journalEntryDate({ ...entry, loggedAt: now }, now), "2026-09-08", "explicit historical date wins over save time");
  assert.equal(journalEntryDate({ ...entry, date: "Today · just now", loggedAt: Date.parse("2026-09-09T02:00:00Z") }, now), "2026-09-08");
  const dst = journalEntryDate({ ...entry, date: "Today", loggedAt: Date.parse("2026-03-09T04:30:00Z") }, now);
  assert.equal(context({ ...emptyCycle(), lastPeriod: "2026-03-08" }, dst).cycleDay, 2);
  assert.equal(journalEntryDate({ ...entry, id: Date.parse("2026-09-08T12:00:00Z"), date: "Today" }, now), "2026-09-08");
  assert.equal(journalEntryDate({ ...entry, date: "Sep 8, 2025" }, now), "2025-09-08");
  assert.equal(journalEntryDate({ ...entry, date: "Dec 31" }, Date.parse("2026-01-02T12:00:00Z")), "2025-12-31");
  assert.equal(journalEntryDate({ ...entry, date: "unknown" }, now), null);
  assert.equal(journalEntryDate({ ...entry, date: "Today · just now" }, now), null, "a historical relative label alone cannot borrow today's context");
  assert.equal(journalEntryDate({ ...entry, date: "2026-02-30" }, now), null);
});

test("mounted Journal replaces stale stored context after imported history changes without rewriting journal records", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/", pretendToBeVisual: true });
  const keys = ["window", "document", "HTMLElement", "HTMLCanvasElement", "CustomEvent", "Event", "Element"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  let data = { ...defaultAppData([]), journal: [entry] }, writes = 0, savedJournal;
  const listeners = new Set(), repo = { async load() { return structuredClone(data); }, async save() { writes++; }, async saveMany(changes) { writes++; savedJournal = changes.journal; }, subscribeData(cb) { listeners.add(cb); return () => listeners.delete(cb); } };
  const session = createCloudSession(async () => ({ observe(cb) { cb({ uid: "synthetic-cycle-owner", email: null }); return () => {}; }, async signIn() {}, async signOut() {}, repository: () => repo }), { cloudPrimary: true, restoreOnStart: true });
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => { root.render(createElement(YiApp, { initialNow: Date.parse("2026-10-09T16:00:00Z"), session })); await delay(30); });
    await act(async () => delay(30));
    await act(async () => [...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Journal")).click());
    assert.match(document.querySelector(".entry-context").textContent, /Cycle context uncertain/);
    data = { ...data, health: normalizeHealthKitRecords([flowSample("2026-09-01")], "2026-10-09T12:00:00Z") };
    await act(async () => { listeners.forEach(cb => cb(structuredClone(data))); await delay(10); });
    assert.match(document.querySelector(".entry-context").textContent, /Cycle day 8 · follicular estimate/);
    assert.doesNotMatch(document.querySelector(".entry-context").textContent, /Cycle Not Recorded/);
    assert.equal(data.journal[0].cycleContext, entry.cycleContext, "legacy field is preserved, not migrated/overwritten");
    assert.equal(writes, 0, "derived context never creates repository writes");
    await act(async () => [...document.querySelectorAll(".journal-page .header-action")].find(button => button.textContent.includes("New entry")).click());
    await act(async () => document.querySelector(".entry-kind-grid button").click());
    await act(async () => { document.querySelector(".journal-entry-modal .primary-button").click(); await delay(20); });
    const added = savedJournal.find(item => item.id !== entry.id);
    assert.equal(added.cycleContext, undefined, "new entries do not freeze an estimate into their record");
    assert.equal(typeof added.loggedAt, "number", "new entries still have a durable own-date timestamp");
  } finally {
    await act(async () => root.unmount()); session.repository()?.dispose?.(); dom.window.close(); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
