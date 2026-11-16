/**
 * Neural tactical policy. Rules enumerate LEGAL candidate orders per squad (objective, flank, engage, hold, cover,
 * retreat, smoke, defend + the rule-based order itself); one shared scoring MLP ranks them from squad + candidate
 * features and the choice is sampled with a difficulty temperature. Hard traps (forced retreat, no suicide retreat)
 * stay outside the net.
 */
import { chooseIndex } from '../neural/mlp';
import { extLive, netOf } from '../neural/pack';
import type { Act, Ctx2 } from './ai';
import { cellFactor, cellOf, heightAt } from './grid';
import type { Battle, Side, Squad } from './types';
import { UNITS } from './units';
import { cacheOf, nearby, rnd } from './util';

/** Squad feature slots: 14 core + 4 extension slots (commander, fatigue, weather, wear) read tolerantly (0 when the field is absent). */
export const TAC_CORE = 14;
export const TAC_EXT = 4;
export const TAC_S = TAC_CORE + TAC_EXT;
export const NT = 12;
export const TAC_C = NT + 6;
export const TAC_IN = TAC_S + TAC_C;
const MAXC = 20;
/** Candidate type ids. */
export const CT = { RULE: 0, OBJ: 1, FLANK: 2, ENGAGE: 3, FOCUS: 4, HOLD: 5, COVER: 6, RETREAT: 7, SMOKE: 8, DEFEND: 9, WAIT: 10 } as const;

/** Training hook: receives the candidate matrix and the index of the rule-based candidate (always 0). */
export const tap: { rec: ((x: Float64Array, n: number) => void) | null } = { rec: null };

const X = new Float64Array(MAXC * TAC_IN);
const OUT = new Float64Array(MAXC);
const SCRATCH = new Float64Array(MAXC);
const acts: Act[] = [];

export function useNeural(b: Battle, side: Side): boolean {
  // Opt-in per battle: the game wires `engine` explicitly (system.ts); bare battles (tests, scripts) keep the rule AI.
  return b.engine?.[side] === 'neural' && netOf('tac', TAC_IN) !== null;
}

/** Extension slots from the real fields: commander modifiers (mean of acc/spd/resolve, 1 = neutral), fatigue, battlefield weather (worst of rain/fog/mud/low vis) and equipment wear (not modelled in battle: 0). Zeros unless the pack is feature-set v2. */
function extFeatures(b: Battle, s: Squad, o: number): void {
  const live = extLive();
  const fx = s.fx, w = b.wx;
  X[o + TAC_CORE] = live ? clamp(fx ? (fx.acc + fx.spd + fx.resolve) / 3 : 1, 0, 2) : 0;
  X[o + TAC_CORE + 1] = live ? clamp(s.fg ?? 0, 0, 1) : 0;
  X[o + TAC_CORE + 2] = live && w ? clamp(Math.max(w.rain, w.fog, w.mud, 1 - w.vis), 0, 1) : 0;
  X[o + TAC_CORE + 3] = 0;
}

const GROUP: Record<string, number> = { infantry: 0, special: 0, engineer: 0, mech: 1, mbt: 2, recon: 3, attackHeli: 4 };
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function around(b: Battle, side: Side, x: number, y: number, r: number): [number, number] {
  let fr = 0, en = 0;
  nearby(b, x, y, r, (e) => { if (e.alive && !e.gone) { const w = UNITS[e.kind].threat; if (e.side === side) fr += w; else en += w; } });
  return [fr, en];
}

function squadFeatures(k: Ctx2, s: Squad, o: number): { fr: number; en: number } {
  const { b, side } = k;
  const c = cacheOf(b);
  const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
  let nd = 1e9;
  for (const e of k.enemyAlive) { const d = Math.hypot(c.sqCx[e.id] - cx, c.sqCy[e.id] - cy); if (d < nd) nd = d; }
  const [fr, en] = around(b, side, cx, cy, 800);
  X.fill(0, o, o + TAC_S);
  X[o + (GROUP[s.kind] ?? 0)] = 1;
  X[o + 5] = c.sqEnts[s.id].length / s.n0;
  X[o + 6] = s.morale;
  X[o + 7] = b.t - s.engagedT < 6 ? 1 : 0;
  X[o + 8] = clamp(c.sqSupp[s.id], 0, 1);
  X[o + 9] = clamp(nd / 2000, 0, 2);
  X[o + 10] = (fr - en) / (fr + en + 1);
  X[o + 11] = clamp(b.t / b.timeLimit, 0, 1);
  X[o + 12] = clamp((b.score[side] - b.score[1 - side]) / 2400, -1, 1);
  X[o + 13] = k.attacker ? 1 : 0;
  extFeatures(b, s, o);
  return { fr, en };
}

