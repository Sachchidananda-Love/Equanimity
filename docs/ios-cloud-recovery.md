# iOS cloud recovery — 2026-10-08

> Offline cache selection no longer waits for restored Firebase authentication. See [iOS offline account relaunch](ios-offline-relaunch.md) for the subsequent device-session grant, safe sign-out and physical-phone test. The cache/outbox engine described here is reused unchanged.

Implemented non-blocking auth/repository hydration and background cloud recovery. Automated verification passed; Tatiana's physical-iPhone acceptance is still required. No claim is made that the intermittent device stall has been profiled or completely eliminated on that phone.

## Root causes found

1. `YiExperience` marked its entire `<main>` **inert** until repository loading succeeded and whenever cloud saving failed or import was busy. Inert disables focus and interaction for navigation, Practice, Journal, dialogs and unrelated local controls. A slow/rejected cloud request therefore looked like a frozen app even when React and the timer were running.
2. While Firebase Auth restored, the signed-out boundary did not mount the normal shell/navigation. Repository initialization waited on server-only reads before enabling that shell: revision read, seven collection reads, then another revision read. Firestore used memory cache, with no account checkpoint available after process termination. Existing Auth IndexedDB/local persistence was already present and is preserved.
3. The session save queue could retain a rejected promise. Subsequent queued writes could inherit that rejection instead of executing. Failed repository refresh also cleared the validated write baseline before the new read succeeded.
4. The experience key included repository revision, so re-selection remounted the entire experience. There was no coordinated browser/network/native foreground recovery path; repeated events and stale completions needed explicit protection.
5. A whole-body class MutationObserver scanned navigation changes unnecessarily. It now receives the active-screen visibility explicitly. Derived cycle display is memoized without changing its calculations.

These are code-confirmed interaction gates and recovery defects, not proof of a particular 5–10-second native/main-thread stall. No existing Firestore snapshot listeners were found that reset the whole app. No retry loop was added to a render effect, no blanket `enableNetwork`/`disableNetwork` transport resets were introduced, and no timer engine was modified.

## Behavior now

- **Launch/auth restoration:** the existing shell, navigation and local controls render without waiting for Firebase. Until the authenticated UID is known, no private history or local fallback history is loaded. A small existing status area reports restoration. Account-dependent submit buttons remain unavailable until that account's validated dataset is ready; navigation, scrolling, modal fields and practice controls are not globally disabled.
- **Cached authenticated account:** asynchronous IndexedDB restoration makes its validated dataset, including pending edits, available before server refresh finishes. The cache is namespaced by Firebase project and UID. It never reads or uploads the explicit local-development repository.
- **Offline:** after a valid baseline exists, ordinary UI edits update the view immediately and are checkpointed to a durable device outbox without awaiting Firestore. The status reports pending/offline, not server-saved. Without a baseline, account saving stays unavailable but the shell still works. Browser online/offline is only a hint; SDK failures separately detect unreachable Firebase.
- **Reconnect:** one in-flight recovery job drains pending changes using the original revision checks. Transient errors retain edits and back off from one second to a maximum of 30 seconds while online. Online/foreground/manual retry resumes in the background. Repeated same-UID auth and reconnect events keep the same repository/view. Unchanged refreshes do not replace the dataset; a read racing a newer edit cannot replace or silently rebase that edit.
- **Relaunch:** render the shell immediately, restore Firebase's existing managed session asynchronously, restore only its UID checkpoint, then refresh/retry. An acknowledged device checkpoint survives process termination while its WebView storage remains intact. Private data stays closed if session restoration fails. Sign-out invalidates the old view and stale async results; pending account outboxes are retained for that account, not uploaded under another UID.
- **Failure/conflict:** permission denial, invalid data, cache failure or a remote revision conflict retain data/edits and show an attention-needed state. Only account mutations are paused; unrelated interaction remains available. Retry does not discard the outbox or automatically overwrite another device's revision.

## Cloud and data guarantees

