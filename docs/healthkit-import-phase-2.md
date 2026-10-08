# HealthKit phase 2: reviewed manual import and private-cloud sync

## Outcome and scope

The existing HealthKit bridge now feeds the normalized `AppData.health` / `HealthRecord` repository and UID-owned Firestore `healthRecords`. Persisted records feed derived daily selection and the existing Body & cycle cards, charts and expanded 7d / 30d / 90d / 1yr / All views. No new health collection or persisted summary architecture was introduced.

Only source-proven Tempdrop **basal temperature, cervical mucus and menstrual flow** are eligible. Sleep, ovulation tests and sexual activity retain read/inspection support but are not imported or aggregated into the real dataset. No background delivery, direct Tempdrop API/CSV, HealthKit writes, notifications, Android, deployment or distribution was added.

Tatiana's reported 77 inspection records can now be safely *re-queried* and selectively imported after consent. The old inspector's session is not a durable import queue. The number actually saved depends on source identity, metric eligibility, existing UUIDs and current permissions; this is not authorization to upload all 77. No real-device health records were read or uploaded during development of this phase. This phase still requires the physical-phone acceptance test below.

## Every changed file

| File | Change |
| --- | --- |
| `app/YiApp.tsx` | Feed health-derived cycle projection into existing screens; remove chart's hidden 30-point truncation; replace Body card demo values; add explicit manual temperature override; coordinate import busy state. |
| `ios/App/App/EquanimityHealthKitPlugin.swift` | Preserve sample metadata timezone when available; compute local date in that zone; retain unknown menstrual-flow categories instead of guessing spotting. |
| `package.json` | Include HealthKit regression tests in application and data test commands. |
| `src/adapters/firebase/client.ts` | Supply device/account consent reader; reauthorize immediately before transaction writes, including transaction retries. |
| `src/adapters/firebase/repository.ts` | Guard changed HealthKit writes by consent, source/metric policy and metadata allowlist; retain imported UUID tombstones on load. |
| `src/adapters/healthkit.ts` | Validate native payloads; canonicalize UUIDs; derive provider from source identity; normalize category labels; keep inspection separate from persistence. |
| `src/adapters/local/healthkit-import-state.ts` (new) | UID-scoped device-local consent, minimized retry checkpoint and last successful import time. |
| `src/adapters/local/validation.ts` | Validate optional manual display overrides. |
| `src/application/HealthKitTools.tsx` | Consent, manual import/retry, reports, breakdowns, last-import/pending status and retained developer inspector. |
| `src/application/use-healthkit-import.ts` (new) | UI orchestration through the service boundary; current-account/repository guard. |
| `src/application/use-app-data.ts` | Adopt confirmed cloud imports without a duplicate autosave; preserve unsaved manual edits after failed saves. |
| `src/domain/cycle/records.ts` | Allow deterministic IDs for view-only projected days. |
| `src/domain/cycle/types.ts` | Manual temperature override and view-only source-reference fields/origin. |
| `src/domain/health/import-policy.ts` (new) | Reviewed metric/provider policy and explicit persisted-field projection. |
| `src/domain/health/types.ts` | Optional manual `displayOverride`. |
| `src/services/cloud-session.ts` | Safely recover the rejected write queue after explicit successful reload; prohibit reload during pending writes. |
| `src/services/health-service.ts` | Deterministic daily source selection, source-referencing summaries and view-only cycle projection. |
| `src/services/healthkit-import-service.ts` (new) | UUID reconciliation, corrections/supersession, consent checks, pending retention and explicit retry. |
| `tests/firestore-emulator.test.mjs` | Actual Firebase-port consent, selected import round-trip and private-UID rule coverage. |
| `tests/healthkit-import.test.mjs` (new) | Synthetic import/persistence/selection/failure/privacy regressions. |
| `tests/helpers/healthkit-fixtures.mjs` (new) | Synthetic HealthKit payloads only. |
| `docs/healthkit-phase-1.md` | Mark phase-1 report as historical and link current behavior. |
| `docs/healthkit-import-phase-2.md` (new) | This implementation, test and privacy report. |

`npm run ios:prepare` also regenerated ignored native web assets and verified their integrity. No `.env.local`, signing/team settings, entitlements, Firestore rules, dependency versions or lockfile were changed.

## Exact import and reconciliation algorithm

