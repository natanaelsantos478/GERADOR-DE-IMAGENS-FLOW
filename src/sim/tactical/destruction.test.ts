import { describe, expect, it } from 'vitest';
import { rasterizeNav } from '../../data/vector/rasterize';
import { emptyArea, type VPoly } from '../../data/vector/types';
import { buildingHp, damageBuilding } from './buildings';
import { createBattle, snapshotBattle, stepBattle } from './core';
import { issueOrder, layout } from './orders';
import { components, navCell, navOf } from './nav';
import { scenarioInput, flatMap } from './scenario.test-util';
import { buildingInfo, SURF_RUBBLE } from './terrainRules';
import { onImpact } from './terrainFx';
import { rebuildCache } from './util';
import type { Battle, Proj, SquadInput, TacticalMap } from './types';

// Hand-built geometry (a rules test, not game data): 2400 m flat square, 16 m cells.
const SIZE = 2400;
const box = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0, x1, y0, x1, y1, x0, y1]];
const bld = (r: number[][], h: number, kind?: string): VPoly => ({ rings: r, cls: 'building', h, kind });
const house = (cx: number, cy: number, h = 6, kind?: string) => bld(box(cx - 7, cy - 7, cx + 7, cy + 7), h, kind); // 14x14 = 196 m2, 2 floors
function navWith(fn: (a: ReturnType<typeof emptyArea>) => void) {
  const a = emptyArea(0, 0, SIZE, 14);
  fn(a);
  return rasterizeNav(a, { cell: 16 });
}
/** A wall of houses closing the whole map at y = 8 (one per cell). */
const wallOfHouses = (a: ReturnType<typeof emptyArea>, h = 6, kind?: string) => { for (let x = -1192; x < SIZE / 2; x += 16) a.buildings.push(house(x + 0, 8, h, kind)); };

const sq = (ref: string, kind: SquadInput['kind'], count: number): SquadInput => ({ ref, kind, count, morale: 0.9, ammo: 1 });
function battleOn(nav: ReturnType<typeof navWith>, mine: SquadInput[]): Battle {
  const map: TacticalMap = { ...flatMap(64, SIZE), nav };
  const base = scenarioInput(map, 'd');
  const b = createBattle({ ...base, objectives: [{ x: 0, y: 0 }], sides: [{ country: 'A', squads: mine, support: { artillery: 0, airstrike: 0, drone: 0 } }, { country: 'B', squads: [sq('sam', 'sam', 1)], support: { artillery: 0, airstrike: 0, drone: 0 } }], timeLimitS: 5000 }, 5);
  b.noAi = true; b.phase = 'combat'; b.t = 0; b.tick = 0;
  for (const q of b.squads) q.fireFree = false; // nobody shoots: the tests are about movement and demolition, not about winning
  return b;
}
const place = (b: Battle, id: number, x: number, y: number) => { const s = b.squads[id]; s.x = x; s.y = y; layout(b, s); rebuildCache(b); };
const run = (b: Battle, s: number, until?: () => boolean) => { for (let i = 0; i < s * 20 && b.phase !== 'ended'; i++) { stepBattle(b, 0.05); if (until && until()) return true; } return !!until && until(); };
const proj = (o: Partial<Proj>): Proj => ({ id: 1, kind: 'shell', x0: 0, y0: 0, x1: 0, y1: 0, t0: 0, t1: 0, side: 0, tgt: -1, hit: false, dmg: 60, pen: 300, ar: 28, supp: 0.5, face: 2, air: false, ...o });
const idAt = (b: Battle, x: number, y: number) => { const rt = navOf(b.map)!; return rt.bld[navCell(rt, x, y)]; };

