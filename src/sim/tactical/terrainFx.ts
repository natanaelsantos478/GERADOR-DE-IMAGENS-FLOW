/** Dynamic effects of the real terrain: destructible bridges, protected sites, structures, artillery fires, objective candidates, point queries. */
import { encodeRle, SURF, type NavData } from '../../data/vector/nav';
import { navCell, navCenter, navOf, type NavRT } from './nav';
import { BRIDGE_HP, INFRA_HP, POI_OBJECTIVE, SURFACE_RULES, USE_RULES } from './terrainRules';
import type { Battle, Proj, TacticalMap } from './types';
import { rnd, nearby } from './util';

const PROT_CODES = [USE_RULES.hospital.code, USE_RULES.school.code, USE_RULES.religious.code, USE_RULES.cemetery.code];
const USE_NAME = Object.fromEntries(Object.entries(USE_RULES).map(([k, v]) => [v.code, k]));
const ev = (b: Battle, e: NonNullable<Battle['ev']>[number]) => { (b.ev ??= []).push(e); };

// ---------------------------------------------------------------- bridges
const groups = new WeakMap<NavRT, { lab: Int32Array; cells: Map<number, number[]> }>();
function bridgeGroups(rt: NavRT) {
  let g = groups.get(rt);
  if (g) return g;
  const n = rt.n, lab = new Int32Array(n * n).fill(-1), cells = new Map<number, number[]>();
  for (let s = 0; s < lab.length; s++) {
    if (rt.surf[s] !== SURF.BRIDGE || lab[s] !== -1) continue;
    const list: number[] = [], st = [s]; lab[s] = s;
    while (st.length) {
      const c = st.pop()!; list.push(c);
      const cx = c % n, cy = (c - cx) / n;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const X = cx + i, Y = cy + j;
        if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
        const q = Y * n + X;
        if (rt.surf[q] === SURF.BRIDGE && lab[q] === -1) { lab[q] = s; st.push(q); }
      }
    }
    cells.set(s, list);
  }
  g = { lab, cells }; groups.set(rt, g);
  return g;
}
/** Bridge decks as groups (key = lowest cell): centre and size. */
export function bridges(rt: NavRT): { key: number; x: number; y: number; cells: number }[] {
  return [...bridgeGroups(rt).cells].map(([key, l]) => { let x = 0, y = 0; for (const c of l) { const [a, b] = navCenter(rt, c); x += a; y += b; } return { key, x: x / l.length, y: y / l.length, cells: l.length }; });
}

function destroyBridge(b: Battle, rt: NavRT, key: number): void {
  const list = bridgeGroups(rt).cells.get(key);
  if (!list) return;
  const surf = Uint8Array.from(rt.surf);
  for (const c of list) surf[c] = SURF.DEEP; // what was under the deck is water or a gap: impassable
  const dead = new Set(list);
  for (const e of b.ents) if (e.alive && !e.gone && dead.has(navCell(rt, e.x, e.y)) && e.kind !== 'attackHeli') { e.hp = 0; e.alive = false; }
  b.map.nav = { ...b.map.nav!, surf: encodeRle(surf) }; // new object -> derived layers and components rebuild
  for (const s of b.squads) if (s.path.length && (s.order === 'move' || s.order === 'amove' || s.order === 'occupy')) { s.pend = [s.ox, s.oy]; s.path = []; s.pi = 0; }
  const [x, y] = navCenter(rt, key);
  ev(b, { k: 'bridgeDestroyed', x, y, t: b.t });
}

// ---------------------------------------------------------------- fires
export function ignite(b: Battle, rt: NavRT, c: number): void {
  const f = SURFACE_RULES[rt.surf[c]].fire;
  if (f <= 0 || (b.fires ??= []).length > 160 || b.fires.some((q) => q.c === c) || (b.burnt ??= []).includes(c)) return;
  if (rnd(b) < f * 0.7) b.fires.push({ c, until: b.t + 40 });
}
/** Once per second: burning cells hurt, spread by flammability and keep a smoke column that blocks line of sight. */
export function stepFires(b: Battle): void {
  const rt = navOf(b.map);
  if (!rt || !b.fires?.length) return;
  const keep: NonNullable<Battle['fires']> = [];
  for (const f of b.fires) {
    const [x, y] = navCenter(rt, f.c);
    if (b.t >= f.until) { (b.burnt ??= []).push(f.c); if (b.burnt.length > 600) b.burnt.shift(); continue; }
    keep.push(f);
    b.smokes.push({ x, y, r: rt.cs * 1.2, until: b.t + 2.5 });
    nearby(b, x, y, rt.cs * 0.7, (e) => { if (e.kind === 'attackHeli') return; e.hp -= 2.5; e.supp = Math.min(1, e.supp + 0.2); if (e.hp <= 0) { e.hp = 0; e.alive = false; } });
    for (const d of [1, -1, rt.n, -rt.n]) {
      const q = f.c + d;
      if (q < 0 || q >= rt.surf.length || (d === 1 && q % rt.n === 0) || (d === -1 && f.c % rt.n === 0)) continue;
      const fl = SURFACE_RULES[rt.surf[q]].fire;
      if (fl > 0.1 && keep.length < 160 && !b.fires.some((o) => o.c === q) && !b.burnt?.includes(q) && rnd(b) < fl * 0.1) keep.push({ c: q, until: b.t + 40 });
    }
  }
  b.fires = keep;
  if (b.smokes.length > 400) b.smokes = b.smokes.filter((s) => s.until > b.t);
}