1. A user taps **Import recent Health data**. The service requires the signed-in UID's current cloud repository and explicit device/account consent. Signing in, opening the app or enabling consent alone does not import anything.
2. Query the native bridge for the last 90 days. All supported inspection types remain readable. If HealthKit is unavailable or a selected category query errors, abort and preserve existing records/checkpoints. An empty query is not proof of permission denial or deletion.
3. Validate the entire returned native batch: UUID structure, source identity, string metadata/device fields, values/units, dates, timezone and timestamp ordering. Invalid recognized samples abort the batch before any checkpoint/cloud write. Map native types into normalized metrics; quantity units are Celsius (`Cel`). Map dry mucus to `None / dry` and egg-white to `Egg white`; normalize flow labels. Unrecognized values are not invented as valid observations.
4. Canonicalize each UUID to uppercase. Set stable ID `healthkit:<UUID>` and preserve `originalSourceId`, source app bundle, source name/version, device information, observed/start/end timestamps, local date, timezone and metric value/unit. Attribution is derived from the native writing application's name/bundle, not the metric or the native `provider` label. Tempdrop identification accepts a name containing `Tempdrop` or a segmented `tempdrop` bundle identifier; other Apple sources are `Apple`, otherwise `other source`.
5. Count all normalized records and provider/metric breakdowns. Only the three reviewed metrics with proven Tempdrop identity qualify. Other records increment `skipped`; raw inspection records stay in the current UI session. Project qualifying records through the persisted-field/metadata allowlist.
6. Merge qualifying records into the same UID's previous minimized pending checkpoint by UUID. A newly queried representation wins for that UUID; pending UUIDs absent from the new query remain. Write and read-back-verify this checkpoint **before** starting cloud I/O. A storage failure stops upload and retains results in service memory with an explicit keep-this-view-open warning.
7. Load a fresh repository baseline. Account/repository guards and consent are rechecked after asynchronous work. Reconcile against *all* existing health source records. Manual records are cloned unchanged; dates never identify an imported record.
8. For each qualified UUID: duplicate identical occurrences count as already imported; conflicting representations in one batch reject it. Match existing HealthKit records by external UUID, case-insensitively. Same representation preserves ID and timestamps and does not write. A changed active representation replaces that imported source record, retaining its stable ID/`createdAt` and updating `updatedAt`. An existing `deleted` or `superseded` record is never resurrected.
9. A genuinely new UUID is added separately, even on the same date. It supersedes older imported records only when metric, source bundle and explicit `HKSyncIdentifier` match and its numeric `HKSyncVersion` is higher. Those old records become `status: superseded`, not hard-deleted. A late lower version is stored superseded. No replacement relationship is guessed from date or value alone.
10. Save only the reconciled `health` dataset if its canonical content changed. The existing repository computes the diff, writes normalized records and advances its revision in one transaction. Its existing 400-record-change limit remains: oversized imports fail intact into pending state, without partial writes. Recheck UID, consent and the allowlist at the repository and transaction boundary.
11. On confirmed success, adopt committed `AppData` into the application without a second autosave, store the device-local last-import time and clear the checkpoint. On failure, retain the minimized checkpoint and show **pending**, not success; candidate counts are explicitly unconfirmed. A commit followed by a checkpoint-cleanup failure is also pending: retry is safe because UUID reconciliation is idempotent. No sample/default fallback replaces cloud records.
12. **Retry pending import** explicitly reloads the latest baseline and uses the same reconciliation. Nothing retries or uploads in the background. Rejected cloud-session queues recover only after a successful explicit reload. Pending manual UI edits are retained in the view, not discarded by adopting an import.

The report contains `found`, `new`, `alreadyImported`, `updated`, `skipped`, `superseded`, provider/metric counts and the attempt timestamp. Found refers to normalized query records; the successful import report evaluates those queried records against the loaded baseline. A retry reports the checkpoint's records. If a new query also carries older pending records, the pending union may include more records than the current query report. The displayed last successful import time is device/account-local.

## Exact Firestore representation

Path: `users/<UID>/healthRecords/<cloudRecordId(record.id)>`. For a string ID, the document key is `s-` plus URI-encoded ID, e.g. `s-healthkit%3A11111111-1111-4111-8111-111111111111`.

Illustrative **synthetic** temperature document (optional fields are absent if not provided):