Cloud remains authoritative. The new IndexedDB checkpoint/outbox is a recovery mechanism, not a second primary repository, a local-to-cloud migration or a realtime cross-device merge engine. This small persistence addition is necessary to keep accepted offline edits across force-quit and make cached hydration independent of server reads.

Firestore paths, envelope schemas, UID approval rules and transaction ownership/consent checks are preserved. The existing `settings/repository` record gains an optional `lastMutationId`; retrying the same transaction after a lost acknowledgement does not advance the revision or duplicate its writes. No Rules change/deployment or new collection is needed. The compare-and-swap device checkpoint prevents another view from overwriting a newer durable queue.

HealthKit import service/plugin, consent, queries, anchors, pending import checkpoint and provider normalization are unchanged. The import workflow still uses **server-acknowledged** `saveMany`, not the UI outbox's device acknowledgement; an import cannot report server success merely because a local edit was queued. Tempdrop and fertility calculations are unchanged. Timer engine, deadlines, gongs and runtime storage are unchanged. Existing slider appearance changes in the worktree were preserved, not part of this fix.

## Development instrumentation

`[Equanimity lifecycle]` messages cover app launch, auth restoration start/end, repository initialization start/end, Firestore recovery start/end, browser offline/online, and native/DOM background/foreground. Only fixed event names, elapsed milliseconds, pending counts and connectivity booleans may be logged. There are no emails, UIDs, configuration values, health records, journal contents or raw error objects in these diagnostic messages.

Logging is enabled in the development server/development-mode web bundle, not the ordinary production bundle. Native scene events forward only `{ active: boolean }` to the web layer. DOM and native foreground events are coalesced and handlers are removed on unmount.

For an optional physical-device diagnostic build, package development-mode assets:

```sh
npm run build:standalone -- --mode development
npm run ios:sync
```

Then install a Debug build through Xcode and inspect the WKWebView console with Safari Web Inspector. A Debug Xcode build alone does not turn a production web bundle into a development bundle. For ordinary production assets, rerun `npm run ios:prepare` before building/installing. This task left production-mode assets synced.

## Verification

- Hosted production build and `npm test`: **93 passed**, including 21 new recovery tests, existing cloud/data/HealthKit/cycle/fertility/SSR tests and the prior slider regression.
- Standalone production build and `npm run test:standalone`: **6 passed**, including localhost static serving and media/module integrity.
- Auth/Firestore demo emulators: **4 passed**, including real transaction lost-acknowledgement replay and unchanged owner/anonymous/foreign-UID denial.
- `npm run test:cloud`: the original 17 plus 21 recovery tests are included in the main run.
- `npm run lint` and `npm run typecheck:standalone`: passed.
- `npm run ios:prepare` / final `npm run ios:sync`: production web validation, Capacitor sync and bundled asset verification passed.
- `npm run test:ios-shell`: **4 passed** against synced assets.
- Xcode `App` Debug build, generic iOS Simulator destination, signing disabled: passed. Native scene forwarding compiled successfully. No simulator/physical app installation was performed.

Existing warning: the lazy Firebase SDK bundle exceeds 500 kB. This is not a build failure and the SDK remains separate from the app-shell chunk. Firebase emulators used only synthetic records in `demo-yi-phase3a`; a task-specific temporary Java 21 runtime was downloaded, not installed system-wide. No live Firebase data was read/written by the tests. Local test ports/native cache access required development-environment sandbox approval.

Recovery coverage includes: uncompleted auth promise with rendered navigation/no inert shell; offline → online; queued edits restored before server reads; repeated auth/reconnect/resume; transient pending-write retry; real and mocked lost-ack replay; failed reads preserving a usable baseline; edits during refresh; permission failures; failed device checkpoints and warning recovery; cold offline accounts not falsely marked saved; account/UID/stale read isolation; concurrent checkpoint CAS; native/DOM lifecycle cleanup; foreign cache rejection; unchanged strict import acknowledgement; sign-out during restoration; explicit fallback selection; and effect cleanup/restart/unmount checkpointing.