describe('building rules (data-driven)', () => {
  it('hit points grow with footprint, height and material; protected sites and tall towers are never breachable', () => {
    const shed = buildingInfo({ h: 3, area: 60 }), home = buildingInfo({ h: 6, area: 120 }), block = buildingInfo({ h: 15, area: 400 }), tower = buildingInfo({ h: 100, area: 1500 });
    expect(shed.hp).toBeLessThan(home.hp); expect(home.hp).toBeLessThan(block.hp); expect(block.hp).toBeLessThan(tower.hp);
    expect(shed.mat).toBe('light'); expect(home.mat).toBe('brick'); expect(tower.mat).toBe('reinforced');
    expect([shed.small, home.small, block.small, tower.small]).toEqual([true, true, false, false]);
    expect(buildingInfo({ h: 6, area: 120, kind: 'school' })).toMatchObject({ prot: true, civil: true, small: false });
    expect(buildingInfo({ h: 6, area: 120, kind: 'military' })).toMatchObject({ civil: false, small: false });
    expect(buildingInfo({ h: 6, area: 300 }).small).toBe(false); // too big a footprint
    expect(buildingInfo({ h: 12, area: 100 }).small).toBe(false); // 4 floors
  });
});

describe('marked route', () => {
  it('visits 3 points in order, detouring around a block that stands in the way, and takes the old single-point order unchanged', () => {
    const nav = navWith((a) => { a.buildings.push(bld(box(-250, -750, 250, -450), 20)); a.buildings.push(bld(box(450, -100, 750, 100), 20)); });
    const b = battleOn(nav, [sq('rec', 'recon', 3)]);
    place(b, 0, -600, -600);
    const rt = navOf(b.map)!;
    const P = [[600, -600], [600, 600], [-600, 600]];
    const r = issueOrder(b, 0, [0], { kind: 'move', x: P[2][0], y: P[2][1], via: [P[0][0], P[0][1], P[1][0], P[1][1]] });
    expect(r.ok).toBe(true);
    const s = b.squads[0];
    expect(s.route).toEqual([P[1][0], P[1][1], P[2][0], P[2][1]]); // legs 2 and 3 are not searched yet
    expect(s.path.length || s.pend).toBeTruthy();
    const reached = [-1, -1, -1];
    let maxDet = 0, bad = 0;
    run(b, 700, () => {
      for (let k = 0; k < 3; k++) if (reached[k] < 0 && Math.hypot(s.x - P[k][0], s.y - P[k][1]) < 25) reached[k] = b.t;
      if (reached[0] < 0) maxDet = Math.max(maxDet, Math.abs(s.y - -600));
      if (rt.spd.wheel[navCell(rt, s.x, s.y)] === 0) bad++;
      return reached[2] >= 0 && s.order === 'idle';
    });
    expect(reached.every((t) => t >= 0)).toBe(true);
    expect(reached[0]).toBeLessThan(reached[1]); expect(reached[1]).toBeLessThan(reached[2]);
    expect(maxDet).toBeGreaterThan(150); // went around the block that sits on the straight line
    expect(bad).toBe(0);
    expect(s.order).toBe('idle'); expect(s.route).toBeUndefined();
    // old order: one point, no route
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 0, y: 900 }).ok).toBe(true);
    expect(b.squads[0].route).toBeUndefined();
    // a point outside the map is rejected
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 0, y: 0, via: [5000, 0] })).toEqual({ ok: false, reason: 'tac.err.outOfMap' });
  }, 120_000);

  it('a leg with no path is skipped and a new order forgets the route', () => {
    const nav = navWith((a) => { a.water.push({ rings: box(-300, -300, 300, 300), cls: 'deep' }); });
    const b = battleOn(nav, [sq('rec', 'recon', 2)]);
    place(b, 0, -800, -800);
    // middle point inside a lake: it snaps to the shore, the order is still valid
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 800, y: 800, via: [0, 0] }).ok).toBe(true);
    expect(b.squads[0].route).toEqual([800, 800]);
    issueOrder(b, 0, [0], { kind: 'hold' });
    expect(b.squads[0].route).toBeUndefined();
  });
});

