import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRepository, DATA_KEY, BACKUP_KEY, emptyCycle } from "../src/adapters/local/repository.ts";
import { demoEntries, initialCycleHistory } from "../src/fixtures/demo-data.ts";
import { createRecordId } from "../src/domain/ids.ts";
import { localCalendarDate, dateOnlyParts, dateOnlyDay, displayDay } from "../src/domain/dates/calendar.ts";
import { cycleSummary, cycleFieldText } from "../src/domain/cycle/calculations.ts";
import { manualHealthRecords, createHealthService, reconcileManualHealthRecords } from "../src/services/health-service.ts";
import { createCycleDraft, updateCycleField, saveCycleDraft } from "../src/domain/cycle/records.ts";

class MemoryStorage {
  records = new Map(); writes = 0; fail = false;
  constructor(records = {}) { Object.entries(records).forEach(([k,v]) => this.records.set(k,v)); }
  get length() { return this.records.size; }
  key(i) { return [...this.records.keys()][i] ?? null; }
  getItem(key) { return this.records.get(key) ?? null; }
  setItem(key, value) { if (this.fail) throw new Error("Quota exceeded"); this.writes++; this.records.set(key, value); }
}
const clock = () => "2026-10-03T12:00:00.000Z";
const repo = storage => createLocalRepository(() => storage, clock);
const journal = { id: 1700000000000, type: "Journal", title: "My actual entry", date: "2023-11-14", note: "Original words", loggedAt: 1700000000000 };
const day = overrides => ({ ...initialCycleHistory[0], id: 99, date: "2026-10-03", temperatureSource: "Manual", recordOrigin: "user", recordedFields: [], ...overrides });

