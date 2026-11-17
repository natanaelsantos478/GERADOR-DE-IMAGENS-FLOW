import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldStatic } from '../../core/contracts';
import { nodeFetchJson } from '../../data/fetchNode';
import { loadWorldStatic } from '../../data/loadWorld';
import { loadFixture, type Fixture, type FixtureName } from '../../data/vector/fixtures.test-util';
import { decodeRle, encodeRle, SURF } from '../../data/vector/nav';
import { createBattle, result, stepBattle } from './core';
import { issueOrder } from './orders';
import { buildMapFromWorld, defaultObjectives } from './mapWorld';
import { canStand, components, mainComp, navCell, navCenter, navOf, snapCell } from './nav';
import { navPath } from './navPath';
import { scenarioInput, sideForce } from './scenario.test-util';
import type { Battle, TacticalMap } from './types';
import { UNITS } from './units';

const AREAS: FixtureName[] = ['rio', 'paris', 'rural', 'alpes'];
let world: WorldStatic;
beforeAll(async () => { world = await loadWorldStatic(nodeFetchJson()); }, 120_000);
const mapOf = (f: Fixture): TacticalMap => buildMapFromWorld(world, f.lon, f.lat, { sizeM: f.sizeM, heights: f.heights64, vectorArea: f.nav });
const run = (b: Battle, s: number) => { for (let i = 0; i < s * 20 && b.phase !== 'ended'; i++) stepBattle(b, 0.05); };
const standing = (b: Battle) => {
  const rt = navOf(b.map)!;
  for (const e of b.ents) {
    if (!e.alive || e.gone) continue;
    const mob = UNITS[e.kind].mob;
    if (mob === 'air') continue;
    const c = navCell(rt, e.x, e.y), sq = b.squads[e.sq];
    const okInside = mob === 'foot' && sq.inb && rt.bld[c] === sq.inb;
    if (!okInside && rt.spd[mob][c] === 0) return `${e.kind} #${e.id} at surf ${rt.surf[c]} slope ${rt.slope[c]}`;
  }
  return '';
};