/** Fills the candidate part of row `row` (squad features copied from row 0 by the caller). */
function candFeatures(k: Ctx2, s: Squad, type: number, a: Act, row: number): void {
  const { b, side } = k;
  const o = row * TAC_IN + TAC_S;
  X.fill(0, o, o + TAC_C);
  X[o + type] = 1;
  if (type === CT.RETREAT || type === CT.WAIT) return;
  const c = cacheOf(b);
  const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
  const tx = a.k === 'dig' || a.k === 'hold' ? cx : a.x, ty = a.k === 'dig' || a.k === 'hold' ? cy : a.y;
  const [fr, en] = around(b, side, tx, ty, 600);
  X[o + NT] = clamp(Math.hypot(tx - cx, ty - cy) / 3000, 0, 2);
  X[o + NT + 1] = b.map.cover[cellOf(b.map, tx, ty)] / 2;
  let rel = 0, bd = 400;
  for (const ob of b.objs) { const d = Math.hypot(ob.x - tx, ob.y - ty); if (d < bd) { bd = d; rel = ob.owner === -1 ? 0 : ob.owner === side ? 1 : -1; } }
  X[o + NT + 2] = rel;
  X[o + NT + 3] = clamp(en / 20, 0, 3);
  X[o + NT + 4] = clamp(fr / 20, 0, 3);
  X[o + NT + 5] = clamp((heightAt(b.map, tx, ty) - heightAt(b.map, cx, cy)) / 100, -2, 2);
}

const passable = (b: Battle, s: Squad, x: number, y: number) => cellFactor(b.map, cellOf(b.map, x, y), UNITS[s.kind].mob) !== 0;
const sameAct = (p: Act, q: Act) => p.k === q.k && (p.k === 'retreat' || p.k === 'dig' || p.k === 'hold' || Math.hypot(p.x - q.x, p.y - q.y) < 120);

/** Builds legal candidates for a squad. Returns their count; `acts[i]` is the order of row i, row 0 is the rule choice. */
function candidates(k: Ctx2, s: Squad, rule: Act | null): number {
  const { b, side, half } = k;
  const c = cacheOf(b);
  const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
  const frac = c.sqEnts[s.id].length / s.n0;
  acts.length = 0;
  const types: number[] = [];
  const push = (type: number, a: Act) => {
    if (acts.length >= MAXC) return;
    if (type !== CT.RULE && rule && sameAct(a, rule)) return;
    acts.push(a); types.push(type);
  };
  const o0 = squadFeatures(k, s, 0);
  void o0;
  if (rule) push(CT.RULE, rule);
  const air = s.kind === 'attackHeli';
  const ok = (x: number, y: number) => air || passable(b, s, x, y);
  const cl = (v: number) => clamp(v, -half + 100, half - 100);
  for (const ob of b.objs) if (ok(ob.x, ob.y)) push(CT.OBJ, { k: 'attackMove', x: ob.x, y: ob.y, wedge: true });
  // flanks of the nearest enemy-held / contested objective
  let tgt = b.objs[0], td = 1e18;
  for (const ob of b.objs) if (ob.owner !== side) { const d = Math.hypot(ob.x - cx, ob.y - cy); if (d < td) { td = d; tgt = ob; } }
  if (tgt) {
    const dx = tgt.x - cx, dy = tgt.y - cy, dd = Math.hypot(dx, dy) || 1;
    for (const sg of [-1, 1]) {
      const x = cl(tgt.x + (-dy / dd) * 450 * sg), y = cl(tgt.y + (dx / dd) * 450 * sg);
      if (ok(x, y)) push(CT.FLANK, { k: 'attackMove', x, y });
    }
  }
  let near: Squad | null = null, nd = 1e9;
  for (const e of k.enemyAlive) { const d = Math.hypot(c.sqCx[e.id] - cx, c.sqCy[e.id] - cy); if (d < nd) { nd = d; near = e; } }
  if (near) {
    const nx = c.sqCx[near.id], ny = c.sqCy[near.id];
    if (ok(nx, ny)) push(CT.ENGAGE, { k: 'attackMove', x: nx, y: ny });
    if (!air) push(CT.FOCUS, { k: 'attack', x: nx, y: ny, target: near.id });
    if (s.smoke > 0 && nd < 1500 && !air) {
      const a = Math.atan2(nx - cx, ny - cy);
      push(CT.SMOKE, { k: 'smoke', x: cx + Math.sin(a) * 60, y: cy + Math.cos(a) * 60 });
    }
  }
  if (!air) {
    push(CT.HOLD, { k: 'dig', x: cx, y: cy });
    // best cover cell within ~500 m (urban > forest, higher ground), away from the nearest enemy
    let bx = 0, by = 0, bs = -1e9;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2, r = 350;
      const x = cl(cx + Math.sin(ang) * r), y = cl(cy + Math.cos(ang) * r);
      if (!passable(b, s, x, y)) continue;
      let sc = b.map.cover[cellOf(b.map, x, y)] * 2 + (heightAt(b.map, x, y) - heightAt(b.map, cx, cy)) / 40;
      if (near) sc += (Math.hypot(x - c.sqCx[near.id], y - c.sqCy[near.id]) - nd) / 300;
      if (sc > bs) { bs = sc; bx = x; by = y; }
    }
    if (bs > -1e9) push(CT.COVER, { k: 'move', x: bx, y: by });
    let dn = null as Battle['objs'][number] | null, dd2 = 1e18;
    for (const ob of k.owned) { const d = Math.hypot(ob.x - cx, ob.y - cy); if (d < dd2) { dd2 = d; dn = ob; } }
    if (dn && ok(dn.x, dn.y)) push(CT.DEFEND, { k: 'move', x: dn.x, y: dn.y });
  }
  // retreat only when it is not suicidal-by-cowardice: hurt or shaken squads
  if (frac < 0.5 || s.morale < 0.45) push(CT.RETREAT, { k: 'retreat', x: 0, y: 0 });
  // squad features once, then replicate into every row
  for (let r = 0; r < acts.length; r++) {
    if (r > 0) X.copyWithin(r * TAC_IN, 0, TAC_S);
    candFeatures(k, s, types[r], acts[r], r);
  }
  return acts.length;
}

