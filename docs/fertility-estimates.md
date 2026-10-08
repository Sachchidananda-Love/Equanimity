# Body & cycle fertility estimates

Calculation version: `fertility-observations-v1`.

This is a transparent, deterministic awareness feature, **not a validated contraceptive device or a complete implementation of a named fertility-awareness method**. It does not establish an exact ovulation date, confirm infertility, or forecast pregnancy-risk-free days. No ML model or numeric pregnancy probability is used.

## Existing heuristics and routing

- `cycleSummary` contains an average-cycle-minus-14 calendar heuristic and phase names. It remains a compatibility summary for other app contexts, but Body & cycle no longer uses its phases or fertile-window claims.
- `deriveCycleInsights` previously allowed an incomplete temperature baseline, took the last three observations without checking calendar continuity, and used a 0.05°C coverline. Its temperature-shift calculation now uses the strict shared detector below. Its descriptive sleep, symptom and peak-type mucus summaries remain.
- Recorded-field checks, date-only calendar arithmetic, cycle start history and the existing `cycleDisplayLog` projection are reused. The fertility layer is isolated in `src/domain/cycle/fertility.ts`; it does not access HealthKit or Firestore.

## Input and provenance rules

The input is the already-selected daily display projection, not an additional import or a competing source selector. The existing selection prefers verified imported Tempdrop temperature unless an explicit manual temperature display override is present. Manual overrides for other fields follow existing service rules.

Only explicitly recorded fields are evidence. Samples, unverified legacy observations, untouched defaults and invalid dates are excluded. A new cycle requires an explicit recorded start (`cycleDayOne` / saved `lastPeriod`); bleeding alone cannot invent one. An explicitly recorded false `cycleDayOne` supersedes a conflicting saved `lastPeriod` date. Retained source IDs and explicit temperature override flags are copied into the result's evidence trail, including post-peak mucus and continued elevated readings. Calculations never mutate or persist the projection or underlying source records.

Every day's estimate uses only observations and starts dated on or before that day. The entire saved history is considered independently of the chart's visible range. Future observations cannot retroactively confirm an earlier day's state. Future dates without observations cannot acquire lower likelihood.

## State precedence

| State | Rules |
| --- | --- |
| Likely fertile | Watery/egg-white mucus, wet/slippery sensation, or a positive/peak ovulation test. A positive/peak test also influences the following two calendar days. |
| Post-ovulation / lower fertility likelihood | A completed supported temperature rise, more than three days since the latest fertile-type mucus, and explicit lower-type mucus on every subsequent day through this date. Temperatures must continue at/above the threshold with the same source. No current conflicting signs or bleeding. |
| Possible fertile | Other mucus, damp sensation, a high ovulation test, the broad preliminary calendar window, or an unresolved prior fertility signal. |
| Uncertain / insufficient data | No adequate supporting evidence, including early-cycle dry days and days outside a calendar projection. A positive pregnancy test suspends the cycle estimate until a newly recorded cycle start. |

Strong mucus/test signs take priority over the calendar and temperature pattern. Negative tests or dry mucus alone never establish lower likelihood. Missing or conflicting evidence cannot close an unresolved possible-fertility interval.

## Preliminary calendar window

Require six completed recorded cycles, each 15–60 days long, with all seven delimiting starts in the preceding 366 days. Subtract 18 from the shortest cycle to obtain the first cycle day (clamped to day 1), and 11 from the longest to obtain the last. Convert those cycle days to dates from the recorded current start.

Flag variable/irregular history when lengths span more than seven days or any fall outside 26–32 days. These bounds and flags are **app caution choices**, not a diagnosis. Wider lengths widen the preliminary window; dates outside it remain uncertain. Fewer starts, implausible gaps or stale history yield no calendar forecast. `averageCycle` defaults are never inputs.

## Strict temperature signal detector

Require nine consecutive calendar days within the recorded cycle:

1. Six explicit usable baseline temperatures.
2. Three usable temperatures each at least 0.2°C above the maximum baseline, with the same recorded temperature-source label across all nine days. The display projection does not establish physical device identity or measurement-site consistency within a generic `Manual` source label; this is another limit on interpretation.

A usable temperature is finite, at least 34°C but below 38°C, not questionable, and has no recorded disturbances or medication note. Readings at or above 38°C are excluded as a fever-range caution. This is **not an illness diagnostic**; unrecorded illness and medication effects below that threshold cannot be excluded. The third high day is a date when a rise is *supported*, not a confirmed ovulation date. The next day is the earliest that could acquire lower likelihood.

This intentionally stricter signal detector is an **app-specific operational rule**, not a claim that the linked guidance validates these precise thresholds or the software.

## Post-peak mucus and suspension

The latest watery/egg-white or wet/slippery day is the observed fertile-type mucus day; it is not necessarily a clinically identified peak. At least three complete subsequent days must pass. On the fourth day and onward, every subsequent day must have explicit dry/sticky mucus without recorded damp/wet/slippery sensation. Missing mucus is not dry mucus.

A new fertile-type mucus signal, high/positive/peak test, bleeding, absent/unusable temperature, source change or temperature below the threshold invalidates the active shift. A new candidate must have its first high day after that invalidating date. The estimate does not silently resume from the old rise. A recorded new cycle start resets the physiologic sequence.

## Sources and limits

- [WHO/JHU: symptoms-based methods](https://fphandbook.org/explaining-how-use-symptoms-based-methods) describes temperature rises after ovulation, three full elevated-temperature days, post-peak mucus observation and the importance of combining signs. It cautions that illness/temperature changes and conditions affecting mucus complicate interpretation.
- [WHO/JHU: calendar-based methods](https://fphandbook.org/explaining-how-use-calendar-based-methods) describes tracking cycle history and the shortest-minus-18 / longest-minus-11 preliminary range. This software does not claim calendar-rhythm contraceptive effectiveness.
- [ACOG: evaluating infertility](https://www.acog.org/womens-health/faqs/evaluating-infertility) explains that a positive ovulation test suggests ovulation in the next 24–48 hours. A positive test is not proof that ovulation occurred.
- [CDC: Standard Days Method](https://www.cdc.gov/contraception/hcp/usspr/standard-days-method.html) notes substantial variation in the timing of the fertile window even in regular cycles.
- [NHS: fever in adults](https://www.nhs.uk/symptoms/fever-in-adults/) describes 38°C or above as the usual high-temperature threshold, while noting that illness can occur below it. The app uses this solely to exclude a reading from fertility support.

Postpartum/breastfeeding changes, hormonal medications, illness, irregular bleeding and unrecorded disturbances can make the estimate unreliable. These contexts are not sufficiently represented in the current data model for the app to rule them out. Users avoiding pregnancy should use contraception and should not rely on these labels.

Tests cover early uncertainty, pre-shift fertile mucus, a sustained rise, missing temperatures/mucus, conflicting signals, irregular cycles, manual overrides, provenance preservation, no-data states, source changes, questionable/disturbed readings, no future leakage, cycle resets and date-aligned rendering.
