import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { developmentToolsEnabled, privacyPolicyConfiguration } from "../src/platform/release-config.ts";
import { CloudPanel } from "../src/application/CloudPanel.tsx";
import { HealthKitTools } from "../src/application/HealthKitTools.tsx";
import { DataTools } from "../src/application/DataTools.tsx";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const snapshot = { mode: "signed-out", auth: "signed-out", save: "idle", operation: "idle", online: true, error: "" };
function panels() {
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(CloudPanel, { snapshot }),
    React.createElement(HealthKitTools, { onImported() {}, onBusy() {} }),
    React.createElement(DataTools, { issues: [], reload() {} })));
}
test("Release hides fallback/raw Health/local export tools but retains ordinary account and import controls", () => {
  assert.equal(developmentToolsEnabled(), false);
  const html = panels();
  assert.doesNotMatch(html, /Use local-only|Inspect last 90 days|HealthKit inspection|Export browser data|<pre/);
  for (const label of ["Sign in", "Refresh status", "Request read permissions", "Sync selected Apple Health", "Import recent Health data", "Retry pending import", "Privacy"]) assert.ok(html.includes(label));
  assert.match(html, /Privacy policy is not configured/);
  assert.doesNotMatch(html, /href="(?:undefined|null|#)"/);
});
test("native Debug can expose preserved tools with production web assets; a persisted preference cannot", () => {
  const previous = globalThis.window;
  try {
    globalThis.window = { localStorage: { getItem: () => "true" } };
    assert.equal(developmentToolsEnabled(), false);
    globalThis.window.__EQUANIMITY_DEVELOPMENT_TOOLS__ = true;
    // DataTools is the only panel reading local storage during render.
    globalThis.window.localStorage.getItem = () => null;
    const html = panels();
    for (const label of ["Use local-only", "Inspect last 90 days", "HealthKit inspection", "Export browser data"]) assert.ok(html.includes(label));
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
test("privacy boundary accepts a real HTTPS URL and never emits a broken or unsafe link", () => {
  assert.deepEqual(privacyPolicyConfiguration(""), { state: "missing", url: null });
  assert.deepEqual(privacyPolicyConfiguration("https://example.org/privacy"), { state: "configured", url: "https://example.org/privacy" });
  for (const value of ["not a URL", "javascript:alert(1)", "http://example.org", "https://localhost/privacy", "https://127.0.0.1", "https://equanimity.local", "https://user:password@example.org"]) assert.equal(privacyPolicyConfiguration(value).state, "invalid");
});
test("Release HealthKit requests only the shipping verified metrics; Debug retains inspection types", async () => {
  const swift = await read("ios/App/App/EquanimityHealthKitPlugin.swift");
  const definitions = swift.slice(swift.indexOf("private let requestedDefinitions"), swift.indexOf("@objc func isAvailable"));
  const release = definitions.replace(/#if DEBUG[\s\S]*?#endif/g, "");
  for (const type of ["basalBodyTemperature", "menstrualFlow", "cervicalMucusQuality"]) assert.ok(release.includes(type));
  assert.doesNotMatch(release, /sleepAnalysis|ovulationTestResult|sexualActivity/);
  assert.match(definitions, /#if DEBUG[\s\S]*sleepAnalysis[\s\S]*ovulationTestResult[\s\S]*sexualActivity[\s\S]*#endif/);
  assert.match(swift, /requestAuthorization\(toShare: \[\], read:/);
  const plist = await read("ios/App/App/Info.plist");
  assert.match(plist, /optionally reads basal body temperature, menstrual flow, and cervical mucus/);
  assert.doesNotMatch(plist, /NSHealthUpdateUsageDescription/);
});
test("backup protection targets only the app's WebKit directory, before web creation and on foreground", async () => {
  const [safety, app, scene, bridge, project] = await Promise.all([
    read("ios/App/App/EquanimityBackupSafety.swift"), read("ios/App/App/AppDelegate.swift"),
    read("ios/App/App/SceneDelegate.swift"), read("ios/App/App/EquanimityBridgeViewController.swift"), read("ios/App/App.xcodeproj/project.pbxproj")]);
  assert.match(safety, /appendingPathComponent\("WebKit", isDirectory: true\)/);
  assert.match(safety, /values\.isExcludedFromBackup = true/);
  assert.match(safety, /isSymbolicLink != true/);
  assert.doesNotMatch(safety, /removeItem|moveItem|contentsOfDirectory|enumerator|UserDefaults|nonPersistent/);
  assert.match(app, /didFinishLaunchingWithOptions[\s\S]*protectDeviceStorage\(\)/);
  assert.match(scene, /sceneDidBecomeActive[\s\S]*protectDeviceStorage\(\)/);
  assert.match(bridge, /#if DEBUG[\s\S]*__EQUANIMITY_DEVELOPMENT_TOOLS__[\s\S]*#endif/);
  assert.equal((project.match(/fileRef = 8A1B7C104E5F678901234567/g) ?? []).length, 1);
});
