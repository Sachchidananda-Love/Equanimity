import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import YiApp from "../app/YiApp.tsx";
import { createCloudSession } from "../src/services/cloud-session.ts";
import { createWidgetHold, widgetOwnsGesture } from "../src/application/widget-hold.ts";
import { rangeValueAtPosition } from "../src/application/RangeInput.tsx";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const point = (clientX = 20, clientY = 20, pointerId = 1) => ({ clientX, clientY, pointerId });

test("long press opens edit once; vertical movement cancels before the hold threshold", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = createWidgetHold();
  let edits = 0;
  hold.start(point(), () => edits++);
  t.mock.timers.tick(200);
  hold.move(point(20, 27));
  t.mock.timers.tick(500);
  assert.equal(edits, 0);
  hold.start(point(), () => edits++);
  t.mock.timers.tick(450);
  t.mock.timers.tick(1000);
  assert.equal(edits, 1);
});

test("cancel, pointer release, replacement and teardown cannot fire stale holds", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = createWidgetHold();
  let edits = 0;
  hold.start(point(), () => edits++);
  hold.cancel(1);
  t.mock.timers.tick(450);
  assert.equal(edits, 0);
  hold.start(point(), () => edits += 100);
  hold.start(point(20, 20, 2), () => edits++);
  hold.cancel(1); // another pointer does not cancel the current hold
  t.mock.timers.tick(450);
  assert.equal(edits, 1);
  hold.start(point(), () => edits++);
  hold.cancel();
  t.mock.timers.tick(1000);
  assert.equal(edits, 1);
});

test("ranges, labels, buttons and nested overflow content do not arm widget holds", () => {
  const dom = new JSDOM('<div id="widget"><label><span>Energy</span><input type="range"></label><button>Open</button><p>Plain card</p><div style="overflow-y:auto"><span id="scroll">Scrollable quote</span></div></div>');
  try {
    const doc = dom.window.document, widget = doc.getElementById("widget");
    for (const selector of ["input", "label span", "button"]) assert.equal(widgetOwnsGesture(widget.querySelector(selector), widget), true);
    assert.equal(widgetOwnsGesture(widget.querySelector("p"), widget), false);
    const scroll = doc.getElementById("scroll");
    Object.defineProperty(scroll.parentElement, "scrollHeight", { value: 200 });
    Object.defineProperty(scroll.parentElement, "clientHeight", { value: 80 });
    assert.equal(widgetOwnsGesture(scroll, widget), true);
  } finally { dom.window.close(); }
});

