/** Tactical AI for any side (enemy, allies, "auto-command"). Runs every 2 s per side. */
import { schedule } from './combat';
import { decideSquad, decideSupport, observeSquad, tap, useNeural } from './aiNeural';
import { navOf } from './nav';
import { issueOrder } from './orders';
import type { Battle, Side, Squad } from './types';
import { UNITS } from './units';
import { cacheOf, nearby } from './util';

export const aiControls = (b: Battle, s: Squad) => s.side !== b.player || b.auto[s.side] || s.ai;

const MANEUVER = new Set(['infantry', 'special', 'engineer', 'mech', 'mbt']);

/** One order of the AI in a closed vocabulary (rules and the neural policy both produce these). */
export interface Act { k: 'attackMove' | 'move' | 'hold' | 'dig' | 'retreat' | 'attack' | 'smoke'; x: number; y: number; target?: number; wedge?: boolean }

const FOOT_KINDS = new Set(['infantry', 'special', 'engineer']);
/** Rules: infantry settling on a position in a built-up area garrisons the nearest free enterable building (within 180 m). */
function tryOccupy(b: Battle, side: Side, s: Squad): boolean {
  if (!FOOT_KINDS.has(s.kind)) return false;
  if (s.gar !== undefined || s.order === 'occupy') return true;
  const rt = navOf(b.map);
  if (!rt) return false;
  const c = cacheOf(b), cx = c.sqCx[s.id], cy = c.sqCy[s.id];
  let best = 0, bd = 180 * 180;
  for (const bl of rt.data.buildings) {
    if (!bl.enterable) continue;
    const d = (bl.cx - cx) ** 2 + (bl.cy - cy) ** 2;
    if (d >= bd) continue;
    const occ = (b.garr?.[bl.id] ?? []).filter((q) => c.sqEnts[q]?.length).length;
    if (occ < bl.cap) { bd = d; best = bl.id; }
  }
  return best > 0 && issueOrder(b, side, [s.id], { kind: 'occupy', building: best }).ok;
}

export function applyAct(b: Battle, side: Side, s: Squad, a: Act): void {
  if (a.k === 'attackMove' || a.k === 'move') {
    if (a.wedge && s.form === 'scatter' && (s.kind === 'mbt' || s.kind === 'mech')) s.form = 'wedge';
    if (s.order === (a.k === 'move' ? 'move' : 'amove') && Math.hypot(s.ox - a.x, s.oy - a.y) < 60) { s.ai = true; return; }
    issueOrder(b, side, [s.id], { kind: a.k, x: a.x, y: a.y });
  } else if (a.k === 'dig') { if (tryOccupy(b, side, s)) { s.ai = true; return; } if (!s.digging) issueOrder(b, side, [s.id], { kind: 'dig' }); }
  else if (a.k === 'hold') { if (s.order !== 'hold' && s.order !== 'idle') issueOrder(b, side, [s.id], { kind: 'hold' }); }
  else if (a.k === 'attack') issueOrder(b, side, [s.id], { kind: 'attack', target: a.target! });
  else if (a.k === 'smoke') issueOrder(b, side, [s.id], { kind: 'smoke', x: a.x, y: a.y });
  else if (s.order !== 'retreat') issueOrder(b, side, [s.id], { kind: 'retreat' });
  s.ai = true; // orders from the AI keep the squad AI-driven
}

/** Context handed to the rule/neural policies for one side's think. */
export interface Ctx2 {
  b: Battle; side: Side; attacker: boolean; half: number;
  enemyAlive: Squad[]; owned: Battle['objs']; notOwned: Battle['objs'];
}

/** The rule-based choice for a manoeuvre squad (mi = rotating objective counter owned by the caller). */
export function ruleAct(k: Ctx2, s: Squad, mi: number): Act | null {
  const { b, attacker, half, owned, notOwned } = k;
  const c = cacheOf(b);
  const n = c.sqEnts[s.id].length, frac = n / s.n0;
  const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
  let near: Squad | null = null, nd = 1e9;
  for (const e of k.enemyAlive) { const d = Math.hypot(c.sqCx[e.id] - cx, c.sqCy[e.id] - cy); if (d < nd) { nd = d; near = e; } }
  void frac;
  const pool = attacker ? (notOwned.length ? notOwned : b.objs) : owned.length ? owned : b.objs;
  const mp = pool[mi % pool.length];
  const m1 = mi + 1; // the original counter was incremented before use
  const lateral = ((m1 % 3) - 1) * 380;
  const dxo = mp.x - cx, dyo = mp.y - cy, dd = Math.hypot(dxo, dyo) || 1;
  const px = Math.max(-half + 100, Math.min(half - 100, mp.x + (-dyo / dd) * lateral * (attacker ? 1 : 0.3)));
  const py = Math.max(-half + 100, Math.min(half - 100, mp.y + (dxo / dd) * lateral * (attacker ? 1 : 0.3)));
  if (s.kind === 'recon') return { k: 'attackMove', x: px, y: py };
  if (s.kind === 'attackHeli') return near ? { k: 'attackMove', x: c.sqCx[near.id], y: c.sqCy[near.id] } : null;
  if (attacker) {
    if (Math.hypot(cx - mp.x, cy - mp.y) < mp.r * 0.8) return { k: 'dig', x: cx, y: cy };
    return { k: 'attackMove', x: px, y: py, wedge: true };
  }
  const dist = Math.hypot(cx - mp.x, cy - mp.y);
  if (near && nd < 700 && frac > 0.6 && (s.kind === 'mbt' || s.kind === 'mech') && Math.hypot(c.sqCx[near.id] - mp.x, c.sqCy[near.id] - mp.y) < mp.r * 2.5) return { k: 'attack', x: 0, y: 0, target: near.id };
  if (dist > mp.r * 0.7) return { k: 'attackMove', x: mp.x + (m1 % 2 ? 1 : -1) * mp.r * 0.3, y: mp.y };
  return { k: 'dig', x: cx, y: cy };
}