```json
{
  "schemaVersion": 1,
  "ownerUid": "owner-a",
  "deleted": false,
  "record": {
    "id": "healthkit:11111111-1111-4111-8111-111111111111",
    "schemaVersion": 1,
    "metric": "basal-temperature",
    "value": { "kind": "quantity", "value": 36.4, "unit": "Cel" },
    "observedAt": "2026-10-07T12:00:00.000Z",
    "startAt": "2026-10-07T12:00:00.000Z",
    "endAt": "2026-10-07T12:00:00.000Z",
    "localDate": "2026-10-07",
    "timeZone": "America/Toronto",
    "status": "recorded",
    "createdAt": "2026-10-07T12:00:00.000Z",
    "updatedAt": "2026-10-07T12:00:00.000Z",
    "provenance": {
      "provider": "Tempdrop",
      "ingestion": "healthkit",
      "originalSourceId": "11111111-1111-4111-8111-111111111111",
      "sourceAppId": "com.tempdrop.synthetic",
      "sourceDeviceId": "synthetic-device",
      "method": "healthkit:HKQuantityTypeIdentifierBasalBodyTemperature",
      "storage": "cloud",
      "metadata": {
        "sourceName": "Tempdrop",
        "sourceVersion": "1",
        "name": "Synthetic sensor",
        "model": "Fixture",
        "localIdentifier": "synthetic-device",
        "healthkit.HKTimeZone": "America/Toronto"
      }
    }
  }
}
```

Mucus/flow use `value: { kind: "category", value: "Egg white" | "Medium" | other normalized category, unit: "category" }` with their corresponding metric and method. Corrections/supersession retain source records and use the existing `record.status`. Existing repository removals use envelope `deleted: true`; loading a deleted HealthKit envelope retains its UUID as a normalized `status: deleted` tombstone, excluded from display selection.

The only allowed metadata keys are `sourceName`, `sourceVersion`, `sourceProductType`, `name`, `manufacturer`, `model`, `hardwareVersion`, `firmwareVersion`, `softwareVersion`, `localIdentifier`, `healthkit.HKTimeZone`, `healthkit.HKWasUserEntered`, `healthkit.HKMenstrualCycleStart`, `healthkit.HKMetadataKeyMenstrualCycleStart`, `healthkit.HKSyncIdentifier`, `healthkit.HKSyncVersion`. The explicit projection drops arbitrary notes, raw native payloads, UDI device identifiers, redundant native category numbers, inspection confidence and unrelated metadata. No complete Health export is uploaded. Apple permission state and future query anchors are never written to Firestore.

## Manual precedence and Body & cycle data flow

| Metric | Highest display priority | Next priority | Fallback |
| --- | --- | --- | --- |
| Basal temperature | Explicit manual `displayOverride: true` | Verified imported Tempdrop | Explicit manual temperature |
| Cervical mucus | Explicit manual observation, including `None / dry` | Verified imported Tempdrop | Unrecorded |
| Menstrual flow | Explicit manual observation, including `None` | Verified imported Tempdrop | Unrecorded |

Within the same priority, choose the latest observed/start timestamp (manual records use update time), then stable ID to break ties deterministically. Questionable temperatures remain flagged for existing chart/insight handling. Deleted, superseded, estimated and legacy-unverified records cannot win. An untouched manual form default is not an override. Manual transcribed Tempdrop measurements remain `ingestion: manual`; they do not claim HealthKit origin. Clearing an explicit manual field retains its tombstone and lets an eligible imported value win again.

The manual check-in now offers **Use this manual temperature instead of imported Tempdrop for this date**. Neither this nor manual mucus/flow selection destroys the imported observation. Import itself never changes any manual record or persisted `cycleEvents`.

`AppData.health` → `selectDailyHealthRecords` → source-referencing `dailyHealthSummary` / `cycleDisplayLog` → existing Today/Journal cycle and Body views. The projection combines saved manual cycle days with selected normalized observations, creating deterministic view-only days for imported dates. It keeps `healthSourceRecordIds` for temperature/mucus/flow. The projection is never saved as manual cycle history; validation rejects its `health-summary` origin. The raw manual cycle log remains the modal's edit source.

The existing range filters operate on this projected history, and the chart no longer silently truncates a requested long range to 30 observations. Latest-temperature callouts use the latest actual temperature day, not a later mucus-only day. The small Body card's old hardcoded energy/sleep/demo values now show selected saved temperature, mucus and flow. Imported flow does not automatically rewrite last-period date or cycle length. Sleep aggregates remain based on existing explicit manual cycle logs only, not inspection samples.

## Consent, accounts and offline state

**Sync selected Apple Health data to private cloud** defaults OFF for every device/account key, including existing installations with no saved choice. Apple Health read permission is independent. Permission requests, inspection and signing in do not imply cloud consent. Enabling explains that selected records will be stored under the signed-in private Firebase account for cross-device backup; the import button is a separate action.

Consent, minimized pending checkpoint and last-import time use UID-scoped device localStorage keys `equanimity:healthkit:<encoded-UID>:<consent|pending|last-import>:v1`. They are not synced. Turning consent off blocks future imports/retries and HealthKit mutations at the repository boundary; already saved records remain readable across devices. Turning it off does not revoke Apple read access or erase cloud records/checkpoints. Sign-out/account changes invalidate the service and keyed UI; another UID cannot import the previous UID's checkpoint. Returning to the same account can explicitly retry it. Cloud views never fall back to the local sample dataset.

