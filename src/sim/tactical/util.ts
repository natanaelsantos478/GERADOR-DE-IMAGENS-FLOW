/** Shared helpers: battle RNG, spatial hash and per-tick derived data (never serialized). */
import { nextU32 } from '../../core/rng';
import type { Battle, Ent, FormationKind, Squad } from './types';
import { UNITS, type UnitDef } from './units';

export const DT = 0.05;
export const rnd = (b: Battle): number => nextU32(b.rng) / 4294967296;
export const gauss = (b: Battle): number => {
  const u = Math.max(1e-9, rnd(b));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * rnd(b));
};
export const def = (e: { kind: Ent['kind'] }): UnitDef => UNITS[e.kind];
export const isAir = (e: Ent) => e.kind === 'attackHeli';
export const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const BUCKET = 250;
export interface Cache {
  nb: number;
  head: Int32Array;
  next: Int32Array;
  /** alive element ids per squad (rank = index) */
  sqEnts: number[][];
  sqEngaged: Uint8Array;
  sqLag: Float64Array;
  sqCx: Float64Array;
  sqCy: Float64Array;
  sqSupp: Float64Array;
}
const caches = new WeakMap<Battle, Cache>();
export function cacheOf(b: Battle): Cache {
  let c = caches.get(b);
  if (!c) { c = { nb: 0, head: new Int32Array(0), next: new Int32Array(0), sqEnts: [], sqEngaged: new Uint8Array(0), sqLag: new Float64Array(0), sqCx: new Float64Array(0), sqCy: new Float64Array(0), sqSupp: new Float64Array(0) }; caches.set(b, c); }
  return c;
}
const bucketOf = (b: Battle, c: Cache, x: number, y: number) => {
  const bx = Math.min(c.nb - 1, Math.max(0, Math.floor((x + b.map.sizeM / 2) / BUCKET)));
  const by = Math.min(c.nb - 1, Math.max(0, Math.floor((y + b.map.sizeM / 2) / BUCKET)));
  return by * c.nb + bx;
};
/** Rebuild the spatial hash and per-squad aggregates. Call once per tick. */
export function rebuildCache(b: Battle): Cache {
  const c = cacheOf(b);
  c.nb = Math.ceil(b.map.sizeM / BUCKET);
  if (c.head.length !== c.nb * c.nb) c.head = new Int32Array(c.nb * c.nb);
  c.head.fill(-1);
  if (c.next.length < b.ents.length) c.next = new Int32Array(b.ents.length + 256);
  const ns = b.squads.length;
  if (c.sqEngaged.length !== ns) { c.sqEngaged = new Uint8Array(ns); c.sqLag = new Float64Array(ns); c.sqCx = new Float64Array(ns); c.sqCy = new Float64Array(ns); c.sqSupp = new Float64Array(ns); }
  c.sqEnts = new Array(ns);
  for (let i = 0; i < ns; i++) c.sqEnts[i] = [];
  c.sqCx.fill(0); c.sqCy.fill(0); c.sqSupp.fill(0);
  for (const e of b.ents) {
    if (!e.alive || e.gone) continue;
    const k = bucketOf(b, c, e.x, e.y);
    c.next[e.id] = c.head[k]; c.head[k] = e.id;
    c.sqEnts[e.sq].push(e.id);
    c.sqCx[e.sq] += e.x; c.sqCy[e.sq] += e.y; c.sqSupp[e.sq] += e.supp;
  }
  for (let i = 0; i < ns; i++) {
    const n = c.sqEnts[i].length;
    if (n) { c.sqCx[i] /= n; c.sqCy[i] /= n; c.sqSupp[i] /= n; } else { c.sqCx[i] = b.squads[i].x; c.sqCy[i] = b.squads[i].y; }
  }
  return c;
}
/** Visit alive ents within radius r (circle) of a point. */
export function nearby(b: Battle, x: number, y: number, r: number, fn: (e: Ent) => void): void {
  const c = cacheOf(b);
  const half = b.map.sizeM / 2;
  const x0 = Math.max(0, Math.floor((x - r + half) / BUCKET)), x1 = Math.min(c.nb - 1, Math.floor((x + r + half) / BUCKET));
  const y0 = Math.max(0, Math.floor((y - r + half) / BUCKET)), y1 = Math.min(c.nb - 1, Math.floor((y + r + half) / BUCKET));
  const r2 = r * r;
  for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
    for (let id = c.head[by * c.nb + bx]; id !== -1; id = c.next[id]) {
      const e = b.ents[id];
      if ((e.x - x) ** 2 + (e.y - y) ** 2 <= r2) fn(e);
    }
  }
}

/** Slot offset (lateral to the right, forward) of element `i` of `n` in a formation. */
export function slotOffset(form: FormationKind, i: number, n: number, sp: number): [number, number] {
  switch (form) {
    case 'line': return [(i - (n - 1) / 2) * sp, 0];
    case 'column': return [0, ((n - 1) / 2 - i) * sp];
    case 'wedge': { const k = Math.ceil(i / 2), s = i % 2 ? 1 : -1; return [i === 0 ? 0 : s * k * sp * 0.9, -k * sp * 0.75]; }
    default: { const r = sp * 0.9 * Math.sqrt(i + 1), a = i * 2.39996; return [Math.cos(a) * r, Math.sin(a) * r]; }
  }
}
export function slotPos(sq: Squad, i: number, n: number, sp: number): [number, number] {
  const [lat, fwd] = slotOffset(sq.form, i, n, sp);
  const fx = Math.sin(sq.face), fy = Math.cos(sq.face);
  return [sq.x + lat * fy + fwd * fx, sq.y - lat * fx + fwd * fy];
}
