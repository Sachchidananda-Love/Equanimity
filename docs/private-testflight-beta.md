# Private external TestFlight beta preparation

## Outcome and release gates

The app remains cloud-primary. No Firestore rules, UID/cache/outbox schemas, Tempdrop import policy, cycle estimation, timer scheduling/audio or gesture styles were changed. No data was deleted or relocated, and no photos/video were removed.

Before distribution:
- Supply `VITE_PRIVACY_POLICY_URL` with your actual published public HTTPS privacy policy. It is currently **not configured**; Account & data → Privacy shows a clear notice and has no broken/placeholder link.
- Approve the bundled personal media inventory below. Every tester receives those files, including files not currently selected by the cube UI.
- Verify backup exclusion on a physical Release iPhone and perform an upgrade/offline-relaunch smoke test. This preparation cannot inspect Tatiana's on-device container or prove an actual OS backup's contents.
- Validate a signed archive, Apple membership/team/HealthKit provisioning, App Store Connect configuration, deployed Firebase rules and tester approvals manually.

The icon/splash are still the valid opaque Capacitor placeholders. Replacing them is recommended before wider invitations but was not requested as part of this cleanup.

## Release versus Debug

`src/platform/release-config.ts` enables tools for Vite development builds or the native **compile-time DEBUG-only** document-start injection. There is no stored setting or production environment toggle that enables tools. The iOS Debug build uses the same production-mode web assets as Release, with the native Debug flag injected before scripts execute. This is a UI/build gate, not a security boundary against debugger/filesystem access.

Release hides:
- explicit local-only development/fallback selection;
- local browser export, sample review and “Keep as my data” tools;
- “Inspect last 90 days”, raw normalized HealthKit JSON and inspection type details.

Release retains:
- account sign-in/sign-out, sync/recovery status and retry;
- HealthKit availability/status, read permission, account/device-specific cloud consent, normal import, last-import/pending status and retry;
- aggregate reconciliation counts, not raw record contents;
- existing saved records and manual cycle observations.

Debug retains all development tools and its inspection-only read categories. Native heartbeat/gong diagnostics remain DEBUG-only; bounded JS diagnostics remain development-gated.

## Final Release HealthKit types

- `HKQuantityTypeIdentifierBasalBodyTemperature`
- `HKCategoryTypeIdentifierMenstrualFlow`
- `HKCategoryTypeIdentifierCervicalMucusQuality`

The existing verified import allowlist persists only Tempdrop-origin temperature, mucus and flow. Although manual ovulation tests/intercourse are consumed by the cycle UI, their HealthKit categories were inspection-only and not imported into the shipping account dataset. They therefore are **not requested or queried in Release**. Debug additionally requests/queries sleep, ovulation tests and sexual activity for inspection. Existing manual/imported data and normal cycle calculations are unchanged. Apple may retain previously granted categories from an older installed build; this does not mean the new Release requests/queries them.

Read-only authorization still uses `toShare: []`; no HealthKit write permission was added.

Final `NSHealthShareUsageDescription`:

> Equanimity optionally reads basal body temperature, menstrual flow, and cervical mucus from Apple Health to show your body and cycle history. You can separately choose to import selected records into your private Equanimity cloud account.

## Privacy URL boundary

Set `VITE_PRIVACY_POLICY_URL` in your existing Vite production environment (for example `.env.local`, or your build environment). Supply the URL of your real published policy, not an example domain. It must be HTTPS, without embedded credentials or a localhost/`.local` host. The public URL is compiled into the web bundle; changing it requires rebuilding and syncing.

`.env.example` documents the value but leaves it blank. Account & data → Privacy opens the configured policy externally; missing/invalid configuration displays an explicit notice instead. `verify-ios-web.mjs` rejects invalid configured URLs and stale output and warns on a missing URL, allowing development preparation to complete without pretending the release is ready.