The checkpoint contains only qualified normalized fields, not the complete inspection result. It is a retry buffer, not a second source-of-truth health dataset. When device storage is unavailable, memory retains the result only while the current view stays alive, and no upload starts. With normal storage, restarting the app preserves the checkpoint; restoring connectivity alone does not upload it. Cross-device recovery of committed records uses Firestore; device pending imports do not transfer to another device.

## Physical iPhone acceptance procedure

1. Run `npm run ios:prepare`, then `npm run ios:open`. In Xcode select the existing **App** scheme/target, configured development team and Tatiana's unlocked iPhone. Build/run using existing development signing. Do not change the app identity, install production distribution or delete/reinstall the app unnecessarily.
2. Sign into the approved private account that should own Tatiana's observations and stay in private cloud mode. Verify normal cloud loading succeeds. Confirm consent is **OFF** on this installation/account unless you explicitly enabled it during an earlier phase-2 test.
3. Scroll to **Apple Health · import & testing**, expand it, and tap **Refresh status**. Use **Request read permissions** if needed. Review Health → Sharing → Apps → Equanimity and allow the three reviewed read categories. No write permission is requested. Other categories may remain readable for inspection only.
4. With cloud consent OFF, tap **Inspect last 90 days**. Review normalized source name/bundle, UUID and dates for the reported Tempdrop temperature/mucus/flow records. Found should reflect current data (77 was the prior snapshot, not a fixed expectation). The import button must be disabled, last import must not advance, and no HealthKit cloud documents should be created.
5. Confirm the signed-in cloud account is correct; explicitly enable **Sync selected Apple Health data to private cloud**, read its backup explanation, then tap **Import recent Health data**. Wait for confirmed success, not just candidate counts. Capture only counts if sharing results, not private values/UUIDs. Verify eligible Tempdrop records are new or already imported and unreviewed/source-unqualified records are skipped. Last successful import advances and pending returns to zero.
6. In Body & cycle, check real saved BBT values and source labels, mucus and flow on the inspected dates. Expand history and exercise 7d / 30d / 90d / 1yr / All. Dates outside a range should disappear; a 90-day query does not manufacture older history. Existing manual observations and manual sleep should remain intact.
7. Tap **Import recent Health data** again without changing Health samples. Expect no new duplicate records, unchanged active records to count already imported, and no extra revision write when health content is unchanged. Reload/relaunch with connectivity and verify cloud-backed observations persist. An approved second device/browser signed into the same UID should display the saved records without needing HealthKit or enabling import consent there.
8. On a date with imported temperature, save a deliberately distinguishable manual temperature through the existing check-in. With the override checkbox OFF, imported Tempdrop stays selected and both sources survive. Enable the checkbox and save: manual wins. Explicit manual mucus/flow should win over imports, including explicit `None`/dry values. Re-import and verify these manual observations remain unchanged. Restore any test edits deliberately; do not confuse a test correction with a clinical observation.
9. Turn sync OFF and verify imports/retries are disabled while saved observations remain visible. Signing out closes private data; another UID starts with its own consent/checkpoint and must not see this account's records. Do not enable import under someone else's account on Tatiana's phone.
10. For offline behavior, begin from an already loaded cloud view with consent ON, then temporarily disable network connectivity and tap import. HealthKit can still read on-device records. Wait for the failure/pending message; existing displayed/cloud data must not be replaced. Restart/reopen the same account if testing durable retention, restore connectivity, explicitly retry and verify no duplicate UUIDs. Depending on Firebase timeout behavior, the action can remain busy before failure. A cold offline app may not be able to load/authenticate its cloud view: this phase is not a general offline app rewrite.
11. Keep sleep in inspection only. Check its actual provider/bundle and interval/stage semantics separately if desired. A supported requested type does not prove any Tempdrop sleep record exists. Do not expect HealthKit sleep counts or values in saved health records or summaries.

This development run compiled simulator Debug and unsigned physical-device Release builds; it did **not** execute these real-device import steps or verify a live Firestore upload.

## Deletions and deferred work

The current bridge uses `HKSampleQuery`, not anchored queries. A record absent from a 90-day query can reflect age, permission changes or filtering, so absence never deletes anything. Same-UUID corrections and explicit source sync-version replacements are supported; replacement UUIDs without explicit linking metadata remain separate source records.

