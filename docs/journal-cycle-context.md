# Journal cycle context — 2026-10-09

## Inspection findings

- `YiExperience.addEntry` saved `cycleContext` as a display string. `saveCycle` also supplied one for check-ins. Journal preferred this permanent string, so entries created before sufficient cycle data remained stuck at “Cycle not recorded”.
- The fallback used `cycleSummary`, which subtracts only `log.lastPeriod` and clamps negative day counts to one. It did not select the appropriate start for a historical entry.
- Journal already receives `cycleDisplayLog(cycleLog, health)`. This read-only projection includes verified imported Tempdrop flow, period-start metadata, temperature and mucus, while retaining manual selections/overrides and source IDs. Import behavior does not need changing.
- Timestamped journal entries have `loggedAt` (or legacy timestamp IDs). The old parser did not recognize normalized ISO entry dates, so some historical dates could incorrectly fall back to today.

## New calculation and UI

Journal consumes the memoized, batched `deriveJournalCycleContexts` selector in the cycle domain. New entries no longer save a calculated cycle label. Existing strings remain untouched in storage but are not authoritative for display. Updating cycle history or imported health data recalculates visible historical context without rewriting journal entries or queuing cloud saves.

For each entry's own date:

1. Use normalized ISO date, otherwise its logged timestamp/legacy timestamp ID. Legacy month/day labels retain the existing display-year convention, with explicit years honored. Normalize through the existing Toronto date helpers, including daylight-saving boundaries. An unparseable date or a bare historical “Today” label with no durable timestamp cannot borrow today's cycle context.
2. Reuse the fertility domain's trusted period-start selection, including compatible `lastPeriod`, recorded starts and explicit false-start corrections. Choose the latest start on or before the entry date; never clamp entries before the first known start to day one.
3. Reuse the existing causal fertility timeline for mucus/LH likelihood and temperature-supported context. Later physiologic observations cannot retroactively confirm an earlier day's ovulation. Likelihood labels remain “likely” or “possible”, never “infertile” or “safe”.
4. Explicit flow/start observations refine the label: for example, “Cycle day 2 · menstrual flow observed”. Spotting does not establish a new cycle, and explicit “None” flow does not become an observed menstrual phase.
5. Without stronger physiology, use `cycleSummary` for an explicitly labeled calendar phase estimate. A later recorded start can refine a completed cycle's actual length; otherwise use the mean of the last six available completed cycles, falling back to the existing average-cycle setting. Use the existing average-period setting for a menstrual estimate, not an observation claim.
6. Reuse the fertility domain's irregular-length caution flag. With irregular/incomplete lengths or an overdue cycle, retain the known day but say “phase uncertain”. Do not invent a future period start by wrapping the day count.

Examples: “Cycle day 8 · follicular estimate”, “Cycle day 15 · likely fertile”, “Cycle day 23 · post-ovulation estimate”. A calendar post-ovulation estimate is not physiologic confirmation or a lower-fertility guarantee. The existing context line retains its design; its explanatory title states that estimates are not contraception guarantees and includes direct observation details.

Flow without a trusted cycle-start marker can supply an observed flow label on its own date, but cannot silently establish cycle day one. Dates before any known start remain uncertain unless direct observations supply useful context.

## Files

- `src/domain/cycle/journal-context.ts`: pure single-date/batch selectors.
- `src/domain/cycle/fertility.ts`: extract shared start selection and irregular-length flag, preserving existing fertility rules.
- `src/domain/journal/dates.ts`: shared historical date parsing using normalized calendar helpers.
- `src/domain/journal/types.ts`: document the legacy snapshot field.
- `app/YiApp.tsx`: consume the selector, stop writing new cycle snapshots, use shared date parsing.
- `tests/journal-cycle-context.test.mjs`: 11 focused domain/mounted regressions, including imported-history updates and new-entry persistence.
- `tests/rendered-html.test.mjs`: update the old UI-source assertions to require the domain selector.
- `package.json`: include the new tests in application/data suites.
- This report.

No migration, source-record mutation, new dependencies, HealthKit/Tempdrop import changes, Firebase/offline-cache changes, slider changes or timer behavior changes.

## Verification

Passed: hosted build and 145 application tests; standalone production build and 6 asset/serving tests; 5 iOS shell tests; lint; standalone TypeScript; `ios:prepare`; unsigned generic-iPhone Debug compile. Physical-device installation was not performed.

On the iPhone, open an older journal entry on a date with a known prior period start but no daily observation. Confirm its day/estimated phase. Add or import a genuine missing/backdated period start through the existing workflow, then return to that entry: its context should update while the journal text remains unchanged. Compare an entry before and after that start, and one in a prior cycle. For an account with no known start, verify “Cycle context uncertain”, not day zero or an invented day one. Use test/synthetic data when exercising corrections; do not alter real cycle history just to test the UI.
