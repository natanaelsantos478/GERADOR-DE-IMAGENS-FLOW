/**
 * Grass tufts near the camera: pure, deterministic placement (unit-tested) and the editable pattern file `public/data/styles/grass.json`.
 * Placement runs on a fixed grid of tile-local cells, so the same area always gets the same tufts; each cell draws its own random numbers
 * from a hash of its coordinates (nothing depends on the order of the calls or on where the camera was before). Density thins out with the
 * distance to the camera and the nearest cells fill the budget first.
 */
export type RGB = [number, number, number];
export interface GrassRule {
  id: string;
  /** land-cover / land-use classes the rule covers (`grass`, `farmland`, `park`, `agriculture`, `scrub`...) and optional climate limits */
  match: { cover?: string[]; minAbsLat?: number; maxAbsLat?: number; minElev?: number; maxElev?: number };
  /** tufts per m2 at full density (before the per-profile budget and the distance fade) */
  density: number;
  /** blade height range (m) */
  height: [number, number];
  /** tuft radius (m) */
  radius: number;
  /** blades per tuft */
  blades: number;
  /** base colours (sRGB 0-255); each tuft takes one, the tip is lighter by `tip` */
  colors: RGB[];
  tip: number;
}
export interface GrassProfile { radius: number; maxTufts: number }
export interface GrassStyle {
  version: 1;
  doc?: string;
  wind: { amp: number; speed: number; scale: number };
  /** share of the radius where the density starts to thin out */
  fadeFrom: number;
  profiles: Record<string, GrassProfile>;
  rules: GrassRule[];
}

const fail = (m: string): never => { throw new Error(`styles/grass.json: ${m}`); };
const isRGB = (c: unknown): c is RGB => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 255);
export function validateGrass(raw: unknown): GrassStyle {
  const g = raw as GrassStyle;
  if (!g || g.version !== 1) fail('unsupported or missing version (expected 1)');
  if (!g.wind || !(g.wind.amp >= 0) || !(g.wind.speed >= 0) || !(g.wind.scale > 0)) fail('wind.amp / speed / scale required');
  if (!(g.fadeFrom > 0 && g.fadeFrom <= 1)) fail('fadeFrom must be in (0, 1]');
  if (!g.profiles || !Object.keys(g.profiles).length) fail('profiles required');
  for (const [k, p] of Object.entries(g.profiles)) if (!(p.radius >= 0) || !(p.maxTufts >= 0)) fail(`profile ${k}: radius / maxTufts`);
  if (!Array.isArray(g.rules) || !g.rules.length) fail('rules must be a non-empty list');
  for (const r of g.rules) {
    if (!r.id || !r.match || !(r.density > 0) || r.height?.length !== 2 || !(r.radius > 0) || !(r.blades >= 3) || !(r.tip >= 0)) fail(`${r.id ?? '?'}: id/match/density/height/radius/blades/tip required`);
    if (!Array.isArray(r.colors) || !r.colors.length || !r.colors.every(isRGB)) fail(`${r.id}: colors must be a non-empty list of [r,g,b]`);
  }
  if (Object.keys(g.rules[g.rules.length - 1].match).length) fail('last rule must be a catch-all (match: {})');
  return g;
}

export interface RuleCtx { cover: string; absLat: number; elev: number }
/** First rule that matches (the last one is a catch-all). */
export function pickRule(rules: GrassRule[], c: RuleCtx): number {
  for (let i = 0; i < rules.length; i++) {
    const m = rules[i].match;
    if (m.cover && !m.cover.includes(c.cover)) continue;
    if (m.minAbsLat !== undefined && c.absLat < m.minAbsLat) continue;
    if (m.maxAbsLat !== undefined && c.absLat >= m.maxAbsLat) continue;
    if (m.minElev !== undefined && c.elev < m.minElev) continue;
    if (m.maxElev !== undefined && c.elev >= m.maxElev) continue;
    return i;
  }
  return rules.length - 1;
}

