import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyCycle } from "../src/adapters/local/repository.ts";
import { createCycleDraft, updateCycleField } from "../src/domain/cycle/records.ts";
import { deriveCycleInsights } from "../src/domain/cycle/calculations.ts";
import { deriveFertilityDay, deriveFertilityTimeline, detectSustainedTemperatureShift } from "../src/domain/cycle/fertility.ts";
import { BodyCycleAnalytics, CycleTrackingChart } from "../src/application/BodyCycle.tsx";
import { CycleFertilityEstimate } from "../src/application/CycleFertility.tsx";
import { cycleDisplayLog, manualHealthRecords } from "../src/services/health-service.ts";
import { normalizeHealthKitRecords } from "../src/adapters/healthkit.ts";
import { healthKitSample } from "./helpers/healthkit-fixtures.mjs";

const record = (date, fields) => Object.entries(fields).reduce((result, [field, value]) => updateCycleField(result, field, value), createCycleDraft(date, `synthetic:${date}`));
const dateAt = day => `2026-09-${String(day).padStart(2, "0")}`;
const logOf = history => ({ ...emptyCycle(), history });
const dates = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => dateAt(first + index));
function shiftedHistory() {
  return Array.from({ length: 12 }, (_, index) => record(dateAt(index + 1), {
    temperature: index < 6 ? 36.35 : 36.65, temperatureSource: "Tempdrop",
    cervicalMucus: index === 5 ? "Egg white" : "None / dry",
    ...(index === 0 ? { cycleDayOne: true } : {}),
  }));
}

test("early-cycle uncertainty: bleeding, dry mucus and negative tests never mean infertility", () => {
  const log = logOf([record(dateAt(1), { cycleDayOne: true, flow: "Heavy", cervicalMucus: "None / dry", ovulationTest: "Negative" }), record(dateAt(2), { cervicalMucus: "None / dry" })]);
  const result = deriveFertilityTimeline(log, dates(1, 3));
  assert.deepEqual(result.map(day => day.state), ["uncertain", "uncertain", "uncertain"]);
  assert.deepEqual(result.map(day => day.cycleDay), [1, 2, 3]);
  assert.ok(result[0].reasons.some(reason => reason.includes("Bleeding")));
  assert.equal(deriveFertilityDay(logOf([record(dateAt(1), { flow: "Heavy" })]), dateAt(1)).cycleStart, null, "flow must not invent a cycle-day-one event");
});

test("fertile mucus takes priority before a shift, and unresolved signs widen possible fertility", () => {
  const log = logOf([record(dateAt(1), { cycleDayOne: true }), record(dateAt(3), { cervicalMucus: "Creamy" }), record(dateAt(4), { cervicalMucus: "Egg white", temperature: 36.3 }), record(dateAt(6), { mucusSensation: "Slippery" })]);
  const result = deriveFertilityTimeline(log, dates(1, 8));
  assert.deepEqual(result.map(day => day.state), ["uncertain", "uncertain", "possible", "likely", "possible", "likely", "possible", "possible"]);
  assert.ok(result.every(day => day.temperatureShift === null));
});

test("sustained post-ovulation rise needs six baselines, three consecutive highs and complete post-peak mucus", () => {
  const history = shiftedHistory();
  const estimates = deriveFertilityTimeline(logOf(history), dates(6, 12));
  assert.deepEqual(estimates.map(day => day.state), ["likely", "possible", "possible", "possible", "lower", "lower", "lower"]);
  assert.equal(estimates[3].temperatureShift.firstHighDate, dateAt(7));
  assert.equal(estimates[3].temperatureShift.supportedOn, dateAt(9));
  assert.equal(estimates[3].temperatureShift.threshold, 36.55);
  assert.equal(estimates[4].peakMucusDate, dateAt(6));
  assert.ok(estimates[4].reasons[0].includes("not confirmed infertility"));
  assert.ok(estimates[4].evidence.some(item => item.description.includes("Every subsequent day") && item.dates.length === 5));
  assert.ok(estimates[4].evidence.some(item => item.description.includes("continues at or above") && item.dates.includes(dateAt(10))));
  assert.equal(detectSustainedTemperatureShift(history.slice(6), dateAt(9)), null, "a partial baseline is never sufficient");
  assert.equal(deriveCycleInsights(history.slice(0, 9)).sustainedShift, true);
  assert.equal(deriveCycleInsights(history.slice(6, 9)).sustainedShift, false, "the former partial-baseline heuristic is replaced");
});

