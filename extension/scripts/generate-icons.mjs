#!/usr/bin/env node
// Generates minimal valid PNGs for the extension icons. No extra dependencies —
// uses only Node built-ins (zlib for DEFLATE, fs for writing).
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "../icons");

// CRC32 for PNG chunk integrity
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(d.length);
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crcVal]);
}

// Indigo-600 (#4f46e5) icon with a subtle envelope shape drawn in white
function generatePNG(size) {
  const BG = [79, 70, 229]; // indigo-600
  const FG = [255, 255, 255];

  // Pixel painter: envelope outline inside a rounded-ish square
  const pixels = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      const nx = x / size; // 0..1
      const ny = y / size;
      // Envelope body: 15%–85% x, 25%–75% y
      const inBody = nx > 0.15 && nx < 0.85 && ny > 0.25 && ny < 0.75;
      // Top flap (V): triangular region above mid-line of envelope
      const midY = 0.5;
      const distFromCenterX = Math.abs(nx - 0.5);
      const inFlap = ny > 0.25 && ny < midY && inBody && ny < 0.25 + (0.5 - distFromCenterX) * 0.5;
      if (!inBody) return BG;
      // Border of envelope (1px equiv at 128px = ~0.8%)
      const t = 0.018;
      const onBorder =
        nx < 0.15 + t || nx > 0.85 - t || ny < 0.25 + t || ny > 0.75 - t || Math.abs(ny - (0.25 + (0.5 - distFromCenterX) * 0.5)) < t;
      if (inFlap && onBorder) return FG;
      if (!inFlap && onBorder) return FG;
      return BG;
    }),
  );

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rowSize = 1 + size * 3;
  const raw = Buffer.allocUnsafe(size * rowSize);
  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const off = y * rowSize + 1 + x * 3;
      const [r, g, b] = pixels[y][x];
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(iconsDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const path = join(iconsDir, `icon${size}.png`);
  writeFileSync(path, generatePNG(size));
  console.log(`wrote ${path}`);
}
