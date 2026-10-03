# Local data architecture: Phase 0 and Phase 1

No Firebase, Capacitor, native iOS project, HealthKit access, Tempdrop import, authentication change, or deployment was added. Existing staged/unstaged UI, quotes, and photo work was preserved. This is a local-only data boundary, not a native-ready build or a cloud migration.

## Storage inventory

The legacy keys remain untouched. JSON records previously had no explicit schema version. Record IDs were numeric (often epoch milliseconds). Optional fields may be absent.

| Legacy key | Saved schema |
| --- | --- |
| `yi-journal` | Array of `JournalEntry`: id, type, title, display date; optional duration, note, mood, tags, assessments keyed by name (`{value, note?}`), loggedAt, lunarContext, cycleContext. |
| `yi-timers` | Array of `TimerPreset`: id, name, seconds, color; optional interval, gongs (seconds), gongSounds, startGong, endGong, intervalGong. |
| `yi-activities` | Array of `ActivityPreset`: id, name, icon, color. |
| `yi-cycle` | `CycleLog`: lastPeriod calendar date, averageCycle, averagePeriod, flow, symptoms, optional temperature, history. Older partial settings objects are supported by merging configuration defaults only. |
| `yi-books` | Array of `BookRecord`: id, title; optional author, startedOn, finishedOn, yearRead, finished, assessments. |
| `yi-dashboard-widgets` | Array of dashboard widget identifier strings. Unknown/retired identifiers are retained in storage but not rendered. |
| `yi-insights-workspace-v2` | Plain text layout marker, normally `1`; now retained for historical reference, not used to reset a saved layout. |
| `yi-active-practice` | `StoredPractice`: Timer/Stopwatch mode, duration, optional deadline/start timestamp, opening/closing/interval gongs, intervalEnabled, intervalMinutes, customGongs, customGongSounds. Some old gong fields are optional at the reader boundary. |
| `yi-daily-quote-rotation` | `StoredQuoteRotation`: quote signature, integer order array, day number, position. |

`CycleDayLog` contains id, calendar date, flow, cycleDayOne, optional temperature, temperatureSource, questionableTemperature, cervicalMucus, mucusSensation, cervixPosition/Firmness/Opening, ovulationTest, pregnancyTest, intercourse, symptoms, energy, sexDrive, pms, disturbances, optional medicationNote/notes, and optional sleepScore/sleepMinutes/deepSleepMinutes/sleepLatencyMinutes/sleepInterruptions. The compatibility model now also has `recordOrigin` and `recordedFields`. These distinguish untouched form defaults from explicit observations without destructively rewriting legacy values.

New keys:

- `yi-original-backup-v1`: first-write snapshot `{format, schemaVersion:1, exportedAt, records}`. `records` maps original keys to their exact strings (or null). Includes all existing `yi-*` keys, not unrelated apps' storage. The snapshot is verified and never replaced. An invalid existing backup stops migration.
- `yi-local-data-v1`: `{schemaVersion:1, migrationVersion:1, updatedAt, data, review, protectedDatasets}`. `data` holds journal, timers, activities, cycle, books, widgets, health. A single write saves changes across collections atomically.
- `yi-active-practice-v1`, `yi-daily-quote-rotation-v1`: `{schemaVersion:1, value}`. A null practice value is an explicit stop marker; it prevents an old legacy timer from reappearing.

Export includes all current `yi-*` values and the original backup string, nested without modifying the originals. The downloaded file contains private health/journal information: store it securely. Export is a backup mechanism; automatic restore/import is deliberately not implemented.

## Safety and migration rules

1. Backup must succeed before the first migration write. No legacy keys are removed or overwritten.
2. Missing/empty journal and cycle history remain empty. Default configuration is separate from sample health/journal fixtures.
3. Exact known fixture matches go into a preserved review area, not real history or normalized source measurements. The user may explicitly choose **Keep as my data**. Genuine records identical to fixtures can therefore be temporarily hidden pending review, never deleted.
4. Other legacy cycle history is marked `legacy-unverified`. It stays visible for compatibility, but is not automatically converted into authoritative health measurements or given invented ingestion timestamps/provenance. Explicitly editing a field creates its normalized manual source record; untouched legacy defaults do not become newly recorded measurements.
5. Numeric legacy IDs stay numeric. User-created records use UUID strings; normalized manual source IDs are stable strings referring back to the daily record and field.
6. Invalid legacy collections stay backed up and write-protected. Their active view falls back to empty/configuration defaults, with a notice. No rows are silently dropped from a partially malformed collection.
7. Malformed/future versioned envelopes become read-only. Another collection cannot overwrite malformed versioned data. Writes detect a stale tab; reload rather than allowing it to overwrite another tab's changes. This guard is not a cloud synchronization protocol.
8. Quota/permission failures retain the last saved state and original data. App state can still change in memory; the data-safety notice reports when it was not saved. Do not close the page until resolving that notice/exporting the saved values.
9. Legacy Yoga naming is adapted to Maintenance Yoga in the new working copy, retaining original bytes. Saved widget layouts are no longer automatically reset based on the legacy layout marker.

