"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import type { CycleDayLog, CycleLog } from "../domain/cycle/types";
import { dateOnlyTimestamp, displayDay, dateOnlyDay, localCalendarDate } from "../domain/dates/calendar";
import { deriveCycleInsights } from "../domain/cycle/calculations";
import { cycleChartDays, cycleObservationFields, cycleObservationText, cycleStartDates, cycleTemperatureScale, cycleTemperatureSegments, recordedCycleValue } from "../domain/cycle/chart";
import { deriveFertilityDay, deriveFertilityTimeline } from "../domain/cycle/fertility";
import { CycleFertilityEstimate, FertilityChartRow, FertilityLegend } from "./CycleFertility";

const mucusLevels = ["Egg white", "Watery", "Creamy", "Sticky", "None / dry"] as const;
const ranges = ["7d", "30d", "90d", "1yr", "All"] as const;
type CycleRange = typeof ranges[number];
const formatDate = (date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" }).format(dateOnlyTimestamp(date));
const temperatureText = (value: number, fahrenheit: boolean) => `${(fahrenheit ? value * 9 / 5 + 32 : value).toFixed(2)}°${fahrenheit ? "F" : "C"}`;

function observationSource(record: CycleDayLog, field: keyof CycleDayLog) {
  const imported = record.healthSourceRecordIds?.[field]?.some(id => id.startsWith("healthkit:"));
  return imported ? "Tempdrop · Apple Health" : field === "temperature" ? `${record.temperatureSource} · manually recorded` : record.recordOrigin === "legacy-unverified" ? "Saved observation · source unverified" : "Manually recorded";
}

function shortObservation(record: CycleDayLog | undefined, field: keyof CycleDayLog) {
  const value = recordedCycleValue(record, field);
  if (value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? String(value.length) : "None";
  if (field === "notes" || field === "medicationNote") return value ? "✎" : "None";
  if (field === "sleepMinutes" || field === "deepSleepMinutes") return `${(Number(value) / 60).toFixed(1)}h`;
  if (field === "sleepLatencyMinutes") return `${value}m`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const abbreviations: Record<string, string> = { "Not tested": "NT", Negative: "−", Positive: "+", Medium: "Med", Slippery: "Slip", Closed: "Cl", High: "Hi", Firm: "Fm" };
  return abbreviations[String(value)] ?? String(value);
}

export function CycleTrackingChart({ cycleLog, history, compact = false, selectedDate, onSelect, fahrenheit = false, showAllRows = false, dayWidth = 32 }: {
  cycleLog: CycleLog; history: CycleDayLog[]; compact?: boolean; selectedDate?: string; onSelect?: (date: string) => void; fahrenheit?: boolean; showAllRows?: boolean; dayWidth?: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const days = cycleChartDays(cycleLog, history);
  const fertility = deriveFertilityTimeline(cycleLog, days.map(day => day.date));
  const scale = cycleTemperatureScale(history);
  const segments = cycleTemperatureSegments(days, scale.position);
  const rows = compact ? [] : cycleObservationFields.filter(({ field }) => field !== "flow" && field !== "cervicalMucus" && (showAllRows || history.some(day => recordedCycleValue(day, field) !== undefined)));
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  useEffect(() => {
    const node = scroll.current;
    if (node) node.scrollLeft = node.scrollWidth - node.clientWidth;
  }, [first, last, dayWidth]);
  useEffect(() => {
    const node = scroll.current;
    const cell = node?.querySelector<HTMLElement>(".cycle-calendar .is-selected");
    const leftAxis = node?.querySelector<HTMLElement>(".cycle-sticky-left");
    const rightAxis = node?.querySelector<HTMLElement>(".cycle-sticky-right");
    if (!node || !cell || !leftAxis || !rightAxis) return;
    const visible = node.getBoundingClientRect();
    const selected = cell.getBoundingClientRect();
    const left = visible.left + leftAxis.offsetWidth;
    const right = visible.right - rightAxis.offsetWidth;
    if (selected.left < left) node.scrollLeft -= left - selected.left;
    else if (selected.right > right) node.scrollLeft += selected.right - right;
  }, [selectedDate, first, last, dayWidth]);

  if (!days.length) return <div className="body-cycle-empty"><span aria-hidden="true">◌</span><b>Your body’s patterns, day by day</b><p>Import your Tempdrop observations or save a body & cycle check-in to begin.</p></div>;

  const variables = { "--cycle-days": days.length, "--cycle-day-width": `${compact ? 22 : dayWidth}px` } as CSSProperties;
  return <div className={`body-cycle-chart ${compact ? "is-compact" : ""}`} style={variables}>
    <div className="body-cycle-scroll" ref={scroll} role="region" aria-label="Daily cycle chart; scroll horizontally for earlier dates">
      <div className="body-cycle-grid">
        <div className="cycle-axis-heading cycle-sticky-left"><span>Date</span><b>Cycle day</b></div>
        <div className="cycle-calendar">{days.map(day => <button type="button" key={day.date} className={`${day.date === selectedDate ? "is-selected" : ""} ${day.cycleStart ? "is-start" : ""}`} onClick={() => onSelect?.(day.date)} aria-pressed={day.date === selectedDate} aria-label={`${formatDate(day.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, cycle day ${day.cycleDay ?? "not known"}${day.cycleStart ? ", recorded period start" : ""}`}>
          <small>{formatDate(day.date, { month: "short" })}</small><span>{formatDate(day.date, { day: "numeric" })}</span><b>{day.cycleDay ?? "—"}</b>
        </button>)}</div>
        <div className="cycle-axis-heading cycle-sticky-right"><span>BBT</span><b>°{fahrenheit ? "F" : "C"}</b></div>

        <div className="cycle-mucus-axis cycle-sticky-left" aria-label="Cervical mucus and menses scale">{mucusLevels.map((level, index) => <div key={level} className={`mucus-level mucus-${index}`}><i aria-hidden="true" /><span>{level === "None / dry" ? "Dry / none" : level}</span></div>)}<div className="menses-level"><i aria-hidden="true" /><span>Menses</span></div></div>
        <div className="cycle-daily-plot">
          <div className="cycle-observation-columns">{days.map(day => {
            const mucus = recordedCycleValue(day.record, "cervicalMucus");
            const flow = recordedCycleValue(day.record, "flow");
            const level = mucus === undefined ? -1 : mucusLevels.indexOf(mucus);
            const intensity = flow === "Heavy" ? 24 : flow === "Medium" ? 18 : flow === "Light" ? 11 : flow === "Spotting" ? 5 : 0;
            return <div key={day.date} className={`${day.date === selectedDate ? "is-selected" : ""} ${day.cycleStart ? "is-start" : ""}`}>
              {level >= 0 && <i className={`cycle-mucus-bar mucus-${level}`} style={{ top: `${level * 14 + 1}%` }} title={`${day.date}: ${mucus}`} />}
              {flow !== undefined && flow !== "None" && <i className={`cycle-menses-bar ${flow === "Spotting" ? "is-spotting" : ""}`} style={{ height: `${intensity}%` }} title={`${day.date}: ${flow} flow`} />}
              <button type="button" className="cycle-day-hit" onClick={() => onSelect?.(day.date)} aria-label={`View ${formatDate(day.date)} observations`} title={`${formatDate(day.date)} · ${typeof recordedCycleValue(day.record, "temperature") === "number" ? temperatureText(day.record!.temperature!, fahrenheit) : "Temperature not recorded"} · mucus: ${cycleObservationText(day.record, "cervicalMucus")} · flow: ${cycleObservationText(day.record, "flow")}`} />
            </div>;
          })}</div>
          <div className="cycle-temperature-grid" aria-hidden="true">{scale.ticks.map(tick => <i key={tick} style={{ top: `${scale.position(tick)}%` }} />)}</div>
          <svg className="cycle-temperature-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{segments.map((segment, index) => <line key={index} x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} className={segment.questionable ? "is-questionable" : ""} />)}</svg>
          <div className="cycle-temperature-points" aria-hidden="true">{days.map((day, index) => {
            const temperature = recordedCycleValue(day.record, "temperature");
            return typeof temperature === "number" ? <i key={day.date} className={`cycle-temperature-point ${day.record?.questionableTemperature ? "is-questionable" : ""} ${day.date === selectedDate ? "is-selected" : ""}`} style={{ left: `${(index + .5) / days.length * 100}%`, top: `${scale.position(temperature)}%` }} /> : null;
          })}</div>
        </div>
        <div className="cycle-temperature-axis cycle-sticky-right" aria-label="Temperature scale">{scale.ticks.map(tick => <span key={tick} style={{ top: `${scale.position(tick)}%` }}>{(fahrenheit ? tick * 9 / 5 + 32 : tick).toFixed(1)}</span>)}</div>

        <FertilityChartRow estimates={fertility} selectedDate={selectedDate} onSelect={onSelect} />
        {rows.map(({ field, label, group }) => <Fragment key={field}>
          <div className="cycle-row-label cycle-sticky-left" title={label}>{label}</div>
          <div className={`cycle-observation-row group-${group.toLowerCase()}`}>{days.map(day => <button type="button" key={day.date} className={`${day.date === selectedDate ? "is-selected" : ""} ${recordedCycleValue(day.record, field) !== undefined ? "has-observation" : ""}`} onClick={() => onSelect?.(day.date)} aria-label={`${formatDate(day.date)}, ${label}: ${cycleObservationText(day.record, field)}`} title={`${label}: ${cycleObservationText(day.record, field)}`}><span>{shortObservation(day.record, field)}</span></button>)}</div>
          <div className="cycle-row-end cycle-sticky-right" />
        </Fragment>)}
      </div>
    </div>
    <div className="body-cycle-legend"><span><i className="legend-temperature" />Temperature</span><span><i className="legend-mucus" />Mucus</span><span><i className="legend-menses" />Menses</span>{!compact && <span><i className="legend-questionable" />Questionable</span>}</div>
    {!compact && <FertilityLegend />}
    {!compact && <p className="cycle-chart-hint">Swipe for earlier dates · tap a day for every observation. Gaps mean no measurement. Fertility labels are app estimates, not contraception guarantees.</p>}
  </div>;
}

export function BodyCycleCard({ cycleLog, now, onLog, onExpand }: { cycleLog: CycleLog; now: number; onLog?: () => void; onExpand?: () => void }) {
  const history = cycleLog.history.filter(day => day.recordOrigin !== "sample").sort((a, b) => a.date.localeCompare(b.date));
  const latestTemperature = [...history].reverse().find(day => recordedCycleValue(day, "temperature") !== undefined);
  const lastDay = history.at(-1)?.date;
  const recent = history.filter(day => !lastDay || dateOnlyDay(day.date)! >= dateOnlyDay(lastDay)! - 13);
  const estimate = deriveFertilityDay(cycleLog, localCalendarDate(now));
  return <article className="body-cycle-card card">
    <div className="body-cycle-card-heading"><div><p className="eyebrow">Your daily observations</p><h2>Body & cycle</h2></div><div className="card-actions">{onLog && <button type="button" className="log-cycle-button" onClick={onLog}>＋ Log</button>}{onExpand && <button type="button" className="expand-button" onClick={onExpand} aria-label="Expand Body & cycle">Expand ↗</button>}</div></div>
    <div className="body-cycle-card-summary"><span>{estimate.cycleDay ? <><b>Day {estimate.cycleDay}</b> · {estimate.label}</> : "Record a period start for cycle days"}<small>App estimate · not contraception</small></span><strong>{latestTemperature?.temperature !== undefined ? `${latestTemperature.temperature.toFixed(2)}°C` : "—"}<small>{latestTemperature?.temperatureSource ?? "Temperature"}</small></strong></div>
    <CycleTrackingChart cycleLog={cycleLog} history={recent} compact onSelect={onExpand ? () => onExpand() : undefined} />
    <div className="body-cycle-card-footer"><span>{history.length} recorded {history.length === 1 ? "day" : "days"}</span><span>{lastDay ? `Latest ${formatDate(lastDay)}` : "Waiting for observations"}</span></div>
  </article>;
}

function CycleDayDetail({ cycleLog, history, date, fahrenheit, onSelect }: { cycleLog: CycleLog; history: CycleDayLog[]; date: string; fahrenheit: boolean; onSelect: (date: string) => void }) {
  const record = history.find(day => day.date === date);
  const previous = [...history].reverse().find(day => day.date < date);
  const next = history.find(day => day.date > date);
  const start = cycleStartDates(cycleLog).filter(startDate => startDate <= date).at(-1);
  const cycleDay = start ? dateOnlyDay(date)! - dateOnlyDay(start)! + 1 : null;
  const temperature = recordedCycleValue(record, "temperature");
  const groups = ["Cycle", "Body", "Sleep", "Notes"] as const;
  return <section className="cycle-day-detail" aria-label="Selected day observations" aria-live="polite">
    <header><div><p className="eyebrow">{cycleDay ? `Cycle day ${cycleDay}${start === date ? " · period start" : ""}` : "Daily record"}</p><h3>{formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3></div><div className="cycle-day-navigation"><button type="button" aria-label="Previous recorded day" disabled={!previous} onClick={() => previous && onSelect(previous.date)}>←</button><button type="button" aria-label="Next recorded day" disabled={!next} onClick={() => next && onSelect(next.date)}>→</button></div></header>
    {typeof temperature === "number" && record && <div className="cycle-detail-temperature"><strong>{temperatureText(temperature, fahrenheit)}</strong><span>Basal temperature<small>{observationSource(record, "temperature")}{record.questionableTemperature ? " · questionable" : ""}{record.temperatureDisplayOverride ? " · manual display override" : ""}</small></span></div>}
    {record ? <div className="cycle-detail-groups">{groups.map(group => {
      const fields = cycleObservationFields.filter(item => item.group === group && recordedCycleValue(record, item.field) !== undefined);
      return fields.length ? <section key={group}><h4>{group === "Cycle" ? "Cycle observations" : group === "Body" ? "Body signals" : group}</h4><dl>{fields.map(({ field, label }) => <div key={field}><dt>{label}</dt><dd>{cycleObservationText(record, field)}{record.healthSourceRecordIds?.[field]?.some(id => id.startsWith("healthkit:")) && <small>Tempdrop · Apple Health</small>}</dd></div>)}</dl></section> : null;
    })}</div> : <p className="cycle-detail-missing">No observations recorded on this date.</p>}
    {record && <p className="cycle-detail-source">{record.recordOrigin === "health-summary" ? "Imported observations and any manual check-in saved for this day." : record.recordOrigin === "legacy-unverified" ? "Saved record · original source unverified." : "Saved body & cycle check-in."}</p>}
  </section>;
}

export function BodyCycleAnalytics({ cycleLog, now, onClose }: { cycleLog: CycleLog; now: number; onClose: () => void }) {
  const [range, setRange] = useState<CycleRange>("90d");
  const [selected, setSelected] = useState<string | null>(null);
  const [fahrenheit, setFahrenheit] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [dayWidth, setDayWidth] = useState(32);
  const detail = useRef<HTMLDivElement>(null);
  const daysInRange = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : range === "1yr" ? 365 : null;
  const today = displayDay(now);
  const history = cycleLog.history.filter(day => day.recordOrigin !== "sample" && (daysInRange === null || dateOnlyDay(day.date)! >= today - daysInRange + 1)).sort((a, b) => a.date.localeCompare(b.date));
  const selectedDate = selected && history.length && selected >= history[0].date && selected <= history.at(-1)!.date ? selected : history.at(-1)?.date;
  const temperatures = history.filter(day => recordedCycleValue(day, "temperature") !== undefined);
  const mucus = history.filter(day => recordedCycleValue(day, "cervicalMucus") !== undefined);
  const flow = history.filter(day => recordedCycleValue(day, "flow") !== undefined);
  const lastTemperature = temperatures.at(-1);
  const lastMucus = mucus.at(-1);
  const lastFlow = flow.at(-1);
  const currentEstimate = deriveFertilityDay(cycleLog, localCalendarDate(now));
  const selectedEstimate = deriveFertilityDay(cycleLog, selectedDate ?? localCalendarDate(now));
  const selectedRecord = history.find(day => day.date === selectedDate);
  const selectedTemperature = recordedCycleValue(selectedRecord, "temperature");
  const latestStart = cycleStartDates(cycleLog).filter(date => !history.length || date <= history.at(-1)!.date).at(-1);
  const insights = deriveCycleInsights(history.filter(day => !latestStart || day.date >= latestStart));
  const temperatureValues = temperatures.map(day => day.temperature!);
  return <section className="analytics-modal body-cycle-analytics" role="dialog" aria-modal="true" aria-labelledby="body-cycle-title">
    <header className="modal-header"><div><p className="eyebrow">Your body, over time</p><h2 id="body-cycle-title">Body & cycle</h2></div><button type="button" className="close-button" aria-label="Close Body & cycle" onClick={onClose}>×</button></header>
    <div className="range-tabs" style={{ "--range-offset": `${ranges.indexOf(range) * 100}%` } as CSSProperties}>{ranges.map(item => <button type="button" key={item} className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => { setRange(item); setSelected(null); }}>{item}</button>)}</div>
    <div className="cycle-history-heading"><span>{history.length ? `${formatDate(history[0].date)} – ${formatDate(history.at(-1)!.date, { month: "short", day: "numeric", year: "numeric" })}` : "No observations in this range"}<small>{history.length} recorded days · {temperatures.length} temperatures</small></span><span className="cycle-phase-tag">{currentEstimate.cycleDay ? `Day ${currentEstimate.cycleDay} · App-derived estimates` : "Period start not recorded"}</span></div>
    <div className="cycle-chart-card">
      <div className="cycle-chart-tools"><span>Daily chart</span><div><button type="button" onClick={() => setDayWidth(dayWidth === 32 ? 48 : 32)} aria-label={dayWidth === 32 ? "Enlarge day columns" : "Compact day columns"}>{dayWidth === 32 ? "Zoom +" : "Zoom −"}</button><button type="button" onClick={() => setFahrenheit(!fahrenheit)} aria-label={`Temperature unit: ${fahrenheit ? "Fahrenheit" : "Celsius"}; switch units`}>°{fahrenheit ? "F" : "C"}</button></div></div>
      {selectedDate && <div className="cycle-selected-summary"><span><b>{formatDate(selectedDate)}</b> · {typeof selectedTemperature === "number" ? temperatureText(selectedTemperature, fahrenheit) : "BBT not recorded"}<small>{cycleObservationText(selectedRecord, "cervicalMucus")} mucus · {cycleObservationText(selectedRecord, "flow")} flow</small></span><button type="button" onClick={() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Day details ↓</button></div>}
      <CycleTrackingChart cycleLog={cycleLog} history={history} selectedDate={selectedDate} onSelect={setSelected} fahrenheit={fahrenheit} showAllRows={showAllRows} dayWidth={dayWidth} />
      {history.length > 0 && <label className="cycle-show-rows"><input type="checkbox" checked={showAllRows} onChange={event => setShowAllRows(event.target.checked)} />Show rows without observations</label>}
    </div>
    <CycleFertilityEstimate estimate={selectedEstimate} fahrenheit={fahrenheit} />
    <div className="cycle-latest-grid">{[{ label: "Latest BBT", value: lastTemperature?.temperature !== undefined ? temperatureText(lastTemperature.temperature, fahrenheit) : "—", day: lastTemperature }, { label: "Cervical mucus", value: lastMucus ? cycleObservationText(lastMucus, "cervicalMucus") : "—", day: lastMucus }, { label: "Menstrual flow", value: lastFlow ? cycleObservationText(lastFlow, "flow") : "—", day: lastFlow }].map(item => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.day ? formatDate(item.day.date) : "Not recorded"}</small></article>)}</div>
    {selectedDate && <div ref={detail}><CycleDayDetail cycleLog={cycleLog} history={history} date={selectedDate} fahrenheit={fahrenheit} onSelect={setSelected} /></div>}
    {history.length > 0 && <section className="cycle-pattern-summary"><h3>Recorded patterns</h3><dl>
      <div><dt>Temperature range</dt><dd>{temperatureValues.length ? `${temperatureText(Math.min(...temperatureValues), fahrenheit)} – ${temperatureText(Math.max(...temperatureValues), fahrenheit)}` : "Not recorded"}<small>{temperatures.length} measurements in this view</small></dd></div>
      <div><dt>Latest peak-type mucus</dt><dd>{insights.peakMucus ? `${insights.peakMucus.cervicalMucus} · ${formatDate(insights.peakMucus.date)}` : "Not recorded in the latest cycle"}<small>Observed mucus, not an ovulation confirmation</small></dd></div>
      <div><dt>Average sleep</dt><dd>{insights.averageSleep !== null ? `${Math.floor(insights.averageSleep / 60)}h ${insights.averageSleep % 60}m` : "Not recorded"}<small>From recorded sleep in the latest cycle</small></dd></div>
      <div><dt>Common symptoms</dt><dd>{insights.commonSymptoms.length ? insights.commonSymptoms.join(" · ") : "None recorded in the latest cycle"}</dd></div>
    </dl></section>}
    <p className="cycle-data-caption">Temperature, mucus and menstrual flow include saved Tempdrop imports. Additional rows show your recorded check-ins; missing observations stay blank.</p>
    <p className="cycle-safety">Fertility states are app-derived estimates from saved observations, not Tempdrop fertility results or contraception guarantees. No day is identified as pregnancy-risk-free.</p>
  </section>;
}
