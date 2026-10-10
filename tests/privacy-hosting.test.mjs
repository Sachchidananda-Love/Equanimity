import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const config = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
const markdown = await readFile(new URL("../docs/privacy-policy.md", import.meta.url), "utf8");
const html = await readFile(new URL("../privacy-site/privacy/index.html", import.meta.url), "utf8");
const document = new JSDOM(html).window.document;
const normalized = text => text.replace(/\s+/g, " ").trim();

test("Hosting publishes only the separate privacy site and preserves backend config", () => {
  assert.equal(config.hosting.site, "equanimity-yi");
  assert.equal(config.hosting.public, "privacy-site");
  assert.equal(config.hosting.rewrites, undefined);
  assert.equal(config.hosting.predeploy, undefined);
  assert.deepEqual(config.firestore, { rules: "firestore.rules" });
  assert.deepEqual(config.emulators, {
    auth: { host: "127.0.0.1", port: 9099 },
    firestore: { host: "127.0.0.1", port: 8080 },
    ui: { enabled: false }, singleProjectMode: true,
  });
  assert.ok(config.hosting.redirects.some(rule => rule.source === "/" && rule.destination === "/privacy/"));
  const headers = config.hosting.headers.find(rule => rule.source === "**").headers;
  assert.ok(headers.some(header => header.key === "Content-Security-Policy" && header.value.includes("default-src 'none'")));
});

test("HTML and Markdown contain the same public policy", () => {
  const plain = markdown.replace(/^#{1,2} /gm, "").replace(/^- /gm, "")
    .replace(/\[([^\]]+)\]\(https:\/\/[^)]+\)/g, "$1");
  assert.equal(normalized(document.querySelector("main").textContent), normalized(plain));
  assert.equal(document.querySelector("h1").textContent, "Equanimity Privacy Policy");
  assert.doesNotMatch(markdown + html, /\[CONFIRM|\bTODO\b/);
  for (const text of [markdown, html]) {
    // Each outstanding value occurs only once per copy; allow replacing it before publishing.
    assert.ok((text.match(/PRIVACY_CONTACT_EMAIL/g) ?? []).length <= 1);
    assert.ok((text.match(/EFFECTIVE_DATE/g) ?? []).length <= 1);
  }
});

test("Accessible static page has no trackers, scripts, forms, or external assets", async () => {
  assert.equal(document.documentElement.lang, "en");
  assert.ok(document.querySelector('meta[name="viewport"]'));
  assert.equal(document.querySelectorAll("script, iframe, form, input, img, video, audio, object, embed").length, 0);
  assert.equal(document.querySelectorAll("main").length, 1);
  const styles = [...document.querySelectorAll('link[rel="stylesheet"]')];
  assert.deepEqual(styles.map(link => link.getAttribute("href")), ["/privacy/style.css"]);
  const css = await readFile(new URL("../privacy-site/privacy/style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /@import|url\(/i);
  assert.ok(css.includes("max-width:"));
  assert.ok(css.includes(":focus-visible"));
  assert.deepEqual((await readdir(new URL("../privacy-site/", import.meta.url))).sort(), ["privacy"]);
  assert.deepEqual((await readdir(new URL("../privacy-site/privacy/", import.meta.url))).sort(), ["index.html", "style.css"]);
});
