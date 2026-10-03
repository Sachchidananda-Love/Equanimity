# Cloud-primary persistence after Phase 3A

Firestore is now the normal persistence path for authenticated real users when `VITE_FIREBASE_ENABLED=true`. This phase intentionally does **not** migrate local test/demo records. Local storage is retained only for explicit development/fallback use and device-local runtime state. No Capacitor, iOS project, HealthKit, Tempdrop, Storage, Analytics, live deployment, or live record manipulation was added.

## Current behavior

- With Firebase enabled, startup/restart shows the sign-in boundary, not local journal/health data. Sign-in automatically selects that exact UID's cloud repository; the keyed view loads and validates it before enabling interactions. There is no second “Use cloud” step for normal sign-in.
- Authentication remains memory-only. Refresh/restart requires signing in again, then restores the same persisted cloud dataset. This preserves the existing privacy policy rather than silently adding durable credentials or health caching.
- Disabled Firebase remains a local development build. Enabled but invalid configuration stays behind the sign-in boundary; it does not silently open local data. The user can explicitly select the labelled local-only development/fallback option.
- Local fallback never merges, uploads, downloads, or mirrors either dataset. Switching back to cloud explicitly reloads only the authenticated UID's data. Local fallback is not a cloud offline queue and resets to the normal sign-in boundary after refresh when Firebase is enabled.
- Sign-out immediately unmounts private records and invalidates old repository references, even during a slow/pending operation. It does not automatically open local data. Pending or failed edits prompt before manual sign-out/discard. An already-sent write may have committed; sign-out is not a rollback. Late completions cannot restore the closed view or mark another session synced.
- Loading and saving are distinguished. Cloud operations are pending until acknowledged; errors pause editing and surface a visible message above the main UI. Permission-denied explains UID approval/rules instead of reporting only a generic failure. Reload explicitly discards unsaved in-memory edits after confirmation. No failed-write automatic retry/local fallback was introduced.
- Preset/journal notifications in cloud mode refer to queued changes and the cloud save status rather than promising a completed save before acknowledgment. Main screen/card styling is unchanged; the only additions are sign-in/loading/error/status treatment.

No new environment values, Console setup, schema, or Rules deployment is required beyond the working Phase 3A setup. Keep the existing administrator UID approvals and private ownership Rules. Rebuild/restart both builds to receive the new behavior. `.env.local` was not read, edited, printed, or committed.

## Verified Firestore domains

The shared CRUD exercise runs against both a deterministic repository port and the **actual Firebase Auth/Firestore emulators with client Security Rules enforced**.

| Domain | Cloud location | Verified operations |
| --- | --- | --- |
| Journal entries | `users/{uid}/journalEntries/{encodedId}` | Create, update, fresh repository read/reload, tombstone, recreate with same ID |
| Timer presets | `timerPresets/{encodedId}` | Same operations, duration update, intentionally empty collection retained |
| Activity presets | `activityPresets/{encodedId}` | Same operations, name update |
| Books | `books/{encodedId}` | Same operations, title/completion/date update |
| Cycle events | `cycleEvents/{encodedId}` | Create, update, read/reload, tombstone and stable-ID recreation |
| Normalized health records | `healthRecords/{encodedId}` | Same operations, value update, unchanged source identity/provenance; explicit none/zero tested separately |
| Synced settings | `settings/cycle`, `settings/dashboard` | Cycle/period preferences, widget order/subset, empty/reset configuration, read/reload |

Settings are small configuration documents, not major dataset arrays on a user document. Cycle history remains in event documents. Clearing a settings preference is an explicit empty/reset value, not a physical delete. Records use existing schema-1 envelopes; tombstones retain the last saved record. Normalized health source status tombstones also retain their separate domain meaning. New IDs remain stable strings; legacy numeric IDs remain typed and encoded distinctly. No ID rewrite/migration was added.