test("missing temperatures never bridge a shift or silently retain lower likelihood", () => {
  for (const missing of [4, 8, 10]) {
    const history = shiftedHistory();
    history[missing - 1] = record(dateAt(missing), { cervicalMucus: history[missing - 1].cervicalMucus, temperatureSource: "Tempdrop" });
    const result = deriveFertilityTimeline(logOf(history), dates(missing, 12));
    assert.ok(result.every(day => day.state !== "lower"), `missing day ${missing}`);
    if (missing <= 9) assert.equal(detectSustainedTemperatureShift(history, dateAt(9)), null);
  }
  const missingMucus = shiftedHistory();
  missingMucus[7].recordedFields = missingMucus[7].recordedFields.filter(field => field !== "cervicalMucus");
  assert.equal(deriveFertilityDay(logOf(missingMucus), dateAt(10)).state, "possible", "unknown mucus is not dry mucus");
});

test("new fertile mucus, high/positive tests, bleeding and temperature conflicts suspend an earlier shift", () => {
  for (const [fields, expected] of [[{ cervicalMucus: "Watery" }, "likely"], [{ mucusSensation: "Wet" }, "likely"], [{ ovulationTest: "Positive" }, "likely"], [{ ovulationTest: "High" }, "possible"], [{ temperature: 36.3 }, "possible"], [{ flow: "Spotting" }, "possible"]]) {
    const history = shiftedHistory();
    history[10] = Object.entries(fields).reduce((day, [field, value]) => updateCycleField(day, field, value), history[10]);
    const result = deriveFertilityTimeline(logOf(history), dates(10, 12));
    assert.equal(result[0].state, "lower");
    assert.equal(result[1].state, expected);
    assert.equal(result[1].temperatureShift, null);
    assert.notEqual(result[2].state, "lower", "the previous rise cannot reappear after a conflict");
  }
});

test("questionable, disturbed, mixed-source and unrecorded temperatures do not establish a shift", () => {
  for (const patch of [{ questionableTemperature: true }, { disturbances: ["Illness"] }, { medicationNote: "Synthetic medication note" }, { temperatureSource: "Oral" }, { temperature: Number.NaN }, { temperature: 38 }]) {
    const history = shiftedHistory();
    history[7] = Object.entries(patch).reduce((day, [field, value]) => updateCycleField(day, field, value), history[7]);
    assert.equal(detectSustainedTemperatureShift(history, dateAt(9)), null);
    assert.notEqual(deriveFertilityDay(logOf(history), dateAt(10)).state, "lower");
  }
  const history = shiftedHistory();
  history[7].recordedFields = history[7].recordedFields.filter(field => field !== "temperature");
  assert.equal(detectSustainedTemperatureShift(history, dateAt(9)), null);
});

test("positive/peak tests influence that day and the next two days; high and negative tests never close a window", () => {
  const log = logOf([record(dateAt(1), { cycleDayOne: true }), record(dateAt(5), { ovulationTest: "Peak" }), record(dateAt(8), { ovulationTest: "Negative", cervicalMucus: "None / dry" })]);
  assert.deepEqual(deriveFertilityTimeline(log, dates(5, 10)).map(day => day.state), ["likely", "likely", "likely", "possible", "possible", "possible"]);
});