test("gesture CSS allows page/slider vertical pans without changing native thumb visuals", async () => {
  const [ranges, global, cycle] = await Promise.all(["../src/application/sliders.css", "../app/globals.css", "../src/application/body-cycle.css"].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(ranges, /height: 44px/);
  assert.match(ranges, /touch-action: pan-y pinch-zoom/);
  assert.doesNotMatch(ranges, /touch-action: none|slider-thumb|appearance: none|position: absolute/);
  assert.match(global, /html,body \{ touch-action:auto; \}/);
  assert.match(global, /\.dashboard-grid\.editing \.dashboard-widget \{[^}]*touch-action:auto/);
  assert.doesNotMatch(global, /\.dashboard-grid\.editing \.dashboard-widget \{[^}]*touch-action:none/);
  assert.match(global, /\.dashboard-grid\.editing \.drag-widget-handle \{[^}]*touch-action:none/);
  assert.match(cycle, /\.body-cycle-scroll \{[^}]*touch-action:auto/);
});

async function mounted(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://synthetic.invalid/", pretendToBeVisual: true });
  const keys = ["window", "document", "HTMLElement", "HTMLCanvasElement", "CustomEvent", "Event", "Element", "getComputedStyle"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  dom.window.HTMLElement.prototype.animate = () => ({ cancel() {} });
  const captured = new Map();
  dom.window.HTMLElement.prototype.setPointerCapture = function(id) { captured.set(id, this); };
  dom.window.HTMLElement.prototype.hasPointerCapture = function(id) { return captured.get(id) === this; };
  dom.window.HTMLElement.prototype.releasePointerCapture = function(id) { captured.delete(id); };
  const session = createCloudSession(async () => { throw new Error("Synthetic local test must not connect"); });
  // React's input-event capability check must see a DOM at module initialization.
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(YiApp, { initialNow: 1791475200000, session }))); await delay(30); });
    await run(dom, captured);
  } finally {
    await act(async () => root.unmount());
    assert.equal(captured.size, 0, "unmount releases pointer capture");
    dom.window.close();
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}
async function pointer(node, type, details = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, point(), { button: 0, isPrimary: true, pointerType: "touch" }, details);
  await act(async () => node.dispatchEvent(event));
  return event;
}
async function click(node) { assert.ok(node); await act(async () => node.click()); }
async function rangeValue(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(node, String(value));
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("track coordinate mapping respects endpoints, bounds, nonzero minimum and step", () => {
  const input = { min: "0", max: "100", step: "1", dir: "" };
  assert.equal(rangeValueAtPosition(input, 125, 100, 200), 13);
  assert.equal(rangeValueAtPosition(input, 200, 100, 200), 50);
  assert.equal(rangeValueAtPosition(input, 500, 100, 200), 100);
  assert.equal(rangeValueAtPosition(input, 0, 100, 200), 0);
  assert.equal(rangeValueAtPosition({ ...input, min: "1", max: "120" }, 200, 100, 200), 61);
  assert.equal(rangeValueAtPosition({ ...input, step: "5" }, 246, 100, 200), 75);
  assert.equal(rangeValueAtPosition({ ...input, step: "0.1", max: "1" }, 245, 100, 200), 0.7);
  assert.equal(rangeValueAtPosition({ ...input, dir: "rtl" }, 150, 100, 200), 75);
  assert.equal(rangeValueAtPosition(input, 200, 100, 0), 0);
});

function trackGeometry(range) {
  range.getBoundingClientRect = () => ({ left: 100, top: 0, width: 200, height: 44, right: 300, bottom: 44 });
}

test("native track taps remain native; touch drag away from thumb updates on the first gesture", async () => {
  await mounted(async (_dom, captured) => {
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Practice")));
    const range = document.querySelector(".gong-range");
    trackGeometry(range);
    for (const [x, value] of [[100, 1], [200, 61], [300, 120]]) {
      assert.equal((await pointer(range, "pointerdown", { clientX: x })).defaultPrevented, false);
      // JSDOM has no native range tap hit-testing. Deliver the browser's input
      // event explicitly; the enhancement must not cancel/replace native taps.
      await rangeValue(range, value);
      assert.equal(captured.size, 0, "tap never explicitly captures");
      await pointer(range, "pointerup", { clientX: x });
      assert.equal(document.querySelector(".gong-minute-input").value, String(value));
    }
    await rangeValue(range, 1); // thumb is at the far left
    await pointer(range, "pointerdown", { clientX: 200 });
    await pointer(range, "pointermove", { clientX: 203 });
    assert.equal(captured.size, 0, "tiny wobble is not horizontal intent");
    await pointer(range, "pointermove", { clientX: 220 });
    assert.equal(captured.size, 1);
    assert.equal(document.querySelector(".gong-minute-input").value, "72");
    await pointer(range, "pointermove", { clientX: 250 });
    assert.equal(document.querySelector(".gong-minute-input").value, "90");
    await rangeValue(range, 20); // an overlapping native thumb event cannot steal ownership
    assert.equal(range.value, "90");
    assert.equal(document.querySelector(".gong-minute-input").value, "90");
    await pointer(range, "pointermove", { clientX: 150, pointerId: 2 });
    assert.equal(range.value, "90", "other finger does not adjust this drag");
    await pointer(range, "pointerup", { clientX: 290 });
    assert.equal(range.value, "114");
    assert.equal(captured.size, 0);
    await rangeValue(range, 25);
    assert.equal(range.value, "25", "native input updates work after drag release");
  });
});

test("vertical or ambiguous swipes never engage custom dragging or cancel native scrolling", async () => {
  await mounted(async (_dom, captured) => {
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Practice")));
    const range = document.querySelector(".gong-range");
    trackGeometry(range);
    await rangeValue(range, 31);
    assert.equal((await pointer(range, "pointerdown", { clientX: 200 })).defaultPrevented, false);
    assert.equal((await pointer(range, "pointermove", { clientX: 205, clientY: 24 })).defaultPrevented, false);
    assert.equal(captured.size, 0, "diagonal movement without clear horizontal intent waits");
    assert.equal(range.value, "31");
    assert.equal((await pointer(range, "pointermove", { clientX: 203, clientY: 45 })).defaultPrevented, false);
    await pointer(range, "pointermove", { clientX: 270, clientY: 46 });
    assert.equal(range.value, "31", "vertical intent cannot later turn into a slider drag");
    assert.equal(captured.size, 0);
    await pointer(range, "pointercancel");
    await pointer(range, "pointerdown", { clientX: 180 });
    await pointer(range, "pointermove", { clientX: 210, clientY: 24 });
    assert.equal(captured.size, 1, "next horizontal gesture works on first attempt");
    await pointer(range, "pointercancel");
    assert.equal(captured.size, 0);
  });
});

test("slider end, cancel, capture loss, background, keyboard and unmount clean up ownership", async () => {
  await mounted(async (_dom, captured) => {
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Practice")));
    const range = document.querySelector(".gong-range");
    trackGeometry(range);
    const begin = async () => {
      await pointer(range, "pointerdown", { clientX: 150 });
      await pointer(range, "pointermove", { clientX: 230 });
      assert.equal(captured.size, 1);
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      await begin();
      if (type === "lostpointercapture") captured.delete(1); // browser has already relinquished capture
      await pointer(range, type, { clientX: 240 });
      assert.equal(captured.size, 0);
    }
    await begin();
    await pointer(range, "lostpointercapture"); // native/internal handoff, our new capture remains pending
    assert.equal(captured.size, 1);
    await act(async () => window.dispatchEvent(new window.Event("blur")));
    assert.equal(captured.size, 0);
    await begin();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    assert.equal(captured.size, 0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await begin();
    const key = new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    await act(async () => range.dispatchEvent(key));
    assert.equal(captured.size, 0);
    assert.equal(key.defaultPrevented, false);
    await rangeValue(range, 12); // model a native keyboard/assistive input
    assert.equal(document.querySelector(".gong-minute-input").value, "12");
    await begin(); // mounted fixture asserts release on unmount
  });
});

test("mounted dashboard lets vertical swipes through and captures only explicit edit handles", async () => {
  await mounted(async (_dom, captured) => {
    const widget = document.querySelector(".dashboard-widget");
    assert.ok(widget);
    const down = await pointer(widget, "pointerdown");
    assert.equal(down.defaultPrevented, false);
    await pointer(widget, "pointermove", { clientY: 40 });
    await act(async () => delay(470));
    assert.equal(document.querySelector(".dashboard-grid").classList.contains("editing"), false);
    assert.equal(captured.size, 0);
    await pointer(widget, "pointerdown");
    await pointer(widget, "pointercancel");
    await act(async () => delay(470));
    assert.equal(document.querySelector(".dashboard-grid").classList.contains("editing"), false);
    await pointer(widget, "pointerdown");
    await act(async () => delay(470));
    assert.equal(document.querySelector(".dashboard-grid").classList.contains("editing"), true);
    assert.equal(captured.size, 0, "long press opens editing without stealing the ongoing native gesture");
    const clickAfterHold = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => widget.dispatchEvent(clickAfterHold));
    assert.equal(clickAfterHold.defaultPrevented, true, "hold does not also activate a card");
    await pointer(widget, "pointerup");
    assert.equal((await pointer(widget, "pointerdown")).defaultPrevented, false);
    assert.equal(captured.size, 0, "card body does not steal a scroll");
    const handle = widget.querySelector(".drag-widget-handle");
    assert.equal((await pointer(handle, "pointerdown")).defaultPrevented, true);
    assert.equal(captured.size, 1);
    await pointer(handle, "pointerup", { pointerId: 2 });
    assert.equal(captured.size, 1, "unrelated finger cannot finish the drag");
    await pointer(widget, "pointercancel");
    assert.equal(captured.size, 0);
    assert.equal(widget.classList.contains("dragging"), false);
    await pointer(handle, "pointerdown");
    await pointer(widget, "lostpointercapture");
    assert.equal(captured.size, 0);
    assert.equal(widget.classList.contains("dragging"), false);
    await pointer(handle, "pointerdown"); // fixture verifies capture cleanup on unmount
  });
});

test("mounted native range leaves pointer/keyboard default behavior intact and never locks the page", async () => {
  await mounted(async (_dom, captured) => {
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Practice")));
    const range = document.querySelector(".gong-range");
    assert.ok(range);
    assert.equal(range.type, "range");
    assert.equal(range.disabled, false);
    assert.ok(range.labels.length);
    await rangeValue(range, 12);
    assert.equal(document.querySelector(".gong-minute-input").value, "12", "first native input event updates the UI");
    for (const type of ["pointerdown", "pointermove", "pointercancel", "pointerdown", "pointerup"]) {
      assert.equal((await pointer(range, type, { clientY: type === "pointermove" ? 70 : 20 })).defaultPrevented, false);
    }
    assert.equal(captured.size, 0);
    const key = new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    range.dispatchEvent(key);
    assert.equal(key.defaultPrevented, false);
    assert.notEqual(document.body.style.overflow, "hidden");
    assert.equal(document.querySelector(".app-shell").hasAttribute("inert"), false);
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Journal")));
    await act(async () => window.dispatchEvent(new window.CustomEvent("yi-journal-compose", { detail: "reflection" })));
    const assessment = document.querySelector('.sliders input[type="range"]');
    assert.ok(assessment);
    await rangeValue(assessment, 47);
    assert.equal(assessment.closest("label").querySelector("output").textContent, "47%");
    await rangeValue(assessment, 0);
    assert.equal(assessment.closest("label").querySelector("output").textContent, "N/A");
    assert.equal((await pointer(document.querySelector(".sliders label"), "pointerdown")).defaultPrevented, false);
    assert.ok(document.querySelector(".journal-entry-modal"), "slider gestures do not dismiss the modal");
    await click(document.querySelector(".journal-entry-modal .close-button"));
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Insights")));
    await click(document.querySelector(".dashboard-cycle-checkin button"));
    const scales = [...document.querySelectorAll('.cycle-scales input[type="range"]')];
    assert.equal(scales.length, 3);
    for (const scale of scales) {
      await rangeValue(scale, 65);
      assert.equal(scale.closest("label").querySelector("output").textContent, "65%");
      assert.equal((await pointer(scale, "pointermove", { clientY: 60 })).defaultPrevented, false);
    }
    await click(document.querySelector(".cycle-log-modal .close-button"));
    await click([...document.querySelectorAll(".bottom-nav button")].find(button => button.textContent.includes("Practice")));
    await click(document.querySelector(".save-current"));
    const savedRange = document.querySelector('.repeat-slider input[type="range"]');
    assert.ok(savedRange);
    await rangeValue(savedRange, 17);
    assert.equal(document.querySelector(".repeat-controls input[type=number]").value, "17");
  });
});
