# Native iOS Practice Lock Screen support

## Finishing a foreground gong after lock/background — October 10, 2026

Physical-device interval/final notifications and Live Activity now work. The remaining opening-gong cutoff occurred because the native player used `.playback` but the main app had no `UIBackgroundModes: audio`. Apple's [playback configuration](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback) requires the audio background mode for lock/background continuation. The main app now declares **only audio**, to finish finite bundled audio already initiated by user/foreground playback. The opening gong is not converted to a notification; no gong asset, timer deadline, notification schedule or Live Activity was changed.

The existing off-main AVAudioPlayer path retains the selected original file, `.mixWithOthers`, media volume and player volume 0.82. It plays once (`numberOfLoops = 0`), without restart on lock/resume. Completion, decoding error, failed start and initialization failure stop/release the active player/delegate and deactivate the audio session with `.notifyOthersOnDeactivation`. Replacement playback remains supported; a per-playback delegate/token prevents a late older completion from shutting down the new gong. Audio interruption ends the current gong without automatic replay/resume. There is one interruption observer, no polling, no silence loop, no background task extension and no remote-control/Now Playing machinery. Cached decoded players are idle after completion; the app does not hold an audio session active to keep the timer running. iOS owns subsequent notification audio and may suspend the app once the finite playback finishes.

Ring/Silent: `.playback` was already the player's category, so this does not change foreground Silent-mode behavior. Native opening/preview audio can play in Silent mode and follows media volume/output routing; notification interval/final sounds still obey notification/alert volume, Silent, Focus and iOS routing. Background audio does not grant Critical Alerts or change notification authorization. Calls/Siri/audio interruptions, force quit and device power-off can still stop an opening gong.

Physical verification (automated source checks/builds cannot prove lock-screen playback):

1. Install updated Debug build; use a session long enough that opening audio finishes before its next interval. Start each opening selection while leaving app open; confirm its sound/volume is unchanged.
2. Start again and lock halfway through Gong 1 (about 12 seconds), then Gong 2 (about 26 seconds of its original 52-second foreground file), Gong 3 and Tripple Gong. Each should finish its existing tail, not restart, and show one `gong finished; audio session deactivated` Debug log.
3. Repeat by pressing Home/swiping to another app halfway through playback. Return after completion: no replay.
4. Leave locked until an interval and closing gong: each notification should sound exactly once; Live Activity remains unchanged.
5. After the opening tail ends, inspect the Xcode audio-session completion log and device Energy/background activity: no continuous app-owned audio or repeated playback. Playback/decode failure and interruption should also release the session, with no resume loop. A deactivation failure logs a fixed Debug warning without retrying indefinitely.

## Physical-device notification diagnosis — October 10, 2026

### Explicit active interruption level

Latest physical report: default control, custom control and real Practice all show visible alerts but are silent. Both content builders now explicitly assign `content.interruptionLevel = .active` without altering `content.sound`, trigger dates, assets, delegate presentation, permissions or Live Activity. Reconciliation rejects non-active pending Practice content and rebuilds it using the same ID/deadline.

Previous code assigned **no interruption level**: both builders used fresh `UNMutableNotificationContent`, not a copied template, and no application helper assigned `.passive`. Before this edit a local macOS UserNotifications runtime probe reported fresh content as `.active`, raw value `1`; existing native request tests also passed `.active` assertions. These observations do not establish the value of old physical-iPhone pending/delivered requests. New content explicitly uses `.active` (`1`). No claim of a verified passive-to-active device transition or fixed audio is made.

