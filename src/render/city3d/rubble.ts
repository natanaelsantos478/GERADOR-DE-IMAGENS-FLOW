/**
 * Rubble of a destroyed building generated from the editable pattern public/data/styles/rubble.json: an irregular heap (faceted mound) plus loose blocks, slabs and beams.
 * Pure and deterministic (seeded by the building id): no Cesium here, so it is unit-tested; `rubbleMesh.ts` turns the model into triangles.
 */
export type RGB = [number, number, number];
export type RubbleMat = 'light' | 'brick' | 'concrete' | 'reinforced';
export type RubbleBy = 'shell' | 'rocket' | 'bomb' | 'missile' | 'breach' | 'fire';
export const RUBBLE_MATS: readonly RubbleMat[] = ['light', 'brick', 'concrete', 'reinforced'];
export const RUBBLE_BY: readonly RubbleBy[] = ['shell', 'rocket', 'bomb', 'missile', 'breach', 'fire'];

export interface PieceSpec { type: 'block' | 'slab' | 'beam'; weight: number; size: [number, number]; thickness?: [number, number] }
/** Pieces of wall left standing at the edge of the heap (textured with the facade atlas: windows included). */
export interface WallSpec { min: number; max: number; perMetre: number; width: [number, number]; height: [number, number]; thickness: [number, number]; lean: number; textures: string[] }
export interface MatSpec {
  /** Heap height = clamp(min(original height, heightCap) * heightFrac * (area/150)^areaGain, minHeight, maxHeight). */
  heightFrac: number; heightCap: number; minHeight: number; maxHeight: number; areaGain: number; fill: number;
  /** Metres the heap overflows the footprint into the street (min,max; grows with the footprint). */
  spill: [number, number];
  /** Share of the loose pieces thrown out onto the spill zone. */
  scatter: number;
  density: number; minPieces: number; maxPieces: number; rebar: number;
  palette: RGB[]; textures: string[]; pieces: PieceSpec[]; walls: WallSpec;
  mound: { color: RGB; roughness: number };
  /** Darkened rubble/dust stain on the ground around the heap (readable from far away): `margin` = metres beyond the heap foot. */
  decal: { color: RGB; margin: [number, number] };
}
export interface CollapseSpec { duration: number; tilt: number; shrinkTo: number; shake: number; dust: number; blocks: number; style: 'down' | 'breach' }
/** Dust of the fall (real seconds, render only): the cloud that grows and lingers, then the thin smoke that keeps rising from the heap. */
export interface DustSpec { cloudLife: [number, number]; cloudGrow: number; cloudPuffs: number; cloudAlpha: number; smokeLife: [number, number]; smokeEvery: number; smokeAlpha: number; smokeTime: [number, number]; maxSmoking: number; maxPuffs: number }
export interface RubbleSpec { floorHeight: number; materials: Record<RubbleMat, MatSpec>; collapse: Record<RubbleBy, CollapseSpec>; dust: DustSpec }

const isRGB = (c: unknown): c is RGB => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'number' && v >= 0 && v <= 255);
const isRange = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every((v) => typeof v === 'number' && v > 0) && r[0] <= r[1];
const isRange0 = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every((v) => typeof v === 'number' && v >= 0) && r[0] <= r[1];
const fail = (m: string): never => { throw new Error(`styles/rubble.json: ${m}`); };

