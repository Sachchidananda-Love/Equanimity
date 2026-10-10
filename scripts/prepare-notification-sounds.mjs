import { mkdir, readFile, writeFile } from "node:fs/promises";

// Mechanical asset preparation only. Existing foreground media is untouched.
// Apple requires notification alerts <30s. Gong 2 has a 52s decay: retain its
// first 29s and gently fade only the last second. All other WAVs copy byte-for-byte.
const output = new URL("../ios/App/NotificationSounds/", import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ["gong-1.wav", "gong-2.wav", "gong-3.wav", "tripple-gong.wav"]) {
  const source = await readFile(new URL(`../public/gong-sounds/${file}`, import.meta.url));
  let format, pcm;
  for (let offset = 12; offset + 8 <= source.length;) {
    const size = source.readUInt32LE(offset + 4);
    const chunk = source.subarray(offset + 8, offset + 8 + size);
    const tag = source.toString("ascii", offset, offset + 4);
    if (tag === "fmt ") format = chunk;
    if (tag === "data") pcm = chunk;
    offset += 8 + size + size % 2;
  }
  if (!format || !pcm || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) throw new Error(`Unsupported PCM WAV: ${file}`);
  const rate = format.readUInt32LE(4), channels = format.readUInt16LE(2), align = channels * 2;
  const duration = pcm.length / (rate * align);
  let bytes = source;
  if (duration >= 30) {
    if (file !== "gong-2.wav") throw new Error(`Review unexpected long gong: ${file}`);
    const frames = rate * 29;
    const data = Buffer.from(pcm.subarray(0, frames * align));
    for (let frame = frames - rate; frame < frames; frame++) {
      const gain = (frames - 1 - frame) / (rate - 1);
      for (let channel = 0; channel < channels; channel++) {
        const index = frame * align + channel * 2;
        data.writeInt16LE(Math.round(data.readInt16LE(index) * gain), index);
      }
    }
    const header = Buffer.alloc(44);
    header.write("RIFF"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16); format.copy(header, 20, 0, 16);
    header.write("data", 36); header.writeUInt32LE(data.length, 40);
    bytes = Buffer.concat([header, data]);
  }
  await writeFile(new URL(`equanimity-${file}`, output), bytes);
  console.log(`Notification sound equanimity-${file}: ${Math.min(duration, 29).toFixed(6)}s, PCM 16-bit ${rate}Hz (${duration >= 30 ? "shortened decay" : "unchanged"}).`);
}
