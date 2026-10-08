import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { verifyIosWeb } from "./verify-ios-web.mjs";

export async function verifyIosShell() {
  const root = new URL("../", import.meta.url);
  const config = JSON.parse(await readFile(new URL("ios/App/App/capacitor.config.json", root), "utf8"));
  assert.equal(config.appId, "win.calemandersonbar.equanimity");
  assert.equal(config.appName, "Equanimity"); assert.equal(config.webDir, "dist-mobile");
  assert.equal(config.server.hostname, "equanimity.local"); assert.equal(config.server.iosScheme, "capacitor");
  assert.ok(!config.server.url && !config.server.cleartext && !config.server.allowNavigation);
  const project = await readFile(new URL("ios/App/App.xcodeproj/project.pbxproj", root), "utf8");
  assert.match(project, /win\.calemandersonbar\.equanimity/); assert.match(project, /CapApp-SPM/);
  const swift = await readFile(new URL("ios/App/CapApp-SPM/Package.swift", root), "utf8");
  assert.match(swift, /capacitor-swift-pm/); assert.doesNotMatch(swift, /firebase|HealthKit|Tempdrop/i);
  const entitlements = await readFile(new URL("ios/App/App/App.entitlements", root), "utf8");
  const plist = await readFile(new URL("ios/App/App/Info.plist", root), "utf8");
  assert.match(entitlements, /com\.apple\.developer\.healthkit/);
  assert.match(plist, /NSHealthShareUsageDescription/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/);
  assert.match(project, /HealthKit\.framework/);
  await access(new URL("ios/App/App/Info.plist", root));
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const files = await verifyIosWeb();
  for (const name of files) {
    const source = new URL(`dist-mobile/${name}`, root); const copied = new URL(`ios/App/App/public/${name}`, root);
    const [a, b] = await Promise.all([readFile(source), readFile(copied)]);
    assert.equal(hash(a), hash(b), `Native copy differs: ${name}`);
  }
  console.log("iOS shell: durable identity, SPM, bundled origin and copied asset integrity verified.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await verifyIosShell();