/** Validates the pattern file (throws a readable error on a bad edit; the previous catalog then stays). */
export function validateRubble(raw: any): RubbleSpec {
  if (raw?.version !== 1) fail('unsupported or missing version (expected 1)');
  const out = { materials: {}, collapse: {} } as unknown as RubbleSpec;
  for (const m of RUBBLE_MATS) {
    const s = raw.materials?.[m];
    if (!s) fail(`materials.${m} missing`);
    for (const k of ['heightFrac', 'heightCap', 'minHeight', 'maxHeight', 'areaGain', 'fill', 'scatter', 'density', 'minPieces', 'maxPieces'] as const) if (!(typeof s[k] === 'number' && s[k] >= 0)) fail(`${m}.${k} must be a number >= 0`);
    if (s.minHeight > s.maxHeight) fail(`${m}: minHeight > maxHeight`);
    if (s.minPieces > s.maxPieces || s.maxPieces > 400) fail(`${m}: minPieces <= maxPieces <= 400 required`);
    if (!Array.isArray(s.palette) || !s.palette.length || !s.palette.every(isRGB)) fail(`${m}.palette must be a non-empty list of [r,g,b]`);
    if (!isRGB(s.mound?.color)) fail(`${m}.mound.color must be [r,g,b]`);
    if (!(s.heightFrac > 0 && s.heightFrac <= 1)) fail(`${m}.heightFrac must be 0..1`);
    if (!isRange0(s.spill)) fail(`${m}.spill must be [min,max] metres`);
    if (!isRGB(s.decal?.color) || !isRange0(s.decal?.margin)) fail(`${m}.decal needs color [r,g,b] and margin [min,max]`);
    const w = s.walls;
    if (!w || !(w.max >= w.min && w.min >= 0 && w.max <= 8) || !(w.perMetre >= 0) || !isRange(w.width) || !isRange(w.height) || !isRange(w.thickness) || !Array.isArray(w.textures)) fail(`${m}.walls: min<=max<=8, perMetre, width/height/thickness [min,max], textures[]`);
    if (w.max > s.minPieces) fail(`${m}.walls.max must not exceed minPieces`);
    if (!Array.isArray(s.pieces) || !s.pieces.length) fail(`${m}.pieces must be a non-empty list`);
    for (const p of s.pieces) {
      if (!['block', 'slab', 'beam'].includes(p.type) || !(p.weight > 0) || !isRange(p.size)) fail(`${m}.pieces: type/weight/size invalid`);
      if (p.type !== 'block' && !isRange(p.thickness)) fail(`${m}.pieces ${p.type}: thickness [min,max] required`);
    }
    out.materials[m] = { ...s, rebar: s.rebar ?? 0, textures: s.textures ?? [], mound: { color: s.mound.color, roughness: s.mound.roughness ?? 0.5 } };
  }
  out.floorHeight = typeof raw.floorHeight === 'number' && raw.floorHeight > 0 ? raw.floorHeight : 3.2;
  const d = raw.dust;
  if (!d || !isRange(d.cloudLife) || !isRange(d.smokeLife) || !isRange(d.smokeTime)) fail('dust: cloudLife, smokeLife, smokeTime must be [min,max] seconds');
  for (const k of ['cloudGrow', 'cloudPuffs', 'cloudAlpha', 'smokeEvery', 'smokeAlpha', 'maxSmoking', 'maxPuffs'] as const) if (!(typeof d[k] === 'number' && d[k] > 0)) fail(`dust.${k} must be a number > 0`);
  if (d.cloudAlpha > 1 || d.smokeAlpha > 1) fail('dust alphas must be 0..1');
  out.dust = { ...d };
  for (const b of RUBBLE_BY) {
    const c = raw.collapse?.[b];
    if (!c) fail(`collapse.${b} missing`);
    for (const k of ['duration', 'tilt', 'shrinkTo', 'shake', 'dust', 'blocks'] as const) if (!(typeof c[k] === 'number' && c[k] >= 0)) fail(`collapse.${b}.${k} must be a number >= 0`);
    if (!(c.duration >= 0.5 && c.duration <= 12)) fail(`collapse.${b}.duration must be 0.5..12 s`);
    if (c.shrinkTo > 1) fail(`collapse.${b}.shrinkTo must be 0..1`);
    out.collapse[b] = { ...c, style: c.style === 'breach' ? 'breach' : 'down' };
  }
  return out;
}