/** Neural choice for a manoeuvre squad; null = keep the current order (not yet time to re-think). */
export function decideSquad(k: Ctx2, s: Squad, rule: Act | null, mi: number): Act | null {
  void mi;
  const { b } = k;
  const net = netOf('tac', TAC_IN)!;
  if ((s.nt ?? 0) > b.t && s.order !== 'idle') return null;
  const n = candidates(k, s, rule);
  if (n === 0) return rule;
  for (let r = 0; r < n; r++) OUT[r] = net.forward(X.subarray(r * TAC_IN, (r + 1) * TAC_IN))[0];
  const T = b.aiTemp ?? 0.3;
  const i = chooseIndex(OUT, n, T, T > 0 ? rnd(b) : null, SCRATCH);
  s.nt = b.t + 5 + rnd(b) * 5;
  return acts[i];
}

/** Recording hook for behaviour cloning (rule engine): candidate matrix with the rule choice at row 0. */
export function observeSquad(k: Ctx2, s: Squad, rule: Act | null): void {
  if (!tap.rec || !rule) return;
  const n = candidates(k, s, rule);
  if (n > 1) tap.rec(X, n);
}

/** Whether to place the support call the rules found (candidate CALL=rule vs WAIT), scored by the same net. */
export function decideSupport(k: Ctx2, best: { n: number; hard: number }, kind: string): boolean {
  const { b, side } = k;
  const net = netOf('tac', TAC_IN)!;
  for (let r = 0; r < 2; r++) {
    const o = r * TAC_IN;
    X.fill(0, o, o + TAC_IN);
    X[o + 13] = k.attacker ? 1 : 0;
    X[o + 11] = clamp(b.t / b.timeLimit, 0, 1);
    X[o + 12] = clamp((b.score[side] - b.score[1 - side]) / 2400, -1, 1);
    X[o + TAC_S + (r === 0 ? CT.RULE : CT.WAIT)] = 1;
    if (r === 0) {
      X[o + TAC_S + NT + 3] = clamp(best.n / 20, 0, 3);
      X[o + TAC_S + NT + 5] = best.hard / 5;
      X[o + TAC_S + NT + 1] = kind === 'artillery' ? 0 : kind === 'airstrike' ? 0.5 : 1;
    }
    OUT[r] = net.forward(X.subarray(o, o + TAC_IN))[0];
  }
  const T = b.aiTemp ?? 0.3;
  return chooseIndex(OUT, 2, T, T > 0 ? rnd(b) : null, SCRATCH) === 0;
}
