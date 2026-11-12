import { schedule } from './combat';
import { cellFactor, cellOf, inside } from './grid';
import { edgePoint, setPath } from './move';
import type { Battle, Ent, Order, OrderResult, Side, Squad } from './types';
import { UNITS } from './units';
import { slotPos } from './util';

const err = (reason: string): OrderResult => ({ ok: false, reason });

/** Re-seat the alive elements of a squad on their formation slots (deployment). */
export function layout(b: Battle, s: Squad): void {
  const ids = b.ents.filter((e) => e.sq === s.id && e.alive && !e.gone);
  ids.forEach((e, i) => { const [x, y] = slotPos(s, i, ids.length, UNITS[s.kind].sp); e.x = x; e.y = y; e.h = s.face; });
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
        if (b.phase === 'deploy') {
          const r = b.deploy[side];
          s.x = Math.max(r.x - r.w / 2, Math.min(r.x + r.w / 2, o.x)); s.y = Math.max(r.y - r.h / 2, Math.min(r.y + r.h / 2, o.y));
          layout(b, s); break;
        }
        if (cellFactor(b.map, cellOf(b.map, o.x, o.y), UNITS[s.kind].mob) === 0) return err('tac.err.impassable');
        if (!setPath(b, s, o.x, o.y)) return err('tac.err.noPath');
        s.order = o.kind === 'move' ? 'move' : 'amove'; s.ox = o.x; s.oy = o.y; s.digging = false; s.dug = 0;
        break;
      }
      case 'attack': {
        const t = b.squads[o.target];
        if (b.phase !== 'combat') return err('tac.err.deployPhase');
        if (!t || t.side === side) return err('tac.err.badTarget');
        s.order = 'attack'; s.target = t.id; s.path = []; s.digging = false; s.dug = 0;
        break;
      }
      case 'hold': s.order = 'hold'; s.path = []; break;
      case 'retreat': {
        s.order = 'retreat'; s.path = []; s.digging = false; s.dug = 0;
        const [ex, ey] = edgePoint(b, s); setPath(b, s, ex, ey);
        break;
      }
      case 'formation': s.form = o.form; if (o.facing !== undefined) s.face = o.facing; if (b.phase === 'deploy') layout(b, s); break;
      case 'face': s.face = o.facing; if (b.phase === 'deploy') layout(b, s); break;
      case 'fire': s.fireFree = o.free; break;
      case 'dig': s.path = []; s.order = 'hold'; s.digging = true; break;
      case 'smoke': {
        if (s.smoke <= 0 || b.phase !== 'combat') return err('tac.err.noSmoke');
        const f = 70;
        let x = o.x ?? s.x + Math.sin(s.face) * f, y = o.y ?? s.y + Math.cos(s.face) * f;
        const d = Math.hypot(x - s.x, y - s.y);
        if (d > 450) { x = s.x + ((x - s.x) / d) * 450; y = s.y + ((y - s.y) / d) * 450; }
        b.smokes.push({ x, y, r: 38, until: b.t + 45 }); s.smoke--;
        break;
      }
      case 'dismount': if (!dismount(b, s)) return err('tac.err.noCargo'); break;
    }
  }
  return any ? { ok: true } : err('tac.err.noUnits');
}

export { dismount };