describe('destructible buildings', () => {
  it('artillery destroys a house: its cells become slow, covered, drivable ground (patched in place) and the wall opens', () => {
    const nav = navWith((a) => wallOfHouses(a));
    const b = battleOn(nav, [sq('mbt', 'mbt', 2)]);
    const rt = navOf(b.map)!;
    const id = idAt(b, 8, 8);
    expect(id).toBeGreaterThan(0);
    const side = (y: number) => { const l = components(rt, 'wheel'); return l[navCell(rt, 0, y)]; };
    expect(side(-300)).not.toBe(side(300)); // the wall closes the map
    const surfBefore = rt.surf.slice();
    expect(rt.spd.wheel[navCell(rt, 8, 8)]).toBe(0);
    const hp0 = buildingHp(b, rt, id);
    let shells = 0;
    while (!navOf(b.map)!.rub.has(id) && shells < 40) { onImpact(b, proj({ x1: 8, y1: 8 })); shells++; if (shells === 1) expect(buildingHp(b, rt, id)).toBeLessThan(hp0); }
    expect(shells).toBeGreaterThanOrEqual(2); expect(shells).toBeLessThanOrEqual(12);
    expect(navOf(b.map)).toBe(rt); // same runtime object: patched, not rebuilt
    const c = navCell(rt, 8, 8);
    expect(rt.surf[c]).toBe(SURF_RUBBLE); expect(rt.bld[c]).toBe(0); expect(rt.cover[c]).toBe(2);
    expect(rt.spd.wheel[c]).toBeGreaterThan(0); expect(rt.spd.wheel[c]).toBeLessThan(0.2);
    expect(rt.spd.track[c]).toBeGreaterThan(rt.spd.wheel[c]); expect(rt.spd.track[c]).toBeLessThan(0.5);
    expect(rt.spd.foot[c]).toBeGreaterThan(rt.spd.track[c]);
    let changed = 0;
    for (let i = 0; i < rt.surf.length; i++) if (rt.surf[i] !== surfBefore[i]) changed++;
    expect(changed).toBe(rt.bcells[id].length); // only the footprint was touched
    expect(side(-300)).toBe(side(300)); // components re-derived: the gap connects both sides
    expect(b.map.rub).toHaveLength(1);
    expect(b.map.rub![0]).toMatchObject({ id, by: 'shell', fl: 2, m: 'brick' });
    const ev = b.ev!.find((e) => e.k === 'buildingDestroyed')!;
    expect(ev).toMatchObject({ k: 'buildingDestroyed', id, floors: 2, civil: true, prot: false, kind: 'house', by: 'shell' });
    // the input raster is untouched (save format unchanged)
    expect(b.map.nav!.surf).toBe(nav.surf);
  });

  it('tall buildings shrug off artillery; protected sites weigh much more than a house', () => {
    const nav = navWith((a) => { a.buildings.push(bld(box(-100, -100, 100, 100), 90)); a.buildings.push(bld(box(300, 300, 340, 340), 9, 'hospital')); a.buildings.push(house(-400, 400)); });
    const b = battleOn(nav, [sq('mbt', 'mbt', 1)]);
    const rt = navOf(b.map)!;
    const tower = idAt(b, 0, 0);
    for (let i = 0; i < 30; i++) onImpact(b, proj({ x1: 0, y1: 0 }));
    expect(rt.rub.has(tower)).toBe(false); expect(buildingHp(b, rt, tower)).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) onImpact(b, proj({ x1: 0, y1: 0, kind: 'bomb', dmg: 160, ar: 38 }));
    expect(rt.rub.has(tower)).toBe(false); // a tower needs a long bombing campaign
    const hosp = idAt(b, 320, 320), home = idAt(b, -400, 400);
    for (let i = 0; i < 60 && !rt.rub.has(hosp); i++) onImpact(b, proj({ x1: 320, y1: 320, kind: 'bomb', dmg: 160, ar: 38 }));
    for (let i = 0; i < 20 && !rt.rub.has(home); i++) onImpact(b, proj({ x1: -400, y1: 400 }));
    const evs = b.ev!.filter((e) => e.k === 'buildingDestroyed') as Extract<NonNullable<Battle['ev']>[number], { k: 'buildingDestroyed' }>[];
    const h = evs.find((e) => e.kind === 'hospital')!, o = evs.find((e) => e.kind === 'house')!;
    expect(h.prot).toBe(true); expect(o.prot).toBe(false);
    expect(h.weight).toBeGreaterThan(o.weight * 5);
    expect(b.urbanHits).toBeGreaterThan(0);
  });

  it('occupants are hurt when the building falls, garrison is released, moving squads re-search', () => {
    const nav = navWith((a) => { a.buildings.push(bld(box(-40, -40, 40, 40), 9)); });
    const b = battleOn(nav, [sq('inf', 'infantry', 6), sq('rec', 'recon', 2)]);
    const rt = navOf(b.map)!, id = idAt(b, 0, 0);
    place(b, 0, 0, 0);
    expect(issueOrder(b, 0, [0], { kind: 'occupy', building: id }).ok).toBe(true);
    run(b, 200, () => b.squads[0].gar === id);
    expect(b.squads[0].gar).toBe(id);
    const hp = b.ents.filter((e) => e.sq === 0).map((e) => e.hp);
    place(b, 1, -600, -600);
    issueOrder(b, 0, [1], { kind: 'move', x: 600, y: 600 });
    rebuildCache(b);
    expect(b.squads[1].path.length).toBeGreaterThan(0);
    damageBuilding(b, rt, id, 1e9, 'bomb', 1);
    expect(rt.rub.has(id)).toBe(true);
    expect(b.squads[0].gar).toBeUndefined(); expect(b.squads[0].inb).toBeUndefined();
    expect(b.ents.filter((e) => e.sq === 0).some((e, i) => e.hp < hp[i] || !e.alive)).toBe(true);
    expect(b.squads[1].pend ?? b.squads[1].path.length).toBeTruthy(); // path crossed the building's neighbourhood -> deferred re-search
    expect(issueOrder(b, 0, [0], { kind: 'occupy', building: id })).toEqual({ ok: false, reason: 'tac.err.notEnterable' });
  });
});

