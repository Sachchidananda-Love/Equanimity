import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHealthKitRecords } from "../src/adapters/healthkit.ts";
import { createHealthKitImportState } from "../src/adapters/local/healthkit-import-state.ts";
import { createFirebaseRepository, cloudRecordId } from "../src/adapters/firebase/repository.ts";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createHealthKitImportService, reconcileHealthKitRecords } from "../src/services/healthkit-import-service.ts";
import { manualHealthRecords, selectDailyHealthRecords, cycleDisplayLog, dailyHealthSummary } from "../src/services/health-service.ts";
import { createCycleDraft, updateCycleField } from "../src/domain/cycle/records.ts";
import { emptyCycle } from "../src/adapters/local/repository.ts";
import { persistedHealthKitRecord } from "../src/domain/health/import-policy.ts";
import { healthValid, cycleValid } from "../src/adapters/local/validation.ts";
import { healthKitSample, UUID_A, UUID_B, UUID_C, timestamp } from "./helpers/healthkit-fixtures.mjs";

class Port {
  uid = "owner-a"; documents = new Map(); writes = 0; fail = false;
  currentUid() { return this.uid; }
  async read(path) { if (this.fail) throw Error("offline"); return structuredClone(this.documents.get(path) ?? null); }
  async list(path) { return [...this.documents].filter(([key]) => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/"))
    .map(([key, data]) => ({ id: key.slice(path.length + 1), data: structuredClone(data) })); }
  async commit(path, expected, writes, authorize) {
    if (this.fail) throw Error("offline"); authorize?.();
    if ((this.documents.get(path)?.record.revision ?? 0) !== expected) throw Error("revision conflict");
    for (const write of writes) this.documents.set(write.path, structuredClone(write.data));
    this.writes++;
  }
}
function setup(samples = [healthKitSample()]) {
  const values = new Map(); const state = createHealthKitImportState(() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }));
  const port = new Port(); const uid = "owner-a";
  const repository = createFirebaseRepository(port, uid, { healthKitConsent: () => state.consent(uid) });
  const query = async () => ({ available: true, records: samples, errors: [], message: "Synthetic Health data" });
  const makeService = (overrides = {}) => createHealthKitImportService({ uid, repository, state, isCurrent: () => port.uid === uid, query, now: () => timestamp, ...overrides });
  return { values, state, port, repository, makeService, service: makeService() };
}
const normalized = (...samples) => normalizeHealthKitRecords(samples.length ? samples : [healthKitSample()], timestamp);

test("same UUID twice and repeated reconciliation preserve one stable record and timestamps", () => {
  const input = normalized(); const first = reconcileHealthKitRecords([], [...input, ...input], timestamp);
  assert.equal(first.records.length, 1); assert.equal(first.report.new, 1); assert.equal(first.report.alreadyImported, 1);
  const second = reconcileHealthKitRecords(first.records, normalizeHealthKitRecords([healthKitSample()], "2026-10-08T12:00:00Z"), "2026-10-08T12:00:00Z");
  assert.deepEqual(second.records, first.records); assert.equal(second.report.alreadyImported, 1); assert.equal(second.report.updated, 0);
  assert.equal(second.records[0].id, `healthkit:${UUID_A}`);
});

test("different UUIDs on one date and manual data remain separate; selection and overrides are explicit", () => {
  let day = updateCycleField(createCycleDraft("2026-10-07", "manual-day"), "temperature", 36.1);
  day = updateCycleField(day, "flow", "None"); day = updateCycleField(day, "cervicalMucus", "Sticky");
  const manual = manualHealthRecords(day, timestamp);
  const imported = normalized(healthKitSample(), healthKitSample({ uuid: UUID_B, startDate: "2026-10-07T13:00:00Z", endDate: "2026-10-07T13:00:00Z", value: { kind: "quantity", value: 36.6, unit: "Cel" } }),
    healthKitSample({ uuid: UUID_C, typeIdentifier: "HKCategoryTypeIdentifierCervicalMucusQuality", value: { kind: "category", value: "egg-white", unit: "category" } }));
  const merged = reconcileHealthKitRecords(manual, imported, timestamp).records;
  assert.equal(merged.length, 6); assert.deepEqual(merged.slice(0, 3), manual);
  const selected = selectDailyHealthRecords(merged, day.date);
  assert.equal(selected["basal-temperature"].value.value, 36.6); assert.equal(selected["cervical-mucus"].value.value, "Sticky"); assert.equal(selected["menstrual-flow"].value.value, "None");
  day = updateCycleField(day, "temperatureDisplayOverride", true);
  const overridden = [...manualHealthRecords(day, timestamp), ...merged.filter(record => record.provenance.ingestion === "healthkit")];
  assert.equal(selectDailyHealthRecords(overridden, day.date)["basal-temperature"].value.value, 36.1);
  const view = cycleDisplayLog({ ...emptyCycle(), history: [day] }, overridden);
  assert.equal(view.history[0].temperature, 36.1); assert.equal(view.history[0].cervicalMucus, "Sticky");
  assert.equal(dailyHealthSummary(overridden, day.date, "America/Toronto").values["basal-temperature"].sourceRecordIds[0], manual[0].id);
});