// ------------------------------------------------------------------ deterministic random
function rng(seed: number): () => number {
  let a = (seed ^ 0x9e3779b9) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ model
export interface Piece {
  kind: 'block' | 'slab' | 'beam' | 'wall';
  /** Centre relative to the footprint centre (m); z above the ground. */
  x: number; y: number; z: number;
  /** Full size (m) along the piece's own axes. */
  sx: number; sy: number; sz: number;
  yaw: number; pitch: number; roll: number;
  color: RGB;
  /** Atlas texture id (undefined = plain colour). */
  tex?: string;
  rebar?: boolean;
}
export interface RubbleInput {
  id: number; mat: RubbleMat; fl: number;
  /** Footprint outer ring, flat [x,y,...] in local metres (tile or battle frame: only relative geometry is used). */
  ring: number[];
  /** Footprint area (m2); computed from the ring when absent. */
  area?: number;
  /** Height (m) of the standing building; when absent floors * floorHeight. */
  h?: number;
}
export interface RubbleModel {
  id: number; mat: RubbleMat;
  /** Footprint centre in the input frame. */
  cx: number; cy: number;
  height: number; radius: number; heading: number;
  /** Largest overflow of the heap beyond the footprint (m). */
  spill: number;
  /** Ground stain: outer ring (relative metres) around the heap, flat. */
  decal: { pts: [number, number][]; color: RGB };
  /** Heap body: `pts` = ring around the centre (relative metres), `levels` = [scale of the ring, height] from the foot to the crest, `jit` = per vertex height factor. */
  mound: { pts: [number, number][]; levels: [number, number][]; jit: number[]; color: RGB; tex?: string };
  pieces: Piece[];
  /** Triangles needed to draw it. */
  tris: number;
}

const ringArea = (r: number[]) => { let a = 0; for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1]; return Math.abs(a) / 2; };
function centroid(r: number[]): [number, number, number] {
  let n = r.length / 2;
  if (n > 1 && r[0] === r[(n - 1) * 2] && r[1] === r[(n - 1) * 2 + 1]) n--;
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += r[i * 2]; y += r[i * 2 + 1]; }
  return [x / n, y / n, n];
}
export const inRing = (r: number[], x: number, y: number): boolean => {
  let c = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) { const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
};
/** Distance from (cx,cy) along direction (dx,dy) to the first edge of the ring (Infinity when none). */
function rayHit(r: number[], cx: number, cy: number, dx: number, dy: number): number {
  let best = Infinity;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const ax = r[j * 2] - cx, ay = r[j * 2 + 1] - cy, ex = r[i * 2] - r[j * 2], ey = r[i * 2 + 1] - r[j * 2 + 1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/** Heap height (m): proportional to the floors and (softly) to the footprint, clamped by the material. */
export function rubbleHeight(s: MatSpec, fl: number, area: number, h?: number, floorHeight = 3.2): number {
  const orig = Math.min(s.heightCap, h && h > 0 ? h : Math.max(1, fl) * floorHeight);
  return clamp(orig * s.heightFrac * Math.pow(Math.max(20, area) / 150, s.areaGain), s.minHeight, s.maxHeight);
}
/** Mound (K rays: 2 triangles per quad band + the apex fan) + ground stain (one band of quads) + one box per piece. */
export const triangles = (nPieces: number, mound: { pts: unknown[]; levels?: unknown[] }): number => nPieces * 12 + mound.pts.length * (2 * Math.max(1, (mound.levels?.length ?? 4) - 2) + 1) + mound.pts.length * 2;

/** The rubble of one building: same input -> same model, always. */
export function generateRubble(spec: RubbleSpec, g: RubbleInput): RubbleModel {
  const s = spec.materials[g.mat];
  const [cx, cy, n] = centroid(g.ring);
  const area = g.area ?? ringArea(g.ring);
  const rnd = rng(Math.imul(g.id | 0, 0x27d4eb2d) ^ (RUBBLE_MATS.indexOf(g.mat) + 1) * 0x165667b1);
  const H = rubbleHeight(s, g.fl, area, g.h, spec.floorHeight);
  let R = 1, longest = 0, heading = 0, perim = 0;
  for (let i = 0; i < n; i++) {
    R = Math.max(R, Math.hypot(g.ring[i * 2] - cx, g.ring[i * 2 + 1] - cy));
    const j = (i + 1) % n, ex = g.ring[j * 2] - g.ring[i * 2], ey = g.ring[j * 2 + 1] - g.ring[i * 2 + 1], l = Math.hypot(ex, ey);
    perim += l;
    if (l > longest) { longest = l; heading = Math.atan2(ey, ex); }
  }
  // overflow into the street: grows with the footprint (1..3 m by default)
  const spillMax = lerp(s.spill[0], s.spill[1], clamp(area / 600, 0, 1));
  // heap body: a ring of rays to the footprint edge (+ the overflow), levels up to the crest
  const K = 12, pts: [number, number][] = [], jit: number[] = [], decalPts: [number, number][] = [];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    let d = rayHit(g.ring, cx, cy, Math.cos(a), Math.sin(a));
    if (!Number.isFinite(d)) d = R * 0.7; // centre outside a concave footprint
    d = Math.min(Math.min(d, R) * s.fill * (0.92 + rnd() * 0.16), R) + spillMax * (0.35 + rnd() * 0.65);
    pts.push([Math.cos(a) * d, Math.sin(a) * d]);
    const m = lerp(s.decal.margin[0], s.decal.margin[1], rnd());
    decalPts.push([Math.cos(a) * (d + m), Math.sin(a) * (d + m)]);
    jit.push(0.8 + rnd() * 0.4, 0.8 + rnd() * 0.4);
  }
  const rough = s.mound.roughness;
  // fuller than a cone: a wide, rough plateau (the heap reads as a pile of the building, not as a hill)
  const levels: [number, number][] = [[1, 0], [0.8, H * (0.4 + rough * 0.1)], [0.52, H * 0.8], [0.2, H * 0.96], [0, H]];
  const tex = s.textures.length ? s.textures[Math.floor(rnd() * s.textures.length)] : undefined;
  const mound = { pts, levels, jit, color: s.mound.color, tex };
  // heap surface height at a relative point (matches the faceted mound closely enough to seat the pieces on it)
  const surf = (px: number, py: number) => { const r01 = Math.min(1, Math.hypot(px, py) / Math.max(1, R * s.fill + spillMax * 0.6)); return H * Math.max(0.06, 1 - Math.pow(r01, 2.2)); };
  const pieces: Piece[] = [];
  const count = Math.round(clamp((area / 100) * s.density, s.minPieces, s.maxPieces));
  // standing wall fragments with the facade texture (windows) on the edge of the heap
  const w = s.walls, nWalls = w.max > 0 ? Math.round(clamp(perim * w.perMetre, w.min, w.max)) : 0;
  for (let i = 0; i < nWalls; i++) {
    const e = Math.min(n - 1, Math.floor(rnd() * n)), e2 = (e + 1) % n;
    const ax = g.ring[e * 2] - cx, ay = g.ring[e * 2 + 1] - cy, bx = g.ring[e2 * 2] - cx, by = g.ring[e2 * 2 + 1] - cy, el = Math.hypot(bx - ax, by - ay) || 1;
    const t = lerp(0.2, 0.8, rnd()), ex = ax + (bx - ax) * t, ey = ay + (by - ay) * t;
    const ix = -ex * 0.12, iy = -ey * 0.12; // a little inside the wall line
    const wi = Math.min(lerp(w.width[0], w.width[1], rnd()), Math.max(w.width[0], el * 0.8));
    const hi = Math.min(lerp(w.height[0], w.height[1], rnd()), H * 1.1 + w.height[0]);
    const th = lerp(w.thickness[0], w.thickness[1], rnd());
    const tx = w.textures.length ? w.textures[Math.floor(rnd() * w.textures.length)] : undefined;
    const color = s.palette[Math.floor(rnd() * s.palette.length)].map((v) => Math.min(255, v * (1.05 + rnd() * 0.15))) as RGB;
    pieces.push({ kind: 'wall', x: ex + ix, y: ey + iy, z: surf(ex * 0.8, ey * 0.8) * 0.5 + hi / 2 - 0.3, sx: th, sy: wi, sz: hi, yaw: Math.atan2(by - ay, bx - ax) - Math.PI / 2, pitch: (rnd() - 0.5) * 2 * w.lean, roll: (rnd() - 0.5) * 2 * w.lean, color, tex: tx });
  }
  // loose pieces on the heap (and a share thrown out onto the street)
  const total = s.pieces.reduce((a, p) => a + p.weight, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, g.ring[i * 2]); x1 = Math.max(x1, g.ring[i * 2]); y0 = Math.min(y0, g.ring[i * 2 + 1]); y1 = Math.max(y1, g.ring[i * 2 + 1]); }
  const loose = Math.max(0, count - nWalls);
  for (let i = 0; i < loose; i++) {
    let px = 0, py = 0, out = false;
    if (rnd() < s.scatter) { // spilled onto the street, on the foot of the heap
      const q = pts[Math.floor(rnd() * K)], f = lerp(0.78, 1.04, rnd());
      px = q[0] * f; py = q[1] * f; out = true;
    } else {
      for (let tries = 0; tries < 12; tries++) {
        px = lerp(x0, x1, rnd()) - cx; py = lerp(y0, y1, rnd()) - cy;
        if (inRing(g.ring, px + cx, py + cy)) break;
        px *= 0.5; py *= 0.5; // fall back to the middle of the heap
      }
    }
    let wt = rnd() * total, ps = s.pieces[0];
    for (const p of s.pieces) { wt -= p.weight; if (wt <= 0) { ps = p; break; } }
    const size = lerp(ps.size[0], ps.size[1], rnd());
    const th = ps.thickness ? lerp(ps.thickness[0], ps.thickness[1], rnd()) : size;
    const color = s.palette[Math.floor(rnd() * s.palette.length)].map((v) => Math.min(255, v * (0.88 + rnd() * 0.24))) as RGB;
    const piece: Piece = { kind: ps.type, x: px, y: py, z: 0, sx: size, sy: size, sz: size, yaw: heading + (rnd() < 0.7 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.8, pitch: 0, roll: 0, color, tex: s.textures.length && rnd() < 0.7 ? s.textures[Math.floor(rnd() * s.textures.length)] : undefined };
    if (ps.type === 'block') { piece.sx = size * lerp(0.7, 1, rnd()); piece.sy = size * lerp(0.7, 1, rnd()); piece.sz = size * lerp(0.5, 0.9, rnd()); piece.pitch = (rnd() - 0.5) * 0.9; piece.roll = (rnd() - 0.5) * 0.9; }
    else if (ps.type === 'slab') { piece.sx = size; piece.sy = size * lerp(0.5, 0.9, rnd()); piece.sz = th; piece.pitch = (rnd() - 0.5) * 1.5; piece.roll = (rnd() - 0.5) * 1.5; } // leaning slabs
    else {
      const rebar = rnd() < s.rebar;
      piece.sx = rebar ? size * 0.9 : size; piece.sy = piece.sz = rebar ? 0.06 + rnd() * 0.04 : th;
      piece.pitch = rebar ? lerp(0.6, 1.3, rnd()) * (rnd() < 0.5 ? 1 : -1) : (rnd() - 0.5) * 1.6; piece.roll = (rnd() - 0.5) * 0.8;
      if (rebar) { piece.rebar = true; piece.color = [78, 58, 48]; piece.tex = undefined; }
    }
    piece.z = out ? piece.sz * 0.3 + 0.05 : surf(px, py) * lerp(0.55, 1.05, rnd()) + piece.sz * 0.25;
    pieces.push(piece);
  }
  const decal = { pts: decalPts, color: s.decal.color };
  return { id: g.id, mat: g.mat, cx, cy, height: H, radius: R, heading, spill: spillMax, decal, mound, pieces, tris: triangles(pieces.length, mound) };
}

// ------------------------------------------------------------------ collapse animation (pure)
export interface CollapsePose {
  /** Vertical scale of the standing building (1 -> shrinkTo). */
  sink: number;
  /** Tilt (rad) about the horizontal axis perpendicular to `dir`. */
  tilt: number;
  /** Horizontal tremor of the standing building (m, local frame). */
  shx: number; shy: number;
  /** Vertical scale of the rubble heap growing from the ground. */
  grow: number;
}
/** Pose at progress p (0..1) of the fall; `seed` only offsets the tremor phase. */
export function collapsePose(c: CollapseSpec, p: number, seed = 0): CollapsePose {
  p = clamp(p, 0, 1);
  const k = Math.pow(p, c.style === 'breach' ? 1.15 : 1.6);
  const calm = 1 - p;
  const ph = (seed % 7) * 0.9;
  return {
    sink: lerp(1, c.shrinkTo, k),
    tilt: (c.tilt * Math.PI / 180) * Math.sin(Math.min(1, p * 1.25) * Math.PI * 0.5) * (c.style === 'breach' ? 1 : (0.4 + 0.6 * Math.sin(p * Math.PI))),
    shx: Math.sin(p * 46 + ph) * c.shake * calm * Math.min(1, p * 8),
    shy: Math.cos(p * 39 + ph) * c.shake * 0.7 * calm * Math.min(1, p * 8),
    grow: p >= 1 ? 1 : clamp(Math.pow(p, 0.85), 0.03, 1),
  };
}