export function runAi(b: Battle, side: Side): void {
  if (b.phase !== 'combat' || b.noAi) return;
  const c = cacheOf(b);
  const mine = b.squads.filter((s) => s.side === side && c.sqEnts[s.id]?.length > 0 && aiControls(b, s));
  const enemyAlive = b.squads.filter((s) => s.side !== side && c.sqEnts[s.id]?.length > 0);
  if (!mine.length) return;
  const k: Ctx2 = { b, side, attacker: b.attacker === side, half: b.map.sizeM / 2, enemyAlive, owned: b.objs.filter((o) => o.owner === side), notOwned: b.objs.filter((o) => o.owner !== side) };
  const neural = useNeural(b, side);
  let mi = 0;

  for (const s of mine) {
    if (s.routed) continue;
    const n = c.sqEnts[s.id].length;
    const frac = n / s.n0;
    const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
    const engaged = b.t - s.engagedT < 6;
    if (MANEUVER.has(s.kind) && ((s.morale < 0.3 && engaged) || frac < 0.2)) { applyAct(b, side, s, { k: 'retreat', x: 0, y: 0 }); continue; }
    // nearest known enemy squad
    let near: Squad | null = null, nd = 1e9;
    for (const e of enemyAlive) { const d = Math.hypot(c.sqCx[e.id] - cx, c.sqCy[e.id] - cy); if (d < nd) { nd = d; near = e; } }

    if (s.kind === 'mech' && s.cargo > 0 && engaged && nd < 900) issueOrder(b, side, [s.id], { kind: 'dismount' });
    if (!neural && c.sqSupp[s.id] > 0.5 && s.smoke > 0 && near && nd < 1200 && s.order !== 'hold') {
      const a = Math.atan2(c.sqCx[near.id] - cx, c.sqCy[near.id] - cy);
      issueOrder(b, side, [s.id], { kind: 'smoke', x: cx + Math.sin(a) * 60, y: cy + Math.cos(a) * 60 });
    }

    if (s.kind === 'artillery' || s.kind === 'mlrs' || s.kind === 'sam' || s.kind === 'logistics') {
      if (near && nd < 1100 && s.kind !== 'logistics') { applyAct(b, side, s, { k: 'retreat', x: 0, y: 0 }); continue; }
      if (s.order === 'idle' && s.kind !== 'sam') s.form = 'line';
      continue;
    }
    if (!MANEUVER.has(s.kind) && s.kind !== 'recon' && s.kind !== 'attackHeli') continue;

    const rule = ruleAct(k, s, mi++);
    if (!neural && tap.rec) observeSquad(k, s, rule);
    const act = neural ? decideSquad(k, s, rule, mi - 1) : rule;
    if (act) applyAct(b, side, s, act);
    s.ai = true;
  }

  // support calls: densest cluster of recently-spotted enemies
  const sup = b.support[side];
  if ((sup.artillery > 0 || sup.airstrike > 0 || sup.drone > 0) && !b.pend.some((m) => m.side === side && m.at > b.t - 40)) {
    let best: { x: number; y: number; n: number; hard: number } | null = null;
    for (const e of b.ents) {
      if (e.side === side || !e.alive || e.gone || b.t - e.spotT > 4) continue;
      let n = 0, hard = 0, fr = 0;
      nearby(b, e.x, e.y, 90, (o) => { if (o.side !== side) { n++; if (UNITS[o.kind].arm[0] > 40) hard++; } else fr++; });
      if (!fr && (!best || n > best.n)) best = { x: e.x, y: e.y, n, hard };
    }
    if (best) {
      const kind = sup.airstrike > 0 && best.hard >= 2 ? 'airstrike' : sup.artillery > 0 && best.n >= 3 ? 'artillery' : sup.drone > 0 && best.hard >= 1 ? 'drone' : null;
      if (kind && (!neural || decideSupport(k, best, kind))) schedule(b, side, kind, best.x, best.y);
    }
  }
}