// ---------------------------------------------------------------- impacts
export function onImpact(b: Battle, p: Proj): void {
  const rt = navOf(b.map);
  if (!rt || (p.ar <= 0 && !p.hit)) return;
  const c = navCell(rt, p.x1, p.y1), u = rt.use[c];
  const kind = PROT_CODES.includes(u) ? USE_NAME[u] : undefined;
  if (kind && b.t - ((b.prot ??= {})[kind] ?? -99) > 8) { b.prot[kind] = b.t; ev(b, { k: 'protectedHit', kind, x: p.x1, y: p.y1, side: p.side, t: b.t }); }
  if (p.ar <= 0) return;
  if (p.ar >= 8) {
    const g = bridgeGroups(rt), R = Math.ceil(p.ar / rt.cs), cx = c % rt.n, cy = (c - cx) / rt.n, hit = new Map<number, number>();
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const X = cx + i, Y = cy + j;
      if (X < 0 || Y < 0 || X >= rt.n || Y >= rt.n) continue;
      const q = Y * rt.n + X;
      if (rt.surf[q] !== SURF.BRIDGE) continue;
      const [qx, qy] = navCenter(rt, q), d = Math.hypot(qx - p.x1, qy - p.y1);
      if (d <= p.ar) hit.set(g.lab[q], Math.max(hit.get(g.lab[q]) ?? 0, 1 - d / p.ar));
    }
    for (const [key, f] of hit) {
      const bh = (b.bhp ??= {});
      bh[key] = (bh[key] ?? BRIDGE_HP) - p.dmg * (0.4 + f) * 1.2;
      if (bh[key] <= 0) { delete bh[key]; destroyBridge(b, rt, key); break; }
    }
    for (const s of rt.data.infra) {
      const hp = (b.infraHp ??= {})[s.id] ?? s.hp;
      if (hp <= 0 || Math.hypot(s.x - p.x1, s.y - p.y1) > p.ar + 6) continue;
      b.infraHp[s.id] = hp - p.dmg * 1.5;
      if (b.infraHp[s.id] <= 0) {
        const eff = INFRA_HP[s.kind].effect;
        if (eff === 'blackout') b.blackout = (b.blackout ?? 0) + 1;
        if (eff === 'comms') b.commsDown = (b.commsDown ?? 0) + 1;
        ev(b, { k: 'infraDestroyed', kind: s.kind, effect: eff, x: s.x, y: s.y, t: b.t });
      }
    }
  }
  if (p.kind === 'shell' || p.kind === 'rocket' || p.kind === 'bomb') ignite(b, rt, c);
}

// ---------------------------------------------------------------- queries
/** What the simulation knows about a point (strategic layer / UI): class, effects, use, building. */
export function queryNav(nav: NavData, lon: number, lat: number, heights?: number[]) {
  const mPerLon = 111320 * Math.cos((nav.center[1] * Math.PI) / 180);
  const x = (lon - nav.center[0]) * mPerLon, y = (lat - nav.center[1]) * 111320;
  if (Math.abs(x) > nav.sizeM / 2 || Math.abs(y) > nav.sizeM / 2) return null;
  const map: TacticalMap = { sizeM: nav.sizeM, n: heights ? Math.round(Math.sqrt(heights.length)) : 2, heights: heights ?? [0, 0, 0, 0], cover: [], road: [], water: [], nav };
  const rt = navOf(map)!, c = navCell(rt, x, y), s = rt.surf[c], r = SURFACE_RULES[s];
  return {
    x, y, surf: s, name: r.name, tags: r.tags, use: USE_NAME[rt.use[c]] ?? 'none', protectedSite: PROT_CODES.includes(rt.use[c]),
    building: rt.bld[c] ? nav.buildings[rt.bld[c] - 1] : null, cover: rt.cover[c], concealment: r.conceal, obstacleM: rt.obs[c], slopeDeg: rt.slope[c],
    speed: { foot: rt.spd.foot[c], wheel: rt.spd.wheel[c], track: rt.spd.track[c] },
  };
}

/** Capture candidates (hospital, police, town hall, station, bridge, peak, ...) with weights from POI_OBJECTIVE. */
export function objectiveCandidates(rt: NavRT): { x: number; y: number; kind: string; w: number }[] {
  const out: { x: number; y: number; kind: string; w: number }[] = [];
  for (const p of rt.data.pois) { const w = POI_OBJECTIVE[p.kind]; if (w) out.push({ x: p.x, y: p.y, kind: p.kind, w }); }
  for (const p of rt.data.peaks) out.push({ x: p.x, y: p.y, kind: 'peak', w: POI_OBJECTIVE.peak });
  for (const g of bridges(rt)) if (g.cells >= 6) out.push({ x: g.x, y: g.y, kind: 'bridge', w: POI_OBJECTIVE.bridge });
  for (const s of rt.data.infra) if (s.kind === 'power') out.push({ x: s.x, y: s.y, kind: 'power', w: POI_OBJECTIVE.power });
  return out;
}
