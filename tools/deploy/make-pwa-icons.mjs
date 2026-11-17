#!/usr/bin/env node
/** Renders the PWA icons (public/pwa/*.png + icon.svg) with a tiny software rasteriser: no downloads, no deps. */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../../public/pwa/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** `pad`: fraction of the canvas kept as safe zone (maskable icons need ~20%). */
function render(size, pad) {
  const px = Buffer.alloc(size * size * 4);
  const BG = [11, 16, 22], OCEAN = [18, 62, 84], LINE = [63, 182, 201], ACC = [224, 166, 74];
  const cx = size / 2, R = size * (0.5 - pad) * 0.92, ss = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + 0.5) / ss - cx) / R, v = (y + (sy + 0.5) / ss - cx) / R;
      let col = BG;
      const r = Math.hypot(u, v);
      if (r <= 1) {
        col = mix(OCEAN, BG, Math.min(1, r * r * 0.5)); // shaded sphere
        const lat = Math.asin(-v), lon = Math.asin(Math.max(-1, Math.min(1, u / Math.cos(lat || 1e-9))));
        const w = 0.028;
        const nearLon = Math.abs(((lon * 180) / Math.PI + 90) % 30 - 15) > 15 - 1.6 && Math.abs(Math.cos(lat)) > 0.01;
        const nearLat = Math.abs(((lat * 180) / Math.PI + 90) % 30 - 15) > 15 - 1.6;
        if (nearLon || nearLat) col = mix(col, LINE, 0.55);
        if (Math.abs(u) < w * 1.4 && r <= 1) col = ACC; // central meridian
      }
      if (r > 0.985 && r < 1.04) col = mix(col, LINE, 0.9);
      acc = acc.map((a, i) => a + col[i]);
    }
    const o = (y * size + x) * 4;
    px[o] = acc[0] / (ss * ss); px[o + 1] = acc[1] / (ss * ss); px[o + 2] = acc[2] / (ss * ss); px[o + 3] = 255;
  }
  return png(size, px);
}

writeFileSync(new URL('icon-192.png', OUT), render(192, 0.06));
writeFileSync(new URL('icon-512.png', OUT), render(512, 0.06));
writeFileSync(new URL('maskable-512.png', OUT), render(512, 0.2));
writeFileSync(new URL('icon.svg', OUT), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b1016"/><circle cx="256" cy="256" r="220" fill="#123e54" stroke="#3fb6c9" stroke-width="8"/><g fill="none" stroke="#3fb6c9" stroke-opacity=".6" stroke-width="6"><ellipse cx="256" cy="256" rx="110" ry="220"/><path d="M36 256h440M70 150h372M70 362h372"/></g><path d="M256 36v440" stroke="#e0a64a" stroke-width="12"/></svg>\n`);
console.log('PWA icons written to public/pwa');
