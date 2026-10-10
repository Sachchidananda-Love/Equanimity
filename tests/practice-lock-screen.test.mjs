import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { nativePracticePlan, PRACTICE_GONG_FILES } from "../src/domain/practice/native-plan.ts";
import { createPracticeLockScreen } from "../src/platform/practice-lock-screen.ts";
import { practiceNotificationMessage, PracticeLockScreenControls, PracticeNotificationReadout } from "../src/application/PracticeLockScreenControls.tsx";
import { Capacitor } from "@capacitor/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const base = { sessionId: "synthetic", mode: "Timer", duration: 900, endAt: 1800000900123,
  openingGong: "Gong 1", closingGong: "Tripple Gong", intervalEnabled: true,
  intervalMinutes: 2, intervalGong: "Gong 2", customGongs: [4, 7, 7], customGongSounds: ["Gong 3", "Gong 1", "Tripple Gong"] };
const status = { permission: "authorized", soundEnabled: true, liveActivitiesEnabled: true,
  scheduled: 8, requested: 8, notificationScheduling: true };

test("explicit mapping preserves every interval/custom/final sound and full session schedule", () => {
  assert.deepEqual(PRACTICE_GONG_FILES, {
    "Gong 1": "gong-1.wav", "Gong 2": "gong-2.wav", "Gong 3": "gong-3.wav", "Tripple Gong": "tripple-gong.wav",
  });
  const plan = nativePracticePlan(base);
  assert.equal(plan.endAt, base.endAt); assert.equal(plan.startedAt, base.endAt - base.duration * 1000);
  assert.deepEqual(plan.events.map(event => [(event.at - plan.startedAt) / 60000, event.file]), [
    [2, "gong-2.wav"], [4, "gong-3.wav"], [6, "gong-2.wav"], [7, "gong-1.wav"],
    [8, "gong-2.wav"], [10, "gong-2.wav"], [12, "gong-2.wav"], [14, "gong-2.wav"], [15, "tripple-gong.wav"],
  ]);
  assert.equal(new Set(plan.events.map(event => event.id)).size, plan.events.length);
  assert.ok(plan.events.every(event => event.id.startsWith("equanimity.practice.synthetic.gong.")));
  assert.equal(plan.events.at(-1).final, true);
  assert.deepEqual(nativePracticePlan(base), plan, "relaunch builds identical identifiers");
});

test("no notifications for stopwatch; invalid/out-of-session custom offsets skipped", () => {
  assert.equal(nativePracticePlan({ ...base, mode: "Stopwatch" }), null);
  const plan = nativePracticePlan({ ...base, intervalEnabled: false, customGongs: [0, -1, NaN, 1, 15, 20], customGongSounds: ["", "", "", "Tripple Gong"] });
  assert.deepEqual(plan.events.map(event => event.file), ["tripple-gong.wav", "tripple-gong.wav"]);
});

