# HealthKit phase 1: read-only inspection

Historical phase-1 report. The reviewed, consent-gated import workflow now supersedes the session-only behavior below; see [HealthKit phase 2](healthkit-import-phase-2.md) for the current policy, implementation and phone test procedure. Inspection itself remains session-only.

This phase adds a native iOS HealthKit bridge for Equanimity. It requests read access only for basal body temperature, sleep analysis, menstrual flow, cervical mucus quality, ovulation test results, and sexual activity (the existing app has an intercourse field). It does not write HealthKit data, call Tempdrop directly, schedule background work, or upload HealthKit records.

The native bridge is `ios/App/App/EquanimityHealthKitPlugin.swift`. The TypeScript boundary is `src/adapters/healthkit.ts`, and normalized records use the existing `HealthRecord` model with `provenance.ingestion = "healthkit"`, the HealthKit sample UUID in `originalSourceId`, and a stable `healthkit:<uuid>` record ID. The temporary panel is rendered by `src/application/HealthKitTools.tsx` near the bottom of the main app and is labelled “Testing / development · HealthKit inspection”. Its records remain React/session state only.

## Physical iPhone test

1. Open the iOS project in Xcode, select the `App` target, and select the physical iPhone and the configured development team.
2. Build and run Equanimity on the iPhone. The iPhone must be unlocked and have Health data available; the Simulator is useful only for safe-unavailable behavior.
3. In the app, expand **Testing / development · HealthKit inspection** and tap **Refresh status**.
4. Tap **Request read permissions**. In the Apple Health prompts, allow the categories you want to inspect. Equanimity never requests write access.
5. In **Health** → **Sharing** → **Apps** → **Equanimity**, review the selected read categories. Apple does not expose per-type read authorization status to the app, so the panel honestly reports that limitation.
6. Return to Equanimity and tap **Inspect last 90 days**. Expand normalized records to review type, value/category, interval, local date, source, bundle identifier, device metadata, HealthKit UUID, and provenance.

For Tempdrop identification, enable Tempdrop’s Health sync/export option if the Tempdrop app exposes one, then allow its Health categories in Apple Health. The bridge labels a record `Tempdrop` only when HealthKit source metadata contains Tempdrop; records without that source metadata remain `other source`. Metric type alone is never treated as proof of Tempdrop origin.

The next phase may select records for Firestore synchronization only after reviewing the physical-device output and defining source-selection, deduplication, deletion, and user-consent rules. This phase does not enable that synchronization.
