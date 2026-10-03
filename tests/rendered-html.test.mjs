import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
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

test("server-renders the configured cloud sign-in boundary or local Yi experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Yi — practice, cycle &amp; wellbeing<\/title>/i);
  if (html.includes("Sign in to open your private cloud")) {
    assert.match(html, /Private cloud data is closed/);
    assert.match(html, /type="password"/);
    assert.match(html, /Use local-only development\/fallback data/);
    assert.doesNotMatch(html, /Your wellbeing|Meditation timer|Body &amp; cycle check-in/);
    return;
  }
  assert.match(html, /Your wellbeing/);
  assert.match(html, /Meditation timer/);
  assert.doesNotMatch(html, /Settle in\./);
  assert.match(html, />Custom<\/button>/);
  assert.match(html, /Journal prompt/);
  assert.match(html, /aria-label="Edit insights"/);
  assert.match(html, /Maintenance Yoga/);
  assert.match(html, /Work Out Yoga/);
  assert.match(html, /Log new book/);
  assert.match(html, /Books read/);
  assert.doesNotMatch(html, />Today</);
  assert.match(html, /Lunar phase/);
  assert.match(html, /Next full moon/);
  assert.match(html, /Quick reflection/);
  assert.match(html, /Rotating cube of personal photos/);
  assert.match(html, /Five spiritual faculties/);
  assert.match(html, /Three characteristics/);
  assert.match(html, /Five hindrances/);
  assert.doesNotMatch(html, /Current streak/);
  assert.doesNotMatch(html, /At least 1 hr\/day/);
  assert.doesNotMatch(html, /At least 10 min\/day/);
  assert.doesNotMatch(html, /What would help right now\?/);
  assert.doesNotMatch(html, /A thought to turn with/);
  assert.doesNotMatch(html, /Building your site|codex-preview/);
});

