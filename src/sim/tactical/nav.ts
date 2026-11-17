/** Runtime (derived, never serialized) layers of a `NavData`: speed per mobility class, cover, obstacle height, slope, components. */
import { decodeRle, SURF, type NavData } from '../../data/vector/nav';
import { SURFACE_RULES } from './terrainRules';
import type { Mobility } from './units';
import type { TacticalMap } from './types';

type Ground = 'foot' | 'wheel' | 'track';
/** Slope limits (degrees): wheeled 30, tracked 38, infantry 50. */
export const SLOPE_LIM: Record<Ground, number> = { foot: 50, wheel: 30, track: 38 };
const GROUND: Ground[] = ['foot', 'wheel', 'track'];

export interface NavRT {
  data: NavData; n: number; cs: number; half: number;
  gh: Float32Array; surf: Uint8Array; use: Uint8Array; bld: Uint16Array; slope: Uint8Array; cover: Uint8Array; obs: Uint8Array;
  spd: Record<Ground, Float32Array>;
  bcells: number[][];
  comps: Partial<Record<Ground, Int32Array>>;
  main: Partial<Record<Ground, number>>;
}
const cache = new WeakMap<NavData, NavRT>();

export function navOf(m: TacticalMap): NavRT | null {
  const d = m.nav;
  if (!d) return null;
  let rt = cache.get(d);
  if (!rt) { rt = build(d, m); cache.set(d, rt); }
  return rt;
}

function build(d: NavData, m: TacticalMap): NavRT {
  const n = d.n, N = n * n, cs = d.sizeM / n, half = d.sizeM / 2;
  const surf = decodeRle(d.surf, N, Uint8Array), use = decodeRle(d.use, N, Uint8Array), bld = decodeRle(d.bld, N, Uint16Array);
  const fine = d.hgt && d.hn ? decodeRle(d.hgt, d.hn * d.hn, Int16Array, true) : null;
  const hn = fine ? d.hn! : m.n, hs = fine ? Array.from(fine, (v) => v / 10) : m.heights, hcs = d.sizeM / hn;
  const hAt = (x: number, y: number) => {
    const fx = Math.min(hn - 1.001, Math.max(0, (x + half) / hcs - 0.5)), fy = Math.min(hn - 1.001, Math.max(0, (y + half) / hcs - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * hn + x0;
    return (hs[i] * (1 - tx) + hs[i + 1] * tx) * (1 - ty) + (hs[i + hn] * (1 - tx) + hs[i + hn + 1] * tx) * ty;
  };
  const gh = new Float32Array(N), slope = new Uint8Array(N), cover = new Uint8Array(N), obs = new Uint8Array(N);
  const spd = { foot: new Float32Array(N), wheel: new Float32Array(N), track: new Float32Array(N) };
  const bh = new Uint8Array(d.buildings.length + 1);
  for (const b of d.buildings) bh[b.id] = Math.min(255, Math.round(b.h));
  const bcells: number[][] = Array.from({ length: d.buildings.length + 1 }, () => []);
  const span = Math.max(cs, hcs);
  for (let c = 0; c < N; c++) {
    const s = surf[c], x = (c % n + 0.5) * cs - half, y = Math.floor(c / n) * cs + cs / 2 - half;
    const structure = s === SURF.BRIDGE || s === SURF.TUNNEL || s === SURF.FOOTBRIDGE || s === SURF.PIER || s === SURF.STEPS || s === SURF.RUNWAY;
    if (!structure && (s !== SURF.DEEP)) {
      const gx = (hAt(x + span, y) - hAt(x - span, y)) / (2 * span), gy = (hAt(x, y + span) - hAt(x, y - span)) / (2 * span);
      slope[c] = Math.min(89, Math.round((Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI));
    }
    gh[c] = hAt(x, y);
    cover[c] = SURFACE_RULES[s].cover;
    obs[c] = s === SURF.BUILDING ? bh[bld[c]] : SURFACE_RULES[s].obs;
    if (s === SURF.BUILDING && bld[c]) bcells[bld[c]].push(c);
    for (let g = 0; g < 3; g++) {
      const base = SURFACE_RULES[s].spd[g], lim = SLOPE_LIM[GROUND[g]];
      spd[GROUND[g]][c] = base === 0 || slope[c] > lim ? 0 : base * Math.max(0.2, 1 - 0.7 * (slope[c] / lim));
    }
  }
  return { data: d, n, cs, half, gh, surf, use, bld, slope, cover, obs, spd, bcells, comps: {}, main: {} };
}

export const navCell = (rt: NavRT, x: number, y: number): number => {
  const cx = Math.min(rt.n - 1, Math.max(0, Math.floor((x + rt.half) / rt.cs))), cy = Math.min(rt.n - 1, Math.max(0, Math.floor((y + rt.half) / rt.cs)));
  return cy * rt.n + cx;
};
export const navCenter = (rt: NavRT, c: number): [number, number] => [(c % rt.n + 0.5) * rt.cs - rt.half, (Math.floor(c / rt.n) + 0.5) * rt.cs - rt.half];

/** Speed multiplier of a cell (0 = impassable). `inb`: building the squad occupies / is entering / leaving (infantry only). */
export function navFactor(rt: NavRT, c: number, mob: Mobility, inb = 0): number {
  if (mob === 'air') return 1;
  const f = rt.spd[mob][c];
  if (f === 0 && inb && mob === 'foot' && rt.bld[c] === inb) return 0.5;
  return f;
}
export function canStand(m: TacticalMap, x: number, y: number, mob: Mobility, inb = 0): boolean {
  const rt = navOf(m);
  if (!rt || mob === 'air') return true;
  if (Math.abs(x) > rt.half || Math.abs(y) > rt.half) return false;
  return navFactor(rt, navCell(rt, x, y), mob, inb) > 0;
}

/** Connected components (4-neighbour) of the passable cells of a ground mobility class, computed once. */
export function components(rt: NavRT, mob: Ground): Int32Array {
  let lab = rt.comps[mob];
  if (lab) return lab;
  const n = rt.n, N = n * n, spd = rt.spd[mob];
  lab = new Int32Array(N);
  const st = new Int32Array(N);
  let id = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] || !spd[s]) continue;
    id++; let sp = 0; st[sp++] = s; lab[s] = id;
    while (sp) {
      const c = st[--sp], cx = c % n;
      if (cx > 0 && spd[c - 1] && !lab[c - 1]) { lab[c - 1] = id; st[sp++] = c - 1; }
      if (cx < n - 1 && spd[c + 1] && !lab[c + 1]) { lab[c + 1] = id; st[sp++] = c + 1; }
      if (c >= n && spd[c - n] && !lab[c - n]) { lab[c - n] = id; st[sp++] = c - n; }
      if (c < N - n && spd[c + n] && !lab[c + n]) { lab[c + n] = id; st[sp++] = c + n; }
    }
  }
  rt.comps[mob] = lab;
  return lab;
}