Each implemented collection is tested for approved owner read/write/update/tombstone access and anonymous/other-UID denial, including list queries. Reserved future collections and client self-grants remain denied. Actual Auth sign-out invalidates access; sign-in restores the same records. Fresh repository instances reload the persisted data. Pure session tests additionally cover account changes, failed sign-in, permission-denied without fallback, late pending-load completion, explicit local separation, restart, and poisoned write queues/conflicts.

Known demo fixtures/unverified cycle history remain blocked before cloud writes; loads do not persist defaults or sample history. Default timer/activity configuration may be explicitly saved when a user edits that configuration; it is not demo health/journal history. The controller cannot access a local repository, and the signed-out cloud-primary UI does not mount local data loading. Existing local raw storage preservation tests remain in place. Only synthetic test data was used in the emulators; no live Firebase account or personal record was accessed by this implementation work.

## Remaining persistence gaps and limits

1. This is a primary **online**, explicit-save repository, not a complete sync product. There are no realtime cross-device listeners/merges, persistent offline cloud drafts, cloud export/restore, or automated backup UI. Revision conflicts deliberately fail and require reload; unsaved edits are only in memory. Keep note of them before discarding/restarting. A disconnected server request can remain pending until connectivity resolves; sign-out still closes access immediately.
2. Active practice deadlines, currently running timer/gong choices, and quote rotation remain device-local by design, even in cloud mode. Timer/activity **presets**, journal/practice history, books, cycle preferences, normalized source observations, and dashboard widget configuration are cloud-persisted. Temporary modal/navigation/chart-range selection is UI state, not a synced setting.
3. The existing UI exposes journal/timer-preset deletion and book/cycle/health entry workflows, but not a separate delete editor for every domain. Activity presets currently have an add-only UI (no rename/delete control); cycle-source, arbitrary health-record and book deletion are also not standalone UI actions. Repository update/tombstones are verified for all record collections; that is not a claim that every action exists in the UI. No destructive management UI was added.
4. Multiple newly created presets/books may display in Firestore document-ID order; no new durable ordering field for those collections was introduced. Dashboard widget ordering and journal/cycle chronology are explicitly preserved. A future arbitrary preset/book reordering feature should store order intentionally rather than relying on query order.
5. Health summaries remain app-derived and separate from source measurements. `dailyHealth`, `importBatches`, and `migrations` remain unimplemented/denied. No CSV or HealthKit permission/query-anchor payloads are supported. No production local-to-cloud migration is needed or planned from this test/demo local dataset.
6. Runtime validation rejects malformed cloud records instead of overwriting them. The rules enforce UID approval, ownership and envelope shape; detailed semantic validation stays in the adapter. Requests affecting more than 400 documents fail without a partial batch. Account administration, password reset, revocation policies and any future durable-auth policy are still separate product decisions.

Firestore can be treated as the primary persistence layer **for the current online application domains**, subject to manual browser acceptance and these limits. This is not a claim of offline durability, native lifecycle validation, or clinical interpretation readiness.

## Verification commands and results

```sh
npm test
npm run test:cloud
npm run test:firebase-emulators
npm run test:standalone
npm run lint
npm run typecheck:standalone
```

`npm test` builds hosted production and runs 38 tests (19 local, 17 cloud/session, 2 hosted UI/source). The 17 repository/session tests can also run alone. Both real emulator tests pass, with expanded assertions across all domains and Auth restoration. Standalone production builds and all 6 standalone checks pass, including static root/nested serving, asset integrity, shared screen rendering and exclusion of server-only modules. Lint and standalone TypeScript pass. Production still warns about the lazy Firebase SDK chunk exceeding 500 kB; it is not a failed build.

Emulators require Java 21+ and loopback ports. The command targets only `demo-yi-phase3a`, never the configured production project; synthetic REST signup is test fixture provisioning only. This machine used the already-downloaded task-specific temporary Java runtime, not a system Java install. Local port tests need sandbox approval in Codex; that is not an app permission requirement.

