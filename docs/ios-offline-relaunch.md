# iOS offline account relaunch — 2026-10-09

Previously loaded account records now bootstrap from the existing durable cache before Firebase SDK/auth restoration completes. Cloud remains primary; there is no new sync engine. Physical-iPhone acceptance is still required.

## Root cause

The recovery repository already persisted the complete usable baseline and pending mutations in IndexedDB. It was not merely an in-memory cache or a pending-edits cache. However, startup selected that repository only after Firebase's initial auth callback, and cached-baseline restoration required `auth.currentUser` to match. Until then the app used an empty signed-out repository.

The installed Firebase Auth SDK restores its persisted user and attempts a user reload before publishing the initial auth state. A failed/offline network request can delay that callback. Auth persistence was already configured with IndexedDB/local persistence; Firestore uses memory cache and server reads. Neither configuration was changed. No normal checkpoint durability defect was found: the existing IndexedDB store resolves writes after the transaction completes.

The new regression tests reproduce the missing bootstrap with the SDK connection deliberately unresolved, using the actual IndexedDB store and repository with synthetic records. They also mount the real app shell and Journal. This is code/test evidence, not a physical-device trace.

## What is persisted and where

- Existing IndexedDB database: `equanimity-cloud-${projectId}`, version 1, `accounts` store keyed by UID. Its checkpoint contains the validated complete `AppData` baseline, cloud revision/collection metadata, checkpoint version and pending mutations with their existing stable mutation IDs. All seven datasets are retained, including intentionally empty collections.
- New small localStorage marker: `equanimity-cloud-access:${encodeURIComponent(projectId)}:${encodeURIComponent(appId)}`. It contains only schema, project, app ID and UID, or a null-UID revocation tombstone. No password, auth token, email or record contents are copied into it.
- The marker is granted only after actual Firebase authentication and a usable, durably persisted baseline. It selects one account cache; startup never scans other UID caches.

The dataset, checkpoint format, transaction/CAS mechanism, pending queue, mutation replay and Firestore rules remain unchanged. `fake-indexeddb` is a test-only dependency.

## Startup, editing and reconnect

1. Read the last device-local account grant. Missing, invalid or foreign-project/app markers do not bootstrap private data.
2. Select that UID's existing recovery repository and restore its baseline plus pending edits from IndexedDB. The shell does not wait for SDK import, auth or the network. Local disk hydration still takes a finite amount of time.
3. Display a cached/offline status. Cached identity is not described as a confirmed Firebase sign-in.
4. Restore Firebase authentication in the background. Offline edits use the existing durable outbox; they are not reported cloud-saved.
5. When Firebase confirms the same UID, keep the same repository and visible baseline, attach/enable the real cloud transport and run existing reconciliation/replay in the background.

A network-online hint alone cannot authorize reads or flush edits. Firestore operations still require the actual matching authenticated Firebase UID. Failed reads preserve the visible baseline. Repeated network/foreground events reuse the existing coalesced refresh/idempotent mutation handling. Revision conflicts retain pending edits and require attention; this change does not automatically overwrite a newer server revision.

## Sign-out and account switching

- Sign-out closes the current private view and durably tombstones its cache access before awaiting Firebase. A slow or unresolved SDK sign-out cannot reopen it on the next offline launch.
- Explicit account switching revokes the previous grant before sign-in. An old SDK restoration callback is held during sign-in; the new request's actual identity wins. Stale sign-in completions cannot undo a later sign-out.
- A known different authenticated UID cannot restore the former UID's cache. The view changes to that account's own repository; no A-to-B data merging occurs.
- Cross-view storage revocation closes an already open account view.
- Checkpoints/outboxes are retained rather than discarded on sign-out. They can be used again only after that account is explicitly authenticated and granted access again.
- If durable revocation itself fails, this view closes but sign-out is reported as incomplete with a retry action. Retry successfully before sharing or relaunching the device. The app cannot guarantee next-launch revocation if device storage refuses the write.

The grant is trusted-device local session state, not a cryptographic identity proof or a server authorization token. Previously granted offline access cannot learn about remote revocation until connectivity/auth restoration returns. As with any local cache, uninstalling the app, clearing website/app storage, or WKWebView storage eviction can remove it. No sample/demo data is substituted when cache/auth is unavailable.

## Physical-iPhone verification

Install the prepared build through Xcode without uninstalling/clearing app storage. The prior build has no access marker, so **first load the account online once with this build**.

1. Enable Wi-Fi/cellular, sign in to the approved account, open Journal and other account screens, and wait for saved/usable cloud data with no checkpoint warning. Note a few existing records.
2. Force-quit Equanimity. Disable both Wi-Fi and cellular. Reopen it. Navigate and scroll immediately: the existing records should appear after local disk hydration, without waiting for Firebase, with the cached/offline status and no demo presets.
3. Add a uniquely named synthetic journal entry, such as `OFFLINE RELAUNCH <time>`. Wait until it is pending without a device-checkpoint error. Force-quit and reopen again while still offline. Both the previous records and this edit should remain visible.
4. Restore connectivity. Keep navigating while it reconnects. The cached records must not disappear before the cloud read completes. The pending entry should sync once, not duplicate. Repeat offline/online and background/foreground transitions.
5. Sign out while offline. Private records should disappear immediately even if Firebase is still busy. Force-quit/reopen offline: the former account's records must remain closed. If sign-out reports a storage error, retry before sharing the phone.
6. If you have another approved test account, sign in online as B and load its data. Relaunch offline: only B's records may appear, never A's. Sign out and explicitly return to A online to verify its retained records/pending edits remain available. Do not create accounts or change approval/rules for this test.

Only use synthetic content for the new test entry. Remove that entry through the normal UI afterward if desired. Existing development diagnostics log lifecycle/phase/count information, not private record contents.

## Verification

- Full hosted build and application test suite: 134 tests, including 14 offline-relaunch regressions.
- Firebase Auth/Firestore emulator integration and ownership/rules tests: 4 tests (demo project only).
- Standalone production build/asset tests: 6 tests.
- iOS shell tests: 5 tests.
- Lint, standalone TypeScript check, `ios:prepare` and unsigned generic-iPhone Debug compile.

Automated results do not certify physical force-quit durability on Tatiana's particular WKWebView/device; perform the steps above. No physical phone install, live cloud writes or deployment was performed for this fix.

## Files changed

- `src/adapters/firebase/device-access.ts`: project/app-scoped device grant and revocation tombstone.
- `src/adapters/firebase/device-recovery.ts`: pre-SDK bootstrap of the existing repository/cache/outbox and late transport attachment.
- `src/adapters/firebase/repository.ts`: separate local cache ownership validation from strict server auth guards.
- `src/adapters/firebase/client.ts`: attach real transport and return the actual sign-in identity.
- `src/services/cloud-session.ts`: cached startup, matching-UID promotion, safe sign-out/switching and stale-auth protection.
- `src/application/cloud-runtime.ts`: select device recovery before SDK import and use initial network state.
- `src/platform/cloud-lifecycle.ts`: cross-view access revocation notification.
- `src/application/CloudPanel.tsx` and `app/YiApp.tsx`: cached status, non-blocking cached sign-out and retry-sign-out wording; no redesign.
- `tests/offline-relaunch.test.mjs`, `package.json`, `package-lock.json`: regression coverage, test commands and test-only IndexedDB implementation.
- This report, `docs/ios-cloud-recovery.md`, `docs/cloud-primary-persistence.md`: current behavior and superseded startup notes.

No HealthKit import, Tempdrop, timer behavior, native implementation or Firestore security rules were changed.