## Domain boundaries and future integration

`ApplicationRepository` defines persistence contracts; `createLocalRepository` implements browser storage. UI state coordinates repositories in `useAppData`; screens do not use localStorage or mock connectors. Fixtures, default practice configuration, and bundled assets are distinct modules. No runtime dependency was added.

`HealthRecord` is a versioned source observation with a stable ID, typed metric/value/unit, optional observed/start/end timestamps, local calendar date/timezone, provider separate from ingestion, original source ID, source app/device IDs, import batch, method, status, optional confidence, and created/updated timestamps. Provider selection does not dictate storage or ingestion. A manually transcribed Tempdrop value has provider `tempdrop` and ingestion `manual`, not `healthkit`. Newly entered temperature defaults to Manual; editing a legacy Tempdrop-default temperature without explicitly choosing that source also uses Manual.

`HealthService.dailySummary` is a separate calculation boundary returning values with source-record references and a calculation version. Phase 1 selects explicit manual values only; external provider precedence, overlapping sleep, import deduplication, and timezone travel policies must be designed before integration. Tombstoned, superseded, and unverified source records are excluded. Clearing a recorded value retains its old source value as a tombstone. Editing a value retains its ID and createdAt; this is not a full event-sourced revision history.

Cycle calculations live in the cycle domain and are labelled app-derived estimates, not imported measurements. Existing heuristics are retained; no medical validity claim or new fertility algorithm is introduced. Unknown fields do not count as dry mucus, no symptoms, or zero. Toronto remains the display/calendar timezone for compatibility; records support other timezones for future providers. Manual calendar-only observations do not receive fabricated observation times.

## Behavior changes (intentional)

- Fresh/empty history no longer shows fabricated sample sessions or cycle history.
- Known samples are preserved in **Data backup & review**, excluded from real totals until explicitly confirmed.
- A small backup/review disclosure and data-safety notices were added; dashboard styling and card/media work remain unchanged.
- Untouched daily-form observations display **Not recorded**; symptoms/disturbances have explicit **None** choices. Zero/false/empty lists remain meaningful when explicitly entered.
- Unknown period start shows **Cycle not recorded**, not an invented cycle prediction.
- Manual temperature no longer defaults to Tempdrop. Source and ingestion are stored independently.
- New IDs are strings, legacy numeric IDs and original storage survive unchanged.
- Daily dates use the existing Toronto calendar rather than UTC, correcting late-evening date boundaries.
- Malformed data is protected instead of silently replaced by defaults; simultaneous tabs require a reload when stale.
- Saved layouts and intentionally empty preset collections are respected, rather than automatically repopulated.

## Verification results and limitations

Commands: `npm test` (production build + data and server-render tests), `npm run lint`, `npx tsc --noEmit --incremental false`.

Final production build and all 21 tests passed. ESLint passed. TypeScript limitations are listed below.

Data tests cover legacy loading/raw export, empty history, partial cycle settings, malformed/duplicate records, schema versions, idempotency, numeric/string ID round trips, sample review, explicit none/zero/false, provenance, timezone/DST dates, auxiliary state, atomic writes, quota failures, stale tabs, source tombstones, and changing dates without destroying untouched observations.

The existing local dev server at `http://localhost:3000` returned HTTP 200 with Insights/wellbeing, Practice/timer, Journal, empty cycle state, and backup controls in rendered HTML. Browser discovery returned no connected browsers; interactive visual verification could not be performed. No personal browser storage was inspected or modified during testing; repository tests use in-memory storage.

Whole-project TypeScript checking still reports existing missing Cloudflare backend types: `cloudflare:workers` in `db/index.ts`, `Fetcher` and `D1Database` in `worker/index.ts`. The changed app/domain modules have no reported errors. Fixing the backend configuration is outside this refactor.