test("legacy records, numeric IDs and exact raw bytes survive migration/export", () => {
  const raw = '[\n  ' + JSON.stringify(journal) + '\n]';
  const storage = new MemoryStorage({ "yi-journal": raw, "yi-cycle": JSON.stringify({ ...emptyCycle(), history: [day({ id: 123, recordedFields: undefined, recordOrigin: undefined })] }), "yi-insights-workspace-v2": "1", "yi-extra": "opaque" });
  const r = repo(storage); const loaded = r.load(["daily-quote"]);
  assert.deepEqual(loaded.journal, [journal]); assert.equal(loaded.cycle.history[0].id,123);
  assert.equal(loaded.cycle.history[0].recordOrigin,"legacy-unverified"); assert.deepEqual(loaded.health,[]);
  assert.equal(storage.getItem("yi-journal"),raw);
  const backup = JSON.parse(storage.getItem(BACKUP_KEY)); assert.equal(backup.records["yi-journal"],raw);
  const exported = JSON.parse(r.exportRaw()); assert.equal(exported.records["yi-journal"],raw); assert.equal(exported.records["yi-extra"],"opaque");
  assert.equal(exported.records[BACKUP_KEY],storage.getItem(BACKUP_KEY));
});
test("empty and missing real histories never acquire demo records", () => {
  for (const initial of [{}, { "yi-journal": "[]", "yi-cycle": JSON.stringify(emptyCycle()) }]) {
    const storage = new MemoryStorage(initial); const r = repo(storage);
    assert.deepEqual(r.load([]).journal,[]); assert.deepEqual(r.load([]).cycle.history,[]); assert.deepEqual(r.load([]).health,[]);
    r.save("cycle",emptyCycle()); assert.deepEqual(repo(storage).load([]).cycle.history,[]);
    assert.equal(cycleSummary(r.load([]).cycle,new Date(clock())).phase,"Cycle not recorded");
  }
});
test("partial legacy cycle settings use configuration defaults, never sample health history", () => {
  const storage = new MemoryStorage({ "yi-cycle": JSON.stringify({lastPeriod:"2026-09-30",averageCycle:30}) });
  const data = repo(storage).load([]); assert.equal(data.cycle.averageCycle,30); assert.deepEqual(data.cycle.history,[]);
});
test("migration is idempotent and backups never get replaced", () => {
  const storage = new MemoryStorage({ "yi-journal": JSON.stringify([journal]) }); const r = repo(storage); r.load([]);
  const snapshot = [...storage.records]; const writes=storage.writes;
  r.load([]); repo(storage).load([]); assert.equal(storage.writes,writes); assert.deepEqual([...storage.records],snapshot);
  r.save("journal",[]); assert.equal(storage.getItem("yi-journal"),JSON.stringify([journal])); assert.equal(storage.getItem(BACKUP_KEY),snapshot.find(([k])=>k===BACKUP_KEY)[1]);
});
test("sample matches stay in review until an explicit user decision", () => {
  const storage = new MemoryStorage({ "yi-journal": JSON.stringify([...demoEntries,journal]), "yi-cycle": JSON.stringify({...emptyCycle(),lastPeriod:"2026-04-18",history:initialCycleHistory}) });
  const r=repo(storage); const data=r.load([]); assert.deepEqual(data.journal,[journal]); assert.deepEqual(data.cycle.history,[]); assert.equal(data.cycle.lastPeriod,"");
  assert.equal(r.reviewRecords().length,demoEntries.length+initialCycleHistory.length); assert.deepEqual(data.health,[]);
  r.restoreReviewRecord(0); assert.equal(r.load([]).journal.length,2); assert.equal(repo(storage).load([]).journal.length,2);
  assert.equal(JSON.parse(storage.getItem("yi-journal")).length,demoEntries.length+1);
});
test("malformed legacy records are retained and protected, not silently overwritten", () => {
  for (const raw of ['{oops',JSON.stringify([{...journal,title:5}]),JSON.stringify([journal,journal])]) {
    const storage=new MemoryStorage({"yi-journal":raw});const r=repo(storage);assert.deepEqual(r.load([]).journal,[]);
    assert.throws(()=>r.save("journal",[journal]),/protected/);assert.equal(storage.getItem("yi-journal"),raw);
    assert.equal(JSON.parse(storage.getItem(BACKUP_KEY)).records["yi-journal"],raw);
    const reloaded=repo(storage); reloaded.load([]); assert.throws(()=>reloaded.save("journal",[]),/protected/);
  }
});
test("malformed or future versioned envelopes cannot be replaced by a healthy collection", () => {
  const storage=new MemoryStorage(); repo(storage).load([]);const envelope=JSON.parse(storage.getItem(DATA_KEY)); envelope.data.journal=[{invalid:true}]; const raw=JSON.stringify(envelope);storage.setItem(DATA_KEY,raw);
  const r=repo(storage);r.load([]);assert.throws(()=>r.save("books",[]),/protected/);assert.equal(storage.getItem(DATA_KEY),raw);
  envelope.schemaVersion=2;const future=JSON.stringify(envelope);storage.setItem(DATA_KEY,future);const next=repo(storage);next.load([]);assert.throws(()=>next.save("journal",[]));assert.equal(storage.getItem(DATA_KEY),future);
});
test("new string IDs remain stable on round-trip while numeric IDs remain numeric", () => {
  const storage=new MemoryStorage();const r=repo(storage);r.load([]);const id=createRecordId();assert.equal(typeof id,"string");assert.notEqual(id,createRecordId());
  r.save("journal",[journal,{...journal,id,title:"New"}]);const loaded=repo(storage).load([]).journal;assert.equal(loaded[0].id,journal.id);assert.equal(loaded[1].id,id);
});
test("none, false, empty symptoms and zero are explicit records; untouched defaults are not", () => {
  const blank=day({temperature:undefined}); assert.deepEqual(manualHealthRecords(blank,clock()),[]);assert.equal(cycleFieldText(blank,"flow"),"Not recorded");
  const recorded=day({temperature:undefined,flow:"None",energy:0,sleepInterruptions:0,intercourse:false,symptoms:[],recordedFields:["flow","energy","sleepInterruptions","intercourse","symptoms"]});
  const records=manualHealthRecords(recorded,clock());assert.equal(records.length,5);assert.equal(records.find(r=>r.metric==="energy").value.value,0);assert.equal(records.find(r=>r.metric==="intercourse").value.value,false);assert.deepEqual(records.find(r=>r.metric==="symptoms").value.value,[]);assert.equal(cycleFieldText(recorded,"flow"),"None");
  const storage=new MemoryStorage();const r=repo(storage);r.load([]);r.save("health",records);assert.deepEqual(repo(storage).load([]).health,records);
  const summary=createHealthService(r).dailySummary(recorded.date,"America/Toronto");assert.equal(summary.values.energy.value.value,0);assert.equal(summary.sourceRecordIds.length,5);
});
test("manual and transcribed Tempdrop provenance do not claim HealthKit ingestion", () => {
  for (const source of ["Manual","Oral","Vaginal","Tempdrop"]) {
    const record=manualHealthRecords(day({temperature:36.5,temperatureSource:source,recordedFields:["temperature"]}),clock())[0];
    assert.equal(record.provenance.ingestion,"manual"); assert.equal(record.provenance.provider,source==="Tempdrop"?"tempdrop":"manual");
    const edited=manualHealthRecords(day({temperature:36.6,temperatureSource:source,recordedFields:["temperature"]}),"2026-10-04T12:00:00Z",[record])[0];assert.equal(edited.id,record.id);assert.equal(edited.createdAt,record.createdAt);
  }
});
test("calendar dates cross timezone and daylight-saving boundaries correctly", () => {
  assert.equal(localCalendarDate(Date.parse("2026-10-03T02:00:00Z")),"2026-10-02");assert.equal(localCalendarDate(Date.parse("2026-10-03T02:00:00Z"),"Asia/Tokyo"),"2026-10-03");
  assert.equal(dateOnlyParts("2026-02-30"),null);assert.ok(dateOnlyParts("2024-02-29"));
  assert.equal(displayDay(Date.parse("2026-03-09T04:30:00Z"))-dateOnlyDay("2026-03-08"),1);
  assert.equal(cycleSummary({...emptyCycle(),lastPeriod:"2026-03-08"},new Date("2026-03-09T04:30:00Z")).day,2);
});
test("all repositories and auxiliary state round-trip without mutating originals", () => {
  const storage=new MemoryStorage({"yi-active-practice":JSON.stringify({mode:"Timer",duration:600,endAt:1700000100000,intervalEnabled:false,intervalMinutes:5,customGongs:[]})});const r=repo(storage);const data=r.load(["cycle"]);
  const edited={...data,journal:[journal],books:[{id:"book1",title:"My book"}],cycle:{...emptyCycle(),history:[day({})]},widgets:[]};r.saveMany(edited);assert.deepEqual(repo(storage).load([]),edited);
  assert.equal(r.loadPractice().mode,"Timer");r.savePractice(null);assert.equal(repo(storage).loadPractice(),null);assert.ok(storage.getItem("yi-active-practice"));
  const quote={signature:"quotes",order:[0,1],day:20000,position:1};r.saveQuote(quote);assert.deepEqual(repo(storage).loadQuote(),quote);
});
test("atomic writes, quota failures and stale tabs preserve the last saved state", () => {
  const storage=new MemoryStorage();const r=repo(storage);r.load([]);const before=storage.getItem(DATA_KEY);storage.fail=true;
  assert.throws(()=>r.saveMany({journal:[journal],books:[{id:"book",title:"Title"}]}));assert.equal(storage.getItem(DATA_KEY),before);assert.deepEqual(r.load([]).journal,[]);storage.fail=false;
  const stale=repo(storage);stale.load([]);r.save("journal",[journal]);assert.throws(()=>stale.save("books",[]),/Another tab/);assert.deepEqual(repo(storage).load([]).journal,[journal]);
});
test("backup failure prevents migration writes", () => {
  const storage=new MemoryStorage({"yi-journal":JSON.stringify([journal])});storage.fail=true;const r=repo(storage);r.load([]);assert.equal(storage.getItem(DATA_KEY),null);assert.throws(()=>r.save("journal",[]));assert.equal(storage.getItem("yi-journal"),JSON.stringify([journal]));
});
test("legacy Tempdrop defaults do not become claims of imported measurements", () => {
  const legacy=day({temperatureSource:"Tempdrop",recordOrigin:"legacy-unverified",recordedFields:undefined});
  const edited=updateCycleField(legacy,"temperature",36.4); assert.equal(edited.temperatureSource,"Manual");
  const records=manualHealthRecords(edited,clock());assert.equal(records.length,1);assert.equal(records[0].provenance.provider,"manual");
});
test("changing a date preserves old IDs and untouched observations on an existing date", () => {
  const original=day({id:123,temperature:36.4,recordedFields:["temperature"]});const log={...emptyCycle(),history:[original]};
  const moved=saveCycleDraft(log,{...original,date:"2026-10-04"},29,5);assert.equal(moved.history[0].id,123);assert.equal(typeof moved.history[1].id,"string");assert.notEqual(moved.history[1].id,123);
  const draft=updateCycleField(createCycleDraft(original.date),"flow","None");const saved=saveCycleDraft(log,draft,29,5);assert.equal(saved.history[0].id,123);assert.equal(saved.history[0].temperature,36.4);assert.deepEqual(saved.history[0].recordedFields,["temperature","flow"]);
});
test("clearing a value retains its source record as a tombstone", () => {
  const log=day({temperature:36.5,recordedFields:["temperature"]});const source=manualHealthRecords(log,clock());const cleared=reconcileManualHealthRecords({...log,temperature:undefined},source,"2026-10-04T12:00:00Z");assert.equal(cleared.length,1);assert.equal(cleared[0].id,source[0].id);assert.equal(cleared[0].status,"deleted");assert.equal(cleared[0].value.value,36.5);
});
test("invalid normalized records cannot overwrite persisted data", () => {
  const storage=new MemoryStorage();const r=repo(storage);r.load([]);const record=manualHealthRecords(day({temperature:36.5,recordedFields:["temperature"]}),clock())[0];r.save("health",[record]);const raw=storage.getItem(DATA_KEY);
  for(const invalid of [{...record,metric:"invalid"},{...record,timeZone:"not-a-timezone"},{...record,confidence:{level:"fake"}},{...record,startAt:"2026-10-04T00:00:00Z",endAt:"2026-10-03T00:00:00Z"}]) {assert.throws(()=>r.save("health",[invalid]));assert.equal(storage.getItem(DATA_KEY),raw);}
});
test("malformed existing backup is retained and prevents migration", () => {
  const storage=new MemoryStorage({[BACKUP_KEY]:"invalid","yi-journal":JSON.stringify([journal])});const r=repo(storage);r.load([]);assert.equal(storage.getItem(BACKUP_KEY),"invalid");assert.equal(storage.getItem(DATA_KEY),null);
});
