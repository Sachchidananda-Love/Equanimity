# Two-account isolation audit and Tripple Gong — 2026-10-09

## Outcome and required changes

Cloud records, cached baselines, durable outboxes, imported-record persistence and private cloud settings are account-isolated in the tested architecture. Checked-in Firestore rules correctly reject cross-UID reads/writes; **no rules changes were necessary**. Ten focused regressions and a new two-user real Firebase SDK emulator test cover account changes, stalled writes, relaunch, private runtime state and HealthKit staging/authorization.

The audit found and fixed two application issues:

1. Active-practice recovery and quote rotation used device-global keys. Signing into B could therefore resume A's practice or inherit quote progress. Both now use project/UID-scoped keys and owner-checked envelopes. Signed-out cloud shells use only in-memory runtime state; they do not read old local checkpoints. Scheduling, timer UX, native gong playback and touch behavior are unchanged.
2. An explicit sign-in after selecting development/fallback mode retained the fallback-selection flag and did not automatically select the new cloud account. Explicit sign-in now returns to cloud mode; a passive auth-restoration callback still respects deliberate local-mode selection. No fallback data is imported or adopted.

Install this build before adding the second account. Finish/pause any active practice before upgrading: old global runtime checkpoints have no reliable owner, so they are preserved under the explicit local fallback, **not automatically assigned to A or B**. New scoped practices recover for their own UID as before.

## Guarantees and evidence

| Requested boundary | Implementation / verification |
| --- | --- |
| Cached cloud data | IndexedDB `equanimity-cloud-${projectId}`, `accounts` store keyed by UID; checkpoint `ownerUid` validated before restoration. Tests separate both UID and project and reject foreign envelopes. |
| Device/outbox writes | Same UID checkpoint contains the baseline, original revision and stable pending mutation IDs. A's pending queue remains retained while B uses its own queue. |
| Account switching | Account intent/generation invalidates old repositories and keyed views. A's records are removed even while B's load is stalled; a mounted test also verifies B cannot recover A's active practice. |
| Sign-out | Immediately closes the private view, disposes repositories/listeners and tombstones device cache access before awaiting Firebase. Stored caches/outboxes remain, but are not reopened for another user. |
| Reconnect/retry | Queue ownership does not change. Repository guards, actual Firebase UID checks and authorization repeated inside transaction callbacks block stale A operations under B. An in-flight switch test verifies no commit and retained A edits. |
| HealthKit persistence | Import service checks the selected UID/repository before and after asynchronous steps. Repository/transaction checks also require the real matching Firebase UID and that account's consent. A's query completion and staged retry cannot write to B. B's own explicit import saves only under B. |
| Private settings/preferences | Dashboard/cycle settings and preset collections live under `users/${uid}/...`. Health consent/pending import/last-import keys are UID-scoped on this device. Practice/quote state now uses `equanimity:runtime:${encodeURIComponent(project)}:${encodeURIComponent(uid)}:${legacyAuxiliaryKey}-v1`, with project and owner UID in the envelope. |
| Local fallback | Separate `yi-local-data-v1`/legacy storage, entered only through the explicit development/fallback action. Cloud selection/cache restoration never reads it, migrates it or uploads it. Scoped runtime keys are excluded from fallback's raw export. |
| Force-quit/relaunch | Pre-SDK bootstrap selects only the last locally granted UID, not every available cache. Grant is issued after verified auth and a usable durable baseline; explicit sign-out/switching revokes it first. B-only and signed-out relaunch tests pass. |
| A writes after B sign-in | Never rebased or redirected to B. A's retained queue may replay only after A explicitly authenticates again. Unit and actual Auth/Firestore emulator tests verify A then B then A, with independent records/settings. |

Server paths and document `ownerUid` are fixed to the repository's original owner. A write already committed before switching may still have completed **for A**; sign-out is not a rollback. Lost acknowledgements retain stable mutation IDs for the existing idempotent retry handling.

## Important limits before sharing a real device