Before Archive, run `npm run ios:prepare` after supplying the URL. Verify the policy loads from the actual Release app. The policy must describe Firebase storage, optional HealthKit import, UID-scoped device cache/outbox retention, consent withdrawal, sign-out not erasing data, and a real deletion/contact process. No final policy text or URL was invented.

## Local health storage and backup safety

All the following JavaScript stores use the existing persistent default WKWebsiteDataStore for `capacitor://equanimity.local`:

| Data | Logical storage |
| --- | --- |
| Complete cloud baseline, normalized health records, revisions and pending account edits (including health changes) | IndexedDB `equanimity-cloud-<project>`, `accounts` store keyed UID. |
| Pending HealthKit normalized import/retry batch | localStorage `equanimity:healthkit:<encoded UID>:pending:v1`. |
| HealthKit opt-in and last-import time | localStorage matching `consent:v1` and `last-import:v1` keys. |
| Reconciliation state | Computed in memory against current records; pending verified batch is the durable retry checkpoint above. Raw inspection/results remain session memory. |
| Last locally authorized account / sign-out tombstone | localStorage `equanimity-cloud-access:<encoded project>:<encoded Firebase app ID>`; no health payload. |
| Firebase managed auth persistence | Firebase Web SDK IndexedDB, with localStorage fallback; no custom stored password. Firestore SDK cache itself is memory-only. |
| Legacy/local fallback manual cycle/health data and original migration backup | localStorage `yi-local-data-v1`, `yi-original-backup-v1`, retained legacy `yi-*` keys. Hidden in Release, not deleted. |
| Scoped practice/quote checkpoints | localStorage `equanimity:runtime:<project>:<UID>:...`; unchanged. |

WebKit's iOS implementation places persistent origin data beneath the app container's `Library/WebKit`, including legacy `WebsiteData/IndexedDB`/`WebsiteData/LocalStorage` and newer `WebsiteData/Default` origin directories. Exact origin hashes/database filenames are OS-managed and are **not exposed as a supported per-UID/per-key filesystem API**. Network caches can also live in `Library/Caches/WebKit`, which is already excluded by the OS. Sources: [WebKit storage implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/WebsiteData/Cocoa/WebsiteDataStoreCocoa.mm), [Apple backup guidance](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup).

`EquanimityBackupSafety.swift` now:
1. Resolves this app's Library directory through Foundation.
2. Creates/uses only its `WebKit` child; rejects a non-directory or symlink.
3. Sets and reads back `URLResourceValues.isExcludedFromBackup = true` on that parent.
4. Runs before WKWebView creation at app launch, and reapplies on foreground.

Excluding the single WebKit parent covers co-located health payloads, SQLite sidecars and future child directories without guessing per-origin paths, scanning records, moving databases or changing the web store/origin. It also excludes co-located auth/preferences/journal/pending writes from OS backup: these remain durable across ordinary relaunch/updates, but **unsynced device-only edits cannot be recovered by an OS backup restore**. Firebase remains the intended cross-device recovery source. Sync before replacing/uninstalling a device.

Failure emits only a fixed non-sensitive native safety warning; it never deletes data or freezes the UI. It is not encryption and does not remove health data from an already-created backup. WebKit implementation paths can change across OS releases, and an app cannot selectively exclude one localStorage key/UID via public WK APIs. If supported-device testing finds storage outside this root or an exclusion failure, do not distribute a real-health-data beta until its exact location can be safely protected. Switching to an ephemeral store would break offline relaunch/pending durability and is **not** an acceptable silent fallback.

Physical verification (not performed here):
- Run/install the Release configuration on an iPhone without uninstalling the existing app; allow normal cloud load and import.
- In Xcode Devices and Simulators, download the app container if permitted. Inspect `Library/WebKit` and verify its backup-exclusion flag on-device (e.g. a debugger evaluation of `URL.resourceValues(forKeys: [.isExcludedFromBackupKey])`). Verify after cold launch and foreground. Do not share the downloaded container: it contains private records.
- Check actual fresh backup behavior using synthetic records/a controlled device; an exported container alone is not proof of backup omission.
- Offline force-quit/relaunch must still restore the last allowed UID and pending edits; reconnect must sync normally. No “Device storage backup exclusion could not be verified” warning should appear.
- If Xcode cannot download a TestFlight container, perform the resource-value inspection with a signed development-distributed build using **Release** compilation and the same implementation before TestFlight acceptance.

