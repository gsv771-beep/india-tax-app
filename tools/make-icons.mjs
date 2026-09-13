// Generates the PWA icons (PNG) without any image library: a rounded green square with three rising bars.
// Usage: node tools/make-icons.mjs   -> public/icons/icon-192.png, icon-512.png, apple-touch-icon.png (180)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '../public/icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x14, 0x53, 0x2d], FG = [0xff, 0xff, 0xff], GOLD = [0xc9, 0xa2, 0x27];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// signed distance helpers for antialiasing
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => { const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r; };
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function icon(size, { transparentCorners }) {
  const s = size / 64; // design on a 64 grid
  const bars = [ // x, width, height (from a baseline at 48)
    { x: 16, w: 8, h: 14, c: FG }, { x: 28, w: 8, h: 22, c: FG }, { x: 40, w: 8, h: 32, c: GOLD },
  ];
  return png(size, (x, y) => {
    const dBg = sdRoundRect(x, y, size / 2, size / 2, size / 2, size / 2, 14 * s);
    const bgCov = transparentCorners ? cover(dBg) : 1;
    let col = BG, alpha = bgCov;
    for (const b of bars) {
      const d = sdRoundRect(x, y, (b.x + b.w / 2) * s, (48 - b.h / 2) * s, (b.w / 2) * s, (b.h / 2) * s, 2 * s);
      const c = cover(d);
      if (c > 0) col = mix(col, b.c, c);
    }
    return [...col, Math.round(alpha * 255)];
  });
}

writeFileSync(path.join(outDir, 'icon-192.png'), icon(192, { transparentCorners: true }));
writeFileSync(path.join(outDir, 'icon-512.png'), icon(512, { transparentCorners: true }));
writeFileSync(path.join(outDir, 'icon-maskable-512.png'), icon(512, { transparentCorners: false }));
writeFileSync(path.join(outDir, 'apple-touch-icon.png'), icon(180, { transparentCorners: false }));
console.log('Wrote icons to', outDir);