describe('breach', () => {
  it('a tank with breach drives through a wall of houses; without it there is no way; a skyscraper wall is not breachable', () => {
    const nav = navWith((a) => wallOfHouses(a));
    const b = battleOn(nav, [sq('mbt', 'mbt', 3)]);
    place(b, 0, 0, -400);
    // without the flag the wall closes the map: the goal is not reachable (the squad stops on its side)
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 0, y: 400 }).ok).toBe(true);
    expect(b.squads[0].breach).toBeUndefined();
    run(b, 300);
    expect(b.squads[0].y).toBeLessThan(0); expect(b.map.rub ?? []).toHaveLength(0);
    place(b, 0, 0, -400);
    const hp0 = b.ents.filter((e) => e.sq === 0).map((e) => e.hp);
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 0, y: 400, breach: true }).ok).toBe(true);
    expect(b.squads[0].breach).toBe(true);
    const done = run(b, 900, () => b.squads[0].y > 380 && b.squads[0].order === 'idle');
    expect(done).toBe(true);
    const rt = navOf(b.map)!;
    expect(b.map.rub!.length).toBeGreaterThanOrEqual(1); expect(b.map.rub!.length).toBeLessThanOrEqual(3);
    expect(b.map.rub!.every((r) => r.by === 'breach')).toBe(true);
    for (const r of b.map.rub!) expect(rt.rub.has(r.id)).toBe(true);
    const tanks = b.ents.filter((e) => e.sq === 0);
    expect(tanks.every((e) => e.alive)).toBe(true);
    tanks.forEach((e, i) => { expect(e.hp).toBeLessThan(hp0[i]); expect(e.hp).toBeGreaterThan(hp0[i] * 0.8); }); // light damage
    expect(b.squads[0].breach).toBeUndefined(); expect(b.squads[0].brk).toBeUndefined();
    expect(b.ev!.filter((e) => e.k === 'buildingDestroyed').length).toBe(b.map.rub!.length);
  }, 120_000);

  it('does not breach big or tall buildings, protected sites, nor with wheels', () => {
    const tall = navWith((a) => { for (let x = -1192; x < SIZE / 2; x += 16) a.buildings.push(house(x, 8, 60)); });
    const b = battleOn(tall, [sq('mbt', 'mbt', 2), sq('rec', 'recon', 2)]);
    place(b, 0, 0, -400); place(b, 1, 100, -400);
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 0, y: 400, breach: true }).ok).toBe(true);
    run(b, 300);
    expect(b.squads[0].y).toBeLessThan(0); expect(b.map.rub ?? []).toHaveLength(0);
    const school = navWith((a) => wallOfHouses(a, 6, 'school'));
    const b2 = battleOn(school, [sq('mbt', 'mbt', 2)]);
    place(b2, 0, 0, -400);
    expect(issueOrder(b2, 0, [0], { kind: 'move', x: 0, y: 400, breach: true }).ok).toBe(true);
    run(b2, 300);
    expect(b2.squads[0].y).toBeLessThan(0); expect(b2.map.rub ?? []).toHaveLength(0);
    const low = navWith((a) => wallOfHouses(a));
    const b3 = battleOn(low, [sq('rec', 'recon', 2)]);
    place(b3, 0, 0, -400);
    expect(issueOrder(b3, 0, [0], { kind: 'move', x: 0, y: 400, breach: true }).ok).toBe(true);
    expect(b3.squads[0].breach).toBeUndefined(); // wheels never breach
    run(b3, 300);
    expect(b3.squads[0].y).toBeLessThan(0); expect(b3.map.rub ?? []).toHaveLength(0);
  });

  it('breach is a cost, not an obligation: a free way around that is shorter is used instead', () => {
    const nav = navWith((a) => { for (let x = -1192; x < 200; x += 16) a.buildings.push(house(x, 8)); });
    const b = battleOn(nav, [sq('mbt', 'mbt', 2)]);
    place(b, 0, 40, -300);
    issueOrder(b, 0, [0], { kind: 'move', x: 40, y: 300, breach: true });
    run(b, 400, () => b.squads[0].order === 'idle');
    expect(b.map.rub ?? []).toHaveLength(0); // the opening at x > 200 was shorter than demolishing
  }, 120_000);
});