Debug readouts show the actual `request.content.interruptionLevel.rawValue` as a named value for both pending controls/Practice and delivered notifications (`active (1)`, `passive (0)`, or another/unknown value), rather than assuming the configured value. After installing, start a fresh Practice and fresh controls; Refresh before locking and after delivery to compare their actual values. Apple documents active as permitting sound and passive as not playing sound: [interruption levels](https://developer.apple.com/documentation/UserNotifications/UNNotificationInterruptionLevel). Active is not a guarantee that audio was audible on a particular device.

### Follow-up: minimal custom control audible; real Practice visible but silent

Physical evidence now confirms that the minimal custom Gong 1 control is audible while locked, and real Practice banners appear but are silent. The following is the source comparison **before** the shared-construction change:

| Field/path | Working custom control | Real Practice |
| --- | --- | --- |
| `sound` | `UNNotificationSound(named: UNNotificationSoundName("equanimity-gong-1.wav"))` | Same initializer, filename from `PracticePlan.notificationSounds`; Gong 1 resolves to exactly `equanimity-gong-1.wav` |
| Title/body | Equanimity notification control / This test should be visible and audible. | Equanimity · Practice / Practice gong. or Your practice has finished. |
| Category | Empty/default | Empty/default |
| Thread | Empty/default | `equanimity.practice` |
| Interruption level | Default `.active` | Default `.active` |
| Relevance score | Default 0, not assigned | Default 0, not assigned |
| `userInfo` | Empty | Generic session UUID, original gong file, mapped sound filename, epoch `at`, final/test booleans |
| Trigger | Nonrepeating 10-second interval | Nonrepeating Gregorian UTC calendar date at `ceil(at/1000)` |
| Identifier | `equanimity.notification-control.<UUID>` | `equanimity.practice.<session>.gong.<offset>` |
| Lifecycle/cleanup | No Practice cleanup or plan ownership | Session-scoped cancel; expired-session cleanup on foreground, no background cleanup |
| Delegate | Foreground banner/list/sound | Active matching session: foreground audio + no OS presentation; inactive matching session: banner/sound; unmatched: none. Suspended background delivery is OS-owned. |
| Mutation/rescheduling | Content copied into request, never changed | Content copied into request, never changed. Reconciliation may replace a stable ID via the same full builder; no replacement builder omits sound. |

The initializer and exact Gong 1 asset were already identical: the repository does **not** establish an exact device-side root cause for silence. The real request does not select `.default`, assign `nil`, omit the extension or use an alternate Gong 1 asset. Thread/trigger/userInfo differ, but none is proven causal by current evidence. Removing them or changing timing/delegate behavior would be speculative.

Both custom control and Practice now call `PracticeNotificationRequest.customSound(filename:)`, which exclusively returns `UNNotificationSound(named: UNNotificationSoundName(filename))`. Selected interval/final/triple mappings are preserved. One concrete reconciliation defect is repaired: previously a pending request with matching ID/date/original file was reused even with missing sound or missing/wrong sound filename metadata. `canReuse` now rejects those requests, replacing only invalid pending entries with the same ID and original trigger date through the full builder. This is a verified validation gap, **not a confirmed explanation of the user's silent, sound-populated notification**.

Pending and delivered Debug evidence separately shows sound populated, mapped filename, `userInfo` filename, trigger subclass, category, thread, interruption level and relevance score. `practiceScheduled` traces identify the construction path and filename. Filenames are public construction metadata, not an introspection of the opaque `UNNotificationSound` object's private properties; no private API is used. Existing presentation/removal traces remain available.

Verification: install updated Debug, reset any old Practice session and start a fresh short timer with **Closing gong: Gong 1**. Before locking, confirm both filename fields are `equanimity-gong-1.wav`, sound populated yes, category none, thread `equanimity.practice`, calendar trigger, active level 1, relevance 0. Lock well before the deadline; note the banner and sound. Return without dismissing and capture delivered fields plus trace. Repeat an interval gong and a separately selected closing gong. Compare with the working minimal Gong 1 control in the same device state. Do not call the real Practice audio fixed until it is physically audible.

### Follow-up: delivered by iOS, but no visible/audible presentation

The subsequent physical-iPhone evidence **does** establish that the exact test and real Practice IDs leave pending and enter `getDeliveredNotifications()`, with enabled authorization/sound/alerts/Lock Screen, populated sound and valid bundled WAVs. The user reports neither visible alerts nor sound. This is not a scheduling failure; the presentation cause is still unconfirmed.

Audit: no notification categories or notification-content extensions are registered by this app. Practice content has a visible generic title/body, an empty category, the `equanimity.practice` thread, default active interruption level and a custom sound. `willPresent` deliberately returns no options for active matching Practice (foreground AVAudio playback instead) and for unmatched Practice sessions. Debug gong tests bypass these branches and return banner/sound. Inactive matching Practice returns banner/sound. These existing options are unchanged. Apple states `willPresent` is not called for background/non-running delivery: [Apple notification handling](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/SchedulingandHandlingLocalNotifications.html). An empty foreground completion can suppress presentation; it is not proof of suppression while locked. Missing `.list` in those foreground paths is not an explanation for genuinely suspended background delivery.

All app removal calls are now Debug-traced with IDs, times, application state and reason, without changing their targets. Sync removes obsolete pending requests, scheduling failure removes that session's partial schedule, and cancel removes only its session's pending/delivered requests. Foreground reconciliation can remove expired Practice alerts after returning to the app; background handling does not remove alerts. Neither cleanup nor session matching can target the isolated `equanimity.notification-control.*` IDs. The bounded, in-memory trace also records entry/completion of `willPresent` and exact banner/list/sound flags. No trace while suspended is normal, not missing proof of OS delivery.

Two **Debug-only** controls directly use `UNMutableNotificationContent`, identical visible title/body, unique IDs and a 10-second nonrepeating time-interval trigger. One uses `UNNotificationSound.default`; the other uses `equanimity-gong-1.wav`. They use no Practice builder, category, thread, userInfo, session projection, audio player or cleanup. If foregrounded, only these controls request `.banner`, `.list`, `.sound`; background presentation remains entirely OS-owned. Their intended trigger, content presence, empty category/thread and interruption level appear beside pending/delivered evidence. The UI is absent in Release; native control methods are compiled out.

Test each separately in the updated Debug build: open the developer panel, tap **Test minimal notification: default sound (10 seconds)**, immediately lock and wait 15 seconds. Record visible alert and sound separately; do not dismiss the alert. Unlock normally, Refresh, and capture the trace and pre-cleanup foreground evidence. Repeat with **Test minimal notification: Gong 1 (10 seconds)**, then the existing Practice gong test. Use Ring mode, audible alert volume, Focus off; if an Apple Watch is paired, power it off for this control to exclude routing. Apple documents alerts may go to Watch rather than the locked phone: [Apple Watch notification routing](https://support.apple.com/en-ie/108369). Public notification settings do not expose all Focus/routing decisions; a delivered-list entry alone does not certify audible/visible presentation.

Interpretation: default fails too → basic OS presentation/routing or observed foreground suppression; default works but identical custom fails → custom-sound path; both controls work but Practice fails → compare Practice trace/content and lifecycle removal. A `willPresent` completion with false sound/banner/list identifies app suppression, and a removal event identifies app cleanup. Delivered controls with no such callbacks/removals rule out these app-owned suppression paths, but do not identify Apple's internal presentation decision. **Not fixed until physical locked-phone controls are visibly delivered and audible.**

Earlier snapshot investigation (before the new delivered evidence):

The supplied iPhone screenshots show `authorized`, Sounds/Alerts/Lock Screen `enabled`, scheduled summary `disabled`, delegate installed, one accepted Debug test request, populated sound, and the matching Gong 1 bundle file validated as 24.143-second PCM WAV. They do **not** establish delivery or survival after locking: the 9:09 screenshot still displays a 9:06 trigger from an earlier diagnostic snapshot. The actual device-side cause remains unconfirmed. Do not assume the prior lack of notification permission still explains the current failure.

The Debug-only panel now opens visibly, labels every requested field explicitly, and has **Test gong in 10 seconds**. It refreshes when visible/returning from lock, with a manual Refresh button retained. The test and real Practice notifications still share `addGong` → `PracticeNotificationRequest.make`; no trigger, sound, permission, timer or Live Activity behavior was changed for this diagnostic update.

Native Debug diagnostics additionally retain in-memory snapshots at the background transition and on foreground before normal delivered-notification cleanup. Each snapshot contains timestamps, settings, pending request IDs/times/sounds/bundle validation and OS-delivered notification IDs/dates. These are generic timer diagnostics, not private record contents. They are absent in Release and are not uploaded or persisted. A background-transition snapshot is **not** continuous monitoring of a suspended process. OS-delivered evidence does not prove audible sound, and an absent delivered notification does not prove nondelivery if the user already dismissed/tapped it.

Device procedure:

1. Install/run the updated **Debug** app. Open Practice → Gongs → Developer: Lock Screen gong diagnostics. Use Refresh; capture the current state. Confirm `authorized`, `soundSetting: enabled`, `lockScreenSetting: enabled`; Ring on, Focus off and audible alert volume.
2. Select Gong 1, tap **Test gong in 10 seconds**, and confirm one new `equanimity.practice-test.*` request with the expected date/time and `yes` for populated sound, Bundle.main existence and validity. The test does not replace/start a Practice timer.
3. Lock immediately; wait 15 seconds. Note separately whether an Equanimity banner appears and whether the sound is audible. Do not dismiss/tap the notification.
4. Unlock normally, return to Practice and Refresh. Capture **Current device state**, **Last background/lock transition**, and **Last return to foreground (before alert cleanup)**. Compare the *same* test identifier across snapshots and delivered evidence.
5. If the test works, repeat while a real Practice with an upcoming interval is running and compare its `equanimity.practice.<session>.gong.<offset>` IDs. If the test fails, report its evidence before changing timer/lifecycle architecture or adding a different delivery mechanism.

No connected device was presumed to be the failing device: Tatiana's paired iPhone 13 mini was unavailable; a different iPhone 13 Pro was connected. No app/device reinstall, private-data inspection or on-device result is claimed here. The four focused diagnostic/audio tests, standalone TypeScript, lint, native request/trigger tests, `ios:prepare` and unsigned iPhone builds are checked separately from physical delivery.

Implemented October 9, 2026. Physical-iPhone verification is still required; compilation and automated tests do not establish audible delivery on a particular device.

## Behavior and scope

Timed Practice sessions project their existing deadline/configuration into native local notifications and an ActivityKit Live Activity. Stopwatch timing, cloud recovery, slider handling, HealthKit, Tempdrop and cycle calculations are unchanged. The native gong player can finish existing foreground playback after lock, as described above. No Firebase service, remote push, silent keepalive, Critical Alerts entitlement, App Group or second timer engine was added.

The existing UID/project-scoped web checkpoint now includes a stable session ID. Native code receives the canonical start/end timestamps, generic title `Practice`, and every configured future event. It does not receive an account ID, private preset name, journal text or health data.

### Notification permission

Practice → Gongs has an iOS-only explanation and **Enable Lock Screen gongs** button. Only this explicit action requests native alert/sound permission. Launching or pressing Start does not prompt on iOS. Denial and disabled Sounds/Live Activities show explanatory text; foreground Practice remains usable. Browser behavior remains its existing notification flow.

Notification permission and iOS Live Activities authorization are independent. A Live Activity can still work when notifications are denied. Notifications do not require network access.

## Sounds and explicit mapping

All notification files are mono, 44,100 Hz, 16-bit linear PCM WAV, bundled in the main app's resource root. All are strictly shorter than 30 seconds, as required by [Apple's notification sound documentation](https://developer.apple.com/documentation/usernotifications/unnotificationsound).

| Practice selection | Original foreground file | Native notification file | Notification duration |
| --- | --- | --- | --- |
| Gong 1 | `public/gong-sounds/gong-1.wav` | `equanimity-gong-1.wav` | 24.143356 s |
| Gong 2 | `public/gong-sounds/gong-2.wav` | `equanimity-gong-2.wav` | 29.000000 s |
| Gong 3 | `public/gong-sounds/gong-3.wav` | `equanimity-gong-3.wav` | 6.299274 s |
| Tripple Gong | `public/gong-sounds/tripple-gong.wav` | `equanimity-tripple-gong.wav` | 16.574853 s |

Gong 2's original is approximately 52.31 seconds. Only its notification copy is shortened: the first 28 seconds are identical, then its decay fades to silence over one second. The original foreground file is untouched. The other three notification copies are byte-identical to their originals, including all three strikes and the already-adjusted amplitude of Tripple Gong. Background perceived volume is governed by iOS alert volume, not the foreground player's volume setting.

`scripts/prepare-notification-sounds.mjs` regenerates/verifies these assets during `npm run ios:prepare`. Tests verify the JS selection → original file → native notification file mapping, PCM format, duration, unchanged other files and Gong 2 fade.

## Scheduling and reconciliation

- Opening gong plays immediately through the existing off-main native audio player; it is not a scheduled notification.
- The pure domain projection enumerates repeating gongs throughout the session, each custom gong with its own sound, and the final gong with the selected closing sound.
- A custom gong replaces a repeating gong at the same offset, matching existing Practice behavior. Duplicate custom offsets use the first configured custom sound. Events at/after the end do not add another interval/custom gong; the closing selection owns the final event.
- IDs are `equanimity.practice.<sessionId>.gong.<offsetSeconds>`. The session ID persists in the existing timer checkpoint. Legacy checkpoints derive a deterministic ID from their existing deadline.
- Native notification times are absolute dates, pinned to UTC. Calendar notification precision is whole seconds: fractional deadlines round upward, never early. OS scheduling is not a real-time/alarm guarantee.
- Repeated sync/resume reconciles stable IDs, leaves unchanged requests alone and removes obsolete Practice requests without touching unrelated pending notifications.
- Changing an active gong configuration updates that same session/deadline; pause/reset/finish/duration or mode changes cancel the old schedule. Resume uses a new session ID and the existing remaining-time logic.
- Account-view teardown cancels native projection/notifications/Live Activity. Serialized transitions and generation checks prevent stale async results from acquiring playback ownership in a new account view.
- Authorized scheduled foreground gongs use the same native player as previews. A due-event bridge call and the notification delegate share one deduplication set; notification sound/banner presentation is suppressed in the foreground. No every-tick bridge calls or checkpoint writes were added. With no authorized schedule, existing foreground audio remains the fallback.
- A final hidden-webview tick cannot cancel its imminent OS final notification. On foreground completion, the app clears its checkpoint and ends the Activity. Delivered notification IDs suppress replay on ordinary resume.

### Pending queue budget

The native implementation conservatively budgets at most 64 pending notifications, subtracting unrelated requests. It preserves the full event projection, prioritizes the final gong plus the earliest intervals, and refills on foreground/reconciliation or foreground notification delivery. If the budget cannot accommodate all upcoming events, Practice displays the scheduled/requested counts.

**More than 64 upcoming events cannot all be promised during one uninterrupted suspended session.** Later intervals outside the pending budget require reopening the app to refill. A previously configured session is not silently changed to fit the budget. This is a deliberate, visible platform constraint, not a claim that every possible 24-hour/minute-interval configuration is supported while continuously locked.

## Live Activity

New embedded WidgetKit extension target: `EquanimityPracticeActivity`.

- Bundle ID: `win.calemandersonbar.equanimity.practiceactivity`.
- Extension minimum iOS: 16.2. Main app bundle ID and its 15.4 deployment settings are unchanged.
- Main app declares `NSSupportsLiveActivities`.
- Lock Screen shows Equanimity · Practice, a system-driven remaining-time countdown and the end time. Dynamic Island has compact/minimal/expanded presentations on supporting devices; non-Dynamic-Island iPhones still get the Lock Screen view.
- SwiftUI renders dates directly; no second-by-second ActivityKit update loop. Start/configuration/resume reconciliation updates only stable timer facts.
- A matching Activity is reused; stale/duplicate session Activities are ended. Pause/reset/finish/account teardown ends/removes it while the app is executing.
- At the deadline, the content becomes stale and shows “Practice finished.” **A local notification does not wake a suspended app to execute ActivityKit end.** Without remote push or a running app process, exact automatic removal at the deadline is not implemented. Reopening the app ends the completed Activity. `staleDate` is not an end/dismiss command.
- iOS allows at most eight hours of active Live Activity life and can retain the ended Lock Screen presentation afterward. Longer timer deadlines remain canonical, but the Activity cannot stay active indefinitely. Users may disable or dismiss it; dismissal does not stop Practice or cancel its notifications. See [Apple's ActivityKit constraints and lifecycle](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities).

## Ring, Silent, Focus and termination

| Situation | Expected behavior / limitation |
| --- | --- |
| Foreground | Existing native AVAudio playback, one selected gong per event; no extra notification gong/banner. Foreground `.playback` audio retains its existing Silent-mode behavior. |
| Locked/backgrounded, Ring, Sounds enabled, Focus allows Equanimity | iOS delivers scheduled local alerts using the selected compatible sound; countdown does not require JS/network. Physical verification required. |
| Silent mode | Normal notification audio is silenced by iOS; the app cannot promise a locked-screen gong. |
| Focus / Do Not Disturb | OS notification filtering can suppress/delay sound or presentation. Allow Equanimity in the relevant Focus for the test. No bypass entitlement/interruption trick is used. |
| Notification permission denied / Sounds off | No audible locked-screen guarantee. Foreground timer/audio remain available; Live Activities have separate authorization. |
| Force quit | Already accepted local requests are OS-owned, not JS timers. Verify delivery on the physical device. No JS execution or guaranteed ongoing/recreated Live Activity is claimed after force quit. Relaunch reconciles the canonical saved deadline without rescheduling past gongs or playing an opening gong again. |
| Powered off / reboot / volume zero / OS routing to watch or accessories | No guarantee of audible iPhone delivery. The implementation is not an alarm app and does not bypass OS behavior. |

Apple documents [Silent mode](https://support.apple.com/guide/iphone/silence-iphone-iph81c7fd7d1/ios) and [Focus notification filtering](https://support.apple.com/guide/iphone/allow-or-silence-notifications-for-a-focus-iph21d43af5b/ios). Alert volume, output routing and OS scheduling mean notification loudness/timing need not match foreground media playback exactly.

## Local storage / privacy

The existing web checkpoint remains UID/project-scoped. Native `UserDefaults` key `equanimity.practice.native-projection.v1` stores only the current generic timer projection (session ID, timestamps, sounds/event identifiers), not an account dataset. It is not itself UID-scoped; it represents the one currently active installed-app session and is removed on cancellation/account teardown/completion reconciliation. It never authorizes cloud access or restores a user's private records.

This ordinary native preferences file is outside the existing WebKit-only health backup exclusion. No health data is introduced there. Local notifications and the Live Activity expose generic practice timing on the Lock Screen according to iOS settings. No analytics, remote logging, account transmission or notification push token was added. Any future privacy-policy update should accurately mention optional notifications/Lock Screen timer visibility; the published policy was not edited as part of this task.

## Every file changed

Modified:

- `app/YiApp.tsx` — project active deadlines/configuration, restore stable IDs, reconcile/cancel native state, suppress duplicate/late iOS playback, permission UI placement.
- `src/domain/practice/types.ts` — optional durable session ID, backward compatible with old checkpoints.
- `ios/App/App/EquanimityGongPlugin.swift` — expose the existing off-main audio implementation as a shared player; keep its audio settings/original files.
- `ios/App/App/EquanimityBridgeViewController.swift` — register the plugin and install its delegate after Capacitor creates its own router.
- `ios/App/App/AppDelegate.swift` — install native projection/delegate on launch.
- `ios/App/App/SceneDelegate.swift` — reconcile delivered alerts/expired Activities on foreground.
- `ios/App/App/Info.plist` — Live Activities support flag.
- `ios/App/App.xcodeproj/project.pbxproj` — native source/resources, extension target/dependency/embed phase and signing/build settings.
- `package.json` — audio preparation and focused tests in existing suites.
- `tests/practice-start.test.mjs` — mounted iOS scheduling/pause/resume/relaunch/edit/hidden-final regressions alongside existing timer tests.

Added:

- `src/domain/practice/native-plan.ts`
- `src/platform/practice-lock-screen.ts`
- `src/application/PracticeLockScreenControls.tsx`
- `ios/App/App/PracticePlan.swift`
- `ios/App/App/EquanimityPracticePlugin.swift`
- `ios/App/PracticeShared/PracticeActivityAttributes.swift`
- `ios/App/EquanimityPracticeActivity/PracticeActivityWidget.swift`
- `ios/App/EquanimityPracticeActivity/Info.plist`
- `ios/App/NotificationSounds/equanimity-gong-1.wav`
- `ios/App/NotificationSounds/equanimity-gong-2.wav`
- `ios/App/NotificationSounds/equanimity-gong-3.wav`
- `ios/App/NotificationSounds/equanimity-tripple-gong.wav`
- `scripts/prepare-notification-sounds.mjs`
- `tests/practice-lock-screen.test.mjs`
- `tests/native-practice/main.swift`
- `docs/ios-practice-lock-screen.md`

Capacitor-generated copied web assets are refreshed/ignored as usual. Its incidental SPM minimum-version rewrite was reverted; no lasting `CapApp-SPM/Package.swift` change is part of this feature. Build outputs remain in ignored `ios/DerivedData`.

## Automated verification

- Application suite and hosted production build: `npm test` — 172 tests pass.
- Firebase Auth/Firestore emulator suite — 5 tests pass against synthetic `demo-yi-phase3a` only; no production data/rules changed. Used an available Java 21 runtime.
- Standalone build/static-server suite — 6 tests pass (localhost tests require sandbox approval here).
- iOS shell/release-safety/native Practice suite — 16 tests pass.
- Lint and `npm run typecheck:standalone` pass.
- `npm run ios:prepare` passes, including sound preparation, production standalone assets and bundle verification.
- Foundation Swift projection executable passes validation/round-trip/stable full schedule, expired-event filtering, bounded queue/final priority tests.
- Unsigned generic iPhone Debug and Release builds compile the app and embedded extension. Signing and real-device OS delivery are not exercised by unsigned builds.
- The additional repository-wide `npx tsc --noEmit` check fails on existing hosted Worker types (`cloudflare:workers`, `Fetcher`, `D1Database`). The standalone/iOS TypeScript check passes; this task does not change the Worker type architecture. Existing large-chunk build warnings remain.

Tests cover JS/domain/native projection and mounted timer integration. OS permissions, ActivityKit presentation, Focus/Silent, audible playback and force-quit delivery still require the following device matrix; source assertions are not substitutes for OS execution.

Native Foundation check:

```sh
swiftc -module-cache-path /private/tmp/equanimity-practice-module-cache ios/App/App/PracticePlan.swift tests/native-practice/main.swift -o /private/tmp/equanimity-native-practice-tests
/private/tmp/equanimity-native-practice-tests
```

## Physical-iPhone verification

Run on the reported iPhone/iOS 26.5.2, then repeat at least the locked/backgrounded/cancel tests with a Release build disconnected from Xcode. Testing while attached to the debugger can prevent normal suspension.

1. Build/install using the existing `App` scheme; see signing below. Set Ring mode, audible **Ringtone and Alerts** volume, Focus off. In Settings → Notifications → Equanimity, allow notifications, Sounds and Lock Screen delivery. Enable Live Activities for Equanimity if the OS offers the toggle. If using a watch/accessory, document it or disconnect for the baseline test.
2. In Practice, use the explicit **Enable Lock Screen gongs** button if not already authorized. Verify no unexpected permission prompt occurs just on launch or Start. Check the status text does not report a partial schedule.
3. Set a six-minute timer: opening Gong 1, repeating every one minute with Gong 2, custom at minute 2 with Gong 3, custom at minute 4 with Tripple Gong, final Tripple Gong. Remove unrelated custom offsets for this test. Expected scheduled sequence: **1:00 Gong 2; 2:00 Gong 3; 3:00 Gong 2; 4:00 Tripple; 5:00 Gong 2; 6:00 Tripple**. Opening Gong 1 occurs immediately. Minute 2/4 custom gongs replace the repeating event, rather than doubling it.
4. **Foreground:** keep app open; navigate/scroll normally. Each event plays once with its selected sound; UI remains responsive; completion opens the existing reflection flow. Preview all four sounds, including the full original Gong 2.
5. **Locked:** repeat Start, wait for native status, lock immediately and leave locked through completion. Check the Live Activity countdown/end time; all six selected scheduled gongs should arrive once under the baseline OS settings. Gong 2 has a faded 29-second notification tail; Tripple retains three strikes. After completion, the Live Activity may show finished until reopening, when it must disappear without replaying gongs.
6. **Background:** repeat while another app is foregrounded; use Airplane Mode to prove scheduling/countdown do not depend on Firebase/network. Return halfway through, then background again; ensure there is only one Live Activity and no duplicate/missed future schedule.
7. **Pause/reset/edit:** pause before minute 1 and wait beyond that original deadline: no old gong or Activity should remain. Resume: countdown uses the remaining time/new deadline; no opening replay. Reset/Finish cancels remaining notifications. Edit repeating/custom/final sound during an active session and verify future events reflect the new selection exactly once at the unchanged deadline.
8. **Silent:** repeat locked with Silent enabled. Expect normal notification sounds to be silenced; restore Ring and repeat. Foreground preview retains its existing media-audio behavior. Do not interpret a silent locked alert as permission to bypass Silent mode.
9. **Focus:** repeat locked with Do Not Disturb blocking Equanimity, then allowing Equanimity. Compare OS filtering versus allowed delivery; no bypass is claimed. Also test Notifications → Sounds off and permission denied: timer remains usable, status explains the restriction.
10. **Force quit/relaunch:** start and allow scheduling to finish; force quit, lock, and wait for minute 1/2 alerts. Reopen mid-session: remaining time derives from the same deadline, no opening or past-gong replay, no duplicate future alerts; the Activity may be recreated if iOS removed it. Repeat reopening after completion: clear the completed session/Activity and show existing completion recovery, not a new schedule. Include opening just around the final deadline to check OS/foreground boundary deduplication.
11. **Account boundary:** start, then sign out/switch account before an event. Verify cancellation/no old Activity or future gongs in the next account. Repeat switching back; checkpoints must follow existing account scope, not restore another user's active session.
12. **Capacity/long session:** use a duration/interval yielding more than 64 future events. Confirm the count warning appears, final is prioritized, and foreground reopening refills the next events. Do not expect all intervals of an uninterrupted over-budget locked session. Check a normal short timer again afterward.

## Signing and TestFlight

Open `ios/App/App.xcodeproj` (SPM; no workspace required) with the existing `App` scheme. The extension is already an embedded build dependency.

1. In Signing & Capabilities, select the same Apple development team for **App** and **EquanimityPracticeActivity**, with automatic signing. Main app bundle ID stays `win.calemandersonbar.equanimity`.
2. Let Xcode register/provision the extension ID `win.calemandersonbar.equanimity.practiceactivity`. If automatic provisioning is unavailable, create its explicit App ID and development/distribution profiles manually. Do not create a separate App Store Connect product for the extension.
3. The main app declares `UIBackgroundModes: audio` solely for finite native gong completion after locking/backgrounding. There is no new Critical Alerts, Push Notifications or App Group capability to request. `NSSupportsLiveActivities` remains the required app Info setting; local notification authorization happens on-device. Existing HealthKit entitlement is unchanged.
4. Keep app and extension version/build numbers in sync when incrementing for upload (currently both 1.0 / 1). A later app-only increment must also update the extension.
5. Install/sign on the physical device and run the matrix above. Before any subsequent Archive, run `npm run ios:prepare` and inspect the extension embedding/signing. Capacitor currently regenerates its SPM minimum as iOS 16; the feature does not intentionally raise the app deployment target. If preserving existing 15.4 support, keep the existing SPM minimum setting consistent before building.
6. A signed Archive must include `PlugIns/EquanimityPracticeActivity.appex` and all four notification WAVs in the main bundle. Normal Organizer validation/upload remains a manual action; no Archive, deployment or TestFlight upload was performed here.
