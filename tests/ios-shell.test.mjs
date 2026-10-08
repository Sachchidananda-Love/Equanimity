import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import config from "../capacitor.config.ts";
import { verifyIosShell } from "../scripts/verify-ios-shell.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("iOS uses the standalone output, durable identity and no remote development server", () => {
  assert.equal(config.appName, "Equanimity"); assert.equal(config.appId, "win.calemandersonbar.equanimity");
  assert.equal(config.webDir, "dist-mobile");
  assert.deepEqual(config.server, { hostname: "equanimity.local", iosScheme: "capacitor" });
});
test("Capacitor packages are pinned together; prepare stops on build or sync failure", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.dependencies["@capacitor/core"], "8.5.2"); assert.equal(pkg.dependencies["@capacitor/ios"], "8.5.2"); assert.equal(pkg.devDependencies["@capacitor/cli"], "8.5.2");
  assert.equal(pkg.scripts["ios:prepare"], "npm run ios:build-web && npm run ios:sync");
  assert.match(pkg.scripts["ios:build-web"], /build:standalone/); assert.match(pkg.scripts["ios:sync"], /cap sync ios/);
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ["@capacitor/android", "@capacitor/push-notifications", "@capacitor-firebase/authentication"]) assert.equal(all[name], undefined);
});
test("native project is SPM-only, uses web Firebase, and declares read-only HealthKit safely", async () => {
  const [swift, plist, project, entitlements, ignore] = await Promise.all([read("ios/App/CapApp-SPM/Package.swift"), read("ios/App/App/Info.plist"), read("ios/App/App.xcodeproj/project.pbxproj"), read("ios/App/App/App.entitlements"), read(".gitignore")]);
  assert.match(swift, /exact: "8\.5\.2"/); assert.match(plist, /<string>Equanimity<\/string>/);
  assert.equal((project.match(/IPHONEOS_DEPLOYMENT_TARGET = 15\.4;/g) ?? []).length, 4);
  assert.match(plist, /NSHealthShareUsageDescription/); assert.match(entitlements, /com\.apple\.developer\.healthkit/); assert.match(project, /HealthKit\.framework/);
  assert.doesNotMatch(swift + plist + project, /firebase-ios-sdk|GoogleService-Info|Tempdrop|aps-environment|NSAllowsArbitraryLoads|UIBackgroundModes/);
  assert.match(ignore, /\/ios\/App\/App\/public\//); assert.doesNotMatch(ignore, /^\/ios\/$/m);
});
test("synced native asset bundle is complete and identical to dist-mobile", async () => {
  await verifyIosShell();
});