A future deletion implementation needs `HKAnchoredObjectQuery` per approved type, durable **device-local** anchors, and matching `HKDeletedObject.uuid` to imported UUIDs. Persist added/deleted changes safely before advancing an anchor; mark matching observations deleted using the existing tombstone model, never infer deletion from an empty snapshot or store anchors in Firestore. Apple's anchored query API delivers added/deleted objects, and deleted objects are retained only temporarily; a later manual-only query cannot guarantee detection of every historical deletion. Guaranteed ongoing handling requires a deliberately designed observer/background workflow, which is outside this phase. See Apple's [HKAnchoredObjectQuery](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery) and [HKDeletedObject](https://developer.apple.com/documentation/healthkit/hkdeletedobject) documentation.

Before sleep import: inspect actual records/source identities on the phone; establish allowed providers, stage/interval normalization, overlap and duplicate merging, daily/night attribution/timezones, manual overrides and quality rules; add policy, UI, consent copy and tests before widening persistence. No assumption that Tempdrop provides sleep is encoded here.

Before background import: deliberately authorize/design observer queries and anchored reconciliation, entitlement/background-delivery changes, protected-device behavior, lifecycle/completion handling, durable retry and anchor advancement, per-device/account cancellation and deletion handling, and real-device tests. Background work must respect cloud consent and must not upload under a stale UID. None is enabled now.

## Remaining privacy/security considerations

- Existing rules still require matching authenticated UID **and** administrator-enabled `privateAccess/<UID>`, validate the envelope and forbid destructive client deletes. They were not changed or deployed. Rule-level access needs the emulator and phone checks below.
- Consent and metadata restrictions are application/repository controls, not cryptographic source attestation or server-enforced consent. Current rules do not validate every inner HealthRecord field and an independently modified authorized client could bypass the application policy. A hardened backend consent/schema policy is future work; UID privacy protection remains unchanged.
- The minimized retry checkpoint is plaintext localStorage in the app's webview/site sandbox, not a dedicated encrypted HealthKit vault. It intentionally survives sign-out for same-account recovery. Device security, XSS/dependency safety, backup retention and a deliberate checkpoint purge/encrypted-storage policy remain considerations before broader release. The key namespaces prevent accidental account mixing; they are not an encryption boundary.
- Revoking consent stops future imports, not previously saved data or local checkpoints. No bulk erase/purge workflow was added. Apple permission revocation is separately managed in Health. Review retention/export/account-deletion requirements before distribution.
- Source/device identifiers are sensitive provenance. Only the explicit allowlist is stored; do not paste inspector output into public tickets/logs. Public Firebase configuration is not a secret, but UID rules/private access must remain correctly deployed. No health payload telemetry/logging was added.
- A device Health store is not proof of the signed-in Firebase account's identity: the user must choose the intended owner account. Source-name/bundle classification is conservative application attribution, not verified vendor signing attestation.
- Historical timezone uses `HKTimeZone` metadata when available, otherwise the device's current timezone at query time. Without source timezone metadata historical travel dates may shift; the stored timezone/date remain internally consistent and may update on a later query.
- This does not add end-to-end cloud encryption, medical-grade interpretation, or general offline authentication/disk Firestore caching. Existing cycle/fertility estimates remain awareness-only.

## Verification

- `npm test`: hosted production build and all 52 application/data/cloud/render tests pass.
- `npm run test:data`: 33 pass, including 14 synthetic HealthKit tests.
- `npm run test:cloud`: 17 pass.
- `npm run test:standalone`: standalone production build and 6 tests pass (loopback-server sandbox permission approved).
- `npm run test:ios-shell`: 4 pass; bundled asset integrity verified.
- `npm run ios:prepare`: standalone build, Capacitor sync and native shell verification pass.
- `npm run lint`: pass.
- `npm run typecheck:standalone`: pass.
- Root `npx tsc --noEmit --incremental false`: still blocked only by the three existing Worker declarations (`cloudflare:workers` in `db/index.ts`, `Fetcher` and `D1Database` in `worker/index.ts`). No HealthKit TypeScript errors remain.
- Native `xcodebuild`: simulator Debug and generic physical-device Release compile successfully with `CODE_SIGNING_ALLOWED=NO`. Development signing/install/live HealthKit/Firestore acceptance remain the phone procedure, not a claimed result.
- `npm run test:firebase-emulators`: attempted; cannot start because Java is missing. The new real-port/UID-rules import test is checked in but **not executed**. Missing Java is an environment limitation, not a HealthKit test failure.
- Production builds retain the existing large-chunk warning; native builds show the existing scheme/destination warning but exit successfully.

All fixtures are synthetic; no actual health values, secrets or complete HealthKit exports were checked into the repository.