/** Nearest cell (ring search by distance) that is passable for `mob`, optionally within component `comp`; -1 when none within `maxR` cells. */
export function snapCell(rt: NavRT, mob: Mobility, c0: number, maxR = 60, comp = 0, inb = 0): number {
  if (mob === 'air') return c0;
  const n = rt.n, cx0 = c0 % n, cy0 = Math.floor(c0 / n), lab = comp ? components(rt, mob) : null;
  const ok = (c: number) => navFactor(rt, c, mob, inb) > 0 && (!lab || lab[c] === comp);
  if (ok(c0)) return c0;
  for (let r = 1; r <= maxR; r++) {
    let best = -1, bd = 1e18;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const X = cx0 + i, Y = cy0 + j;
      if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
      const c = Y * n + X, d = i * i + j * j;
      if (d < bd && ok(c)) { bd = d; best = c; }
    }
    if (best >= 0) return best;
  }
  return -1;
}
/** Snap a point to the nearest passable cell centre (the point itself if already passable). */
export function snapPoint(m: TacticalMap, mob: Mobility, x: number, y: number, inb = 0, maxR = 40): [number, number] | null {
  const rt = navOf(m);
  if (!rt || mob === 'air') return [x, y];
  if (canStand(m, x, y, mob, inb)) return [x, y];
  const c = snapCell(rt, mob, navCell(rt, x, y), maxR, 0, inb);
  return c < 0 ? null : navCenter(rt, c);
}

/** The battlefield component: the largest wheeled one; foot/track take the component that contains it (deployment and objectives live there). */
export function mainComp(rt: NavRT, mob: Mobility): number {
  if (mob === 'air') return 0;
  let m = rt.main[mob];
  if (m !== undefined) return m;
  const w = components(rt, 'wheel'), cnt = new Map<number, number>();
  for (let c = 0; c < w.length; c++) if (w[c]) cnt.set(w[c], (cnt.get(w[c]) ?? 0) + 1);
  let best = 0, bn = 0;
  for (const [k, v] of cnt) if (v > bn) { bn = v; best = k; }
  if (mob === 'wheel') m = best;
  else { const lab = components(rt, mob); const ref = w.indexOf(best); m = ref >= 0 ? lab[ref] : 0; }
  rt.main[mob] = m;
  return m;
}