test("cancel/restart serialize and stale async results cannot take playback ownership", async () => {
  const calls = []; let resolveSync;
  const native = {
    sync: options => { calls.push(["sync", options.plan.sessionId]); return new Promise(resolve => { resolveSync = resolve; }); },
    cancel: async options => { calls.push(["cancel", options.completed]); },
    status: async () => status, requestPermission: async () => status,
  };
  const service = createPracticeLockScreen({ native, isIos: () => true });
  const first = service.sync(nativePracticePlan(base));
  await Promise.resolve();
  service.cancel();
  resolveSync(status); await first; await Promise.resolve(); await Promise.resolve();
  assert.equal(service.ownsGongs(), false);
  assert.deepEqual(calls, [["sync", "synthetic"], ["cancel", false]]);
  const second = service.sync(nativePracticePlan({ ...base, sessionId: "second" }));
  await Promise.resolve(); await Promise.resolve();
  resolveSync(status); await second;
  assert.equal(service.ownsGongs(), true);
  service.cancel(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(service.ownsGongs(), false);
  assert.deepEqual(calls.at(-1), ["cancel", true]);
});

test("first timed Start requests missing notification permission without blocking scheduling; never prompts authorized/denied", async () => {
  let permission = "notDetermined", prompts = 0;
  const plans = [];
  const service = createPracticeLockScreen({ isIos: () => true, native: {
    status: async () => ({ ...status, permission }),
    requestPermission: async () => { prompts++; permission = "authorized"; return status; },
    sync: async ({ plan }) => { plans.push(plan); return { ...status, permission }; },
    cancel: async () => {},
  } });
  // Match the mounted Practice controls, which subscribe to native status.
  const unsubscribe = service.subscribe(() => {});
  const permissionRequest = service.requestPermissionIfNeeded();
  await service.sync(nativePracticePlan(base)); await permissionRequest;
  assert.equal(prompts, 1); assert.equal(service.ownsGongs(), true);
  assert.equal(plans.at(-1).sessionId, base.sessionId);
  await service.requestPermissionIfNeeded(); assert.equal(prompts, 1);
  permission = "denied"; await service.requestPermissionIfNeeded(); assert.equal(prompts, 1);
  permission = "provisional"; await service.requestPermissionIfNeeded(); assert.equal(prompts, 2);
  unsubscribe();
});

test("cancel carries the captured owner ID so old-session cleanup cannot target a new session", async () => {
  const cancellations = [];
  const service = createPracticeLockScreen({ isIos: () => true, native: {
    sync: async () => status, cancel: async options => cancellations.push(options),
  } });
  await service.sync(nativePracticePlan(base));
  service.cancel();
  await service.sync(nativePracticePlan({ ...base, sessionId: "new-session" }));
  assert.deepEqual(cancellations, [{ completed: false, sessionId: "synthetic" }]);
  assert.equal(service.ownsGongs(), true);
});

test("permission UI distinguishes authorization from a verified pending schedule; Debug tools absent in Release", t => {
  assert.match(practiceNotificationMessage({ ...status, permission: "notDetermined" }), /first timed Start/);
  assert.match(practiceNotificationMessage({ ...status, permission: "provisional" }), /quietly/);
  assert.match(practiceNotificationMessage({ ...status, soundEnabled: false }), /sounds are off/);
  assert.match(practiceNotificationMessage({ ...status, scheduled: 0, requested: 8 }), /0 of 8/);
  t.mock.method(Capacitor, "getPlatform", () => "ios");
  const previous = globalThis.window;
  try {
    globalThis.window = {};
    const service = createPracticeLockScreen();
    const render = () => renderToStaticMarkup(createElement(PracticeLockScreenControls, { service }));
    assert.doesNotMatch(render(), /Developer:|Test gong in 10 seconds|Notification test gong/);
    window.__EQUANIMITY_DEVELOPMENT_TOOLS__ = true;
    assert.match(render(), /Test gong in 10 seconds/);
    assert.match(render(), /Refresh notification diagnostics/);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test("diagnostic readout labels native authorization, pending requests and delivered evidence explicitly", () => {
  const evidence = {
    ...status, capturedAt: 1800000000000, soundSetting: "enabled", alertSetting: "enabled",
    lockScreenSetting: "enabled", scheduledDeliverySetting: "disabled", delegateInstalled: true,
    pendingPracticeCount: 1, deliveredPracticeCount: 1,
    requests: [{ id: "synthetic-pending-id", intendedAt: 1800000010000, triggerAt: 1800000011000,
      soundFilename: "equanimity-gong-2.wav", mappedSoundFilename: "equanimity-gong-2.wav", userInfoSoundFilename: "equanimity-gong-2.wav",
      triggerType: "UNCalendarNotificationTrigger", relevanceScore: 0, interruptionLevel: 1,
      soundPopulated: true, bundleExists: true, validSound: true, test: true }],
    deliveredRequests: [{ id: "synthetic-delivered-id", deliveredAt: 1800000001000,
      soundFilename: "equanimity-gong-1.wav", soundPopulated: true, interruptionLevel: 1 }], assets: [],
  };
  const render = value => renderToStaticMarkup(createElement(PracticeNotificationReadout, { title: "Device diagnostics", evidence: value }));
  const html = render(evidence);
  for (const label of ["Authorization status", "soundSetting", "lockScreenSetting", "Pending Practice notification count",
    "Request identifier", "Intended delivery time", "Next native trigger time", "Custom sound filename",
    "Sound populated", "Mapped sound filename", "Request userInfo sound filename", "Trigger type", "UNCalendarNotificationTrigger", "Relevance score",
    "Bundle.main file exists", "Sound valid", "synthetic-pending-id", "synthetic-delivered-id", "equanimity-gong-2.wav"]) assert.ok(html.includes(label), label);
  assert.match(html, /Sound populated<\/dt><dd>yes/);
  assert.match(html, /Actual content interruption level<\/dt><dd>active \(1\)/);
  assert.ok(html.includes("interruption=active (1)"), "delivered notification displays actual level by name");
  assert.match(html, /Bundle\.main file exists<\/dt><dd>yes/);
  assert.match(html, /Sound valid[^<]*<\/dt><dd>yes/);
  const negative = render({ ...evidence, requests: [{ ...evidence.requests[0], soundPopulated: false, bundleExists: false, validSound: false }] });
  assert.match(negative, /Sound populated<\/dt><dd>no/);
  assert.match(negative, /Bundle\.main file exists<\/dt><dd>no/);
  assert.match(render({ ...evidence, requests: [], pendingPracticeCount: 0 }), /No pending Practice requests/);
});

test("Debug diagnostics capture background and pre-cleanup delivered evidence without a new scheduling path", async () => {
  const native = await read("ios/App/App/EquanimityPracticePlugin.swift");
  const foreground = native.slice(native.indexOf("func foreground()"), native.indexOf("private func setting("));
  assert.match(foreground, /#if DEBUG[\s\S]*foregroundEvidence = await self\.notificationEvidence\(\)[\s\S]*#endif/);
  assert.ok(foreground.indexOf("foregroundEvidence =") < foreground.indexOf("self.cancel(completed:"));
  assert.match(foreground, /backgroundEvidence = await self\.notificationEvidence\(\)/);
  assert.match(native, /result\["deliveredRequests"\] = deliveredPractice\.map/);
  assert.match(native, /result\["bundleExists"\]|"bundleExists": Bundle\.main\.url/);
  assert.match(native, /try await addGong\(gong, sessionId: next\.sessionId\)/);
  assert.match(native, /try await addGong\(gong, sessionId: session, test: true\)/);
});

test("reconciliation preserves ownership after final delivery; permission denial/failure degrades gracefully", async () => {
  let result = status;
  const plans = [];
  const service = createPracticeLockScreen({ isIos: () => true, native: {
    sync: async ({ plan }) => { plans.push(plan); if (result instanceof Error) throw result; return result; },
    status: async () => status, requestPermission: async () => status, cancel: async () => {},
  } });
  await service.sync(nativePracticePlan(base));
  result = { ...status, scheduled: 0, requested: 0, notificationScheduling: false };
  await service.reconcile(); assert.equal(service.ownsGongs(), true);
  assert.deepEqual(plans[0], plans[1]);
  result = { ...result, permission: "denied" }; await service.reconcile();
  assert.equal(service.ownsGongs(), false);
  result = new Error("Synthetic unavailable bridge"); await service.reconcile();
  assert.equal(service.ownsGongs(), false);
});

test("notification audio is valid <30s PCM; mapping matches native resources; other gongs unchanged", async () => {
  const native = await read("ios/App/App/PracticePlan.swift");
  const project = await read("ios/App/App.xcodeproj/project.pbxproj");
  for (const sourceName of Object.values(PRACTICE_GONG_FILES)) {
    const targetName = `equanimity-${sourceName}`;
    assert.ok(native.includes(`"${sourceName}": "${targetName}"`)); assert.ok(project.includes(targetName));
    const target = await readFile(new URL(`../ios/App/NotificationSounds/${targetName}`, import.meta.url));
    const original = await readFile(new URL(`../public/gong-sounds/${sourceName}`, import.meta.url));
    let format, pcm;
    for (let offset = 12; offset + 8 <= target.length;) {
      const length = target.readUInt32LE(offset + 4), tag = target.toString("ascii", offset, offset + 4);
      if (tag === "fmt ") format = target.subarray(offset + 8, offset + 8 + length);
      if (tag === "data") pcm = target.subarray(offset + 8, offset + 8 + length);
      offset += 8 + length + length % 2;
    }
    assert.equal(format.readUInt16LE(0), 1); assert.equal(format.readUInt16LE(14), 16);
    const rate = format.readUInt32LE(4), align = format.readUInt16LE(12);
    assert.ok(pcm.length / rate / align < 30);
    if (sourceName !== "gong-2.wav") assert.deepEqual(target, original);
    else {
      assert.equal(pcm.length / rate / align, 29);
      let originalPCM;
      for (let offset = 12; offset + 8 <= original.length;) {
        const length = original.readUInt32LE(offset + 4);
        if (original.toString("ascii", offset, offset + 4) === "data") originalPCM = original.subarray(offset + 8, offset + 8 + length);
        offset += 8 + length + length % 2;
      }
      assert.deepEqual(pcm.subarray(0, rate * align * 28), originalPCM.subarray(0, rate * align * 28));
      assert.equal(pcm.readInt16LE(pcm.length - 2), 0, "fade ends at silence, not an abrupt cut");
    }
  }
});

test("native lifecycle has local-only alerts, suppression/dedup, cancellation and system countdown", async () => {
  const [native, widget, plist, project] = await Promise.all([
    read("ios/App/App/EquanimityPracticePlugin.swift"), read("ios/App/EquanimityPracticeActivity/PracticeActivityWidget.swift"),
    read("ios/App/App/Info.plist"), read("ios/App/App.xcodeproj/project.pbxproj"),
  ]);
  assert.match(native, /requestAuthorization\(options: \[\.alert, \.sound\]\)/);
  assert.match(native, /finish\(\[\], "active matching Practice/); assert.match(native, /played\.insert\(id\)\.inserted/);
  assert.match(native, /removePendingNotificationRequests\(withIdentifiers:/);
  assert.match(native, /activity\.end\(nil, dismissalPolicy: \.immediate\)/);
  assert.match(native, /staleDate: next\.endDate/); assert.match(native, /pushType: nil/);
  assert.match(widget, /Text\(timerInterval:/); assert.match(widget, /context\.isStale/);
  assert.match(plist, /NSSupportsLiveActivities/); assert.match(project, /com\.apple\.product-type\.app-extension/);
  assert.doesNotMatch(native + plist, /criticalAlert|aps-environment|URLSession|Firebase|HealthKit/);
  assert.doesNotMatch(native, /AVAudioSession|beginBackgroundTask/, "Practice scheduling never owns background audio");
  const bridge = await read("ios/App/App/EquanimityBridgeViewController.swift");
  assert.match(bridge, /override func capacitorDidLoad\(\)[\s\S]*super\.capacitorDidLoad\(\)[\s\S]*PracticeNativeService\.shared\.install\(\)/,
    "Practice must install after Capacitor constructs its own notification router");
  assert.match(native, /previousDelegate\.userNotificationCenter\?\(center, didReceive: response/,
    "unrelated notification responses still reach the Capacitor router");
});

test("isolated Debug controls differ only by sound and bypass Practice configuration and cleanup", async () => {
  const native = await read("ios/App/App/EquanimityPracticePlugin.swift");
  const control = native.slice(native.indexOf("func testNotificationControl(custom: Bool)"), native.indexOf("func playDue(sessionId:"));
  assert.match(control, /UNMutableNotificationContent\(\)/);
  assert.match(control, /content.interruptionLevel = \.active/);
  assert.match(control, /content\.title =/); assert.match(control, /content\.body =/);
  assert.match(control, /custom \? PracticeNotificationRequest.customSound\(filename: "equanimity-gong-1.wav"\) : UNNotificationSound.default/);
  assert.match(control, /UNTimeIntervalNotificationTrigger\(timeInterval: 10, repeats: false\)/);
  assert.match(control, /try await center.add\(request\)/);
  assert.doesNotMatch(control, /content\.(categoryIdentifier|threadIdentifier|userInfo)\s*=|addGong|PracticeNotificationRequest.make|removePending|removeDelivered|reconcileActivity/);
  assert.match(native, /#if DEBUG[\s\S]*@objc func testNotificationControl[\s\S]*#endif/);
  assert.match(native, /hasPrefix\(Self.controlPrefix\)[\s\S]*finish\(\[\.banner, \.list, \.sound\], "isolated control/);
  assert.match(native, /trace\("willPresent completion"/);
  assert.match(native, /trace\("removeDelivered"/); assert.match(native, /trace\("removePending"/);
  assert.match(native, /notificationTrace.count > 100/);
  const calls = [];
  const service = createPracticeLockScreen({ isIos: () => true, native: {
    testNotificationControl: async options => { calls.push(options); return { ...status }; },
  } });
  await service.testNotificationControl(false); await service.testNotificationControl(true);
  assert.deepEqual(calls, [{ custom: false }, { custom: true }]);
  assert.equal(service.ownsGongs(), false, "controls do not take timer/audio ownership");
});

test("native test shares the real request builder; background completion and cancellation remain session-scoped", async () => {
  const [native, factory, scene, ui] = await Promise.all([
    read("ios/App/App/EquanimityPracticePlugin.swift"), read("ios/App/App/PracticeNotificationRequest.swift"),
    read("ios/App/App/SceneDelegate.swift"), read("app/YiApp.tsx"),
  ]);
  assert.match(native, /try await addGong\(gong, sessionId: next\.sessionId\)/);
  assert.match(native, /try await addGong\(gong, sessionId: session, test: true\)/);
  assert.match(native, /PracticeNotificationRequest\.make\(gong, sessionId: sessionId/);
  assert.match(factory, /content\.sound = customSound\(filename: filename\)/);
  assert.match(factory, /UNNotificationSound\(named: UNNotificationSoundName\(filename\)\)/);
  assert.match(native, /#if DEBUG[\s\S]*@objc func testGong[\s\S]*#endif/);
  assert.match(native, /deferCompletion\(completed: completed, foreground:/);
  const cancel = native.slice(native.indexOf("func cancel(completed: Bool, sessionId:"), native.indexOf("func foreground()"));
  assert.match(cancel, /belongs\(\$0\.identifier, to: owner\)/);
  assert.doesNotMatch(cancel, /hasPrefix\(PracticePlan\.prefix\)/);
  assert.match(scene, /sceneDidEnterBackground[\s\S]*\.background\(\)/);
  const background = scene.slice(scene.indexOf("func sceneDidEnterBackground"), scene.indexOf("func scene(_ scene:"));
  assert.doesNotMatch(background, /cancel|removePending/);
  assert.match(ui, /if \(isIosPractice\(\) && mode === "Timer"\) void nativePractice\.requestPermissionIfNeeded\(\)/);
});

test("Practice and proven control share sound construction; reuse rejects missing sounds and metadata mismatches", async () => {
  const [native, factory] = await Promise.all([read("ios/App/App/EquanimityPracticePlugin.swift"), read("ios/App/App/PracticeNotificationRequest.swift")]);
  assert.match(native, /PracticeNotificationRequest.customSound\(filename: "equanimity-gong-1.wav"\)/);
  assert.match(factory, /content.sound = customSound\(filename: filename\)/);
  assert.match(factory, /request.content.sound != nil/);
  assert.match(factory, /content.interruptionLevel = \.active/);
  assert.match(factory, /request.content.interruptionLevel == \.active/);
  assert.doesNotMatch(factory + native, /interruptionLevel\s*=\s*\.(passive|critical)/);
  assert.match(factory, /userInfo\["soundFilename"\][\s\S]*PracticePlan.notificationSounds\[gong.file\]/);
  assert.match(native, /PracticeNotificationRequest.canReuse\(\$0, for: gong\)/);
  for (const key of ["mappedSoundFilename", "userInfoSoundFilename", "triggerType", "relevanceScore"]) assert.match(native, new RegExp(`"${key}"`));
});

test("Lock Screen palettes exceed 12:1 contrast; explicit content colors and white Island variants", async () => {
  const widget = await read("ios/App/EquanimityPracticeActivity/PracticeActivityWidget.swift");
  const luminance = color => color.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  assert.ok((luminance([.97, .96, .92]) + .05) / .05 > 12);
  assert.ok(1.05 / (luminance([.08, .13, .11]) + .05) > 12);
  assert.match(widget, /foregroundStyle\(foreground\)[\s\S]*\.background\(background\)/);
  assert.match(widget, /colorScheme == \.dark \|\| luminanceReduced/);
  assert.match(widget, /private var foreground: Color \{ dark \? \.white : \.black \}/);
  assert.ok((widget.match(/foregroundStyle\(\.white\)/g) ?? []).length >= 6);
});