test("source metadata proves provider; sleep, Apple, other sources and unreviewed types are skipped", () => {
  const spoof = healthKitSample({ source: { name: "Another app", bundleIdentifier: "com.synthetic.app", provider: "Tempdrop" } });
  const apple = healthKitSample({ uuid: UUID_B, source: { name: "Health", bundleIdentifier: "com.apple.health", provider: "Tempdrop" } });
  const sleep = healthKitSample({ uuid: UUID_C, typeIdentifier: "HKCategoryTypeIdentifierSleepAnalysis", value: { kind: "category", value: "asleep-deep", unit: "category" } });
  const records = normalized(spoof, apple, sleep);
  assert.deepEqual(records.map(record => record.provenance.provider), ["other source", "Apple", "Tempdrop"]);
  const reconciled = reconcileHealthKitRecords([], records, timestamp);
  assert.equal(reconciled.records.length, 0); assert.equal(reconciled.report.skipped, 3);
});

test("UUID corrections update in place; explicit sync-version replacements supersede without deleting", () => {
  const first = reconcileHealthKitRecords([], normalized(), timestamp).records;
  const corrected = normalized(healthKitSample({ value: { kind: "quantity", value: 36.8, unit: "Cel" } }));
  const update = reconcileHealthKitRecords(first, corrected, "2026-10-08T12:00:00Z");
  assert.equal(update.report.updated, 1); assert.equal(update.records[0].createdAt, first[0].createdAt);
  const old = normalized(healthKitSample({ metadata: { "healthkit.HKSyncIdentifier": "measurement-1", "healthkit.HKSyncVersion": "1" } }));
  const replacement = normalized(healthKitSample({ uuid: UUID_B, metadata: { "healthkit.HKSyncIdentifier": "measurement-1", "healthkit.HKSyncVersion": "2" } }));
  const superseded = reconcileHealthKitRecords(reconcileHealthKitRecords([], old, timestamp).records, replacement, timestamp);
  assert.equal(superseded.records.length, 2); assert.equal(superseded.records[0].status, "superseded"); assert.equal(superseded.report.superseded, 1);
  assert.deepEqual(reconcileHealthKitRecords(superseded.records, old, timestamp).records, superseded.records);
  assert.deepEqual(reconcileHealthKitRecords(first, [], timestamp).records, first);
  const deleted = [{ ...first[0], status: "deleted" }]; assert.deepEqual(reconcileHealthKitRecords(deleted, corrected, timestamp).records, deleted);
});

test("malformed native records reject the whole batch without staging or cloud writes", async () => {
  for (const patch of [{ uuid: "invalid" }, { value: { kind: "quantity", value: NaN, unit: "Cel" } }, { value: { kind: "quantity", value: 98, unit: "F" } }, { timeZone: "invalid" }, { endDate: "2020-01-01T00:00:00Z" }, { metadata: { raw: { nested: true } } }, { source: null }]) {
    assert.throws(() => normalized(healthKitSample(), healthKitSample(patch)), /Invalid|Malformed/);
  }
  const fixture = setup([healthKitSample({ uuid: "invalid" })]); fixture.service.setConsent(true);
  await assert.rejects(fixture.service.importRecent(), /Malformed/); assert.equal(fixture.port.writes, 0); assert.equal(fixture.state.pending("owner-a"), null);
});

