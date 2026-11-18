/**
 * Vegetation mask of a z14 city tile read from the satellite imagery itself (the approach of Microsoft Flight Simulator's
 * tree placement): the vector land cover (OSM/Overture wood polygons) is often missing or coarse, so a forest that is
 * plainly green on the photo got only a handful of 3D trees. Each imagery pixel gets an excess-green vegetation index;
 * the mask stores, per ~5 m cell, the share of vegetated pixels. Trees are then planted where the photo is green.
 */
import { imageryTileUrl, type ImageryKind } from '../globe/imagery';
import { TZ, type TileRef } from './geo';

let kindOf: () => ImageryKind = () => 'esri';
/** The globe tells which imagery source is on screen (the mask must match what the player sees). */
export const setVegetationImagery = (f: () => ImageryKind) => { kindOf = f; };

export interface VegMask {
  /** cells per side */
  n: number;
  /** share of vegetated pixels per cell (0..1), row 0 = north */
  v: Float32Array;
  /** share of the whole tile that is vegetated */
  cover: number;
  /** vegetation share at tile-local metres (x east, y north from the centre) */
  at(x: number, y: number): number;
  /** mean vegetation share in the square of half-side `r` metres around a point (a forest is green all around; a backyard is not) */
  around(x: number, y: number, r: number): number;
}

/** Excess green on chromatic coordinates; shadows of a dense canopy are dark but still green-dominant, water is blue, roofs and roads grey. */
export function isVegetation(r: number, g: number, b: number): boolean {
  const s = r + g + b;
  if (s < 24 || s > 560) return false;
  return (2 * g - r - b) / s > 0.06 && g >= b;
}

const N = 1024;
async function image(url: string): Promise<ImageBitmap | null> {
  try { const r = await fetch(url, { mode: 'cors' }); return r.ok ? await createImageBitmap(await r.blob()) : null; } catch { return null; }
}

/**
 * Mask for tile `t` from the closest imagery that stays affordable: ESRI z17 (~1.2 m/px, 64 images per city tile; z18
 * would be 256 and the imagery server throttles bursts, which also starves the photo shown on the globe) (EOX stops at z13: no mask). Downloads are limited to 4 at a time. Null offline or when no image arrives.
 */
/** `'retry'`: the photo source is up but its images did not arrive (throttled / network): try again later instead of
 * planting from the polygons alone (those cover lakes and fields). */
export async function loadVegetation(t: TileRef, alive: () => boolean): Promise<VegMask | null | 'retry'> {
  const kind = kindOf();
  // EOX stops at z13, coarser than the city tile itself: no mask then (the vector polygons alone place the trees)
  if (kind !== 'esri') return null;
  const z = 17, f = 2 ** (z - TZ), px = 256 * f;
  const urls: { u: string; dx: number; dy: number }[] = [];
  for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const u = imageryTileUrl(kind, z, t.x * f + dx, t.y * f + dy); if (u) urls.push({ u, dx, dy }); }
  if (!urls.length) return null;
  const imgs: { u: string; dx: number; dy: number; img: ImageBitmap | null }[] = [];
  for (let i = 0; i < urls.length; i += 4) { imgs.push(...(await Promise.all(urls.slice(i, i + 4).map(async (q) => ({ ...q, img: await image(q.u) }))))); if (!alive()) break; }
  // one slower retry pass for the images that failed (bursts get throttled)
  const failed = imgs.filter((q) => !q.img);
  if (failed.length && failed.length < imgs.length * 0.9 && alive()) {
    await new Promise((r) => setTimeout(r, 1200));
    for (const q of failed) { if (!alive()) break; q.img = await image(q.u); }
  }
  // a missing image (the server has none over open sea, or one request failed) counts as "no green" there; only a tile
  // with no image at all falls back to the polygons
  if (!alive()) { imgs.forEach((q) => q.img?.close()); return null; }
  // more than a quarter missing: the mask would leave holes where the vector polygons have no check; retry later
  if (imgs.filter((q) => !q.img).length > imgs.length / 4) { imgs.forEach((q) => q.img?.close()); return 'retry'; }
  const cv = new OffscreenCanvas(px, px), cx = cv.getContext('2d', { willReadFrequently: true });
  if (!cx) return null;
  for (const q of imgs) if (q.img) { cx.drawImage(q.img, q.dx * 256, q.dy * 256); q.img.close(); }
  const d = cx.getImageData(0, 0, px, px).data, v = new Float32Array(N * N), cnt = new Float32Array(N * N), k = N / px;
  // texture: a canopy has light/shadow between neighbouring pixels (measured 12-25 luminance units in Rio's parks and the
  // Tijuca forest); green water of bays and lagoons is smooth (0-1). Green without texture is not vegetation.
  const L = (p: number) => 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2];
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const p = (y * px + x) * 4, c = Math.floor(y * k) * N + Math.floor(x * k);
    cnt[c]++;
    if (!isVegetation(d[p], d[p + 1], d[p + 2])) continue;
    const l = L(p), grad = (x + 1 < px ? Math.abs(l - L(p + 4)) : 0) + (y + 1 < px ? Math.abs(l - L(p + px * 4)) : 0) + (x > 0 ? Math.abs(l - L(p - 4)) : 0);
    if (grad >= 6) v[c]++;
  }
  let sum = 0;
  for (let i = 0; i < v.length; i++) { v[i] = cnt[i] ? v[i] / cnt[i] : 0; sum += v[i]; }
  const half = t.sizeM / 2, cell = t.sizeM / N;
  // summed-area table for neighbourhood means
  const S = new Float64Array((N + 1) * (N + 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) S[(j + 1) * (N + 1) + i + 1] = v[j * N + i] + S[j * (N + 1) + i + 1] + S[(j + 1) * (N + 1) + i] - S[j * (N + 1) + i];
  const cl = (k: number) => Math.min(N, Math.max(0, k));
  return {
    n: N, v, cover: sum / v.length,
    at(x, y) { const i = Math.floor((x + half) / cell), j = Math.floor((half - y) / cell); return i < 0 || j < 0 || i >= N || j >= N ? 0 : v[j * N + i]; },
    around(x, y, r) {
      const i0 = cl(Math.floor((x - r + half) / cell)), i1 = cl(Math.ceil((x + r + half) / cell)), j0 = cl(Math.floor((half - y - r) / cell)), j1 = cl(Math.ceil((half - y + r) / cell));
      const a = (i1 - i0) * (j1 - j0);
      return a ? (S[j1 * (N + 1) + i1] - S[j0 * (N + 1) + i1] - S[j1 * (N + 1) + i0] + S[j0 * (N + 1) + i0]) / a : 0;
    },
  };
}
