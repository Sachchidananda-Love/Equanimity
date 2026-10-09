import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createGongPlayer } from "../src/platform/gong-player.ts";

test("native playback dispatches once and returns immediately even while initialization is pending", async () => {
  let resolve, webCalls = 0;
  const files = [];
  const play = createGongPlayer({ isIos: () => true,
    playNative: file => { files.push(file); return new Promise(done => { resolve = done; }); },
    createAudio: () => { webCalls++; throw new Error("WK media must not be initialized"); },
  });
  assert.equal(play("capacitor://equanimity.local/gong-sounds/gong-1.wav"), undefined);
  assert.deepEqual(files, ["gong-1.wav"]); assert.equal(webCalls, 0);
  resolve({ played: true }); await Promise.resolve();
});

test("native rejection, synchronous failure and missing audio never fall back to WK media", async () => {
  for (const playNative of [() => Promise.reject(new Error("Synthetic native failure")), () => { throw new Error("Synthetic bridge failure"); }, () => Promise.resolve({ played: false })]) {
    let webCalls = 0;
    const play = createGongPlayer({ isIos: () => true, playNative,
      createAudio: () => { webCalls++; throw new Error("No web fallback"); },
    });
    assert.doesNotThrow(() => play("/gong-sounds/gong-2.wav"));
    await Promise.resolve(); assert.equal(webCalls, 0);
  }
});

test("browser playback preserves sounds/volume/replacement and ignores stale rejection", async () => {
  const players = [];
  const play = createGongPlayer({ isIos: () => false,
    createAudio: source => {
      const audio = { source, pauses: 0, pause() { this.pauses++; }, play() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); } };
      players.push(audio); return audio;
    },
    playNative: () => { throw new Error("Browser must not call native bridge"); },
  });
  play("/gong-sounds/gong-1.wav"); play("/gong-sounds/gong-2.wav");
  assert.equal(players[0].pauses, 1); assert.equal(players[0].currentTime, 0);
  assert.equal(players[1].volume, 0.82); assert.equal(players[1].source, "/gong-sounds/gong-2.wav");
  players[0].reject(new Error("Stale synthetic rejection")); await Promise.resolve();
  play("/gong-sounds/gong-3.wav"); assert.equal(players[1].pauses, 1);
  players[2].onended(); play("/gong-sounds/gong-1.wav"); assert.equal(players[2].pauses, 0);
  players.forEach(player => player.resolve()); await Promise.resolve();
});

test("browser audio construction/play failure is optional and never escapes into Start", async () => {
  for (const createAudio of [() => { throw new Error("Synthetic unavailable Audio"); }, () => ({ play() { throw new Error("Synthetic play failure"); } }), () => ({ play: () => Promise.reject(new Error("Synthetic playback rejection")) })]) {
    const play = createGongPlayer({ isIos: () => false, createAudio });
    assert.doesNotThrow(() => play("/gong-sounds/gong-1.wav")); await Promise.resolve();
  }
});

test("native player is registered/compiled, loads only bundled gongs, and keeps initialization off main", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [native, bridge, project] = await Promise.all([
    read("ios/App/App/EquanimityGongPlugin.swift"), read("ios/App/App/EquanimityBridgeViewController.swift"), read("ios/App/App.xcodeproj/project.pbxproj"),
  ]);
  assert.match(native, /audioQueue\.async[\s\S]*AVAudioPlayer\(contentsOf: url\)/);
  assert.match(native, /files\.contains\(file\)/); assert.match(native, /subdirectory: "public\/gong-sounds"/);
  assert.match(native, /players\[file\] = player/);
  assert.doesNotMatch(native, /DispatchQueue\.main|URLSession|WKWebView\(/);
  assert.match(bridge, /registerPluginInstance\(EquanimityGongPlugin\(\)\)/);
  assert.equal((project.match(/EquanimityGongPlugin.swift in Sources/g) ?? []).length, 2);
});