test("keeps durable timers and responsive controls in the product source", async () => {
  const [page, wrapper, css, layout, quotes] = await Promise.all([
    readFile(new URL("../app/YiApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/quotes.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /localStorage/);
  assert.match(page, /Date\.now\(\) \+ remaining \* 1000/);
  assert.match(page, /Notification\.requestPermission/);
  assert.match(page, /journalPrompts/);
  assert.match(page, /localRepository.loadQuote/);
  assert.match(page, /saved\.day === currentDay/);
  assert.match(page, /setQuotePosition\(dailyQuotePosition\(currentDay\)\)/);
  assert.match(page, /Edit reflection/);
  assert.match(page, /useAppData/);
  assert.match(page, /customGongSounds/);
  assert.match(page, /Repeating gong minutes/);
  assert.match(page, /AssessmentPatternChart/);
  assert.match(page, /Calculated from saved slider assessments/);
  assert.match(page, /Each saved slider check-in becomes a point/);
  assert.match(page, /ActivityHistoryChart/);
  assert.match(page, /Calculated from logged/);
  assert.match(page, /JournalEntryChooser/);
  assert.match(page, /CycleTrackingChart/);
  assert.match(page, /cervicalMucus/);
  assert.match(page, /sleepInterruptions/);
  assert.match(page, /PracticeRhythmChart/);
  assert.match(page, /Five spiritual faculties/);
  assert.match(page, /DefinitionModal/);
  assert.match(page, /definition-pagination/);
  assert.match(page, /mini-gong-mark/);
  assert.match(page, /JournalCalendar/);
  assert.match(page, /EntryAssessmentDetail/);
  assert.match(page, /ConfirmDeleteModal/);
  assert.match(page, /suggestedEntryTitle/);
  assert.match(page, /loggedAssessments/);
  assert.match(page, /Widget archive/);
  assert.match(page, /Next full moon/);
  assert.match(page, /dismissBackdrop/);
  assert.match(page, /saved-timer-open/);
  assert.match(page, /Back to practice/);
  assert.doesNotMatch(page, /className="round-play"/);
  assert.match(page, /Move any slider to begin logging/);
  assert.match(page, /setPointerCapture/);
  assert.match(page, /elementsFromPoint/);
  assert.match(page, /cubic-bezier\(\.2,\.8,\.2,1\)/);
  assert.match(page, /localRepository.loadPractice/);
  assert.match(page, /DataTools/);
  assert.match(page, /BookLogModal/);
  assert.match(page, /journalContexts/);
  assert.match(page, /loggedAt/);
  assert.match(page, /lunarPhase\(new Date\(now\)\)/);
  assert.match(page, /StableNowContext\.Provider value=\{stableNow\}/);
  assert.match(page, /cycleSummary/);
  assert.doesNotMatch(page, /new Date\(`\$\{log\.lastPeriod\}T12:00:00`\)/);
  assert.doesNotMatch(page, /const \[draftId\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.doesNotMatch(page, /if \(id === "lunar"\).*lunarPhase\(\)/);
  assert.match(wrapper, /dynamic = "force-dynamic"/);
  assert.match(wrapper, /initialNow=\{Date\.now\(\)\}/);
  assert.match(page, /Log book/);
  assert.match(page, /No dated books overlap this range/);
  assert.match(css, /\.moon-orb/);
  assert.match(css, /--moon-shift/);
  assert.match(css, /\.book-timeline/);
  assert.match(css, /grid-auto-rows:170px/);
  assert.match(css, /--compact-card-height:170px/);
  assert.match(css, /height:calc\(var\(--compact-card-height\) \* 2 \+ var\(--dashboard-card-gap\)\)/);
  assert.match(css, /Dashboard sizing system: small 1x1, medium 1x2, large 2x2/);
  assert.match(css, /\.dashboard-insight-meditation[^}]*grid-column:span 1!important/);
  assert.match(css, /\.dashboard-insight-practice[^}]*grid-column:span 2!important/);
  assert.match(css, /\.dashboard-daily-quote>:not\(\.remove-widget\):not\(\.drag-widget-handle\)/);
  assert.match(css, /\.dashboard-lunar>:not\(\.remove-widget\):not\(\.drag-widget-handle\)/);
  assert.match(css, /\.practice-total-summary[^}]*background:/);
  assert.doesNotMatch(page, /Current streak/);
  assert.doesNotMatch(page, /At least 1 hr\/day/);
  assert.doesNotMatch(page, /At least 10 min\/day/);
  assert.doesNotMatch(page, />Felt</);
  assert.match(css, /\.gong-mark:after/);
  assert.match(css, /\.segmented:before/);
  assert.match(css, /\.range-tabs:before/);
  assert.match(css, /\.assessment-chart canvas/);
  assert.match(css, /\.cube-face[^}]*background-size:cover/);
  assert.match(css, /\.activity-history-chart/);
  assert.match(css, /\.cycle-tracking-chart/);
  assert.match(css, /\.mini-gong-mark/);
  assert.match(css, /\.journal-calendar/);
  assert.match(css, /\.archive-widget-list/);
  assert.match(css, /\.cycle-analytics/);
  assert.match(css, /@media \(max-width:360px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(layout, /Yi — practice, cycle & wellbeing/);
  assert.doesNotMatch(layout, /suppresshydrationwarning/);
  assert.ok((quotes.match(/^ {2}"/gm) ?? []).length > 99, "Should include the expanded quote set from the Google Doc");

  assert.match(page, /"Gong 1": "\/gong-sounds\/gong-1\.wav"/);
  assert.match(page, /"Tripple Gong": "\/gong-sounds\/tripple-gong\.wav"/);
  const cubeSizes = await Promise.all(Array.from({ length: 41 }, (_, index) => stat(new URL(`../public/cube-media/cube-${String(index + 1).padStart(2, "0")}.jpg`, import.meta.url)).then((file) => file.size)));
  assert.ok(cubeSizes.every((size) => size < 100_000), "cube images should stay lightweight");
  const pictureFiles = (await readdir(new URL("../public/cube-media", import.meta.url))).filter((file) => /^picture-\d{2}\.jpg$/.test(file));
  assert.equal(pictureFiles.length, 43, "all Pictures for cube images should be included");
  const pictureSizes = await Promise.all(pictureFiles.map((file) => stat(new URL(`../public/cube-media/${file}`, import.meta.url)).then((entry) => entry.size)));
  assert.ok(pictureSizes.every((size) => size < 100_000), "source photos should be converted to lightweight thumbnails");
  assert.match(page, /picture-\$\{String\(index \+ 1\)\.padStart\(2, "0"\)\}\.jpg/);
  assert.doesNotMatch(page, /\/cube-media\/cube-/);
});