Deferred safely: bulk normalization/verification of legacy health provenance, repairing malformed saved collections, backup restore/import, physical splitting of the remaining UI component monolith, full journal date normalization (old entries use human-readable dates), broader date/timezone UX, full revision history, external-source deduplication/conflict policies, cloud/native build work. Existing charts may continue to display legacy-unverified observations; these are not promoted to normalized imported measurements.

## Exact manual check with your existing browser data

1. Use the same browser profile and exact origin where your data already exists (scheme, host and port all matter). Do not use incognito, clear site data, delete storage keys, or assume production data lives at localhost.
2. Before opening the updated app, if possible export site storage from browser developer tools or take a profile backup. Do not paste private data into a chat. This implementation also creates its raw snapshot before its first migration write.
3. Open the updated app at that same origin. Scroll to **Data backup & review**, expand it and click **Export browser data**. Save the JSON privately.
4. In the downloaded file, confirm `records["yi-journal"]`, `records["yi-cycle"]`, etc. are raw JSON strings, not rewritten record arrays. `records["yi-original-backup-v1"]` contains the original snapshot as a string. Versioned current data is in `records["yi-local-data-v1"]`.
5. Optional exact, read-only check in the browser console (prints only key names and match booleans, not your records):

   ```js
   const original = JSON.parse(localStorage.getItem("yi-original-backup-v1"));
   console.table(Object.entries(original.records).map(([key, value]) => ({
     key,
     originalUnchanged: localStorage.getItem(key) === value
   })));
   ```

   All legacy keys should match. Keys captured from an earlier versioned snapshot can legitimately change after subsequent edits; inspect the snapshot context before interpreting that result.
6. On **Insights**, check your saved widget order, reading entries, practice totals, quote card height/width, cube photos, and cycle observations. Open cycle analytics: the captions must say app-derived estimates.
7. On **Journal**, locate an existing personal entry, verify its note and assessments, open its detail, and switch List/Month/Year. If expected items are missing, check the sample review area and notices before editing or deleting anything. Confirm samples only if they truly belong to you.
8. On **Practice**, check saved timers and the Gong 1/Gong 2/Gong 3/Tripple Gong choices. Start a short timer, reload, and confirm its deadline resumes. Stop it, reload, and confirm the legacy timer does not resurrect. This modifies current timer state, not the retained original key.
9. If comfortable adding a test record, save a uniquely labelled journal entry; reload and confirm it survives with a string ID in the versioned data. Save a cycle check-in with only one explicit field. Untouched controls must remain unrecorded; choosing flow **None**, symptoms **None**, or a sleep count of `0` must be retained distinctly.
10. Export again after these checks. Verify the original backup string and legacy keys are unchanged while the versioned data contains the intentional edits. Do not remove the old keys or original backup.
11. If a data notice says invalid/protected/not saved, stop making edits. Export the raw values, keep the page open if it has unsaved state, and request a targeted repair. There is no automatic repair or destructive reset.

## Every file changed for this refactor

Modified:

- `app/YiApp.tsx`
- `app/data.ts`
- `package.json`
- `tests/rendered-html.test.mjs`

Added:

- `src/domain/ids.ts`
- `src/domain/health/types.ts`
- `src/domain/cycle/types.ts`
- `src/domain/cycle/calculations.ts`
- `src/domain/cycle/records.ts`
- `src/domain/journal/types.ts`
- `src/domain/practice/types.ts`
- `src/domain/practice/defaults.ts`
- `src/domain/dates/calendar.ts`
- `src/services/repository-contracts.ts`
- `src/services/health-service.ts`
- `src/services/backup-service.ts`
- `src/adapters/local/repository.ts`
- `src/adapters/local/validation.ts`
- `src/migrations/legacy.ts`
- `src/fixtures/demo-data.ts`
- `src/application/use-app-data.ts`
- `src/application/DataTools.tsx`
- `tests/local-data.test.mjs`
- `tests/register-typescript.mjs`
- `tests/typescript-loader.mjs`
- `docs/local-data-phase-0-1.md`

Pre-existing changes, not edited by this refactor: `app/globals.css`, `app/quotes.ts`, and `public/cube-media/picture-01.jpg` through `picture-43.jpg`. Existing edits in `app/YiApp.tsx` and `tests/rendered-html.test.mjs` were kept and adapted around the extracted architecture.