describe('save / load with rubble', () => {
  it('JSON round trip keeps the rubble and the continued simulation stays identical', () => {
    const nav = navWith((a) => { wallOfHouses(a); a.buildings.push(bld(box(300, -400, 380, -340), 12)); });
    const b = battleOn(nav, [sq('mbt', 'mbt', 2), sq('inf', 'infantry', 4)]);
    place(b, 0, 0, -400); place(b, 1, 200, -500);
    const big = idAt(b, 340, -370);
    damageBuilding(b, navOf(b.map)!, big, 1e9, 'bomb', 0);
    issueOrder(b, 0, [0], { kind: 'move', x: 0, y: 400, breach: true, via: [0, -300] });
    issueOrder(b, 0, [1], { kind: 'move', x: 500, y: -500 });
    run(b, 20);
    expect(b.map.rub!.length).toBeGreaterThanOrEqual(1);
    const copy: Battle = JSON.parse(JSON.stringify(b));
    expect(JSON.stringify(copy)).toBe(JSON.stringify(b));
    const rt2 = navOf(copy.map)!;
    expect(rt2.rub.has(big)).toBe(true);
    expect(rt2.surf[navCell(rt2, 340, -370)]).toBe(SURF_RUBBLE);
    expect(rt2.spd.wheel[navCell(rt2, 340, -370)]).toBeGreaterThan(0);
    // the original raster string is still the stored one (no rubble inside it)
    expect(copy.map.nav!.surf).toBe(nav.surf);
    run(b, 60); run(copy, 60);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(b));
    expect(snapshotBattle(copy, 1, false).squads[0].breach).toBe(snapshotBattle(b, 1, false).squads[0].breach);
  }, 120_000);

  it('a saved battle without the new fields still loads and runs (old saves)', () => {
    const nav = navWith((a) => { a.buildings.push(house(0, 0)); });
    const b = battleOn(nav, [sq('rec', 'recon', 2)]);
    place(b, 0, -300, -300);
    issueOrder(b, 0, [0], { kind: 'move', x: 300, y: 300 });
    const old: Battle = JSON.parse(JSON.stringify(b));
    delete old.map.rub; delete old.bldHp; for (const s of old.squads) { delete s.route; delete s.breach; delete s.brk; }
    run(old, 30);
    expect(old.squads[0].x).not.toBe(-300);
  });
});