test("irregular recorded cycles widen the calendar-only window without claiming lower fertility outside it", () => {
  const lengths = [25, 34, 28, 37, 22, 35];
  const starts = [Date.UTC(2026, 0, 1)];
  lengths.forEach(length => starts.push(starts.at(-1) + length * 86400000));
  const history = starts.map(timestamp => record(new Date(timestamp).toISOString().slice(0, 10), { cycleDayOne: true }));
  const start = history.at(-1).date;
  const date = offset => new Date(starts.at(-1) + offset * 86400000).toISOString().slice(0, 10);
  const log = { ...logOf(history), averageCycle: 29 };
  const early = deriveFertilityDay(log, start);
  assert.equal(early.state, "uncertain");
  assert.equal(early.calendarWindow.irregular, true);
  assert.equal(early.calendarWindow.start, date(3)); // shortest 22 − 18 = cycle day 4
  assert.equal(early.calendarWindow.end, date(25)); // longest 37 − 11 = cycle day 26
  assert.equal(deriveFertilityDay(log, date(10)).state, "possible");
  assert.equal(deriveFertilityDay(log, date(30)).state, "uncertain");
  assert.deepEqual(deriveFertilityDay({ ...log, averageCycle: 60 }, date(10)), deriveFertilityDay(log, date(10)), "configuration defaults do not influence the estimate");
  assert.equal(deriveFertilityDay(logOf(history.slice(1)), date(10)).calendarWindow, null, "six completed cycles, not six starts, are needed");
  const incomplete = history.slice(1); incomplete[0] = { ...incomplete[0], date: "2020-01-01" };
  assert.equal(deriveFertilityDay(logOf(incomplete), date(10)).calendarWindow, null, "missing or old starts cannot create a forecast");
});

test("existing manual display overrides influence estimates without changing imported records or provenance", () => {
  const history = shiftedHistory();
  const normalized = normalizeHealthKitRecords([healthKitSample({ localDate: dateAt(8), startDate: "2026-09-08T12:00:00Z", endDate: "2026-09-08T12:00:00Z", value: { kind: "quantity", value: 36.65, unit: "Cel" } })], "2026-09-08T12:00:00Z");
  history[7] = updateCycleField(history[7], "temperature", 36.2);
  const original = structuredClone({ history, normalized });
  const ordinary = cycleDisplayLog(logOf(history), [...manualHealthRecords(history[7], "2026-09-08T12:00:00Z"), ...normalized]);
  assert.equal(ordinary.history[7].temperature, 36.65, "imported reading wins unless override is explicit");
  const originalEstimate = deriveFertilityDay(ordinary, dateAt(10));
  assert.equal(originalEstimate.state, "lower");
  assert.ok(originalEstimate.evidence.some(item => item.sourceRecordIds.some(id => id.startsWith("healthkit:"))));
  const overriddenHistory = history.map(day => day.date === dateAt(8) ? updateCycleField(day, "temperatureDisplayOverride", true) : day);
  const override = cycleDisplayLog(logOf(overriddenHistory), [...manualHealthRecords(overriddenHistory[7], "2026-09-08T12:00:00Z"), ...normalized]);
  assert.equal(override.history[7].temperature, 36.2);
  assert.equal(deriveFertilityDay(override, dateAt(10)).state, "possible");
  const detail = deriveFertilityDay(override, dateAt(8));
  assert.ok(detail.evidence.some(item => item.manualOverride));
  assert.deepEqual({ history, normalized }, original, "derivation is a read-only projection");
  const deniedStart = record(dateAt(1), { cycleDayOne: false });
  assert.equal(deriveFertilityDay({ ...logOf([deniedStart]), lastPeriod: dateAt(1) }, dateAt(1)).cycleStart, null, "an explicit false start overrides conflicting last-period compatibility data");
});

