import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete Yi experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Yi — practice, cycle &amp; wellbeing<\/title>/i);
  assert.match(html, /Good morning, Yi\./);
  assert.match(html, /Meditation timer/);
  assert.match(html, />Custom<\/button>/);
  assert.match(html, /Journal prompt/);
  assert.match(html, /Start writing/);
  assert.match(html, /Manage insight widgets/);
  assert.doesNotMatch(html, /Building your site|codex-preview/);
});

test("keeps durable timers and responsive controls in the product source", async () => {
  const [page, css, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /yi-active-practice/);
  assert.match(page, /Date\.now\(\) \+ remaining \* 1000/);
  assert.match(page, /Notification\.requestPermission/);
  assert.match(page, /journalPrompts/);
  assert.match(page, /Edit reflection/);
  assert.doesNotMatch(page, />Felt</);
  assert.match(css, /\.gong-mark:after/);
  assert.match(css, /@media \(max-width:360px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(layout, /Yi — practice, cycle & wellbeing/);
});
