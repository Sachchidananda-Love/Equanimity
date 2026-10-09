# Practice Start / gong freeze investigation

## Evidence and boundary

On the affected physical iPhone, the user reports Timer Start **and gong Try**
freeze the app. Stopwatch Start works; the user separately confirmed the freezing
stop action is **✓ Finish**, which plays a closing gong, not Pause. The common
path for all three reported triggers is `tone()` and synchronous HTML Audio construction /
`play()` invocation inside WKWebView. Try does not modify timer state, persist a
checkpoint, request notification permission or call a repository. This isolates
audio as the reported trigger, not a timer persistence or cloud reconnection loop.
The HTML Audio implementation is identical to HEAD before the recent cloud/touch
work. No particular Apple/WebKit internal defect is claimed without a device trace.
Tatiana's device was unavailable to CoreDevice during this investigation; the
physical freeze itself has not been independently reproduced or profiled here.

## Exact Start trace

1. `toggleRunning`: optional browser notification permission request.
2. Timer only, at full duration: `tone(openingGong)`.
3. Set absolute deadline / Stopwatch start timestamp in refs.
4. Write `StoredPractice` once via **localRepository**, including in cloud mode.
   The existing protected backup and record format are unchanged.
5. Set `running` true; the Practice component commits.
6. Timer effect updates immediately, creates one 500 ms interval, and installs
   one visibilitychange + pageshow listener. Cleanup removes all three.
7. Ticks update Practice-local remaining/elapsed state. They neither checkpoint
   nor save cloud data. Absolute timestamps still handle background/resume.
8. Pause/Finish/completion clear the checkpoint. Stopwatch Finish / Timer
   completion play a closing gong and open reflection. Journal cloud persistence
   occurs only on explicit reflection Save, not Start.

No Start-triggered inert/pointer overlay, nested state updater, repeated timer
effect, checkpoint storm or cloud write was found in the traced path/mounted tests.
There is no audio preload loop or awaited playback blocking timer scheduling.
However, catching a rejected audio promise cannot protect against a synchronous
stall while creating/starting WK media.

## Scoped change

The iOS app uses `EquanimityGongPlugin`: an allowlist of four existing bundled WAVs,
AVAudioPlayer, and one private serial audio queue. File loading, audio session
activation, player construction and playback are not on the native UI thread or
WKWebView media path. Players are lazily cached (at most four). New gongs replace
the previous sound, at the existing 0.82 volume. Playback mixes with other audio;
no background capability or timer scheduling changes were added. JavaScript does
not await the native response. Failure stays silent, with no WK audio fallback.
Hosted/browser playback retains the existing HTML Audio behavior.

This is a targeted replacement of the isolated audio path, not a recovery/retry
layer. Practice markup/CSS, slider behavior, cloud recovery, HealthKit, Tempdrop,
Firebase security, data formats and timer deadline/recovery logic are unchanged.

Native playback API: [Apple AVAudioPlayer](https://developer.apple.com/documentation/avfaudio/avaudioplayer).
Bridge registration: [Capacitor custom iOS code](https://capacitorjs.com/docs/ios/custom-code).

Files changed for this task (excluding pre-existing worktree changes):

- `app/YiApp.tsx`: route gongs through the platform player; bounded Practice diagnostics.
- `src/platform/gong-player.ts`: isolated native/browser playback boundary.
- `ios/App/App/EquanimityGongPlugin.swift`: bundled native playback on an audio queue.
- `ios/App/App/EquanimityBridgeViewController.swift`: register the gong plugin only.
- `ios/App/App.xcodeproj/project.pbxproj`: include that Swift source in App.
- `tests/practice-start.test.mjs`: actual mounted Start/tick/recovery regression tests.
- `tests/gong-player.test.mjs`: native dispatch/browser failure/registration tests.
- `tests/standalone-build.test.mjs`: retain asset-base coverage after extracting playback.
- `package.json`: include the two new regression suites in `npm test`.
- `docs/ios-practice-audio.md`: investigation, limitations and phone verification.

## Diagnostics and tests

Existing development-only `[Equanimity diag]` logging now includes Start/Pause,
checkpoint write/clear start/end, active state set/commit, audio initialization,
native dispatch, interval create/cleanup, first tick and effect execution counts.
Native DEBUG adds bounded audio initialization start/end/failure timestamps.
No records, credentials, account identifiers, notes or selected practice values
are logged. Existing JS/native heartbeat markers remain available.

`practice-start.test.mjs` mounts the actual app to check Start/Pause, navigation,
cloud/offline operation, single checkpoint/interval, no parent render storm,
relaunch deadline recovery, repeated foreground events, and audio failure at custom,
repeating and closing gongs. `gong-player.test.mjs` checks native pending/failure
dispatch without HTML Audio, browser replacement/failure, and native source/build
registration. JSDOM does not emulate physical WKWebView/audio-driver behavior.

Validation completed October 9, 2026:

- `npm test`: hosted build + 120/120 tests (including 13 new focused tests).
- `npm run test:standalone`: standalone build + 6/6 tests.
- `npm run test:ios-shell`: 5/5 tests, bundled asset integrity verified.
- `npm run test:firebase-emulators`: 4/4 tests, synthetic demo project only.
- `npm run lint`, `npm run typecheck:standalone`, `git diff --check`: pass.
- `npm run ios:prepare`: standalone assets built, verified and synced to iOS.
- Unsigned Debug `xcodebuild`: both `iphoneos` and `iphonesimulator` pass.
  All four gong WAVs are present in the compiled iPhone app bundle.

Existing chunk-size and Xcode scheme-platform warnings remain. No build was
installed on a physical device, and no production data was read or written.

## Physical iPhone verification (required)

1. Use the newly synced native build, not just refreshed web assets: run
   `npm run ios:prepare`, then build/run App from Xcode to the same affected phone.
   Do not uninstall: existing account data and active practice should be retained.
2. With Xcode's console open, launch, enter Practice, press **Try** repeatedly and
   preview all four gongs. Immediately scroll and navigate to Journal/Insights.
   Gongs should sound without a touch/scroll freeze. Check native audio start/end
   markers and continued JS/native heartbeats.
3. Select Timer, press Start once: Pause should appear immediately. Navigate away
   and back while it counts down. Pause/Resume/Reset five times. There should be
   one checkpoint per Start/Resume and no checkpoint writes on ordinary ticks.
4. Select Stopwatch, Start, wait a few seconds, then Finish. Closing gong and
   reflection should appear without freezing. Cancel reflection (no test journal
   save is needed), and repeat.
5. Repeat Try + Timer + Stopwatch while signed in, with Wi-Fi/cellular off, and
   after restoring connectivity. Navigation must remain responsive throughout.
6. While a timer runs, background for 20 seconds and return; then force-quit and
   reopen before its deadline. Remaining time should catch up from its deadline;
   the opening gong must not replay. Pause and start again.
7. Set a short custom timer (e.g. 10 seconds) and verify completion/reflection;
   test a 1-minute repeating/custom gong while continuing to scroll/navigate.
8. Check built-in speaker and the normal headphone/Bluetooth route. If any freeze
   remains, capture the last `[Equanimity diag]` and `[Equanimity native diag]`
   markers; pause in Xcode to capture thread stacks. Do not send private records.

## Remaining limits

The physical result and exact WebKit-internal stall still need the above test.
Native initialization may take time on a slow/interrupted audio route, but that
work does not wait on the UI thread. An unavailable sound does not stop the timer.
No new locked-screen/background gong guarantee was added: JS timer suspension and
the existing lack of background audio/local-notification scheduling still apply.
Browser users still use their browser's media/autoplay restrictions.