## Bundled personal-media inventory

Source directory: `public/cube-media/`.
Preparation copies all of it into `dist-mobile/cube-media/`, then `ios/App/App/public/cube-media/`, and finally the beta app's `public/cube-media/`.

**85 files: 41 cube JPGs, 43 picture JPGs, 1 MOV.** No media was edited/removed. There are no account restrictions on app-bundle assets.

- `cube-01.jpg`
- `cube-02.jpg`
- `cube-03.jpg`
- `cube-04.jpg`
- `cube-05.jpg`
- `cube-06.jpg`
- `cube-07.jpg`
- `cube-08.jpg`
- `cube-09.jpg`
- `cube-10.jpg`
- `cube-11.jpg`
- `cube-12.jpg`
- `cube-13.jpg`
- `cube-14.jpg`
- `cube-15.jpg`
- `cube-16.jpg`
- `cube-17.jpg`
- `cube-18.jpg`
- `cube-19.jpg`
- `cube-20.jpg`
- `cube-21.jpg`
- `cube-22.jpg`
- `cube-23.jpg`
- `cube-24.jpg`
- `cube-25.jpg`
- `cube-26.jpg`
- `cube-27.jpg`
- `cube-28.jpg`
- `cube-29.jpg`
- `cube-30.jpg`
- `cube-31.jpg`
- `cube-32.jpg`
- `cube-33.jpg`
- `cube-34.jpg`
- `cube-35.jpg`
- `cube-36.jpg`
- `cube-37.jpg`
- `cube-38.jpg`
- `cube-39.jpg`
- `cube-40.jpg`
- `cube-41.jpg`
- `picture-01.jpg`
- `picture-02.jpg`
- `picture-03.jpg`
- `picture-04.jpg`
- `picture-05.jpg`
- `picture-06.jpg`
- `picture-07.jpg`
- `picture-08.jpg`
- `picture-09.jpg`
- `picture-10.jpg`
- `picture-11.jpg`
- `picture-12.jpg`
- `picture-13.jpg`
- `picture-14.jpg`
- `picture-15.jpg`
- `picture-16.jpg`
- `picture-17.jpg`
- `picture-18.jpg`
- `picture-19.jpg`
- `picture-20.jpg`
- `picture-21.jpg`
- `picture-22.jpg`
- `picture-23.jpg`
- `picture-24.jpg`
- `picture-25.jpg`
- `picture-26.jpg`
- `picture-27.jpg`
- `picture-28.jpg`
- `picture-29.jpg`
- `picture-30.jpg`
- `picture-31.jpg`
- `picture-32.jpg`
- `picture-33.jpg`
- `picture-34.jpg`
- `picture-35.jpg`
- `picture-36.jpg`
- `picture-37.jpg`
- `picture-38.jpg`
- `picture-39.jpg`
- `picture-40.jpg`
- `picture-41.jpg`
- `picture-42.jpg`
- `picture-43.jpg`
- `wedding.mov`

Other shipped public assets are `og.png` (Yi illustration, not a personal photo), `favicon.svg`, `file.svg`, `globe.svg`, `window.svg`, and the four gong WAVs. Fonts and native icon/splash also ship. Personal quotes are still shared bundled application content in `app/quotes.ts`; this cleanup did not change them.

## Verified release configuration and tests

