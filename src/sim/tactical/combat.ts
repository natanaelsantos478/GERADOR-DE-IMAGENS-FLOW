/** Target acquisition, firing, projectiles, damage, support strikes and morale. */
import { coverAt, heightAt, los } from './grid';
import type { Battle, Ent, Proj, Side } from './types';
import { UNITS, penFactor, type Weapon } from './units';
import { DT, cacheOf, def, gauss, isAir, nearby, rnd, wrapPi } from './util';

const eye = (e: Ent) => (e.kind === 'attackHeli' ? 40 : e.kind === 'infantry' || e.kind === 'special' || e.kind === 'engineer' ? 1.6 : 2.4);
const isFoot = (e: Ent) => def(e).mob === 'foot';

/** 0 front, 1 side, 2 rear of `t` as seen from (sx,sy). */
export function armorFace(t: Ent, sx: number, sy: number): 0 | 1 | 2 {
  const rel = Math.abs(wrapPi(Math.atan2(sx - t.x, sy - t.y) - t.h));
  return rel < 1.047 ? 0 : rel > 2.094 ? 2 : 1;
}
export function coverMod(b: Battle, t: Ent): number {
  const lvl = coverAt(b.map, t.x, t.y);
  const foot = isFoot(t);
  const sq = b.squads[t.sq];
  return Math.min(0.75, (foot ? [0, 0.3, 0.5][lvl] : [0, 0.1, 0.2][lvl]) + sq.dug * (foot ? 0.35 : 0.25));
}
const canHit = (w: Weapon, t: Ent) => (isAir(t) ? !!w.air : !w.noGround);

/** Detection range of `t` as seen by a unit with sensor range `vis`. */
const detect = (b: Battle, t: Ent, vis: number) => vis * (isFoot(t) ? 0.7 : 1) * (1 - 0.4 * b.squads[t.sq].dug) * (t.moving ? 1.2 : 1);

const cand: { e: Ent; s: number }[] = [];
export function acquire(b: Battle): void {
  const c = cacheOf(b);
  c.sqEngaged.fill(0);
  for (const e of b.ents) {
    if (!e.alive || e.gone) continue;
    const sq = b.squads[e.sq];
    const d = def(e);
    const due = (e.id + b.tick) % 10 === 0;
    for (let wi = 0; wi < d.w.length; wi++) {
      const w = d.w[wi];
      if (e.am[wi] <= 0) { e.tg[wi] = -1; continue; }
      if (!due) {
        const cur = e.tg[wi] >= 0 ? b.ents[e.tg[wi]] : null;
        if (cur && !w.ind && cur.alive && !cur.gone && Math.hypot(cur.x - e.x, cur.y - e.y) < w.r * 0.75) c.sqEngaged[e.sq] = 1;
        continue;
      }
      if (sq.routed) { e.tg[wi] = -1; continue; }
      cand.length = 0;
      const prev = e.tg[wi];
      const consider = (t: Ent) => {
        if (t.side === e.side || !t.alive || t.gone || !canHit(w, t)) return;
        const dist = Math.hypot(t.x - e.x, t.y - e.y);
        if (dist > w.r || dist < (w.min ?? 0)) return;
        const eff = penFactor(w.p, UNITS[t.kind].arm[0] * 0.7);
        if (eff < 0.12 && !w.ar) return;
        if (!w.ind && dist > detect(b, t, d.vis) && b.t - t.spotT > 3) return;
        let s = (UNITS[t.kind].threat * eff * (w.d + w.ar * 2)) / (1 + dist / w.r);
        if (t.id === prev) s *= 1.3;
        if (sq.order === 'attack' && t.sq === sq.target) s *= 2;
        cand.push({ e: t, s });
      };
      if (w.ind) {
        if (e.still < 6) { e.tg[wi] = -1; continue; }
        for (const t of b.ents) if (t.side !== e.side && b.t - t.spotT < 5) consider(t);
      } else nearby(b, e.x, e.y, w.r, consider);
      cand.sort((p, q) => q.s - p.s);
      let pick = -1;
      for (let k = 0; k < Math.min(3, cand.length); k++) {
        const t = cand[k].e;
        if (w.ind) {
          let friendly = 0;
          nearby(b, t.x, t.y, w.ar * 1.5 + 40, (f) => { if (f.side === e.side) friendly++; });
          if (friendly) continue;
          pick = t.id; break;
        }
        if (los(b.map, b.smokes, b.t, e.x, e.y, eye(e), t.x, t.y, eye(t) * 0.7)) {
          pick = t.id;
          if (Math.hypot(t.x - e.x, t.y - e.y) <= detect(b, t, d.vis)) t.spotT = b.t;
          break;
        }
      }
      e.tg[wi] = pick;
      if (pick >= 0 && !w.ind && Math.hypot(b.ents[pick].x - e.x, b.ents[pick].y - e.y) < w.r * 0.75) c.sqEngaged[e.sq] = 1;
    }
  }
}