test("no-data, samples, unverified legacy observations and untouched defaults remain uncertain", () => {
  const empty = deriveFertilityDay(emptyCycle(), dateAt(10));
  assert.equal(empty.state, "uncertain"); assert.equal(empty.calendarWindow, null); assert.equal(empty.temperatureShift, null); assert.deepEqual(empty.evidence, []);
  for (const origin of ["sample", "legacy-unverified"]) {
    const history = shiftedHistory().map(day => ({ ...day, recordOrigin: origin }));
    assert.equal(deriveFertilityDay({ ...logOf(history), lastPeriod: dateAt(1) }, dateAt(10)).state, "uncertain");
  }
  const defaults = shiftedHistory().map(day => ({ ...day, recordedFields: [] }));
  assert.equal(deriveFertilityDay(logOf(defaults), dateAt(10)).state, "uncertain");
  assert.deepEqual(deriveFertilityTimeline(emptyCycle(), ["not-a-date"]), []);
});

test("estimates are causal, independent of chart range, stable when reordered, and reset at recorded starts", () => {
  const history = shiftedHistory();
  const log = logOf(history);
  const earlier = deriveFertilityDay(log, dateAt(8));
  assert.deepEqual(earlier, deriveFertilityDay(logOf(history.slice(0, 8)), dateAt(8)), "future temperatures and mucus cannot confirm an earlier day");
  assert.equal(earlier.state, "possible");
  const timeline = deriveFertilityTimeline(log, dates(1, 12));
  assert.deepEqual(deriveFertilityTimeline(log, dates(8, 12)), timeline.slice(7));
  assert.deepEqual(deriveFertilityTimeline(logOf([...history].reverse()), dates(1, 12)), timeline);
  history[10] = updateCycleField(history[10], "cycleDayOne", true);
  assert.equal(deriveFertilityDay(logOf(history), dateAt(11)).state, "uncertain");
  assert.equal(deriveFertilityDay(logOf(history), dateAt(11)).cycleDay, 1);
  assert.equal(deriveFertilityDay(logOf(history), dateAt(11)).temperatureShift, null);
});

test("positive pregnancy observations suspend cycle estimates, and future days never forecast lower likelihood", () => {
  const history = shiftedHistory();
  assert.equal(deriveFertilityDay(logOf(history), dateAt(13)).state, "possible");
  history[10] = updateCycleField(history[10], "pregnancyTest", "Positive");
  assert.equal(deriveFertilityDay(logOf(history), dateAt(11)).state, "uncertain");
  assert.equal(deriveFertilityDay(logOf(history), dateAt(12)).state, "uncertain");
});

test("chart row is date-aligned and the explanation exposes sources, rules and contraception limitations", () => {
  const history = shiftedHistory();
  const log = logOf(history);
  const chart = renderToStaticMarkup(createElement(CycleTrackingChart, { cycleLog: log, history: history.slice(5), selectedDate: dateAt(10) }));
  const row = chart.match(/<div class="cycle-fertility-row">(.*?)<\/div>/s)?.[1];
  assert.equal((row?.match(/<button/g) ?? []).length, 7);
  assert.match(row, /fertility-likely|fertility-lower/);
  assert.match(chart, /app estimates, not contraception guarantees/);
  const panel = renderToStaticMarkup(createElement(CycleFertilityEstimate, { estimate: deriveFertilityDay(log, dateAt(10)), fahrenheit: true }));
  for (const text of ["Post-ovulation / lower fertility likelihood", "not a validated contraceptive", "Evidence &amp; calculation rules", "97.79°F", "fertility-observations-v1", "WHO/JHU", "imported records are never overwritten"]) assert.ok(panel.includes(text), text);
  assert.doesNotMatch(panel, /Infertile|Safe day|Nut Window/);
  const html = renderToStaticMarkup(createElement(BodyCycleAnalytics, { cycleLog: emptyCycle(), now: Date.UTC(2026, 8, 10, 16), onClose() {} }));
  assert.match(html, /Uncertain \/ insufficient data/);
  assert.doesNotMatch(html, /NaN|undefined/);
});
