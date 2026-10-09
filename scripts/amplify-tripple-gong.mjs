import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Asset-only gain: both native and web players keep their existing playback path.
// Refuse an unknown source so rerunning cannot accidentally amplify twice.
const target = new URL("../public/gong-sounds/tripple-gong.wav", import.meta.url);
const originalHash = "69ea3cbcb7ce83320b5aa24b69f3804f0b5a8e5d6407b373d85ddf023801ae6b";
const hash = buffer => createHash("sha256").update(buffer).digest("hex");
const source = await readFile(target), restored = Buffer.from(source);
let dataOffset, dataLength, pcm16 = false;
if (source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") throw new Error("Expected bundled WAV");
for (let offset = 12; offset + 8 <= source.length;) {
  const name = source.toString("ascii", offset, offset + 4), size = source.readUInt32LE(offset + 4);
  if (offset + 8 + size > source.length) throw new Error("Truncated WAV");
  if (name === "fmt ") pcm16 = size >= 16 && source.readUInt16LE(offset + 8) === 1 && source.readUInt16LE(offset + 22) === 16;
  if (name === "data") { dataOffset = offset + 8; dataLength = size; }
  offset += 8 + size + size % 2;
}
if (!pcm16 || dataOffset === undefined || !dataLength || dataLength % 2) throw new Error("Expected signed PCM16 samples");
for (let offset = dataOffset; offset < dataOffset + dataLength; offset += 2) restored.writeInt16LE(Math.trunc(source.readInt16LE(offset) / 3), offset);
if (hash(restored) === originalHash) {
  console.log("Tripple Gong already has 3x sample amplitude; unchanged.");
} else {
  if (hash(source) !== originalHash) throw new Error("Unknown Tripple Gong asset; refusing to overwrite");
  const amplified = Buffer.from(source);
  let peak = 0;
  for (let offset = dataOffset; offset < dataOffset + dataLength; offset += 2) {
    const sample = source.readInt16LE(offset) * 3;
    if (sample < -32768 || sample > 32767) throw new Error("3x would clip; original preserved");
    amplified.writeInt16LE(sample, offset); peak = Math.max(peak, Math.abs(sample));
  }
  await writeFile(target, amplified);
  console.log(`Tripple Gong amplified 3x (+9.54 dB), peak ${peak}/32768; no clipping. Other gongs untouched.`);
}
