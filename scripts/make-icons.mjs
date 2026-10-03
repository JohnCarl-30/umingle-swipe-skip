// Generates the extension icons (green rounded square with a ">>" skip mark)
// as PNGs without any image dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in unit coordinates (0..1).
const inRoundRect = (x, y, r) => {
  const dx = Math.max(r - x, 0, x - (1 - r)), dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r;
};
const distToSegment = (px, py, ax, ay, bx, by) => {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
};
const inChevron = (x, y, cx, w) =>
  distToSegment(x, y, cx - 0.12, 0.28, cx + 0.1, 0.5) <= w || distToSegment(x, y, cx + 0.1, 0.5, cx - 0.12, 0.72) <= w;

function render(size) {
  const ss = 4, out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + 0.5) / ss) / size, v = (y + (sy + 0.5) / ss) / size;
      if (!inRoundRect(u, v, 0.22)) continue;
      bg++;
      if (inChevron(u, v, 0.4, 0.065) || inChevron(u, v, 0.64, 0.065)) fg++;
    }
    const n = ss * ss, i = (y * size + x) * 4, a = bg / n, f = bg ? fg / bg : 0;
    // background #1f9d5a, mark white
    out[i] = Math.round(0x1f + (255 - 0x1f) * f);
    out[i + 1] = Math.round(0x9d + (255 - 0x9d) * f);
    out[i + 2] = Math.round(0x5a + (255 - 0x5a) * f);
    out[i + 3] = Math.round(a * 255);
  }
  return out;
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../static/icons/icon${size}.png`, import.meta.url), png(size, render(size)));
}
console.log('icons written');