function addProj(b: Battle, p: Omit<Proj, 'id'>): void {
  b.proj.push({ id: b.nextProj++, ...p });
}

export function fireWeapons(b: Battle): void {
  for (const e of b.ents) {
    if (!e.alive || e.gone) continue;
    const sq = b.squads[e.sq];
    const d = def(e);
    e.supp = Math.max(0, e.supp - 0.12 * DT);
    for (let wi = 0; wi < d.w.length; wi++) {
      if (e.cd[wi] > 0) e.cd[wi] -= DT;
      const w = d.w[wi];
      const ti = e.tg[wi];
      if (ti < 0 || e.cd[wi] > 0 || e.am[wi] <= 0 || !sq.fireFree || sq.routed || e.supp > 0.95) continue;
      const t = b.ents[ti];
      if (!t.alive || t.gone) { e.tg[wi] = -1; continue; }
      const dist = Math.hypot(t.x - e.x, t.y - e.y);
      if (dist > w.r * 1.02) { e.tg[wi] = -1; continue; }
      if (w.ind && (e.still < 6 || e.moving)) continue;
      fire(b, e, wi, t, dist);
    }
  }
}

function fire(b: Battle, e: Ent, wi: number, t: Ent, dist: number): void {
  const w = UNITS[e.kind].w[wi];
  e.am[wi]--;
  e.cd[wi] = w.rf * (0.85 + 0.3 * rnd(b));
  const dur = Math.max(0.08, dist / w.v);
  const face = armorFace(t, e.x, e.y);
  if (w.ind) {
    const sigma = 10 + 0.014 * dist;
    addProj(b, { kind: w.t === 'rocket' ? 'rocket' : 'shell', x0: e.x, y0: e.y, x1: t.x + gauss(b) * sigma, y1: t.y + gauss(b) * sigma, t0: b.t, t1: b.t + dur, side: e.side, tgt: -1, hit: false, dmg: w.d, pen: w.p, ar: w.ar, supp: w.s, face: 2, air: false });
    return;
  }
  let p = w.a * Math.max(0.12, 1 - 0.6 * (dist / w.r)) * (1 - 0.7 * e.supp) * (1 - coverMod(b, t));
  if (e.moving && !isAir(e)) p *= isFoot(e) ? 0.4 : 0.55;
  if (t.moving) p *= 0.8;
  const hit = rnd(b) < p;
  const m = hit ? 0 : 1;
  addProj(b, {
    kind: w.t, x0: e.x, y0: e.y, x1: t.x + m * gauss(b) * (6 + dist * 0.01), y1: t.y + m * gauss(b) * (6 + dist * 0.01),
    t0: b.t, t1: b.t + dur, side: e.side, tgt: t.id, hit, dmg: w.d, pen: w.p, ar: w.ar, supp: w.s, face, air: isAir(t),
  });
}

export function damage(b: Battle, e: Ent, dmg: number, pen: number, face: number, supp: number, cause: Side): void {
  if (!e.alive) return;
  const d = def(e);
  const dm = dmg * penFactor(pen, d.arm[face]) * (0.8 + 0.4 * rnd(b));
  e.supp = Math.min(1, e.supp + supp * (isFoot(e) ? 1 : 0.35));
  e.hp -= dm;
  if (e.hp > 0) return;
  e.hp = 0; e.alive = false;
  const sq = b.squads[e.sq];
  sq.morale = Math.max(0, sq.morale - 0.45 / Math.max(2, sq.n0) - 0.01);
  for (const o of b.squads) if (o.side === e.side && o.id !== sq.id && Math.hypot(o.x - e.x, o.y - e.y) < 300) o.morale = Math.max(0, o.morale - 0.008);
  void cause;
}

function impact(b: Battle, p: Proj): void {
  const t = p.tgt >= 0 ? b.ents[p.tgt] : null;
  if (p.hit && t && t.alive && !t.gone) damage(b, t, p.dmg, p.pen, p.face, p.supp, p.side);
  else if (t && t.alive && !t.gone && p.tgt >= 0) t.supp = Math.min(1, t.supp + p.supp * 0.4);
  if (p.ar > 0) {
    nearby(b, p.x1, p.y1, p.ar, (o) => {
      if (o === t && p.hit) return;
      const f = 1 - Math.hypot(o.x - p.x1, o.y - p.y1) / p.ar;
      const dug = 1 - 0.5 * b.squads[o.sq].dug;
      if (isAir(o) && p.kind !== 'missile') return;
      damage(b, o, p.dmg * f * 0.9 * dug, p.pen * 0.5, 2, p.supp * f * 1.5, p.side);
    });
    if (coverAt(b.map, p.x1, p.y1) === 2) b.urbanHits += p.dmg * p.ar * 0.0004;
  }
}

export function stepProjectiles(b: Battle): void {
  let w = 0;
  for (const p of b.proj) {
    if (p.t1 <= b.t) impact(b, p);
    else b.proj[w++] = p;
  }
  b.proj.length = w;
}

