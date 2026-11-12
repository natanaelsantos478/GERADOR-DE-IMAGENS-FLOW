/** Tactical AI for any side (enemy, allies, "auto-command"). Runs every 2 s per side. */
import { schedule } from './combat';
import { issueOrder } from './orders';
import type { Battle, Side, Squad } from './types';
import { UNITS } from './units';
import { cacheOf, nearby } from './util';

export const aiControls = (b: Battle, s: Squad) => s.side !== b.player || b.auto[s.side] || s.ai;

const MANEUVER = new Set(['infantry', 'special', 'engineer', 'mech', 'mbt']);

export function runAi(b: Battle, side: Side): void {
  if (b.phase !== 'combat' || b.noAi) return;
  const c = cacheOf(b);
  const mine = b.squads.filter((s) => s.side === side && c.sqEnts[s.id]?.length > 0 && aiControls(b, s));
  const enemyAlive = b.squads.filter((s) => s.side !== side && c.sqEnts[s.id]?.length > 0);
  if (!mine.length) return;
  const attacker = b.attacker === side;
  const half = b.map.sizeM / 2;
  const owned = b.objs.filter((o) => o.owner === side);
  const notOwned = b.objs.filter((o) => o.owner !== side);
  let mi = 0;
  const give = (s: Squad, kind: 'attackMove' | 'move' | 'hold' | 'dig' | 'retreat', x = 0, y = 0) => {
    if (kind === 'attackMove' || kind === 'move') {
      if (s.order === (kind === 'move' ? 'move' : 'amove') && Math.hypot(s.ox - x, s.oy - y) < 60) return;
      issueOrder(b, side, [s.id], { kind, x, y });
    } else if (kind === 'dig') { if (!s.digging) issueOrder(b, side, [s.id], { kind: 'dig' }); }
    else if (kind === 'hold') { if (s.order !== 'hold' && s.order !== 'idle') issueOrder(b, side, [s.id], { kind: 'hold' }); }
    else if (s.order !== 'retreat') issueOrder(b, side, [s.id], { kind: 'retreat' });
    s.ai = true; // orders from the AI keep the squad AI-driven
  };

  for (const s of mine) {
    if (s.routed) continue;
    const n = c.sqEnts[s.id].length;
    const frac = n / s.n0;
    const cx = c.sqCx[s.id], cy = c.sqCy[s.id];
    const engaged = b.t - s.engagedT < 6;
    if (MANEUVER.has(s.kind) && ((s.morale < 0.3 && engaged) || frac < 0.2)) { give(s, 'retreat'); continue; }
    // nearest known enemy squad
    let near: Squad | null = null, nd = 1e9;
    for (const e of enemyAlive) { const d = Math.hypot(c.sqCx[e.id] - cx, c.sqCy[e.id] - cy); if (d < nd) { nd = d; near = e; } }

    if (s.kind === 'mech' && s.cargo > 0 && engaged && nd < 900) issueOrder(b, side, [s.id], { kind: 'dismount' });
    if (c.sqSupp[s.id] > 0.5 && s.smoke > 0 && near && nd < 1200 && s.order !== 'hold') {
      const a = Math.atan2(c.sqCx[near.id] - cx, c.sqCy[near.id] - cy);
      issueOrder(b, side, [s.id], { kind: 'smoke', x: cx + Math.sin(a) * 60, y: cy + Math.cos(a) * 60 });
    }

    if (s.kind === 'artillery' || s.kind === 'mlrs' || s.kind === 'sam' || s.kind === 'logistics') {
      if (near && nd < 1100 && s.kind !== 'logistics') { give(s, 'retreat'); continue; }
      if (s.order === 'idle' && s.kind !== 'sam') s.form = 'line';
      continue;
    }
    if (!MANEUVER.has(s.kind) && s.kind !== 'recon' && s.kind !== 'attackHeli') continue;

    const pool = attacker ? (notOwned.length ? notOwned : b.objs) : owned.length ? owned : b.objs;
    const mp = pool[mi++ % pool.length];
    const lateral = ((mi % 3) - 1) * 380;
    const dxo = mp.x - cx, dyo = mp.y - cy, dd = Math.hypot(dxo, dyo) || 1;
    const px = Math.max(-half + 100, Math.min(half - 100, mp.x + (-dyo / dd) * lateral * (attacker ? 1 : 0.3)));
    const py = Math.max(-half + 100, Math.min(half - 100, mp.y + (dxo / dd) * lateral * (attacker ? 1 : 0.3)));
    if (s.kind === 'recon') { give(s, 'attackMove', px, py); continue; }
    if (s.kind === 'attackHeli') {
      if (near) give(s, 'attackMove', c.sqCx[near.id], c.sqCy[near.id]);
      continue;
    }
    if (attacker) {
      if (Math.hypot(cx - mp.x, cy - mp.y) < mp.r * 0.8) { give(s, 'dig'); }
      else {
        if (s.form === 'scatter' && (s.kind === 'mbt' || s.kind === 'mech')) s.form = 'wedge';
        give(s, 'attackMove', px, py);
      }
    } else {
      const dist = Math.hypot(cx - mp.x, cy - mp.y);
      if (near && nd < 700 && frac > 0.6 && (s.kind === 'mbt' || s.kind === 'mech') && Math.hypot(c.sqCx[near.id] - mp.x, c.sqCy[near.id] - mp.y) < mp.r * 2.5) issueOrder(b, side, [s.id], { kind: 'attack', target: near.id });
      else if (dist > mp.r * 0.7) give(s, 'attackMove', mp.x + (mi % 2 ? 1 : -1) * mp.r * 0.3, mp.y);
      else give(s, 'dig');
    }
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
      if (sup.airstrike > 0 && best.hard >= 2) schedule(b, side, 'airstrike', best.x, best.y);
      else if (sup.artillery > 0 && best.n >= 3) schedule(b, side, 'artillery', best.x, best.y);
      else if (sup.drone > 0 && best.hard >= 1) schedule(b, side, 'drone', best.x, best.y);
    }
  }
}
