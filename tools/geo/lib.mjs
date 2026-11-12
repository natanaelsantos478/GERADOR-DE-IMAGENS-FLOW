// Geometry / IO helpers shared by the geo pipeline (pure JS, no deps).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = path.join(ROOT, 'tools', '.cache');
export const OUT = path.join(ROOT, 'public', 'data');
export const R_KM = 6371.0088;

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const round = (v, d) => { const m = 10 ** d; return Math.round(v * m) / m; };

/** Normalises Polygon/MultiPolygon into an array of polygons (each = array of rings). */
export function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    s += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
  }
  return Math.abs(s) * R_KM * R_KM / 2;
}
export function polyAreaKm2(poly) {
  let a = ringArea(poly[0]);
  for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i]);
  return Math.max(a, 0);
}
export const geomAreaKm2 = (geom) => polygonsOf(geom).reduce((s, p) => s + polyAreaKm2(p), 0);

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInPoly(x, y, poly) {
  if (!pointInRing(x, y, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(x, y, poly[i])) return false;
  return true;
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Point guaranteed inside the largest part of the geometry (centroid, or widest horizontal chord midpoint). */
export function interiorPoint(geom) {
  const polys = polygonsOf(geom);
  if (!polys.length) return null;
  let best = polys[0], ba = -1;
  for (const p of polys) { const a = polyAreaKm2(p); if (a > ba) { ba = a; best = p; } }
  const [cx, cy] = ringCentroid(best[0]);
  if (pointInPoly(cx, cy, best)) return [cx, cy];
  // scan a few latitudes around centroid for the widest chord
  const ys = best[0].map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  let bw = -1, bp = null;
  for (let k = 1; k < 24; k++) {
    const y = y0 + ((y1 - y0) * k) / 24;
    const xs = [];
    for (const ring of best) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bw) { bw = w; bp = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
  }
  return bp || [cx, cy];
}

export function geomBbox(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polygonsOf(geom)) for (const [x, y] of poly[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/**
 * Even-odd scanline fill of polygons onto a W x H grid whose row 0 is at lat 90 (top) and col 0 at lon -180.
 * Cell centres are sampled. cb(row, colStart, colEndExclusive) is called per span.
 */
export function scanFill(polys, W, H, cb) {
  const dx = 360 / W, dy = 180 / H;
  const rows = new Map();
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;
      const ymin = Math.min(y1, y2), ymax = Math.max(y1, y2);
      const jA = Math.max(0, Math.ceil((90 - ymax) / dy - 0.5));
      const jB = Math.min(H - 1, Math.floor((90 - ymin) / dy - 0.5));
      for (let j = jA; j <= jB; j++) {
        const yc = 90 - (j + 0.5) * dy;
        if ((y1 <= yc) === (y2 <= yc)) continue;
        const x = x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1);
        let arr = rows.get(j);
        if (!arr) rows.set(j, (arr = []));
        arr.push(x);
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] + 180) / dx - 0.5));
      const b = Math.min(W, Math.ceil((xs[k + 1] + 180) / dx - 0.5));
      if (b > a) cb(j, a, b);
    }
  }
}

export const toBase64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

export function sizeMB(file) { return fs.statSync(file).size / 1048576; }
