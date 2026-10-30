import { inflateSync } from "node:zlib";
// Decode only the lossless RGB/RGBA PNG formats returned by Playwright screenshots.
export function decodeScreenshot(buffer) {
  let width, height, channels, offset = 8; const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12] !== 0) throw Error("Unsupported screenshot PNG format"); channels = data[9] === 2 ? 3 : 4; }
    if (type === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : NaN;
      if (!Number.isFinite(prediction)) throw Error("Unsupported PNG row filter");
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, pixel(x, y) { const i = Math.max(0, Math.min(height - 1, y)) * stride + Math.max(0, Math.min(width - 1, x)) * channels; return [...pixels.subarray(i, i + 3), channels === 4 ? pixels[i + 3] : 255]; } };
}
