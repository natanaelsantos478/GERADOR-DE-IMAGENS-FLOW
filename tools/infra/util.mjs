import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RAW = path.resolve(HERE, '../.cache/raw');
export const OUT = path.resolve(HERE, '../../public/data');
export const R_EARTH_KM = 6371.0088;

export function haversineKm(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const round = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function writeJson(file, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, file);
  fs.writeFileSync(p, JSON.stringify(obj));
  return fs.statSync(p).size;
}

/** Douglas-Peucker over flat [x,y,...] points; tolerance in km, local equirectangular metric. Returns kept point indices. */
export function simplifyIdx(pts, n, tolKm) {
  if (n <= 2) return n === 2 ? [0, 1] : [0];
  let latMid = 0;
  for (let i = 0; i < n; i++) latMid += pts[2 * i + 1];
  latMid /= n;
  const kx = 111.32 * Math.cos((latMid * Math.PI) / 180), ky = 110.57;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const j = stack.pop(), i = stack.pop();
    if (j <= i + 1) continue;
    const ax = pts[2 * i] * kx, ay = pts[2 * i + 1] * ky, bx = pts[2 * j] * kx, by = pts[2 * j + 1] * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let k = i + 1; k < j; k++) {
      const px = pts[2 * k] * kx - ax, py = pts[2 * k + 1] * ky - ay;
      let d2;
      if (L2 === 0) d2 = px * px + py * py;
      else {
        let t = (px * dx + py * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - t * dx, qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > best) { best = d2; bi = k; }
    }
    if (best > tolKm * tolKm) { keep[bi] = 1; stack.push(i, bi, bi, j); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, rk = k[0], rv = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [rk, rv];
  }
}