const DELAY: Record<string, number> = { artillery: 25, airstrike: 40, drone: 12 };
export function schedule(b: Battle, side: Side, kind: 'artillery' | 'airstrike' | 'drone', x: number, y: number): void {
  b.support[side][kind]--;
  b.pend.push({ kind, side, x, y, at: b.t + DELAY[kind], n: kind === 'artillery' ? 8 : kind === 'airstrike' ? 5 : 1, done: 0 });
}

/** Pending support missions, smoke expiry, digging, resupply. */
export function stepEffects(b: Battle): void {
  let w = 0;
  for (const m of b.pend) {
    if (b.t >= m.at) {
      const gap = m.kind === 'artillery' ? 1.1 : m.kind === 'airstrike' ? 0.25 : 1;
      while (m.done < m.n && b.t >= m.at + m.done * gap) {
        if (m.kind === 'airstrike' && m.done === 0) {
          // SAMs of the opposing side may shoot the aircraft down.
          let sams = 0;
          for (const e of b.ents) if (e.kind === 'sam' && e.side !== m.side && e.alive && !e.gone && e.am[0] > 0 && Math.hypot(e.x - m.x, e.y - m.y) < 4500) { sams++; e.am[0]--; }
          if (rnd(b) < Math.min(0.85, sams * 0.3)) { m.done = m.n; break; }
        }
        const k = m.done++;
        const spread = m.kind === 'artillery' ? 70 : 0;
        const ang = m.kind === 'airstrike' ? 0 : 0;
        const x1 = m.x + (m.kind === 'airstrike' ? (k - 2) * 28 * Math.sin(ang + 0.6) : gauss(b) * spread);
        const y1 = m.y + (m.kind === 'airstrike' ? (k - 2) * 28 * Math.cos(ang + 0.6) : gauss(b) * spread);
        if (m.kind === 'drone') {
          let best: Ent | null = null, bs = 0;
          nearby(b, m.x, m.y, 220, (e) => { if (e.side !== m.side) { const s = UNITS[e.kind].threat; if (s > bs) { bs = s; best = e; } } });
          const tgt = best as Ent | null;
          if (tgt) addProj(b, { kind: 'missile', x0: m.x, y0: m.y, x1: tgt.x, y1: tgt.y, t0: b.t, t1: b.t + 0.8, side: m.side, tgt: tgt.id, hit: true, dmg: 90, pen: 600, ar: 8, supp: 0.4, face: 2, air: false });
          nearby(b, m.x, m.y, 600, (e) => { if (e.side !== m.side) e.spotT = b.t + 40; });
        } else {
          addProj(b, { kind: m.kind === 'airstrike' ? 'bomb' : 'shell', x0: x1, y0: y1, x1, y1, t0: b.t, t1: b.t + (m.kind === 'airstrike' ? 0.8 : 1.2), side: m.side, tgt: -1, hit: false, dmg: m.kind === 'airstrike' ? 160 : 60, pen: 300, ar: m.kind === 'airstrike' ? 38 : 26, supp: 0.7, face: 2, air: false });
        }
      }
    }
    if (m.done < m.n) b.pend[w++] = m;
  }
  b.pend.length = w;
  b.smokes = b.smokes.filter((s) => s.until > b.t);
}

/** Once per second: dig-in, logistics resupply. */
export function secondly(b: Battle): void {
  for (const sq of b.squads) {
    if (sq.digging) sq.dug = Math.min(1, sq.dug + 1 / (30 / Math.max(0.2, UNITS[sq.kind].dig)));
  }
  for (const e of b.ents) {
    if (e.kind !== 'logistics' || !e.alive || e.gone || e.am[0] <= 0) continue;
    nearby(b, e.x, e.y, 70, (o) => {
      if (o.side !== e.side || o === e || e.am[0] <= 0) return;
      const od = UNITS[o.kind];
      for (let wi = 0; wi < od.w.length; wi++) {
        const full = od.w[wi].n;
        if (full && o.am[wi] < full * 0.9 && e.am[0] > 0) { const give = Math.min(full - o.am[wi], Math.ceil(full * 0.05), e.am[0]); o.am[wi] += give; e.am[0] -= give; }
      }
    });
  }
  // morale
  const c = cacheOf(b);
  for (const sq of b.squads) {
    const n = c.sqEnts[sq.id].length;
    if (!n) continue;
    const engaged = c.sqEngaged[sq.id] === 1;
    if (engaged) sq.engagedT = b.t;
    const calm = b.t - sq.engagedT > 6;
    sq.morale = Math.min(1, Math.max(0, sq.morale + (calm ? 0.006 : 0.001) - 0.03 * c.sqSupp[sq.id]));
    if (!sq.routed && sq.morale < 0.2) { sq.routed = true; sq.ai = true; sq.order = 'retreat'; sq.digging = false; sq.dug = 0; sq.path = []; }
    else if (sq.routed && sq.morale > 0.4 && calm) { sq.routed = false; sq.order = 'idle'; }
  }
  void heightAt;
}