Browser discovery was unavailable. Automated server rendering and controller/repository tests do not verify real DOM events, CSS screenshots, browser console, audible media, or the live configured account. Complete the manual checks below before calling the release browser-accepted. No personal browser storage was read by this task.

## Exact manual browser checks

Use your approved test UID and **synthetic values only**. Do not delete unrelated cloud records. Run `npm run dev` and open the hosted origin; separately run `npm run build:standalone`, `npm run serve:standalone` and open `http://127.0.0.1:4174/`. Different origins have different local fallback/device storage but should use the same configured cloud project/UID.

1. Restart/rebuild with the existing valid `VITE_FIREBASE_ENABLED=true` configuration. Before sign-in, verify the sign-in screen appears and no local journal/health history is shown. Try a wrong password: authentication error, no private records exposed. Correct sign-in should show loading → saved cloud status and automatically open your cloud dataset, without a “Use cloud” step.
2. Journal: create `CLOUD PRIMARY TEST`, write a synthetic note, wait for cloud saved, edit its note, wait again, use **Reload cloud data**, and verify the edit. Delete it via the app; reload hides it. In Console, only its document should become `deleted: true` with its last saved record retained. Existing unrelated records must remain unchanged.
3. Practice: create a uniquely labelled timer preset, edit duration/gong/color, wait for saved, reload and verify those fields. Delete only that test preset, then reload to confirm it stays absent. Preview each gong and verify main screens/navigation still behave normally.
4. Activity presets: use the reflection/activity editor's new-activity control to create a uniquely labelled test activity. Wait for saved and reload; confirm it remains available and existing presets remain intact. This UI is currently add-only: rename/delete and their tombstones are verified by the shared repository/emulator exercise, not a nonexistent browser control.
5. Books: log a synthetic test book, start it, then finish it with a synthetic date/assessment. Wait for cloud saved and reload to verify fields. Do not physically delete a Firestore record from Console as a tombstone test; repository-level book deletion is covered by the emulator, not an invented UI control.
6. Cycle/health: log a test day with explicitly recorded flow “None”, temperature, and sleep interruptions `0`. Record which fields you intentionally changed; reload and verify none/zero remain recorded while untouched fields stay unrecorded. Change temperature for the same day and confirm the existing event/source IDs stay stable, provider/ingestion remain manual, and a cleared temperature retains its normalized source status tombstone. Use a throwaway account to avoid contaminating real health history.
7. Settings: change average cycle/period configuration and reorder/remove/add dashboard widgets. Wait for saved; reload/restart, sign in again, and verify the configuration. In Console, history remains separate `cycleEvents` documents and widget order is a small `settings/dashboard` configuration array.
8. Separation: explicitly choose **Use local-only development/fallback data**. Add `LOCAL ONLY TEST`, reload only if you expect to return to the sign-in boundary, then explicitly return to local to confirm its device-only presence. Sign in/return to cloud and verify the local entry is absent. Cloud test records must likewise not appear in local mode. Local records must never appear in Firestore merely from signing in. Do not clear local storage to test this.
9. Sign out: private records should disappear immediately and the sign-in screen should return. Sign in again and confirm the same UID dataset reappears. Refresh/close/reopen and repeat; another sign-in is expected with memory-only auth. In a second approved throwaway account, verify the first account's records never appear. Emulator tests cover prohibited direct cross-UID operations; Rules Playground can verify that second UID against the first UID path without altering data.
10. Permissions/failures: with a throwaway account only, have the administrator temporarily disable its `privateAccess/{uid}.enabled` and attempt **Reload cloud data**. Expect permission-denied, disabled editing, no automatic local mode or local upload. Restore approval and reload. Disconnect network after loading, attempt a synthetic edit, and verify pending/failed without a false saved status; reconnect, note any unsaved value, then explicitly reload/discard and retry. If an operation stays pending, sign-out must still close access after confirmation.
11. Conflict: load the same UID in two tabs. Save a synthetic edit in the first and wait for saved; a stale edit in the second should fail rather than overwrite the first. Reload the second after recording/discarding its unsaved change. Check Console/Network for uncaught errors and missing assets in both builds. No Storage/Analytics/HealthKit/Tempdrop requests should originate from this implementation.