test("consent defaults OFF for each UID and blocks uploads at service and repository boundaries", async () => {
  const fixture = setup();
  await assert.rejects(fixture.service.importRecent(), /Enable/); assert.equal(fixture.port.writes, 0);
  await fixture.repository.load([]);
  await assert.rejects(fixture.repository.save("health", normalized().map(persistedHealthKitRecord)), /disabled/);
  assert.equal(fixture.state.consent("owner-b"), false); fixture.service.setConsent(true); assert.equal(fixture.state.consent("owner-b"), false);
  const result = await fixture.service.importRecent(); assert.equal(result.state, "synced");
  fixture.service.setConsent(false); await assert.rejects(fixture.service.importRecent(), /Enable/);
  assert.equal((await fixture.repository.load([])).health.length, 1);
});

test("consent ON saves only selected normalized fields and round-trips through the UID healthRecords collection", async () => {
  const fixture = setup([healthKitSample(), healthKitSample({ uuid: UUID_B, typeIdentifier: "HKCategoryTypeIdentifierSleepAnalysis", value: { kind: "category", value: "asleep-rem", unit: "category" } })]);
  fixture.service.setConsent(true);
  const result = await fixture.service.importRecent(); assert.equal(result.state, "synced"); assert.equal(result.report.new, 1); assert.equal(result.report.skipped, 1);
  const record = result.data.health[0]; assert.ok(healthValid(record));
  const path = `users/owner-a/healthRecords/${cloudRecordId(record.id)}`; const envelope = fixture.port.documents.get(path);
  assert.deepEqual(envelope, { schemaVersion: 1, ownerUid: "owner-a", record: JSON.parse(JSON.stringify(record)), deleted: false });
  assert.equal(record.provenance.metadata.arbitraryPrivateNote, undefined); assert.equal(record.provenance.sourceDeviceId, "synthetic-device");
  assert.equal(record.provenance.originalSourceId, UUID_A); assert.equal(fixture.state.pending("owner-a"), null);
  assert.equal((await createFirebaseRepository(fixture.port, "owner-a").load([])).health.length, 1);
  const writes = fixture.port.writes; const again = await fixture.service.importRecent(); assert.equal(again.report.alreadyImported, 1); assert.equal(fixture.port.writes, writes);
  const display = cycleDisplayLog(emptyCycle(), result.data.health); assert.equal(display.history[0].temperature, 36.4);
  assert.equal(display.history[0].recordOrigin, "health-summary"); assert.equal(cycleValid(display), false, "derived display records cannot accidentally become stored manual cycle events");
});

test("all three verified Tempdrop metrics reach persisted health and cycle summaries; unknown flow stays unrecorded in the view", async () => {
  const fixture = setup([healthKitSample(),
    healthKitSample({ uuid: UUID_B, typeIdentifier: "HKCategoryTypeIdentifierCervicalMucusQuality", value: { kind: "category", value: "dry", unit: "category" } }),
    healthKitSample({ uuid: UUID_C, typeIdentifier: "HKCategoryTypeIdentifierMenstrualFlow", value: { kind: "category", value: "medium", unit: "category" } })]);
  fixture.service.setConsent(true); const imported = await fixture.service.importRecent();
  assert.equal(imported.report.new, 3); assert.equal(imported.data.health.length, 3);
  const day = cycleDisplayLog(emptyCycle(), imported.data.health).history[0];
  assert.equal(day.temperature, 36.4); assert.equal(day.cervicalMucus, "None / dry"); assert.equal(day.flow, "Medium");
  assert.equal(day.healthSourceRecordIds.flow[0], `healthkit:${UUID_C}`);
  const unknown = normalized(healthKitSample({ typeIdentifier: "HKCategoryTypeIdentifierMenstrualFlow", value: { kind: "category", value: "unknown-6", unit: "category" } }));
  assert.equal(cycleDisplayLog(emptyCycle(), unknown).history.length, 0);
});

test("cloud failures retain pending results across service restarts, explicit retry is idempotent", async () => {
  const fixture = setup(); fixture.service.setConsent(true); fixture.port.fail = true;
  const result = await fixture.service.importRecent(); assert.equal(result.state, "pending"); assert.equal(result.records.length, 1); assert.equal(fixture.port.writes, 0);
  assert.equal(fixture.state.pending("owner-a").records.length, 1);
  fixture.port.fail = false; const restarted = fixture.makeService(); const retried = await restarted.retryPending(); assert.equal(retried.state, "synced");
  assert.equal(fixture.state.pending("owner-a"), null); const writes = fixture.port.writes;
  await restarted.retryPending(); assert.equal(fixture.port.writes, writes);
});

