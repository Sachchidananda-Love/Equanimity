# Phase 3A: optional private Firebase persistence

Historical Phase 3A report. The subsequent [cloud-primary persistence phase](./cloud-primary-persistence.md) supersedes the local-first startup/selection behavior and the proposed migration next step below. Existing local data is test/demo-only; **no production local-to-cloud migration is planned or implemented**. Console configuration and the UID-owned schema/rules remain applicable.

Only Authentication and Firestore are implemented. No live Firebase project was configured, no rules were deployed, and no personal browser storage was inspected or uploaded. Existing uncommitted work was preserved. Phase 3B, native packaging, HealthKit, Tempdrop, Storage, and Analytics are not implemented.

## Manual Firebase Console setup — required before enabling cloud

1. Open Firebase Console and create or select a project. For a new project, leave Google Analytics disabled. Prefer a separate test project first; do not experiment with health records in production.
2. Project settings → General → Your apps → Add app → Web (`</>`). Give it a nickname. Firebase Hosting is not required: the existing hosted and standalone builds remain the delivery paths.
3. Copy these four values from the web app configuration: `apiKey`, `authDomain`, `projectId`, and `appId`. Do not supply service-account credentials, private keys, or administrator tokens. `storageBucket`, `measurementId`, and `messagingSenderId` are not required by this implementation.
4. Build → Authentication → Get started → Sign-in method → Email/Password: enable Email/Password, not email-link authentication. Leave other providers disabled initially.
5. Authentication → Users → Add user: create the initial Yi email/password account manually. Use a unique password; copy its Firebase **UID**. Create a separate throwaway account for testing. The email is only a login/display value, never a database owner key. [Firebase user management](https://firebase.google.com/docs/auth/web/manage-users).
6. Authentication → Settings → Authorized domains: ensure the deployed hostname is listed. For local tests explicitly add `localhost` and/or `127.0.0.1` as used. Newly created projects may not include localhost. Do not whitelist unrelated domains. [Email/password setup](https://firebase.google.com/docs/auth/web/password-auth).
7. Build → Firestore Database → Create database: use the default `(default)` database, Standard/native Firestore, and production/locked rules initially.
8. **STOP at the location choice.** Firestore location cannot be changed after provisioning. Choose based on data residency/privacy obligations, latency, availability, and cost. This code does not assume Toronto or any other region. If uncertain, stop before creating the database; no region was chosen by this task. Confirm any pricing/billing requirements in Console before accepting them. [Firestore locations](https://firebase.google.com/docs/firestore/locations).
9. Deploy the entire checked-in `firestore.rules`, not an open-access sample. Either paste it into Firestore → Rules → Publish, or review the target project and run `npx firebase login`, then `npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`. This deployment is a manual step, not something this task performed. Do not run `firebase init` over the existing configuration or deploy unrelated services.
10. Firestore → Data → Start collection: create `privateAccess`, document ID equal to the initial account's exact UID, field `enabled` of type **boolean**, value `true`. Add the throwaway test UID separately. Never use an email as the document ID. These administrator-managed documents contain no health values. Clients cannot read/write the allowlist or grant themselves access. Disable access by setting `enabled` to false; account disabling/revocation should also be managed in Authentication when appropriate.
11. Test rules locally with the emulator command below before allowing real data. In Console Rules Playground, verify an approved UID can read its own path while anonymous, unapproved, and another UID cannot. No composite indexes are currently required; queries list individual collections.

Hiding signup is not security: Firebase's public Auth API can create accounts when Email/Password is enabled. This implementation denies Firestore access to all accounts without an administrator-created `privateAccess/{uid}` approval. If preventing even unapproved Auth account creation becomes a requirement, server/Identity Platform registration controls are additional work; no client-only claim is made that account creation is impossible.

## Environment values and both builds

Create an ignored root `.env.local` by copying the example's contents and filling in your own web configuration. Do not commit it. Leave cloud disabled until rules and UID approval are ready.

| Variable | Value and use |
| --- | --- |
| `VITE_FIREBASE_ENABLED` | `true` enables the sign-in option; default `false` keeps the app local-only. |
| `VITE_FIREBASE_API_KEY` | Web configuration `apiKey`; Firebase client initialization. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Web configuration `authDomain`; Auth client initialization. |
| `VITE_FIREBASE_PROJECT_ID` | Web configuration `projectId`; identifies the Firestore/Auth project. |
| `VITE_FIREBASE_APP_ID` | Web configuration `appId`; identifies the registered web app. |
| `VITE_FIREBASE_USE_EMULATORS` | Default `false`. Set `true` only with a `demo-` project ID; targets loopback Auth 9099 and Firestore 8080, never production. |

All six are read in `src/adapters/firebase/config.ts`; the four web values are used by `src/adapters/firebase/client.ts`. Both builds use Vite's `import.meta.env`: the hosted root `vite.config.ts` uses the root environment directory, and `mobile-web/vite.config.ts` explicitly uses that same root. Do not put a separate conflicting configuration in `mobile-web/.env*`. Hosted deployment must supply these public values at **build time**, not just Worker runtime bindings; the standalone production bundle also embeds them at build time. Restart development servers and rebuild/redeploy both outputs after changes. Existing configuration with cloud disabled remains valid.

The Firebase web configuration is visible in browser bundles by design; security comes from Authentication, UID approval, and Rules, not hiding these values. Do not use `VITE_` for any private secret. Missing/placeholder configuration disables usable sign-in without printing the configuration. SDK initialization is lazy on Sign in, not page load. [Firebase web configuration](https://firebase.google.com/docs/projects/api-keys).

## Repository and authentication flow

The UI calls the application/session boundary and common `DataRepository` contract. Only the Firebase adapter imports Firebase SDK calls. The Phase 1 synchronous `ApplicationRepository` extends that contract with device-local backup, review, active-timer, and quote functions; it remains synchronous for existing callers. The cloud adapter implements the common async-capable data contract, not device-only browser functions. Domain calculations have no SDK dependency.

At startup the selected repository is **local**, even when Firebase is configured. The small collapsed **Account & data** footer shows authentication and save states. Sign in transitions unauthenticated → authenticating → authenticated, or authentication-error. A successful sign-in alone performs no Firestore dataset load/write and no local import. Choose **Use cloud data (no import)** to mount a separate UID-owned view. Editing stays disabled until its validated server load succeeds. An empty cloud account has empty real journal/health/cycle histories plus ordinary default configuration and bundled assets. Defaults are not silently saved on load; editing a preset explicitly stores that configuration.

Cloud edits write only to that cloud repository. **Use local data** switches back to the unchanged local dataset, not a synchronized copy. Sign out clears the active cloud view and returns to local mode. Account UID changes invalidate old repository references and clear the cloud view. Pending operations must finish before manual switching/reloading/sign-out. Failed cloud changes require an explicit discard confirmation before switching or reloading; no hidden fallback uploads/downloads occur. Local mode remains available when Firebase is disabled/unavailable.

Authentication uses **memory-only persistence**; refreshing or closing the page requires another sign-in, and reopening always starts in local mode. There is no signup, password-reset, social-login, email-verification, or multi-device sync UI yet. Accounts/passwords can be administered in Console. [Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

The backup/review UI stays local-only. Active practice deadlines and quote rotation stay device-local in both modes. Switching the keyed view closes open dialogs and resets screen/modal UI state; active practice deadlines reload from the existing device adapter. Practice journal records use the currently selected dataset. No main screen or card styling was redesigned.

## Firestore document structure

```text
privateAccess/{uid}                  administrator approval, never client-writable
users/{uid}/
  settings/repository               optimistic revision for atomic writes
  settings/cycle                    cycle configuration, no history array
  settings/dashboard                widget arrangement (small configuration array)
  journalEntries/{encodedId}         one journal record
  timerPresets/{encodedId}           one preset
  activityPresets/{encodedId}        one preset
  books/{encodedId}                  one book
  cycleEvents/{encodedId}            one explicit cycle day/event
  healthRecords/{encodedId}          one normalized source observation
```

There is no major array stored on `users/{uid}` and no parent user document is required. `dailyHealth`, `importBatches`, and `migrations` are reserved for later phases and currently denied by Rules, not populated. Domain summaries remain app-derived estimates; they are not treated as imported measurements or conflated with `healthRecords`.

Each client document is an envelope `{ schemaVersion: 1, ownerUid: uid, record: {...}, deleted: false }`. Health `record` preserves its own schema, stable ID, metric, typed value/unit, local date/timezone, timestamps, status/confidence, and provenance (provider separate from ingestion, original source ID/app/device/batch/method when available). Unrecorded fields stay absent; explicit none, zero, false, and empty lists retain their meanings.

Document IDs use `s-` plus URI-encoded string IDs, or `n-` plus an encoded numeric ID. Original IDs/types remain inside the record. New UI records keep Phase 1 string IDs. This is not a legacy migration. Collection query order is normalized to journal creation chronology and cycle calendar date, rather than arbitrary encoded IDs.

Writes are validated and diffed after a successful validated load. Deletes create tombstones retaining the old record; Rules deny client physical deletes. Health source tombstones also preserve the existing normalized record's status semantics. A transaction checks/increments `settings/repository` and writes the changed documents together. Conflicting sessions fail rather than overwriting each other; there are no live listeners or automatic merges. Loads check revision before/after collection reads. Transfers over 400 changed documents are rejected for a future verified migration, not automatically chunked/uploaded.

Known demo fixtures/unverified cycle history and raw CSV, device permission state, query anchors, or raw import payload fields are rejected before writing. Only current manual entry is integrated. Runtime parsing protects against malformed/version-incompatible documents and disables editing rather than replacing them. Rules enforce ownership/envelope shape; richer semantic validation is in the adapter and is not a substitute for a future trusted import validator. No health-value analytics or third-party telemetry was added.

## Rules and offline behavior

Rules require all three: authenticated Firebase UID, exact matching `users/{uid}` path, and administrator approval. Only the seven implemented collections are accessible. Envelope owner/schema/shape checks apply to writes; all other paths, client grants, and physical deletes are denied. A second approved user still cannot access the first user's records. Administrator Console/Admin SDK privileges are outside client Rules; protect project IAM accordingly.

Firestore uses memory cache, **not persistent IndexedDB health caching**. Loads explicitly request the server. Writes use online transactions, not an offline durable queue. This conservative choice avoids storing authenticated cloud health data durably on shared devices. [Firestore cache behavior](https://firebase.google.com/docs/firestore/manage-data/enable-offline).

Save states are `local-only`, `pending`, `synced`, and `failed`. Pending includes cloud loads/writes. Synced means the load/write was acknowledged, not continuous multi-device sync. Offline load failures leave editing disabled. A failed edit stays only in the current view and is neither copied to local storage nor durably queued; further queued writes do not automatically retry after failure. Keep the view open to recover the values manually, then explicitly reload before retrying. Refresh/discard loses unsaved cloud edits. SDK reads can wait for connectivity before failing, so pending is not a promised short timeout. Local mode retains its existing offline behavior; there is no service worker or second sync engine.

## Automated verification

Final results: `npm test` passes 33 tests (including the hosted production build); `npm run test:standalone` passes all 6 tests and its production build; both real emulator tests pass, including synthetic health none/zero/provenance and tombstones. Lint and standalone TypeScript pass. `npm audit --omit=dev` reports zero vulnerabilities. Both builds were additionally compiled with synthetic public configuration: its presence in both client outputs and the enabled sign-in SSR markup were verified without SDK initialization. The outputs were then rebuilt with the default disabled configuration. No live Firebase connection was used for verification.

```sh
npm ci
npm test
npm run lint
npm run typecheck:standalone
npm run test:standalone
npm run test:firebase-emulators
```

The emulator command requires Java 21+ on PATH and uses only `demo-yi-phase3a`, loopback Auth/Firestore, and synthetic records. It requires no live project or Console credentials; initial emulator downloads require internet. It tests actual email/password sign-in/failure/sign-out, real repository round-trip, anonymous/unapproved denial, approved own access, second-user read/list/write denial, forbidden grants/deletes, and reserved paths. The REST signup in the emulator test is **test fixture provisioning only**, not application registration. [Rules unit testing](https://firebase.google.com/docs/rules/unit-tests).

`npm test` includes the original 21 tests plus cloud/session tests. Existing standalone tests also check all shared major screens, root/nested static assets/media, and server-only dependency exclusions. Tests never open personal browser storage. Both running development entries and the compiled static server were checked over local HTTP. Browser discovery returned no available connection: interactive sign-in, actual browser local records, console errors, media, and offline UI must still be manually accepted. Server-render tests are not claimed as browser interaction tests.

The Firebase SDK is a lazy separate chunk; production emits a >500 kB chunk warning, not a failed build. A targeted `@firebase/firestore` → `@grpc/grpc-js` 1.14.5 override replaces its older vulnerable same-major dependency; emulator tests are rerun against it. Runtime-only audit is clean. Development-tool advisories and a firebase-tools transitive superstatic warning on this machine's Node 25 remain; prefer supported Node 22/24 and review development dependencies separately instead of applying broad breaking audit fixes. Whole-repository TypeScript's earlier Cloudflare type issues are not part of this phase; standalone TypeScript is checked.

## Exact throwaway/manual acceptance test

1. Before configuration, at your **existing browser profile and original origin**, expand **Data backup & review** and export a backup. Store it privately; it contains personal data. Do not clear storage, change origin/port, or import anything. Note a couple of existing entry IDs/dates and cycle observations. Existing legacy keys and `yi-original-backup-v1` must remain intact; the Phase 0/1 guide documents raw-byte checks.
2. Configure a **test Firebase project** and approved throwaway account using the steps above, then set the environment and rebuild. Run `npm run dev` for hosted (`http://localhost:3000/`), or `npm run dev:standalone` (`http://127.0.0.1:5174/`). Production standalone: `npm run build:standalone`, `npm run serve:standalone`, open `http://127.0.0.1:4174/`. Different hosts/ports have separate local storage; empty history at a new origin is expected and does not mean old records disappeared.
3. Open **Account & data**. Confirm local-only and your local history on its original origin. Use an incorrect password: verify authentication-error, local data still accessible, and no new user records in Firestore. Then sign in correctly: authenticated, still local-only, no local upload and no Firestore dataset writes.
4. Choose **Use cloud data (no import)**. Confirm empty real cloud journal/cycle/health history for a fresh account; default presets/content are configuration, not imported local history. Existing local records must not appear in this cloud view.
5. Add a journal entry named `PHASE3A THROWAWAY — NO PERSONAL DATA`, with a synthetic note. Wait for pending → synced. Console should show exactly its envelope under `users/THROWAWAY_UID/journalEntries/s-...` plus revision metadata, not a user-document array or local history upload. Add one synthetic cycle field with explicit none/zero if desired; verify source observations under `healthRecords`, provenance ingestion manual, with no CSV/permission/anchor fields.
6. Choose **Reload cloud data** and verify the test record remains. Sign out: local-only, original local history visible. Refresh: unauthenticated/local-only. Sign in again and explicitly choose cloud to reload the throwaway dataset.
7. Export the local backup again while in local mode. Compare the exact legacy strings under `records` and `records["yi-original-backup-v1"]` against the pre-test export; Phase 3A sign-in/cloud edits must not alter them. Ignore the export's new `exportedAt` timestamp. The existing Phase 1 adapter can create/maintain its already-established versioned envelope on normal first local load; this phase adds no new local migration or replacement. Device timer/quote state may legitimately change through normal usage, so compare those separately from journal/cycle/health.
8. Approve a second throwaway UID. Run emulator security tests; additionally use Rules Playground with that UID against the first UID's journal path to verify read/write denial. An unapproved Auth account must fail cloud load, stay unable to edit, and never receive automatic local fallback data.
9. With the first account's cloud data loaded, turn Network Offline and make a synthetic edit. Observe pending then failed (or pending until connectivity resolves); no local copy or false synced status. Restore online, keep note of the unsaved value, explicitly reload/discard and retry. In two sessions load the same snapshot, edit one and wait for synced; the stale second edit should fail/conflict and require reload, not overwrite the first.
10. Delete only your throwaway entry through the app and verify its envelope becomes `deleted: true`; reloading hides it without physically deleting it. Never use bulk deletion or production health records for testing. Use local mode to confirm original entries still work. Check Insights, Practice, Journal, cycle logging, presets, books, backup, and gong previews in both builds.

No exact observation about *your particular browser's data* is claimed without that manual comparison. What is confirmed by code/tests: the cloud session has no local-repository input; it cannot read/import browser records; keyed cloud views load only the cloud adapter; test local raw bytes are unchanged through sign-in, cloud edits, account switches, and sign-out; no live upload/deletion was performed.

## Phase 3B next — planning only

Add an explicit, consented migration preview using private backup/export as its source. Resolve sample/legacy provenance ambiguity, preserve source IDs and numeric IDs, map sources to UID without email ownership, define conflict/deduplication policy, and create resumable import/migration manifests with verified counts/hashes. Make migration idempotent, batch safely, verify read-back before reporting success, and keep original browser data/backups until separately authorized deletion. Consider durable sync/offline policy and cloud backup/export as distinct work. Nothing here begins that migration or grants future health-import consent.

## Every Phase 3A source/configuration file

Modified (earlier edits in these files were retained):

- `.gitignore` — allow the non-secret example; ignore emulator logs.
- `package.json` — SDK/testing dependencies, cloud/emulator test commands, default cloud test inclusion, targeted gRPC override.
- `package-lock.json` — resolved dependencies.
- `app/YiApp.tsx` — selected repository/keyed view, loading protection, minimal account/status footer.
- `mobile-web/vite.config.ts` — share root build-time environment configuration.
- `src/services/repository-contracts.ts` — common async-capable data contract with the synchronous device contract preserved.
- `src/application/use-app-data.ts` — explicit repository hydration, async saves, no cross-repository fallback.
- `tests/typescript-loader.mjs` — preserve TS versus TSX parsing using the source filename.

Added:

- `.env.example`
- `firebase.json`
- `firestore.rules`
- `src/adapters/firebase/config.ts`
- `src/adapters/firebase/client.ts`
- `src/adapters/firebase/repository.ts`
- `src/services/cloud-session.ts`
- `src/application/cloud-runtime.ts`
- `src/application/CloudPanel.tsx`
- `tests/cloud-repository.test.mjs`
- `tests/firestore-emulator.test.mjs`
- `docs/firebase-phase-3a.md`

Generated/ignored: dependency install output, hosted `dist`/`.vinext`, standalone `dist-mobile`, Vite caches, and emulator logs. Temporary Java/emulator binaries are in a task-specific `/private/tmp` directory, not a system Java installation. Phase 0/1/2 work, prior styling/assets, and unrelated changes remain preserved. No commit, reset, checkout, live deployment, or Firebase Console mutation was performed.