- Name: Equanimity; ID: `win.calemandersonbar.equanimity`; unchanged.
- Version/build: `1.0 (1)`; suitable if build 1 has not already been uploaded. Increment build for each subsequent upload.
- Automatic signing team: `V9P6CQD53C`; distribution membership/profile not certified by unsigned builds.
- HealthKit entitlement remains enabled; authorization remains read-only, with no write-purpose string.
- Bundled production Firebase enabled, emulator disabled, non-demo project, auth domain consistent; values withheld.
- No remote dev server. `equanimity.local` is the bundled scheme-handler host; loopback emulator code is inactive.
- Release contains no native diagnostic heartbeat/gong strings and no native development-tools injection.
- SDK/toolchain: Xcode 26.6 / iPhoneOS 26.5.

Passed: 161 application tests; 5 actual Firebase Auth/Firestore demo-emulator tests; 6 standalone tests; 10 iOS-shell/release-safety tests; native Foundation backup test (new/existing directory, readback/idempotence, retained files, symlink rejection); lint; standalone TypeScript; hosted and standalone production builds; `ios:prepare`; unsigned Debug and Release iPhone compiles. Final Release asset hashes match the prepared bundle and native diagnostic/tool-injection markers are absent. No production cloud mutation, deployment, signed archive, phone installation or TestFlight upload occurred.

## Every changed file

- `.env.example`
- `src/platform/release-config.ts`
- `src/application/CloudPanel.tsx`
- `src/application/DataTools.tsx`
- `src/application/HealthKitTools.tsx`
- `ios/App/App/EquanimityBridgeViewController.swift`
- `ios/App/App/EquanimityHealthKitPlugin.swift`
- `ios/App/App/EquanimityBackupSafety.swift`
- `ios/App/App/AppDelegate.swift`
- `ios/App/App/SceneDelegate.swift`
- `ios/App/App/Info.plist`
- `ios/App/App.xcodeproj/project.pbxproj`
- `scripts/verify-ios-web.mjs`
- `tests/release-safety.test.mjs`
- `tests/native-backup/main.swift`
- `tests/rendered-html.test.mjs`
- `tests/standalone-build.test.mjs`
- `package.json`
- This report.

Generated ignored mobile/native asset output was rebuilt/synced. Firebase rules, repositories, HealthKit import/reconciliation logic, media, timers and sliders are unchanged.

## Manual Apple / Xcode / TestFlight sequence

1. Publish your real privacy policy, set `VITE_PRIVACY_POLICY_URL`, decide on bundled personal media, and complete physical backup/Release smoke verification.
2. In Apple Developer, confirm paid membership/agreements, the intended team and explicit bundle identifier with HealthKit. Do not change the bundle ID.
3. In Firebase Console, verify intended project, email/password auth, deployed UID security rules and administrator approval of each tester/reviewer UID. Use a dedicated reviewer account with synthetic records only.
4. Run `npm run ios:prepare`. Open `ios/App/App.xcodeproj`. Target General: name/ID/version/build. Signing & Capabilities: correct team, automatic signing, HealthKit.
5. Edit Scheme → Archive → Release; generic iOS device → Product → Archive. Organizer: review privacy report, Validate, then Distribute → App Store Connect → Upload (symbols included). No “internal testing only” option for this external beta.
6. App Store Connect: create/select Equanimity iOS app record matching the ID; choose your own SKU. After processing, answer export compliance accurately. Only declare encryption exemption if applicable; no exemption key was guessed.
7. TestFlight → Test Information: beta description, feedback email/contact, privacy policy where requested, review credentials/notes, optional HealthKit behavior and non-contraceptive cycle-estimate caveat. Create a private external email-invitation group; submit first external build for Beta App Review, then invite approved testers. No public link or public App Store submission is needed. [Apple external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).
8. Test the actual TestFlight installation: existing-data upgrade without uninstall, correct Privacy link, hidden dev controls, three read types, HealthKit denial, offline relaunch/reconnect, A/B switching, Start/Try/Finish, sliders, background/resume. Legacy extra Health permissions may remain granted from older Debug builds; verify newly requested categories with a clean synthetic test account/device.