test("Firestore tombstones retain UUID identity and cannot be resurrected by a repeated import", async () => {
  const fixture = setup(); fixture.service.setConsent(true); await fixture.service.importRecent();
  await fixture.repository.save("health", []);
  const path = `users/owner-a/healthRecords/${cloudRecordId(`healthkit:${UUID_A}`)}`;
  assert.equal(fixture.port.documents.get(path).deleted, true);
  const writes = fixture.port.writes;
  const again = await fixture.service.importRecent();
  assert.equal(again.report.alreadyImported, 1); assert.equal(again.data.health[0].status, "deleted");
  assert.equal(fixture.port.writes, writes); assert.equal(fixture.port.documents.get(path).deleted, true);
  assert.equal(cycleDisplayLog(emptyCycle(), again.data.health).history.length, 0);
});

test("device storage failure retains in-memory retry results and never starts an uncheckpointed upload", async () => {
  const fixture = setup(); fixture.service.setConsent(true);
  const original = fixture.state.setPending; fixture.state.setPending = () => { throw Error("storage quota"); };
  const result = await fixture.service.importRecent(); assert.equal(result.state, "pending");
  assert.equal(fixture.service.pendingCount(), 1); assert.equal(fixture.port.writes, 0);
  assert.match(result.message, /open view only/);
  fixture.state.setPending = original;
  assert.equal((await fixture.service.retryPending()).state, "synced");
});

test("repository rejects unreviewed metrics and rechecks consent at the transaction boundary", async () => {
  const fixture = setup(); fixture.service.setConsent(true); await fixture.repository.load([]);
  const sleep = normalized(healthKitSample({ typeIdentifier: "HKCategoryTypeIdentifierSleepAnalysis", value: { kind: "category", value: "asleep-rem", unit: "category" } }));
  await assert.rejects(fixture.repository.save("health", sleep.map(persistedHealthKitRecord)), /not approved/);
  const commit = fixture.port.commit.bind(fixture.port);
  fixture.port.commit = async (...args) => { fixture.service.setConsent(false); return commit(...args); };
  await assert.rejects(fixture.repository.save("health", normalized().map(persistedHealthKitRecord)), /disabled/);
  assert.equal(fixture.port.writes, 0);
});

test("query errors preserve existing records; no empty-query deletion; account switches cancel in-flight imports", async () => {
  const fixture = setup(); fixture.service.setConsent(true); await fixture.service.importRecent(); const before = [...fixture.port.documents];
  await assert.rejects(fixture.makeService({ query: async () => { throw Error("Health unavailable"); } }).importRecent()); assert.deepEqual([...fixture.port.documents], before);
  const empty = await fixture.makeService({ query: async () => ({ available: true, records: [], errors: [], message: "empty" }) }).importRecent(); assert.equal(empty.data.health.length, 1);
  const switched = fixture.makeService({ query: async () => { fixture.port.uid = "owner-b"; return { available: true, records: [healthKitSample()], errors: [], message: "" }; } });
  await assert.rejects(switched.importRecent(), /cancelled/); assert.equal(fixture.state.pending("owner-b"), null);
  assert.equal(fixture.state.consent("owner-b"), false); assert.deepEqual((await createFirebaseRepository(fixture.port, "owner-b").load([])).health, []);
});

test("failed cloud-session writes can be explicitly reloaded and retried, sign-out invalidates import service", async () => {
  const fixture = setup(); let observer;
  const gateway = { observe: callback => { observer = callback; return () => {}; }, signIn: async () => observer({ uid: "owner-a", email: null }), signOut: async () => { fixture.port.uid = null; observer(null); }, repository: () => fixture.repository };
  const session = createCloudSession(async () => gateway, { cloudPrimary: true }); await session.signIn("synthetic", "synthetic");
  const repository = session.repository(); await repository.load([]); fixture.service.setConsent(true);
  const service = fixture.makeService({ repository, isCurrent: () => session.repository() === repository && session.snapshot().identity?.uid === "owner-a" });
  const commit = fixture.port.commit.bind(fixture.port); fixture.port.commit = async () => { throw Error("offline"); };
  assert.equal((await service.importRecent()).state, "pending"); assert.equal(session.snapshot().save, "failed");
  fixture.port.commit = commit; assert.equal((await service.retryPending()).state, "synced"); assert.equal(session.snapshot().save, "synced");
  await session.signOut(); await assert.rejects(service.importRecent(), /cancelled/);
});
