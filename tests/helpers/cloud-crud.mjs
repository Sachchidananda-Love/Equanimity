import assert from "node:assert/strict";
import { createCycleDraft, updateCycleField } from "../../src/domain/cycle/records.ts";
import { manualHealthRecords } from "../../src/services/health-service.ts";
import { cloudRecordId } from "../../src/adapters/firebase/repository.ts";

/** Shared adapter + real-emulator acceptance; synthetic records only. */
export async function exerciseCloudCrud(repositoryFactory, readEnvelope) {
  const repository = repositoryFactory();
  const initial = await repository.load(["cycle", "lunar"]);
  const cycle = updateCycleField(createCycleDraft("2026-10-03"), "temperature", 36.5);
  const health = manualHealthRecords(cycle, "2026-10-03T12:00:00Z")[0];
  const cases = [
    ["journal", "journalEntries", { id: "crud-journal", type: "Journal", title: "Synthetic journal", date: "2026-10-03", note: "Create" }, record => ({ ...record, note: "Updated" })],
    ["timers", "timerPresets", { ...initial.timers[0], id: "crud-timer", name: "Synthetic timer" }, record => ({ ...record, seconds: record.seconds + 60 })],
    ["activities", "activityPresets", { ...initial.activities[0], id: "crud-activity", name: "Synthetic activity" }, record => ({ ...record, name: "Updated activity" })],
    ["books", "books", { id: "crud-book", title: "Synthetic book", startedOn: "2026-10-03", finished: false }, record => ({ ...record, title: "Updated book", finished: true, finishedOn: "2026-10-04" })],
    ["health", "healthRecords", health, record => ({ ...record, value: { ...record.value, value: 36.6 }, updatedAt: "2026-10-03T13:00:00Z" })],
  ];
  const created = Object.fromEntries(cases.map(([key, , record]) => [key, [record]]));
  created.cycle = { ...initial.cycle, averageCycle: 31, averagePeriod: 6, history: [cycle] };
  created.widgets = ["lunar", "cycle"];
  await repository.saveMany(created);
  async function verify(expected) {
    const loaded = await repositoryFactory().load([]);
    for (const key of Object.keys(expected)) assert.deepEqual(loaded[key], expected[key], `${key} read/reload`);
  }
  await verify(created);
  const updated = Object.fromEntries(cases.map(([key, , record, update]) => [key, [update(record)]]));
  updated.cycle = { ...created.cycle, history: [updateCycleField(cycle, "temperature", 36.6)] };
  updated.widgets = ["cycle"];
  await repository.saveMany(updated); await verify(updated);
  for (const [key, collection, record] of cases) {
    const envelope = await readEnvelope(collection, cloudRecordId(record.id));
    assert.equal(envelope.deleted, false); assert.deepEqual(envelope.record, updated[key][0]);
  }
  const removed = Object.fromEntries(cases.map(([key]) => [key, []]));
  removed.cycle = { ...updated.cycle, history: [] }; removed.widgets = [];
  await repository.saveMany(removed); await verify(removed);
  for (const [key, collection, record] of cases) {
    const envelope = await readEnvelope(collection, cloudRecordId(record.id));
    assert.equal(envelope.deleted, true, `${collection} tombstone`); assert.deepEqual(envelope.record, updated[key][0]);
  }
  const event = await readEnvelope("cycleEvents", cloudRecordId(cycle.id));
  assert.equal(event.deleted, true); assert.deepEqual(event.record, updated.cycle.history[0]);
  const cycleSettings = await readEnvelope("settings", "cycle");
  assert.equal(cycleSettings.record.averageCycle, 31); assert.ok(!("history" in cycleSettings.record));
  assert.deepEqual((await readEnvelope("settings", "dashboard")).record.widgets, []);
  // Reusing an intentional stable ID restores its own tombstone, not a new ID.
  await repository.saveMany(updated); await verify(updated);
  for (const [, collection, record] of cases) assert.equal((await readEnvelope(collection, cloudRecordId(record.id))).deleted, false);
  return updated;
}
