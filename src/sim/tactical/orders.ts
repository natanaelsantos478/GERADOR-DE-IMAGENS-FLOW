import { schedule } from './combat';
import { cellFactor, cellOf, inside } from './grid';
import { edgePoint, endMove, setPath, ungarrison } from './move';
import { mainComp, navCell, navCenter, navFactor, navOf, snapCell } from './nav';
import type { Battle, Ent, Order, OrderResult, Side, Squad } from './types';
import { UNITS } from './units';
import { slotPos } from './util';

/** Marked waypoints [x,y,...]: whole pairs inside the map, at most MAX_VIA of them; null when one is outside. */
const MAX_VIA = 24;
function viaOf(b: Battle, via?: number[]): number[] | null {
  if (!via || !via.length) return [];
  const out: number[] = [];
  for (let i = 0; i + 1 < via.length && out.length < MAX_VIA * 2; i += 2) {
    if (!Number.isFinite(via[i]) || !Number.isFinite(via[i + 1]) || !inside(b.map, via[i], via[i + 1])) return null;
    out.push(via[i], via[i + 1]);
  }
  return out;
}
const err = (reason: string): OrderResult => ({ ok: false, reason });

/** Re-seat the alive elements of a squad on their formation slots (deployment). */
export function layout(b: Battle, s: Squad): void {
  const ids = b.ents.filter((e) => e.sq === s.id && e.alive && !e.gone);
  const rt = navOf(b.map), mob = UNITS[s.kind].mob;
  if (rt && mob !== 'air') {
    // deployment only on cells the unit can stand on: move the anchor, then each element, to the nearest passable cell
    const a = snapCell(rt, mob, navCell(rt, s.x, s.y), 120, mainComp(rt, mob));
    if (a >= 0) [s.x, s.y] = navCenter(rt, a);
  }
  ids.forEach((e, i) => {
    let [x, y] = slotPos(s, i, ids.length, UNITS[s.kind].sp);
    if (rt && mob !== 'air' && navFactor(rt, navCell(rt, x, y), mob) === 0) { const c = snapCell(rt, mob, navCell(rt, x, y), 12, mainComp(rt, mob)); [x, y] = c >= 0 ? navCenter(rt, c) : [s.x, s.y]; }
    e.x = x; e.y = y; e.h = s.face;
  });
}

export function newEnt(b: Battle, s: Squad, ammo: number, x: number, y: number): Ent {
  const d = UNITS[s.kind];
  const e: Ent = {
    id: b.ents.length, sq: s.id, side: s.side, kind: s.kind, x, y, h: s.face, hp: d.hp, alive: true, supp: 0,
    am: d.w.map((w) => Math.round(w.n * ammo)), cd: d.w.map(() => 0), tg: d.w.map(() => -1),
    still: 0, moving: false, spotT: -99, gone: false,
  };
  b.ents.push(e);
  return e;
}

function dismount(b: Battle, s: Squad): boolean {
  if (s.kind !== 'mech' || s.cargo <= 0) return false;
  const id = b.squads.length;
  const inf: Squad = {
    ...s, id, kind: 'infantry', name: `${s.name} (inf)`, modelId: UNITS.infantry.model, form: 'scatter', order: 'idle', path: [], pi: 0,
    dug: 0, digging: false, n0: s.cargo, smoke: 1, cargo: 0, engagedT: -99, target: -1,
  };
  b.squads.push(inf);
  for (let i = 0; i < s.cargo; i++) { const [x, y] = slotPos(inf, i, s.cargo, UNITS.infantry.sp); newEnt(b, inf, 0.85, x, y); }
  s.cargo = 0;
  layout(b, inf); // dismounted infantry may only appear on cells it can stand on
  return true;
}

