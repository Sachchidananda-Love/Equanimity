import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BodyCycleAnalytics, CycleTrackingChart } from "../src/application/BodyCycle.tsx";
import { emptyCycle } from "../src/adapters/local/repository.ts";
import { createCycleDraft, updateCycleField } from "../src/domain/cycle/records.ts";
import { cycleChartDays, cycleTemperatureScale, cycleTemperatureSegments, cycleObservationText, recordedCycleValue } from "../src/domain/cycle/chart.ts";

const day = (date, fields) => Object.entries(fields).reduce((record, [field, value]) => updateCycleField(record, field, value), createCycleDraft(date, `synthetic:${date}`));

test("daily chart keeps calendar gaps, resets cycle days only at recorded starts, and uses starts outside the selected range", () => {
  const history = [day("2026-09-28", { cycleDayOne: true }), day("2026-10-01", { temperature: 36.4 }), day("2026-10-03", { temperature: 36.5 }), day("2026-10-04", { cycleDayOne: true, temperature: 36.3 })];
  const chart = cycleChartDays({ ...emptyCycle(), history }, history.slice(1));
  assert.deepEqual(chart.map(item => item.date), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(chart.map(item => item.cycleDay), [4, 5, 6, 1]);
  assert.equal(chart[1].record, undefined);
  assert.equal(chart[3].cycleStart, true);
  assert.equal(cycleChartDays(emptyCycle(), [day("2026-10-01", { flow: "Heavy" })])[0].cycleDay, null, "bleeding alone must not invent a period start");
});

test("temperature lines break across missing or unrecorded days, and questionable readings stay visibly distinct", () => {
  const history = [day("2026-10-01", { temperature: 36.4 }), day("2026-10-03", { temperature: 36.5 }), day("2026-10-04", { temperature: 36.6, questionableTemperature: true }), day("2026-10-05", { flow: "None" })];
  history[3].temperature = 39; // Untouched compatibility data is not an observation.
  const scale = cycleTemperatureScale(history);
  const segments = cycleTemperatureSegments(cycleChartDays(emptyCycle(), history), scale.position);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].questionable, true);
  assert.ok(scale.max < 39);
  assert.ok(scale.position(36.4) > scale.position(36.6));
});

test("day detail preserves explicit none, no and zero, and never exposes untouched form defaults", () => {
  const record = day("2026-10-01", { cervicalMucus: "None / dry", flow: "None", energy: 0, sleepMinutes: 0, sleepInterruptions: 0, intercourse: false, symptoms: [] });
  assert.equal(recordedCycleValue(record, "sexDrive"), undefined);
  assert.equal(cycleObservationText(record, "sexDrive"), "Not recorded");
  assert.equal(cycleObservationText(record, "flow"), "None");
  assert.equal(cycleObservationText(record, "energy"), "0/100");
  assert.equal(cycleObservationText(record, "sleepMinutes"), "0h 0m");
  assert.equal(cycleObservationText(record, "sleepInterruptions"), "0");
  assert.equal(cycleObservationText(record, "intercourse"), "No");
  assert.equal(cycleObservationText(record, "symptoms"), "None");
});

test("calendar columns remain consecutive over month, year, leap day and daylight saving boundaries", () => {
  for (const [start, end, length] of [["2026-10-31", "2026-11-02", 3], ["2026-12-31", "2027-01-02", 3], ["2028-02-28", "2028-03-01", 3]]) {
    assert.equal(cycleChartDays(emptyCycle(), [day(start, {}), day(end, {})]).length, length);
  }
});

test("empty charts show an honest empty state and a single recorded day exposes all its details", () => {
  const empty = renderToStaticMarkup(createElement(CycleTrackingChart, { cycleLog: emptyCycle(), history: [] }));
  assert.match(empty, /Import your Tempdrop observations/);
  assert.doesNotMatch(empty, /Temperature scale|36\.\d/);
  const record = day("2026-10-08", { temperature: 36.49, cervicalMucus: "Egg white", flow: "None", energy: 0, sleepMinutes: 475, sleepInterruptions: 0, symptoms: ["Fatigue"], notes: "Synthetic development note", cycleDayOne: true });
  record.healthSourceRecordIds = { temperature: ["healthkit:synthetic-temperature"] };
  const html = renderToStaticMarkup(createElement(BodyCycleAnalytics, { cycleLog: { ...emptyCycle(), history: [record] }, now: Date.UTC(2026, 9, 8, 16), onClose() {} }));
  for (const detail of ["36.49°C", "Egg white", "Tempdrop · Apple Health", "7h 55m", "0/100", "Fatigue", "Synthetic development note", "Cycle day 1"]) assert.ok(html.includes(detail), detail);
  assert.doesNotMatch(html, /NaN|undefined/);
});