## Remaining limitations

1. No physical-iPhone profiling or touch-event acceptance was possible here. WKWebView startup, Firebase SDK evaluation, storage initialization, main-thread work for a large dataset and native process suspension can still introduce latency. The removed global lock is independently verified; actual device timings need the test below.
2. Firestore transactions require an online server connection; recovery deliberately retains revision-checked transactions rather than replacing them with blind offline batch writes. [Firebase transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).
3. SDK network requests may remain pending for seconds. They no longer gate unrelated UI. `navigator.onLine` cannot prove server reachability; captive portals, Firebase outages and WebView lifecycle quirks must still be exercised on the device. Existing SDK auto-detected long polling is retained. [Firestore settings](https://firebase.google.com/docs/reference/js/firestore.firestoresettings).
4. Force-quit durability begins only after the asynchronous IndexedDB checkpoint completes. Storage failure shows an explicit warning and retains the edit **in memory**; force-quitting then cannot guarantee recovery. Uninstallation, clearing WebView storage, storage eviction or losing the persisted Auth session also limit offline restoration. The new checkpoint contains sensitive account data in device-origin IndexedDB, is not separately app-encrypted, and remains after sign-out to preserve pending edits. It is only exposed by this app after restoring the matching authenticated UID; retain trusted-device handling. [Firebase persistent-cache considerations](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).
5. Revision conflicts are not automatically merged. Pending conflicting edits remain retained, but this task does not add a conflict-resolution/export/discard feature. Repeated retry cannot reconcile a genuinely stale remote revision by itself. Likewise, the CAS guard prevents a second view from destroying an outbox; it does not provide a multi-tab merge UI. Keep the failing view open when an edit could not be checkpointed.
6. A first launch with no cache still needs a successful server load before account saves become available. Permission revocation is enforced by Firestore on server operations; already cached offline data cannot be remotely erased while disconnected. No remote wipe or new retention-management feature was introduced.

## Exact physical-iPhone reproduction/acceptance test

Use the freshly built app on Tatiana's phone (Xcode install or your normal distribution path). Do not uninstall or clear storage; that would destroy the very recovery state being tested. Use uniquely named **synthetic journal notes**, not synthetic health observations. Do not change HealthKit permission/import settings, Firestore rules or existing records.

1. Connect Wi-Fi/cellular, open/sign in normally and wait once for **Private cloud · changes saved**. Confirm her existing journal/body dataset is present. This seeds the new UID cache. Record iOS version, app build and connection type.
2. Go to iOS **Settings**, turn Wi-Fi **off** and cellular data **off** (or Airplane Mode with Wi-Fi also explicitly off). Return to Equanimity. For at least 30 seconds, repeatedly switch Insights → Practice → Journal, scroll, open/close an entry dialog, type and move an assessment slider. No control should wait on cloud reconnection.
3. Save one synthetic journal note titled `RECONNECT CHECK <timestamp>` with a unique sentence. Wait for offline/pending status; verify the note appears locally. Keep navigating. It must not say cloud-saved while disconnected. If a device checkpoint warning appears, keep the app open and record it rather than force-quit.
4. Restore Wi-Fi/cellular in Settings and immediately return. For the first ten seconds, repeatedly navigate, scroll, open/close dialogs and type. Expect no app-wide unresponsive interval, no clearing of the current dataset and no reconnect-induced screen reset. Pending should eventually become saved, with exactly one copy of the test note.
5. Repeat offline/online five times, including a rapid second toggle before sync completes. Background to Home and foreground during recovery. The chosen screen and data should remain stable; no repeated auth sign-in, duplicate notes or permanently pending state on a healthy connection.
6. Turn both connections off again. Save `RELAUNCH CHECK <timestamp>`, wait at least two seconds after pending/offline status appears, verify it is visible, then force-quit via the app switcher. Reopen **while still offline**. Immediately tap between tabs and use local fields/controls. The shell must respond before auth/cloud recovery finishes. After the saved Firebase UID restores, its cached note/data should appear without a server read. If Auth storage cannot restore, private history must stay closed rather than opening another source.
7. Restore connectivity, foreground, and confirm the relaunch note syncs exactly once. Force-quit/reopen online ten times, tapping tabs as soon as the shell appears. Look specifically for the prior intermittent 5–10-second dead period. Account save readiness can lag; ordinary navigation must not.
8. Optionally use the diagnostic bundle and Safari Web Inspector. Collect only lifecycle event/timing lines plus build/iOS/network metadata. If any stall remains, screen-record it and capture a main-thread timeline around the stall; do not export private datasets or raw health/journal console output. After checking, delete only the uniquely titled test journal entries through the app once online/synced.

Pass criteria: zero full-shell interaction lock during these transitions; current data survives transient errors; offline edits remain pending then sync once; stable screen/repository through same-account reconnect; no foreign-account data; no silent overwrite/discard on conflict/error. Ordinary cloud wait time is acceptable only in the sync status/account-dependent action, not navigation or local interaction.

## Every source file changed for this task

Modified:

- `app/YiApp.tsx` — remove whole-main inert/auth-only shell gate; scoped persistence submits; stable UID view; lifted navigation; lifecycle hookup; unchanged cycle display memoization; injectable session for shell test.
- `ios/App/App/SceneDelegate.swift` — native foreground/background boolean forwarding.
- `package.json` — include recovery tests in normal/cloud test scripts; no dependencies added.
- `src/adapters/firebase/client.ts` — attach UID device recovery wrapper; guarded idempotent transaction replay; existing Auth persistence/cache/consent retained.
- `src/adapters/firebase/repository.ts` — preserve validated baseline on failed reads; baseline export/restore and pending mutation validation/commit support; optional mutation identity.
- `src/application/CloudPanel.tsx` — explicit visibility instead of observer; granular sync status and background retry; sign-out retains outbox.
- `src/application/cloud-runtime.ts` — browser-only async session restoration and dev launch event.
- `src/application/use-app-data.ts` — subscribe to isolated data store instead of bulk effect rehydration/dataset comparisons.
- `src/services/cloud-session.ts` — stable same-UID repository, recovering save queue, generation guards, coalesced connection, separate sync/connectivity state and retry/resume.
- `src/services/repository-contracts.ts` — optional recovery contract, validated cloud baseline and sync status types.
- `tests/firestore-emulator.test.mjs` — real lost-ack retry assertion with client rules enforced.
- `tests/rendered-html.test.mjs` — shell rendered while signed-out/restoring, no inert; preserve prior slider test.
- `docs/cloud-primary-persistence.md` — mark historical blocking/memory-only recovery descriptions superseded.

Added:

- `src/adapters/firebase/sync-store.ts` — project/UID IndexedDB checkpoint and atomic CAS outbox.
- `src/application/app-data-store.ts` — independent hydration/edit generations, coalesced mutation checkpointing and stale-read protection.
- `src/platform/cloud-lifecycle.ts` — online/offline and coalesced DOM/native activity recovery.
- `src/platform/lifecycle-log.ts` — development-only privacy-safe events/spans.
- `src/services/cloud-sync.ts` — background refresh, durable UI outbox, idempotent retry, preserved baseline/data and granular failure state.
- `tests/cloud-recovery.test.mjs` — 21 synthetic recovery/race/SSR/lifecycle regression tests.
- `docs/ios-cloud-recovery.md` — this report and physical acceptance procedure.

Preexisting changes left untouched: `app/globals.css`, `src/application/sliders.css`, and the slider regression already in `tests/rendered-html.test.mjs`. Generated hosted/mobile/iOS bundle assets, build caches and emulator logs are ignored output. No HealthKit/Tempdrop/timer domain implementation, rules, environment files or personal dataset was edited. No commit, live deployment, device install or production cloud mutation was performed.
