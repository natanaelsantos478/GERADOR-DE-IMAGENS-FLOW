/** Squad order execution (pathing, anchor movement) and element movement toward formation slots. */
import { cellFactor, cellOf, findPath, inside, moveFactor } from './grid';
import type { Battle, Ent, Squad } from './types';
import { UNITS } from './units';
import { DT, cacheOf, def, isAir, slotPos, wrapPi } from './util';

export function edgePoint(b: Battle, s: Squad): [number, number] {
  const half = b.map.sizeM / 2;
  return [Math.max(-half + 60, Math.min(half - 60, s.x)), s.side === 0 ? -half + 90 : half - 90];
}

export function setPath(b: Battle, s: Squad, x: number, y: number): boolean {
  const p = findPath(b.map, UNITS[s.kind].mob, s.x, s.y, x, y);
  if (!p.length) { s.path = []; s.pi = 0; return false; }
  s.path = p; s.pi = 2; s.repath = b.t;
  return true;
}

export function stepSquads(b: Battle): void {
  const c = cacheOf(b);
  for (const s of b.squads) {
    const alive = c.sqEnts[s.id];
    if (!alive.length) continue;
    const d = UNITS[s.kind];
    if (s.routed && s.order !== 'retreat') s.order = 'retreat';
    if (s.order === 'retreat' && !s.path.length) { const [ex, ey] = edgePoint(b, s); if (!setPath(b, s, ex, ey)) { s.x = ex; s.y = ey; } }
    if (s.order === 'attack') {
      const tgt = b.squads[s.target];
      const tn = tgt ? c.sqEnts[tgt.id].length : 0;
      if (!tn) { s.order = 'idle'; s.path = []; }
      else if (!s.path.length || b.t - s.repath > 6) {
        const reach = Math.max(...d.w.filter((w) => !w.ind).map((w) => w.r), 100) * 0.6;
        const dist = Math.hypot(c.sqCx[tgt.id] - s.x, c.sqCy[tgt.id] - s.y);
        if (dist > reach) setPath(b, s, c.sqCx[tgt.id], c.sqCy[tgt.id]); else { s.path = []; s.repath = b.t; }
      }
    }
    const moving = (s.order === 'move' || s.order === 'amove' || s.order === 'retreat' || s.order === 'attack') && s.path.length > 0 && s.pi < s.path.length;
    if (!moving) {
      if (s.path.length && s.pi >= s.path.length) {
        s.path = []; s.pi = 0;
        if (s.order === 'move' || s.order === 'amove') s.order = 'idle';
        if (s.order === 'retreat' && (Math.abs(s.y) > b.map.sizeM / 2 - 140)) withdraw(b, s);
      }
      continue;
    }
    if (s.order === 'amove' && c.sqEngaged[s.id] && !s.routed) continue; // stand and fight
    if (c.sqSupp[s.id] > 0.8 && d.mob === 'foot') continue;
    const tx = s.path[s.pi], ty = s.path[s.pi + 1];
    const dx = tx - s.x, dy = ty - s.y, dist = Math.hypot(dx, dy);
    if (dist < 4) { s.pi += 2; continue; }
    const hx = dx / dist, hy = dy / dist;
    const lag = Math.min(1, Math.max(0.25, 1 - (c.sqLag[s.id] - 40) / 120));
    const sp = d.spd * moveFactor(b.map, s.x, s.y, hx, hy, d.mob) * lag * (s.order === 'retreat' ? 1.1 : 1);
    const step = Math.min(dist, sp * DT);
    s.x += hx * step; s.y += hy * step;
    if (s.order !== 'attack' || dist > 20) s.face = Math.atan2(hx, hy);
    s.digging = false; s.dug = 0;
    if (s.order === 'retreat' && Math.abs(s.y) > b.map.sizeM / 2 - 100) { withdraw(b, s); }
  }
}

function withdraw(b: Battle, s: Squad): void {
  for (const e of b.ents) if (e.sq === s.id && e.alive) e.gone = true;
  s.path = []; s.order = 'idle';
}

export function stepEnts(b: Battle): void {
  const c = cacheOf(b);
  c.sqLag.fill(0);
  for (const s of b.squads) {
    const ids = c.sqEnts[s.id];
    const n = ids.length;
    if (!n) continue;
    const d = UNITS[s.kind];
    let lag = 0;
    for (let i = 0; i < n; i++) {
      const e = b.ents[ids[i]];
      const [sx, sy] = slotPos(s, i, n, d.sp);
      const dx = sx - e.x, dy = sy - e.y, dist = Math.hypot(dx, dy);
      lag += dist;
      const pinned = d.mob === 'foot' && e.supp > 0.8;
      if (dist > 1.5 && !pinned) {
        const hx = dx / dist, hy = dy / dist;
        const f = moveFactor(b.map, e.x, e.y, hx, hy, d.mob);
        const step = Math.min(dist, d.spd * f * 1.3 * DT);
        const nx = e.x + hx * step, ny = e.y + hy * step;
        if (isAir(e) || (inside(b.map, nx, ny) && cellFactor(b.map, cellOf(b.map, nx, ny), d.mob) > 0)) {
          e.x = nx; e.y = ny;
          e.moving = true; e.still = 0;
          if (dist > 5) turn(e, Math.atan2(hx, hy), d.turn);
        } else { e.moving = false; e.still += DT; }
      } else {
        e.moving = false; e.still += DT;
        const ti = e.tg[0] >= 0 ? e.tg[0] : e.tg[1];
        if (e.still > 0.5 && s.fireFree && ti >= 0 && d.arm[0] > 150 && d.w[0] && !d.w[0].ind) {
          const t = b.ents[ti];
          turn(e, Math.atan2(t.x - e.x, t.y - e.y), d.turn);
        } else if (e.still > 0.5 && !(d.arm[0] > 150)) turn(e, s.face, d.turn);
        else if (e.still > 3 && !s.fireFree) turn(e, s.face, d.turn);
      }
    }
    c.sqLag[s.id] = lag / n;
  }
}

function turn(e: Ent, to: number, rate: number): void {
  const diff = wrapPi(to - e.h), m = rate * DT;
  e.h = Math.abs(diff) <= m ? to : e.h + Math.sign(diff) * m;
}