- Give B a separate Firebase Auth UID and administrator approval (`privateAccess/{B_UID}.enabled = true`) through your normal administrative workflow. The app cannot self-approve or share A's approval. No real account was created or altered during this audit.
- Sign out before handing over an unlocked device. A person holding a still-signed-in session can naturally see that session's data.
- Offline bootstrap is trusted-device access to the **last granted account**, not a fresh server authentication claim. A known different UID closes the former view; an offline device cannot learn about remote revocation until auth/network restores.
- Sign-out hides records; it does not erase account caches, outboxes or retained owned runtime state. This audit is not a local-disk encryption/security assessment. App account isolation does not defend against someone with filesystem/debug access to the unlocked device. Use separate devices/OS security boundaries if that threat matters.
- **Apple Health is device-wide, not partitioned by Firebase UID.** Account-specific opt-in and destination guards cannot establish which human owns samples in that phone's Health store. On Tatiana's iPhone, B must leave HealthKit sync off unless its Health data is intentionally appropriate for B. Inspection is also an existing device-level development capability. Separate devices are needed for automatic personal-health separation; no account-scoping fix can turn one Health store into two people’s stores.
- **Explicit local development/fallback storage is also device-wide**, not private A/B storage. It never silently becomes cloud account data, but another device user can deliberately enter that mode. Keep private real-user records out of it. If local fallback must contain private real-user data on a shared installation, disable its production access or make it a separately authenticated/scoped feature before sharing; that broader workflow change was not made here.
- If durable sign-out revocation fails, the UI reports incomplete sign-out and closes the current view. Retry successfully before sharing/relaunching; no app can guarantee a next-launch tombstone when storage refuses the write.

The tests use checked-in rules and synthetic demo emulator accounts. Deployed production rules/administrator approval were **not** inspected or changed, so automated passing results are not a blanket certification of production configuration or physical-iPhone behavior.

## Audio change

Only `public/gong-sounds/tripple-gong.wav` was amplified: every signed PCM16 sample is exactly multiplied by 3 (+9.54 dB), without clipping. Peak changes from 1538 to 4614 out of 32768. Duration, format, metadata and silence are unchanged. The other three WAVs are byte-identical to their previous versions.

The native/browser player still uses the existing 0.82 playback setting; no WKWebView audio path was added. The asset change therefore applies consistently to both players. Perceived loudness depends on the device/output, so “3x” here is exact signal amplitude, not a promise of subjective loudness. Start with a comfortable system volume when testing.

`scripts/amplify-tripple-gong.mjs` reproduces the mechanical asset edit, validates the original hash/headroom and detects an already-amplified file so it cannot accidentally amplify twice. The regression test divides every new sample by three and verifies the complete original WAV hash, plus hashes of all other gongs.

## Physical-iPhone acceptance

1. Install the prepared build through Xcode without uninstalling/clearing storage, between practice sessions. In Practice, try Tripple Gong at a comfortable fixed system volume, then Gongs 1–3. Only Tripple should be louder; Start/Try/Finish must remain responsive.
2. Sign into approved A online and load the account. Create a uniquely named synthetic journal entry `ISOLATION A <time>` and note A's private presets/layout. Go offline, create another synthetic entry and wait for pending status without a checkpoint error. Force-quit/reopen: only A's data should restore.
3. Start an A practice, then sign out. A's journal/cycle/preset data and active timer must disappear from the visible app. Reopen offline while signed out: neither account's private data/timer may appear. Pause/complete tests normally afterward when returning to A.
4. Reconnect and sign into approved B. A's records/presets/active practice must not appear while B loads or afterward. B's HealthKit consent must default off unless independently previously enabled for B. Do not import Tatiana's Health records into a different person's account just to test.
5. Create `ISOLATION B <time>`, repeat network recovery/foreground transitions, and verify only B's new entry syncs. Force-quit/reopen offline: only B's cached data/state should restore.
6. Sign out B and return to A online. A's retained pending journal edit should sync once to A, not B. Return to B and verify its data is unchanged and contains neither A entry. Delete only the synthetic entries through the normal UI if desired.

## Validation and changed files

Passed: 156 application tests (including 10 focused isolation tests and the audio-amplitude test); 5 Firebase Auth/Firestore emulator tests; 6 standalone tests; 5 iOS shell tests; lint; standalone TypeScript; `ios:prepare`; unsigned generic-iPhone Debug compile. No live cloud writes, deployment or physical phone installation was performed.

- `public/gong-sounds/tripple-gong.wav`, `scripts/amplify-tripple-gong.mjs`, `tests/gong-player.test.mjs`: isolated amplitude change and verification.
- `src/adapters/local/repository.ts`, `src/services/repository-contracts.ts`: scoped private runtime persistence, closed signed-out state, owner validation.
- `app/YiApp.tsx`, `src/application/cloud-runtime.ts`: propagate the stable project/UID runtime scope without changing visuals/scheduling.
- `src/services/cloud-session.ts`: explicit sign-in exits fallback selection.
- `tests/multi-user-isolation.test.mjs`, `tests/firestore-emulator.test.mjs`, `package.json`: focused/suite and two-account SDK integration coverage.
- This report.

Firestore rules, HealthKit import policy/logic, Tempdrop calculations and slider styling/gesture code are unchanged.
