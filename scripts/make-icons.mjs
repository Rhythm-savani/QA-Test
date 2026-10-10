// Generates placeholder PNG icons (graphite rounded square with a teal check) without dependencies.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(out, { recursive: true });

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.25;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x + 0.5, r), size - r);
      const cy = Math.min(Math.max(y + 0.5, r), size - r);
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
      const s = size / 28;
      const d = Math.min(
        distToSegment(x + 0.5, y + 0.5, 8 * s, 14.5 * s, 12 * s, 18.5 * s),
        distToSegment(x + 0.5, y + 0.5, 12 * s, 18.5 * s, 20 * s, 9.5 * s),
      );
      const i = y * (size * 4 + 1) + 1 + x * 4;
      if (!inside) raw.set([0, 0, 0, 0], i);
      else if (d <= 1.5 * s) raw.set([0x5e, 0xe0, 0xd6, 255], i);
      else raw.set([0x14, 0x17, 0x1c, 255], i);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(resolve(out, `icon-${s}.png`), render(s));
console.log('icons written to public/');
