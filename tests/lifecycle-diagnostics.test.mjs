import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { lifecycleDiagnosticsEnabled, lifecycleLog, lifecycleMeasure, observeUiDiagnostics } from "../src/platform/lifecycle-log.ts";

test("native DEBUG diagnostics use elapsed markers, strip private payloads and bound repeated events", () => {
  const previous = globalThis.window, debug = console.debug, lines = [];
  globalThis.window = { __EQUANIMITY_LIFECYCLE_DEBUG__: true };
  console.debug = (...args) => lines.push(args);
  try {
    assert.equal(lifecycleDiagnosticsEnabled(), true);
    for (let i = 0; i < 2000; i++) lifecycleLog("diagnostic repeat test", { pending: 2, phase: "idle", uid: "NEVER_LOG_UID", record: { note: "NEVER_LOG_NOTE" }, elapsedMs: 3 });
    assert.ok(lines.length < 25); assert.ok(lines.some(([marker]) => marker.endsWith("#1024")));
    assert.match(lines[0][0], /^\[Equanimity diag\] \+\d+ms diagnostic repeat test #1$/);
    assert.doesNotMatch(JSON.stringify(lines), /NEVER_LOG/);
    assert.equal(lifecycleMeasure("return test", () => 4), 4);
    assert.throws(() => lifecycleMeasure("throw test", () => { throw new Error("synthetic"); }), /synthetic/);
    assert.ok(lines.some(([marker]) => marker.includes("throw test end")));
    globalThis.window.__EQUANIMITY_LIFECYCLE_DEBUG__ = false;
    const count = lines.length; lifecycleLog("disabled diagnostic test");
    assert.equal(lines.length, count);
  } finally { console.debug = debug; if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test("diagnostic heartbeat and error/pointer handlers stop on cleanup without recovery or data work", () => {
  const previous = globalThis.window, debug = console.debug, lines = [];
  const dom = new JSDOM(); const target = dom.window; target.__EQUANIMITY_LIFECYCLE_DEBUG__ = true;
  let beat, cleared = 0;
  target.setInterval = callback => { beat = callback; return 1; }; target.clearInterval = () => cleared++;
  globalThis.window = target; console.debug = (...args) => lines.push(args);
  try {
    const off = observeUiDiagnostics(target);
    for (let i = 0; i < 60; i++) beat(); assert.equal(cleared, 1);
    target.dispatchEvent(new target.Event("pointerdown")); target.dispatchEvent(new target.Event("error")); target.dispatchEvent(new target.Event("unhandledrejection"));
    assert.ok(lines.some(([marker]) => marker.includes("UI pointer received")));
    assert.ok(lines.some(([marker]) => marker.includes("unexpected JS error")));
    off(); const count = lines.length;
    target.dispatchEvent(new target.Event("pointerdown")); target.dispatchEvent(new target.Event("error")); target.dispatchEvent(new target.Event("unhandledrejection"));
    assert.equal(lines.length, count); assert.equal(cleared, 2);
  } finally { console.debug = debug; dom.window.close(); if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