export function issueOrder(b: Battle, side: Side, ids: number[], o: Order): OrderResult {
  if (b.phase === 'ended') return err('tac.err.ended');
  if (o.kind === 'ready') { b.ready[side] = true; return { ok: true }; }
  if (o.kind === 'artillery' || o.kind === 'airstrike' || o.kind === 'drone') {
    if (b.phase !== 'combat') return err('tac.err.deployPhase');
    if (b.support[side][o.kind] <= 0) return err('tac.err.noSupport');
    if (!inside(b.map, o.x, o.y)) return err('tac.err.outOfMap');
    schedule(b, side, o.kind, o.x, o.y);
    return { ok: true };
  }
  let any = false;
  for (const id of ids) {
    const s = b.squads[id];
    if (!s || s.side !== side) return err('tac.err.badSquad');
    if (!b.ents.some((e) => e.sq === id && e.alive && !e.gone)) continue;
    any = true;
    if (s.routed && o.kind !== 'retreat') continue;
    s.ai = false;
    switch (o.kind) {
      case 'move': case 'attackMove': {
        if (!inside(b.map, o.x, o.y)) return err('tac.err.outOfMap');
        const via = viaOf(b, o.via);
        if (!via) return err('tac.err.outOfMap');
        if (b.phase === 'deploy') {
          const r = b.deploy[side];
          s.x = Math.max(r.x - r.w / 2, Math.min(r.x + r.w / 2, o.x)); s.y = Math.max(r.y - r.h / 2, Math.min(r.y + r.h / 2, o.y));
          layout(b, s); break;
        }
        ungarrison(b, s);
        // marked route: leg k goes to point k; only the first leg is searched now, the others when the previous one ends
        const legs = via.length ? [...via, o.x, o.y] : [o.x, o.y];
        const fx = legs[0], fy = legs[1];
        if (!navOf(b.map) && cellFactor(b.map, cellOf(b.map, fx, fy), UNITS[s.kind].mob) === 0) return err('tac.err.impassable');
        endMove(s); delete s.pend;
        s.order = o.kind === 'move' ? 'move' : 'amove'; s.ox = fx; s.oy = fy; s.digging = false; s.dug = 0;
        if (legs.length > 2) s.route = legs.slice(2);
        if (o.breach && UNITS[s.kind].mob === 'track') s.breach = true;
        if (!setPath(b, s, fx, fy)) { s.order = 'idle'; endMove(s); return err('tac.err.noPath'); }
        break;
      }
      case 'attack': {
        endMove(s);
        const t = b.squads[o.target];
        if (b.phase !== 'combat') return err('tac.err.deployPhase');
        if (!t || t.side === side) return err('tac.err.badTarget');
        ungarrison(b, s);
        s.order = 'attack'; s.target = t.id; s.path = []; s.digging = false; s.dug = 0;
        break;
      }
      case 'hold': endMove(s); s.order = 'hold'; s.path = []; break;
      case 'retreat': {
        endMove(s);
        ungarrison(b, s);
        s.order = 'retreat'; s.path = []; s.digging = false; s.dug = 0;
        const [ex, ey] = edgePoint(b, s); setPath(b, s, ex, ey);
        break;
      }
      case 'formation': s.form = o.form; if (o.facing !== undefined) s.face = o.facing; if (b.phase === 'deploy') layout(b, s); break;
      case 'face': s.face = o.facing; if (b.phase === 'deploy') layout(b, s); break;
      case 'fire': s.fireFree = o.free; break;
      case 'dig': endMove(s); s.path = []; s.order = 'hold'; s.digging = true; break;
      case 'smoke': {
        if (s.smoke <= 0 || b.phase !== 'combat') return err('tac.err.noSmoke');
        const f = 70;
        let x = o.x ?? s.x + Math.sin(s.face) * f, y = o.y ?? s.y + Math.cos(s.face) * f;
        const d = Math.hypot(x - s.x, y - s.y);
        if (d > 450) { x = s.x + ((x - s.x) / d) * 450; y = s.y + ((y - s.y) / d) * 450; }
        b.smokes.push({ x, y, r: 38, until: b.t + 45 }); s.smoke--;
        break;
      }
      case 'occupy': {
        const rt = navOf(b.map);
        const bd = rt?.data.buildings[o.building - 1];
        if (!rt || !bd || UNITS[s.kind].mob !== 'foot' || !bd.enterable || rt.rub.has(bd.id)) return err('tac.err.notEnterable');
        endMove(s);
        if (b.phase !== 'combat') return err('tac.err.deployPhase');
        const live = (b.garr?.[bd.id] ?? []).filter((q) => q !== s.id && b.ents.some((e) => e.sq === q && e.alive && !e.gone));
        if (live.length >= bd.cap) return err('tac.err.buildingFull');
        let bc = -1, bd2 = 1e18;
        for (const c of rt.bcells[bd.id]) { const [x, y] = navCenter(rt, c); const d = Math.hypot(x - bd.cx, y - bd.cy); if (d < bd2) { bd2 = d; bc = c; } }
        if (bc < 0) return err('tac.err.notEnterable');
        ungarrison(b, s);
        const [gx, gy] = navCenter(rt, bc);
        s.inb = bd.id; s.order = 'occupy'; s.ox = gx; s.oy = gy; s.digging = false; s.dug = 0;
        if (!setPath(b, s, gx, gy)) { s.order = 'idle'; return err('tac.err.noPath'); }
        break;
      }
      case 'dismount': if (!dismount(b, s)) return err('tac.err.noCargo'); break;
    }
  }
  return any ? { ok: true } : err('tac.err.noUnits');
}

export { dismount };
