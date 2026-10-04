import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

/** Checks only public web configuration. Never prints configuration values. */
export async function verifyIosWeb() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const env = loadEnv("production", root, "VITE_FIREBASE_");
  const output = new URL("../dist-mobile/", import.meta.url);
  const html = await readFile(new URL("index.html", output), "utf8");
  assert.match(html, /<head>/); assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /https?:\/\/|localhost|127\.0\.0\.1|_vinext|_next/i);
  const files = [];
  for (const name of await readdir(output, { recursive: true })) if ((await stat(new URL(name, output))).isFile()) files.push(name);
  const code = (await Promise.all(files.filter(name => name.endsWith(".js")).map(name => readFile(new URL(name, output), "utf8")))).join("\n");
  const compiledEnabled = /["'`]?VITE_FIREBASE_ENABLED["'`]?\s*:\s*["'`](true|false)["'`]/.exec(code)?.[1];
  assert.equal(compiledEnabled === "true", env.VITE_FIREBASE_ENABLED === "true", "Standalone Firebase enable flag is stale; rebuild before syncing");
  assert.ok(!/["'`]?VITE_FIREBASE_USE_EMULATORS["'`]?\s*:\s*["'`]true["'`]/.test(code), "Native assets must not enable loopback Firebase emulators");
  if (env.VITE_FIREBASE_ENABLED === "true") {
    assert.notEqual(env.VITE_FIREBASE_USE_EMULATORS, "true", "Native preparation must not bundle loopback Firebase emulators");
    for (const name of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"]) {
      const value = env[name];
      assert.ok(value?.trim() && !value.includes("REPLACE_"), `Missing public Firebase configuration: ${name}`);
      assert.ok(code.includes(value), `Standalone output is stale or missing ${name}; run npm run ios:build-web`);
    }
    console.log("iOS web assets: public Firebase configuration verified (values withheld); production service endpoints selected.");
  } else {
    console.log("iOS web assets: Firebase disabled; shell will use local development/fallback mode.");
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await verifyIosWeb();