/** Integer hash -> [0, 1). */
export const hash3 = (a: number, b: number, s = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface Tuft { x: number; y: number; yaw: number; h: number; r: number; rule: number; color: RGB; blades: number }
export interface ScatterOpts {
  /** camera position in tile-local metres and the radius to fill */
  cx: number; cy: number; radius: number;
  /** tile half-side (cells outside are skipped) */
  half: number;
  /** seed that makes tiles differ (e.g. the tile key hash) */
  seed: number;
  maxTufts: number;
  fadeFrom: number;
  rules: GrassRule[];
  /** the rule index to use at a point, or -1 when there is no grass there (water, road, building, wood, bare ground...) */
  accept: (x: number, y: number) => number;
}
export const CELL = 3;
/** Deterministic tufts inside the disc. Nearest cells first, so a small budget keeps the area around the camera dense. */
export function scatterGrass(o: ScatterOpts): Tuft[] {
  const out: Tuft[] = [];
  if (o.radius <= 0 || o.maxTufts <= 0) return out;
  const i0 = Math.floor((o.cx - o.radius + o.half) / CELL), i1 = Math.floor((o.cx + o.radius + o.half) / CELL);
  const j0 = Math.floor((o.cy - o.radius + o.half) / CELL), j1 = Math.floor((o.cy + o.radius + o.half) / CELL);
  const cells: { i: number; j: number; d: number }[] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -o.half + (i + 0.5) * CELL, y = -o.half + (j + 0.5) * CELL, d = Math.hypot(x - o.cx, y - o.cy);
    if (d <= o.radius + CELL) cells.push({ i, j, d });
  }
  cells.sort((a, b) => a.d - b.d || a.j - b.j || a.i - b.i);
  for (const c of cells) {
    if (out.length >= o.maxTufts) break;
    // thinning with the distance: full density up to fadeFrom * radius, then linearly down to nothing at the edge
    const t = (c.d - o.radius * o.fadeFrom) / Math.max(1e-6, o.radius * (1 - o.fadeFrom)), keep = t <= 0 ? 1 : Math.max(0, 1 - t);
    if (keep <= 0) continue;
    for (let k = 0; k < 64; k++) { // upper bound of tufts per cell; the rule density says how many are used
      const x = -o.half + (c.i + hash3(c.i, c.j, o.seed * 7 + k * 3 + 1)) * CELL, y = -o.half + (c.j + hash3(c.i, c.j, o.seed * 7 + k * 3 + 2)) * CELL;
      if (Math.abs(x) >= o.half || Math.abs(y) >= o.half) continue;
      const ri = o.accept(x, y);
      if (ri < 0) continue;
      const r = o.rules[ri], per = r.density * CELL * CELL;
      if (k >= Math.ceil(per)) break;
      // the last (fractional) tuft of a cell exists with the probability of its fraction; distance thinning drops tufts at random
      const frac = per - k >= 1 ? 1 : per - k;
      const u = hash3(c.i * 31 + k, c.j * 17, o.seed + 5);
      if (u >= frac * keep) continue;
      const q = hash3(c.i + k * 101, c.j, o.seed + 9);
      out.push({ x, y, yaw: hash3(c.i, c.j + k * 13, o.seed + 11) * Math.PI * 2, h: r.height[0] + (r.height[1] - r.height[0]) * q, r: r.radius * (0.8 + 0.4 * hash3(c.i + k, c.j + 7, o.seed + 13)), rule: ri, color: r.colors[Math.floor(hash3(c.i, c.j + k, o.seed + 17) * r.colors.length)], blades: r.blades });
      if (out.length >= o.maxTufts) break;
    }
  }
  return out;
}

/** Position of tuft vertices: `blades` thin triangles fanned around the centre, leaning outwards. Returns [pos(xyz) per vertex, tint(rgb) per vertex, sway weight per vertex]. */
export function tuftVertices(t: Tuft, tip: number, ground: number, jitter: (n: number) => number): { p: number[]; c: number[]; w: number[] } {
  const p: number[] = [], c: number[] = [], w: number[] = [];
  const base = [t.color[0] / 255, t.color[1] / 255, t.color[2] / 255], top = base.map((v) => Math.min(1, v * (1 + tip)));
  for (let b = 0; b < t.blades; b++) {
    const a = t.yaw + (b / t.blades) * Math.PI * 2 + jitter(b) * 0.6, rr = t.r * (0.25 + 0.75 * Math.abs(jitter(b + 50))), cx = Math.cos(a) * rr, cy = Math.sin(a) * rr;
    const h = t.h * (0.6 + 0.4 * Math.abs(jitter(b + 100))), lean = 0.25 + 0.35 * Math.abs(jitter(b + 150)), hw = 0.05 + 0.03 * Math.abs(jitter(b + 200));
    const nx = -Math.sin(a), ny = Math.cos(a); // across the blade
    const bx0 = t.x + cx - nx * hw, by0 = t.y + cy - ny * hw, bx1 = t.x + cx + nx * hw, by1 = t.y + cy + ny * hw;
    const tx = t.x + cx + Math.cos(a) * lean * h * 0.5, ty = t.y + cy + Math.sin(a) * lean * h * 0.5;
    // vertices in ENU (x east, y north, z up); the base sinks 4 cm into the ground
    p.push(bx0, by0, ground - 0.04, bx1, by1, ground - 0.04, tx, ty, ground + h);
    c.push(base[0] * 0.7, base[1] * 0.7, base[2] * 0.7, base[0] * 0.7, base[1] * 0.7, base[2] * 0.7, top[0], top[1], top[2]);
    w.push(0, 0, 1);
  }
  return { p, c, w };
}