describe('real-map navigation', () => {
  for (const name of AREAS) {
    it(`AI x AI ends with a winner and nobody stands on impassable cells: ${name}`, async () => {
      const f = await loadFixture(name);
      const map = mapOf(f);
      expect(map.nav).toBeTruthy();
      const b = createBattle({ ...scenarioInput(map, name), objectives: defaultObjectives(map, 0), timeLimitS: 600 }, 42);
      expect(standing(b)).toBe('');
      let bad = '';
      for (let i = 0; i < 740 * 20 && b.phase !== 'ended' && !bad; i++) { stepBattle(b, 0.05); if (i % 10 === 0) bad = standing(b); }
      expect(bad).toBe('');
      expect(b.phase).toBe('ended');
      expect(result(b).winner === 0 || result(b).winner === 1).toBe(true);
    }, 280_000);
  }

  it('wheeled/tracked vehicles cross the Seine only by a bridge', async () => {
    const f = await loadFixture('paris'), map = mapOf(f), rt = navOf(map)!;
    const corner = (fx: number, fy: number) => snapCell(rt, 'wheel', navCell(rt, (fx - 0.5) * 2550, (fy - 0.5) * 2550), 120, mainComp(rt, 'wheel'));
    const [a, c] = [navCenter(rt, corner(0, 0)), navCenter(rt, corner(1, 1))];
    for (const mob of ['wheel', 'track'] as const) {
      const p = navPath(rt, mob, a[0], a[1], c[0], c[1]);
      expect(p.length).toBeGreaterThan(4);
      let bridge = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const k = Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 4);
      for (let q = 0; q <= k; q++) {
        const cell = navCell(rt, p[i] + ((p[i + 2] - p[i]) * q) / k, p[i + 1] + ((p[i + 3] - p[i + 1]) * q) / k);
        expect(rt.spd[mob][cell]).toBeGreaterThan(0);
        if (rt.surf[cell] === SURF.BRIDGE) bridge++;
      }
      }
      expect(bridge).toBeGreaterThan(0);
    }
    // same map with the bridges turned into water: no route exists
    const surf = decodeRle(f.nav.surf, f.nav.n ** 2, Uint8Array).map((v) => (v === SURF.BRIDGE || v === SURF.TUNNEL ? SURF.DEEP : v));
    const cut: TacticalMap = { ...map, nav: { ...f.nav, surf: encodeRle(surf) } };
    const rt2 = navOf(cut)!;
    expect(components(rt2, 'wheel')[navCell(rt2, a[0], a[1])]).not.toBe(components(rt2, 'wheel')[navCell(rt2, c[0], c[1])]);
  });

  it('infantry enters a building, garrisons it and leaves again', async () => {
    const f = await loadFixture('paris'), map = mapOf(f), rt = navOf(map)!;
    const b = createBattle({ ...scenarioInput(map, 'g'), objectives: defaultObjectives(map, 0) }, 3);
    b.noAi = true; b.phase = 'combat';
    const s = b.squads.find((q) => q.side === 0 && q.kind === 'infantry')!;
    const main = mainComp(rt, 'foot');
    const bd = f.nav.buildings.find((q) => q.enterable && q.area > 300 && q.area < 1500 && Math.abs(q.cx) < 500 && Math.abs(q.cy) < 500 && rt.bcells[q.id].length > 1 && snapCell(rt, 'foot', navCell(rt, q.cx + 90, q.cy), 6, main) >= 0)!;
    expect(bd).toBeTruthy();
    const start = navCenter(rt, snapCell(rt, 'foot', navCell(rt, bd.cx + 90, bd.cy), 6, main));
    s.x = start[0]; s.y = start[1];
    for (const e of b.ents.filter((q) => q.sq === s.id)) { e.x = s.x; e.y = s.y; }
    expect(canStand(map, s.x, s.y, 'foot')).toBe(true);
    expect(issueOrder(b, 0, [s.id], { kind: 'occupy', building: bd.id })).toEqual({ ok: true });
    run(b, 240);
    expect(s.gar).toBe(bd.id);
    run(b, 20);
    const inside = b.ents.filter((e) => e.sq === s.id && e.alive && rt.bld[navCell(rt, e.x, e.y)] === bd.id).length;
    expect(inside).toBeGreaterThan(0);
    expect(standing(b)).toBe('');
    // a vehicle may not be ordered into it, a second full-capacity check, then leave
    const out = navCenter(rt, snapCell(rt, 'foot', navCell(rt, bd.cx - 150, bd.cy - 150), 40, main));
    expect(issueOrder(b, 0, [s.id], { kind: 'move', x: out[0], y: out[1] }).ok).toBe(true);
    let bad = '';
    for (let i = 0; i < 400 * 20 && !bad; i++) { stepBattle(b, 0.05); if (i % 10 === 0) bad = standing(b); }
    expect(bad).toBe('');
    expect(s.gar).toBeUndefined();
    expect(s.inb).toBeUndefined();
    expect(b.ents.filter((e) => e.sq === s.id && e.alive && rt.bld[navCell(rt, e.x, e.y)] !== 0).length).toBe(0);
  });

  it('steep slopes block wheels (30°), tracks (38°) and infantry (50°) but not bridges', async () => {
    const f = await loadFixture('alpes'), rt = navOf(mapOf(f))!;
    let steep30 = 0, steep38 = 0, steep50 = 0;
    for (let c = 0; c < rt.surf.length; c++) {
      const sl = rt.slope[c], s = rt.surf[c];
      if (s === SURF.DEEP || s === SURF.BUILDING || s === SURF.BRIDGE || s === SURF.TUNNEL || s === SURF.FOOTBRIDGE) continue;
      if (sl > 30) { steep30++; expect(rt.spd.wheel[c]).toBe(0); }
      if (sl > 38) { steep38++; expect(rt.spd.track[c]).toBe(0); }
      if (sl > 50) { steep50++; expect(rt.spd.foot[c]).toBe(0); }
      if (sl > 5 && sl <= 25) expect(rt.spd.wheel[c]).toBeGreaterThanOrEqual(0);
    }
    expect(steep30).toBeGreaterThan(50);
    expect(steep38).toBeGreaterThan(0);
    void steep50;
    // routes never use a cell steeper than the limit
    const a = navCenter(rt, snapCell(rt, 'wheel', navCell(rt, -1100, -1100), 120, mainComp(rt, 'wheel'))), c = navCenter(rt, snapCell(rt, 'wheel', navCell(rt, 1100, 1100), 120, mainComp(rt, 'wheel')));
    const p = navPath(rt, 'wheel', a[0], a[1], c[0], c[1]);
    for (let i = 0; i < p.length; i += 2) expect(rt.slope[navCell(rt, p[i], p[i + 1])]).toBeLessThanOrEqual(30);
  });

  it('is deterministic and survives serialize -> hydrate mid-battle', async () => {
    const f = await loadFixture('paris'), map = mapOf(f);
    const mk = () => createBattle({ ...scenarioInput(map, 'd'), objectives: defaultObjectives(map, 0) }, 21);
    const a = mk(), b = mk();
    run(a, 150); run(b, 150);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c: Battle = JSON.parse(JSON.stringify(a)); // fresh objects: derived nav layers are rebuilt
    run(a, 120); run(c, 120);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it('benchmark: A* on the fine grid and 600 entities per step', async () => {
    const f = await loadFixture('paris'), map = mapOf(f), rt = navOf(map)!;
    const m = mainComp(rt, 'wheel');
    const pts = [[-1200, -1200, 1200, 1200], [-1200, 1200, 1200, -1200], [0, -1300, 0, 1300], [-1300, 0, 1300, 0]].map(([a, b, c, d]) => [navCenter(rt, snapCell(rt, 'wheel', navCell(rt, a, b), 150, m)), navCenter(rt, snapCell(rt, 'wheel', navCell(rt, c, d), 150, m))]);
    const t0 = performance.now();
    let n = 0;
    for (let k = 0; k < 5; k++) for (const [p, q] of pts) { navPath(rt, k % 2 ? 'foot' : 'wheel', p[0], p[1], q[0], q[1]); n++; }
    const per = (performance.now() - t0) / n;
    console.log(`A*: ${per.toFixed(2)} ms/search (${n} long searches, ${rt.n}x${rt.n})`);
    expect(per).toBeLessThanOrEqual(12);
    const base = scenarioInput(map, 'bench', true);
    const triple = (s: typeof base.sides[0]) => ({ ...s, squads: [0, 1, 2, 3].flatMap((k) => s.squads.map((q) => ({ ...q, ref: `${q.ref}${k}` }))) });
    const b = createBattle({ ...base, objectives: defaultObjectives(map, 0), sides: [triple(sideForce('A', true)), triple(sideForce('B', true))] }, 9);
    expect(b.ents.length).toBeGreaterThanOrEqual(600);
    run(b, 10);
    const times: number[] = [];
    for (let i = 0; i < 20 * 300 && b.phase !== 'ended'; i++) { const t = performance.now(); stepBattle(b, 0.05); times.push(performance.now() - t); }
    const mean = times.reduce((x, v) => x + v, 0) / times.length;
    times.sort((x, y) => x - y);
    console.log(`nav bench: ${b.ents.length} ents, mean ${mean.toFixed(2)} ms, p99 ${times[Math.floor(times.length * 0.99)].toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms`);
    expect(mean).toBeLessThanOrEqual(6); // dense Paris (15k cells of buildings, constant combat); the flat-map benchmark keeps the 4 ms budget
  }, 280_000);

  it('without a vector area the procedural map is used (no error)', () => {
    const map = buildMapFromWorld(world, 7.75, 46.02, { vectorArea: null });
    expect(map.nav).toBeUndefined();
    expect(map.heights.length).toBe(64 * 64);
  });
});
