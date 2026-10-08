import { Fragment } from "react";
import { fertilityStateLabels, type FertilityDayEstimate } from "../domain/cycle/fertility";
import { dateOnlyTimestamp } from "../domain/dates/calendar";

const formatDate = (date: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(dateOnlyTimestamp(date));
const symbols = { likely: "L", possible: "P", lower: "↓", uncertain: "?" } as const;

export function FertilityChartRow({ estimates, selectedDate, onSelect }: { estimates: FertilityDayEstimate[]; selectedDate?: string; onSelect?: (date: string) => void }) {
  return <Fragment>
    <div className="cycle-row-label cycle-sticky-left cycle-fertility-label" title="App-derived fertility estimate, not a contraception guarantee">Estimate</div>
    <div className="cycle-fertility-row">{estimates.map(estimate => <button type="button" key={estimate.date} className={`fertility-${estimate.state} ${estimate.date === selectedDate ? "is-selected" : ""}`} onClick={() => onSelect?.(estimate.date)} aria-pressed={estimate.date === selectedDate} aria-label={`${formatDate(estimate.date)}: ${estimate.label}. ${estimate.reasons[0]} App-derived, not contraception.`} title={`${estimate.label}\n${estimate.reasons.join("\n")}`}><span aria-hidden="true">{symbols[estimate.state]}</span></button>)}</div>
    <div className="cycle-row-end cycle-sticky-right cycle-fertility-label">App</div>
  </Fragment>;
}

export function FertilityLegend() {
  return <div className="cycle-fertility-legend" aria-label="Fertility estimate legend">{Object.entries(fertilityStateLabels).map(([state, label]) => <span key={state} title={label}><i className={`fertility-${state}`} aria-hidden="true" />{state === "lower" ? "Lower likelihood" : state === "uncertain" ? "Uncertain" : label}</span>)}</div>;
}

export function CycleFertilityEstimate({ estimate, fahrenheit = false }: { estimate: FertilityDayEstimate; fahrenheit?: boolean }) {
  const threshold = estimate.temperatureShift?.threshold;
  const thresholdText = threshold === undefined ? null : `${(fahrenheit ? threshold * 9 / 5 + 32 : threshold).toFixed(2)}°${fahrenheit ? "F" : "C"}`;
  return <section className="cycle-fertility-panel" aria-label="App-derived fertility estimate">
    <header><div><p className="eyebrow">App-derived · rule-based</p><h3>Fertility estimate</h3></div><span>{formatDate(estimate.date)}{estimate.cycleDay ? <small>Cycle day {estimate.cycleDay}</small> : <small>Cycle start not known</small>}</span></header>
    <div className={`cycle-fertility-state fertility-${estimate.state}`}><i aria-hidden="true">{symbols[estimate.state]}</i><div><strong>{estimate.label}</strong><p>{estimate.reasons[0]}</p></div></div>
    <p className="cycle-fertility-safety">Awareness only—not a validated contraceptive method or a pregnancy-risk-free window. A temperature rise supports a retrospective pattern; it does not prove ovulation.</p>
    <div className="cycle-fertility-basis"><article><span>Preliminary calendar window</span><strong>{estimate.calendarWindow ? `${formatDate(estimate.calendarWindow.start)} – ${formatDate(estimate.calendarWindow.end)}` : "Not enough recorded cycle history"}</strong><small>{estimate.calendarWindow ? `${estimate.calendarWindow.irregular ? "Irregular / variable history · " : ""}Based on six completed cycles; observations take priority.` : "Six recent completed cycles are needed. Default cycle averages are not evidence."}</small></article><article><span>Temperature pattern</span><strong>{estimate.temperatureShift ? `Rise supported ${formatDate(estimate.temperatureShift.supportedOn)}` : "Sustained rise not established"}</strong><small>{thresholdText ? `Three consecutive readings ≥ ${thresholdText}, following six baseline days.` : "Missing, questionable, disturbed or mixed-source readings cannot establish the rise."}</small></article></div>
    {estimate.reasons.length > 1 && <ul className="cycle-fertility-limitations">{estimate.reasons.slice(1).map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <details className="cycle-fertility-explanation"><summary>Evidence & calculation rules</summary>
      {estimate.evidence.length ? <ul>{estimate.evidence.map((item, index) => <li key={`${item.kind}:${index}`}><span>{item.description}</span><small>{item.manualOverride ? "Includes an explicit manual override · " : ""}{item.sourceRecordIds.length ? `${item.sourceRecordIds.length} retained source ${item.sourceRecordIds.length === 1 ? "record" : "records"}` : "Saved check-in / cycle history"}</small></li>)}</ul> : <p>No usable observations are available for this date. Unknown data is not treated as dry mucus, a negative test or a low temperature.</p>}
      <p>Each day uses only explicitly recorded observations available through that date, across the full saved history—not just the chart’s visible range. Samples and unverified legacy observations are excluded. Existing source selection and manual overrides are respected; imported records are never overwritten.</p>
      <ol>
        <li>Calendar: with six completed cycles of 15–60 days in the preceding year, estimate shortest cycle − 18 through longest cycle − 11. Variable lengths broaden this preliminary window; dates outside it remain uncertain.</li>
        <li>Likely fertile: watery/egg-white mucus, wet/slippery sensation, or a positive/peak test that day. Positive/peak tests also influence the next two days; they do not confirm ovulation.</li>
        <li>Possible fertile: other mucus, damp sensation, a high test, the calendar window, or an earlier unresolved fertility signal. Dry mucus and negative tests alone never establish lower likelihood.</li>
        <li>Temperature support: six consecutive usable baseline days followed by three consecutive readings at least 0.2°C above the highest baseline, all with the same recorded temperature-source label. Questionable readings, readings at or above 38°C, recorded disturbances or medication notes, gaps and cycle starts break the sequence.</li>
        <li>Lower likelihood: the rise must be complete before this date, with at least three complete days since fertile-type mucus and continued explicitly recorded dry/sticky mucus, no damp/wet/slippery sensation, and continued elevated temperature. New fertile signs, bleeding, gaps or conflicting temperatures suspend the estimate; no future lower-likelihood days are forecast.</li>
      </ol>
      <p>These conservative app thresholds are not a validated implementation of a named fertility-awareness method. Illness, hormonal medication, postpartum/breastfeeding changes and unrecorded disturbances can make signs unreliable. If avoiding pregnancy, use contraception rather than relying on these labels.</p>
      <div className="cycle-fertility-sources"><a href="https://fphandbook.org/explaining-how-use-symptoms-based-methods" target="_blank" rel="noreferrer">WHO/JHU · temperature & mucus</a><a href="https://fphandbook.org/explaining-how-use-calendar-based-methods" target="_blank" rel="noreferrer">WHO/JHU · calendar estimates</a><a href="https://www.acog.org/womens-health/faqs/evaluating-infertility" target="_blank" rel="noreferrer">ACOG · ovulation tests</a></div>
      <small className="cycle-fertility-version">{estimate.calculationVersion}</small>
    </details>
  </section>;
}
