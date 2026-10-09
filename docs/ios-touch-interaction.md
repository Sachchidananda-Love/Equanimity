# iPhone touch/scroll interaction fix

## Follow-up: drag from anywhere on the track

The current implementation extends the native ranges with `src/application/RangeInput.tsx`; the original investigation below describes the earlier scrolling fix.

The existing 44px input box is already large enough to receive track touches. [WebKit's native slider implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/shadow/SliderThumbElement.cpp) starts iOS touch dragging only when the initial contact is within the thumb's expanded bounds. Increasing the input's box alone does not extend that internal drag-start region. This matches the reported distinction between native track taps and thumb-only drag starts; it is not a physical-device reproduction.

The lightweight enhancement retains the native input, tap-to-jump, mouse behavior, labels, keyboard and assistive input events. Touch/pen movement must travel at least 6px and be at least 1.5 times more horizontal than vertical before the input explicitly captures the pointer and maps movement to its minimum, maximum and step. Clear vertical movement abandons the gesture; subsequent horizontal wobble cannot restart it. The existing `pan-y pinch-zoom` CSS and thumb/track appearance are unchanged, and no `preventDefault` is added. Native thumb input events during a custom horizontal drag cannot overwrite the custom value.

All move/up/cancel/capture-loss handlers stay on the input. Background visibility and window-blur listeners exist only while a touch is active and are removed on completion, cancellation or unmount. Capture loss ignores a native/internal handoff when this input's replacement capture is still pending.

Files changed for this follow-up only:

- `src/application/RangeInput.tsx` — native input with horizontal-intent track-drag enhancement.
- `app/YiApp.tsx` — replace the four range input sites with the shared component and preserve their existing value callbacks.
- `eslint.config.mjs` — identify RangeInput as an input for accessibility checking; no rule disabled.
- `tests/touch-interaction.test.mjs` — coordinate/step, native-tap passthrough, continuous off-thumb drag, native/custom ownership, vertical/ambiguous intent, cleanup and keyboard regressions.
- `tests/rendered-html.test.mjs` — assert all four sites use the same native-backed component without appearance/default-event overrides.
- `docs/ios-touch-interaction.md` — this follow-up.

Follow-up verification: 10 focused touch tests and 107 main tests; lint, standalone typecheck, hosted/standalone builds, iOS prepare/sync and the 5 iOS-shell tests. JSDOM cannot perform native range hit-testing: native tap input events are explicitly modeled in the tests. Real scrolling, native tap geometry, diagonal arbitration and VoiceOver still require the iPhone test below.

On the newly installed bundle, set a slider near its minimum, lift, then touch its middle or far end (away from the thumb) and drag left/right without lifting again. Repeat with taps at the quarter/middle/end positions. Swipe vertically from those same positions: it must scroll rather than enter custom dragging. Repeat on assessment, cycle and both gong ranges. Interrupt a horizontal drag by backgrounding, return, then test a new drag, native tap and VoiceOver/arrow-key adjustment. No test health/journal records need to be saved.

## Findings

These are source-confirmed gesture problems, not a claim that every reported physical-device stall has been reproduced.

1. All assessment, cycle and gong ranges had a 44px-high native input with `touch-action: none`. Enlarging that rectangle enlarged the area in which page scrolling was forbidden. This is the clearest explanation for scrolling being worse on slider pages.
2. Dashboard edit-mode cards also had `touch-action: none`, although the final pointer-events rules already made only their handles/removal buttons interactive. That ancestor restriction unnecessarily affected those controls.
3. The root `html,body` policy was `pan-y`. It was not itself a vertical-scroll blocker, but constrained horizontal/zoom gestures across the app. The cycle chart additionally omitted pinch zoom from its local policy.
4. A dashboard hold captured the original pointer after 450ms and immediately began a drag, changing edit-mode gesture policy mid-gesture. It excluded inputs but not labels or nested scrollable quote text. The hold lacked unmount cleanup. Active drags already had global pointer-cancel cleanup; the fix strengthens ownership, immediate local cancellation, capture loss and explicit release rather than claiming that global cancellation was absent.
5. Assessment ranges called `setActive` inside a replayable `setAssessments` updater. This is an avoidable render-phase side effect during rapid range changes, not a measured explanation for all iPhone jank.

No custom range recognizer, touchmove cancellation, touchstart interception or transparent range overlay was found. Modal backdrops dismiss only when the backdrop itself is the pointer target; slider gestures are not backdrop dismissals. Ordinary pages use document scrolling; range modals use one vertical overflow container. Intentional horizontal chart/chip scrolling and bounded quote scrolling remain intact.

## Behavior changes

- Keep the existing 44px range element touch box, zero padding/border and native accent color. No thumb/track pseudo-element styling, appearance override, visible knob enlargement, negative-margin hitbox or overlay.
- Ranges use `touch-action: pan-y pinch-zoom`: vertical scrolling can start within their touch boxes. Horizontal value adjustment, keyboard and accessibility remain native `input[type=range]` behavior.
- Root and cycle-chart gesture policy is browser-native `auto`. No global touch/overscroll lock is introduced.
- Only an explicit dashboard drag handle has `touch-action: none` and calls `preventDefault`/pointer capture for reordering. Card bodies and removal buttons can start a native scroll.
- A stationary hold opens edit mode without capturing/dragging the current pointer. Lift, then grab the existing handle to reorder. The banner now describes that existing handle.
- Movement over 6px, release, cancellation, leaving a card and unmount invalidate pending holds. Inputs, labels, buttons, editable content and genuinely overflowing scroll content never arm a hold.
- Drag events belong to the initiating pointer. Pointer up/cancel, lost capture, window blur and unmount release ownership; unrelated fingers cannot move/end the drag. Global move/up/cancel listeners remain passive. A hold's subsequent card click is suppressed only in edit mode.
- Assessment value and active-group updates are batched in the input handler, outside replayable state updaters.

The gesture policy follows the [Pointer Events specification](https://www.w3.org/TR/pointerevents3/#the-touch-action-css-property): browser panning permission depends on the target and its ancestors and cannot be changed for an already-started gesture. No deprecated momentum CSS is added: [WebKit's Safari 13 release announcement](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/) documents accelerated overflow scrolling without needing that opt-in.

## Files changed for this task

- `app/YiApp.tsx` — dashboard hold/capture/click lifecycle, edit hint and assessment updates.
- `app/globals.css` — root and edit-card gesture policy only.
- `src/application/sliders.css` — shared native range gesture policy only; pre-existing touch-box geometry retained.
- `src/application/body-cycle.css` — chart gesture policy only; no calculation changes.
- `src/application/widget-hold.ts` — isolated cancellable hold and native-gesture target filtering.
- `tests/touch-interaction.test.mjs` — timer, target-filter, CSS and mounted Strict Mode gesture tests.
- `tests/rendered-html.test.mjs` — update the old regression assertion that required ranges to block scrolling.
- `package.json` — include the touch regression tests in the existing main test command.
- `docs/ios-touch-interaction.md` — this report and device acceptance procedure.

Pre-existing cloud-recovery/instrumentation work is retained. No HealthKit import, Tempdrop logic, timer timing, Firestore rules, persistence or architecture changes were made for this task. Preparing iOS regenerates ignored bundled web assets; it does not install the app on a phone.

## Automated verification

- Six new touch tests cover hold movement/cancellation/replacement/cleanup, native controls and nested scrollers, non-oversized native-thumb CSS, mounted vertical pointer gestures, handle-only capture, unrelated-pointer protection, cancellation/capture-loss/unmount release, ghost-click suppression and all four native range implementations updating on their first input event.
- Mounted tests run React Strict Mode and exercise returning assessment sliders to zero/N/A.
- Keyboard default handling and labels remain intact; no range pointer handler cancels browser defaults.
- Full main suite: 103 tests.
- Standalone suite: 6 tests.
- Firebase emulator suite: 4 tests using synthetic demo-project data.
- iOS shell suite: 5 tests.
- Lint, standalone TypeScript check, hosted build, standalone build, iOS prepare/sync and unsigned Debug simulator-SDK compilation.

The browser builds retain an existing large-chunk warning. The native compiler reports an existing scheme destination warning but completes successfully.

## Exact physical-iPhone acceptance test

Use the newly built app on Tatiana's iPhone (reported iOS 26.5.2), not the previous installed bundle. Keep the account/data intact; do not uninstall or clear storage. Build/install through the usual Xcode Run workflow after `npm run ios:prepare`. These steps do not require saving test journal or health records.

1. **Journal sliders:** Journal → New entry → Journal entry. Open an assessment group. Swipe vertically ten times, alternating starts on the thumb, track, the invisible area immediately above/below it and its label. Try quick flicks and slow vertical drags. Scrolling should engage on the first gesture; the modal must remain open. The thumb should look unchanged.
2. **Horizontal drag:** In the same modal, drag several thumbs left/right on the first touch, then change another slider and return all to zero. Values should follow promptly and zero should restore N/A when the whole group is zero. Test a slightly diagonal but predominantly horizontal drag. Close without saving.
3. **Body/cycle:** Insights → Cycle check-in (or Body & cycle → Log if that card is installed). Scroll to Energy, Sex drive and PMS. Repeat both vertical-start and horizontal-drag tests on all three. Close without saving.
4. **Gong ranges:** Practice → Repeating gong enabled. Repeat the tests on the live interval slider; confirm the minutes field follows immediately. Save this setup → repeat on the builder's Interval slider, then close without saving. Live practice settings may persist normally; return them to their original values.
5. **Dashboard:** On Insights, swipe vertically starting on non-control card content and scrollable quote text. It must not enter edit mode. Hold still on ordinary card content for about half a second: edit mode should open but the card should not drag or also open analytics. Lift, scroll starting away from the handle, then drag the existing handle to reorder. Try a second finger and interrupt a drag by switching apps. On return, there must be no stuck dragging/autoscroll state. Restore the original ordering if desired and tap Done.
6. **Ordinary/nested scroll:** Flick Journal and Insights from non-slider content. Horizontal chips and the expanded Body & cycle chart should still pan horizontally; vertical swipes near/on the chart should scroll its containing view. At the end of a long quote's inner scroll, lift and start a fresh page swipe to check native nested-scroll handoff.
7. **Accessibility:** With VoiceOver, find each slider and use its native adjustable increment/decrement actions. If a keyboard is available, focus a range and use arrow keys. Labels, bounds and value changes must remain available.
8. Repeat steps 1–4 after background/foreground and a relaunch. Record the screen/control and initial swipe direction for any remaining failure.

## Remaining WKWebView/testing limits

JSDOM does not implement UIKit's scroll recognizer, inertia, native range hit-testing or actual keyboard/VoiceOver default actions. An unsigned simulator-SDK build does not verify physical touch behavior. WKWebView still decides direction thresholds, diagonal gesture arbitration and native thumb appearance/hit slop; a CSS element box is not a guaranteed circular finger radius around a thumb. The fix removes application-level blockers but does not replace that browser behavior with an unverified custom recognizer. Physical acceptance remains unverified until the above test is run.

This task does not resolve or claim to resolve the separate whole-app freeze after cloud recovery.