## Capacitor readiness and iOS risks

The repository is architecturally ready for a **separately authorized Capacitor packaging proof**, not an accepted native release. It already has `package.json`, independent `dist-mobile` assets, and root `index.html` with a head—the documented web packaging prerequisites. A future `webDir` would point to `dist-mobile`; the hosted Worker output is not the native entry. [Capacitor requirements](https://capacitorjs.com/docs/getting-started).

Remaining iOS acceptance risks (not proven blockers to creating a prototype):

- Validate Firebase email/password Auth and Firestore networking under the actual WKWebView origin/network/lifecycle. Memory-only credentials require re-sign-in after app termination. Any durable/native credential storage policy needs explicit privacy/security design and tests.
- Web background timers/audio, autoplay, notification permission, downloads/backups and storage lifetime are not native guarantees. Test suspension/resume, network transitions and process termination on devices. Device-local timer/quote state will have a new origin; no web-local migration is needed for the test/demo data, but its lifecycle must still be understood.
- Test touch scrolling, keyboard avoidance, safe-area/modal layout, gong playback and codecs on iOS; passing server rendering does not prove these.
- Confirm Mac/Xcode/SDK/signing/toolchain availability in the later native phase. This task did not install or inspect Xcode or create a native project. [Capacitor iOS setup](https://capacitorjs.com/docs/ios).
- Before distribution, review native privacy declarations, data retention/export/deletion UX, and release configuration/UID approval. Persistent offline health drafts/native health consent are not implemented.

No known web repository/build issue blocks a packaging proof. Browser acceptance and WKWebView/device tests still block claiming an iOS-ready release. No Capacitor dependency/configuration/project was added automatically.

## Every file changed in this phase

Modified:

- `app/YiApp.tsx` — signed-out gate, visible cloud status/errors, failed-edit protection, queued-save notifications.
- `src/services/cloud-session.ts` — cloud-primary policy, automatic UID repository selection, loading/saving state, permission errors, immediate sign-out invalidation, failed-write guard.
- `src/application/cloud-runtime.ts` — configured app selects cloud-primary startup; invalid enabled configuration fails closed.
- `src/application/CloudPanel.tsx` — normal cloud flow, explicit development fallback, pending/discard handling, clearer sign-in/status presentation.
- `src/adapters/firebase/client.ts` — recheck authenticated UID after transaction reads, before writes.
- `src/adapters/firebase/repository.ts` — remove obsolete migration-phase messages; retain bounded atomic writes and source privacy guards.
- `tests/cloud-repository.test.mjs` — all-domain CRUD, primary-mode lifecycle, account switching, permission denial, pending sign-out and reload/restart behavior.
- `tests/firestore-emulator.test.mjs` — real all-domain CRUD and cross-UID/anonymous rules assertions, automatic cloud sign-in/restoration.
- `tests/rendered-html.test.mjs` — hosted configured sign-in gate or disabled-Firebase local UI assertions.
- `docs/firebase-phase-3a.md` — mark the old local-first/migration-next plan superseded.

Added:

- `tests/helpers/cloud-crud.mjs` — shared synthetic CRUD/tombstone/recreation acceptance exercised in both adapter and emulator tests.
- `docs/cloud-primary-persistence.md` — this handoff/manual acceptance report.

Ignored generated output: hosted `dist`/`.vinext`, standalone `dist-mobile`, build caches and emulator logs. No dependency, rules, environment, schema or user-storage file was changed. No git reset/checkout/commit, external deployment, live upload, or live deletion was performed.
