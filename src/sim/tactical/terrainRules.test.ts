import { describe, expect, it } from 'vitest';
import { SURF } from '../../data/vector/nav';
import { rasterizeNav } from '../../data/vector/rasterize';
import { emptyArea, type VLine, type VPoly } from '../../data/vector/types';
import { createBattle, stepBattle } from './core';
import { los } from './grid';
import { components, navCell, navOf } from './nav';
import { scenarioInput, flatMap } from './scenario.test-util';
import { mudMult, SOURCE_RULES, SURFACE_RULES, USE_RULES } from './terrainRules';
import { objectiveCandidates, onImpact, queryNav, stepFires, bridges } from './terrainFx';
import { stepProjectiles } from './combat';
import { rebuildCache } from './util';
import type { Battle, Proj } from './types';

// Hand-built geometry (unit test of the RULES, not game data): bands of every class across a 3 km square.
const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0, x1, y0, x1, y1, x0, y1]];
const poly = (r: number[][], cls: string, extra: Partial<VPoly> = {}): VPoly => ({ rings: r, cls, ...extra });
const line = (pts: number[], cls: string, brunnel?: string): VLine => ({ pts, cls, brunnel });
function area() {
  const a = emptyArea(0, 0, 3000, 14);
  const band = (cls: string, y0: number, y1: number) => a.landcover.push(poly(rect(-1450, y0, 1450, y1), cls));
  band('wood', 1200, 1450); band('scrub', 1000, 1200); band('rock', 800, 1000); band('sand', 600, 800); band('wetland', 400, 600); band('snow', 200, 400);
  a.water.push(poly(rect(-1500, -100, 1500, 100), 'deep'));
  const roads: [string, number][] = [['motorway', -400], ['primary', -500], ['secondary', -600], ['tertiary', -700], ['minor', -800], ['service', -900], ['track', -1000], ['path', -1100], ['steps', -1200], ['rail', -1300], ['runway', -1400]];
  for (const [c, y] of roads) a.roads.push(line([-1400, y, 1400, y], c));
  a.roads.push(line([0, -300, 0, -150], 'secondary'), line([0, -150, 0, 150], 'secondary', 'bridge'), line([0, 150, 0, 300], 'secondary'));
  a.roads.push(line([-600, 300, -600, 440], 'minor'), line([-600, 440, -600, 560], 'minor', 'tunnel'), line([-600, 560, -600, 700], 'minor'));
  a.roads.push(line([-1300, 0, -1300, 400], 'path', 'bridge'));
  a.waterways.push({ pts: [-1000, 600, -1000, 1000], cls: 'stream' });
  a.landuse.push(poly(rect(400, -100, 440, 0), 'port'), poly(rect(1100, -350, 1300, -150), 'hospital'), poly(rect(900, -350, 1050, -150), 'school'), poly(rect(-1300, -350, -1100, -150), 'military'));
  a.buildings.push(poly(rect(1000, 150, 1050, 200), 'building', { h: 25, kind: 'hospital' }), poly(rect(700, 150, 740, 190), 'building', { h: 8 }));
  a.infra.push({ x: -300, y: -300, kind: 'power' }, { x: 300, y: -300, kind: 'comm' });
  a.pois.push({ x: 500, y: 500, kind: 'police' });
  a.peaks.push({ x: -800, y: 1200, ele: 1500 });
  return a;
}
const nav = rasterizeNav(area(), { cell: 16 });
const map = { ...flatMap(64, 3000), nav };
const rt = navOf(map)!;
const at = (x: number, y: number) => navCell(rt, x, y);
const mk = (): Battle => { const b = createBattle({ ...scenarioInput({ ...flatMap(64, 3000), nav: { ...nav } }, 'tr'), objectives: [{ x: 0, y: 0 }] }, 1); b.noAi = true; b.phase = 'combat'; return b; };
const proj = (o: Partial<Proj>): Proj => ({ id: 1, kind: 'shell', x0: 0, y0: 0, x1: 0, y1: 0, t0: 0, t1: 0, side: 0, tgt: -1, hit: false, dmg: 60, pen: 300, ar: 28, supp: 0.5, face: 2, air: false, ...o });
const spd = (x: number, y: number) => ({ foot: rt.spd.foot[at(x, y)], wheel: rt.spd.wheel[at(x, y)], track: rt.spd.track[at(x, y)] });

describe('terrain rules by class', () => {
  it('open field baseline, roads beat field for vehicles, motorway fastest, pavement ignores mud', () => {
    const f = spd(900, 100 + 1), m = spd(-700, -400), p = spd(-700, -500);
    expect(f.wheel).toBeGreaterThan(0.4); expect(m.wheel).toBeGreaterThan(f.wheel * 2); expect(p.wheel).toBeGreaterThan(f.wheel * 2);
    expect(spd(-700, -800).wheel).toBeGreaterThan(spd(-700, -900).wheel); // street > service
    expect(spd(-700, -1000).wheel).toBeGreaterThan(0.9); // dirt track
    expect(mudMult(SURFACE_RULES[SURF.MOTORWAY], 1, 1)).toBe(1);
    expect(mudMult(SURFACE_RULES[SURF.FIELD], 1, 1)).toBeLessThan(0.7);
    expect(mudMult(SURFACE_RULES[SURF.FIELD], 1, 0)).toBeGreaterThan(mudMult(SURFACE_RULES[SURF.FIELD], 1, 1));
    expect(spd(-700, -1100).wheel).toBeLessThan(0.5); expect(spd(-700, -1100).foot).toBeGreaterThan(1); // footway: infantry only, in practice
  });
  it('forest: cover, concealment, obstacle, slows wheels; scrub lighter; rock blocks wheels with cover; sand and wetland bog wheels; snow slow', () => {
    expect(rt.cover[at(0, 1300)]).toBe(1); expect(rt.obs[at(0, 1300)]).toBe(10); expect(SURFACE_RULES[SURF.WOOD].conceal).toBeGreaterThan(0.5);
    expect(spd(0, 1300).wheel).toBeLessThan(spd(0, 500 + 150).wheel + 1);
    expect(spd(0, 1100).foot).toBeGreaterThan(spd(0, 1300).foot); expect(rt.obs[at(0, 1100)]).toBe(0);
    expect(spd(0, 900).wheel).toBe(0); expect(spd(0, 900).foot).toBeGreaterThan(0); expect(rt.cover[at(0, 900)]).toBe(2);
    expect(spd(0, 700).wheel).toBeLessThan(0.4); expect(SURFACE_RULES[SURF.SAND].tags).toContain('dust');
    expect(spd(0, 500).wheel).toBeLessThan(0.16); expect(SURFACE_RULES[SURF.WETLAND].tags).toContain('bog');
    expect(spd(300, 300).wheel).toBeLessThan(0.35); expect(spd(300, 300).foot).toBeCloseTo(0.5, 1);
  });
  it('water: deep impassable, stream is a slow ford, pier and bridge cross, footbridge and steps are foot only', () => {
    expect(spd(900, 0)).toEqual({ foot: 0, wheel: 0, track: 0 });
    const s = spd(-1000, 800); expect(s.wheel).toBeGreaterThan(0); expect(s.wheel).toBeLessThan(0.4);
    expect(spd(420, -50).wheel).toBeGreaterThan(0.9);
    expect(spd(0, 0).wheel).toBeGreaterThan(1); expect(rt.surf[at(0, 0)]).toBe(SURF.BRIDGE);
    expect(rt.surf[at(-1300, 0)]).toBe(SURF.FOOTBRIDGE); expect(spd(-1300, 0).foot).toBeGreaterThan(0.9); expect(spd(-1300, 0).wheel).toBe(0);
    expect(spd(-700, -1200).foot).toBeGreaterThan(0); expect(spd(-700, -1200).wheel).toBe(0); expect(spd(-700, -1200).track).toBe(0);
  });
  it('buildings block vehicles, give cover 3 and obstruct sight by height; tunnel hides from sight', () => {
    const c = at(1025, 175);
    expect(rt.surf[c]).toBe(SURF.BUILDING); expect(spd(1025, 175)).toEqual({ foot: 0, wheel: 0, track: 0 }); expect(rt.cover[c]).toBe(3); expect(rt.obs[c]).toBe(25);
    expect(nav.buildings.find((q) => q.kind === 'hospital')?.enterable).toBe(true);
    expect(los(map, [], 0, 950, 175, 1.5, 1120, 175, 1.5)).toBe(false);
    expect(los(map, [], 0, 950, 300, 1.5, 1120, 300, 1.5)).toBe(true);
    expect(rt.surf[at(-600, 500)]).toBe(SURF.TUNNEL);
    expect(los(map, [], 0, -600, 500, 1.5, -600, 700, 1.5)).toBe(false);
    expect(los(map, [], 0, 0, 700, 1.5, 0, 1000, 1.5)).toBe(true); // clear over sand/rock
    expect(los(map, [], 0, 0, 1150, 1.5, 0, 1450, 1.5)).toBe(false); // through the forest
  });
  it('slopes: wheels 30, tracks 38, foot 50 degrees (limits are part of the table)', async () => {
    const { SLOPE_LIM } = await import('./nav');
    expect(SLOPE_LIM).toEqual({ foot: 50, wheel: 30, track: 38 });
  });
  it('land use: protected zones, military; point query, objectives from places, bridges and peaks', () => {
    for (const k of ['hospital', 'school', 'religious', 'cemetery']) expect(USE_RULES[k].protected).toBe(true);
    expect(rt.use[at(1200, -250)]).toBe(USE_RULES.hospital.code);
    expect(rt.use[at(-1200, -250)]).toBe(USE_RULES.military.code);
    expect(rt.use[at(1025, 175)]).toBe(USE_RULES.hospital.code);
    const q = queryNav(nav, 1200 / (111320), -250 / 111320);
    expect(q?.use).toBe('hospital'); expect(q?.protectedSite).toBe(true); expect(q?.name).toBeTruthy();
    const kinds = objectiveCandidates(rt).map((c) => c.kind);
    for (const k of ['police', 'bridge', 'peak', 'power']) expect(kinds).toContain(k);
    expect(bridges(rt).length).toBeGreaterThan(0);
  });
});

describe('dynamic terrain effects', () => {
  it('area fire destroys a bridge: navigation changes in real time and an event is raised', () => {
    const b = mk();
    const lab = () => { const r = navOf(b.map)!; const l = components(r, 'wheel'); return [l[navCell(r, 0, -300)], l[navCell(r, 0, 300)]]; };
    const [a0, c0] = lab();
    expect(a0).toBe(c0);
    for (let i = 0; i < 12 && !b.ev?.some((e) => e.k === 'bridgeDestroyed'); i++) onImpact(b, proj({ x1: 0, y1: i % 2 ? 20 : -20 }));
    expect(b.ev?.some((e) => e.k === 'bridgeDestroyed')).toBe(true);
    const [a1, c1] = lab();
    expect(a1).not.toBe(c1);
    expect(JSON.parse(JSON.stringify(b)).map.nav.surf).toBe(b.map.nav!.surf);
  });
  it('hitting a hospital zone raises tac.protectedHit (throttled)', () => {
    const b = mk();
    onImpact(b, proj({ x1: 1200, y1: -250 })); onImpact(b, proj({ x1: 1210, y1: -250 }));
    expect(b.ev?.filter((e) => e.k === 'protectedHit').length).toBe(1);
    expect(b.ev?.[0]).toMatchObject({ k: 'protectedHit', kind: 'hospital', side: 0 });
  });
  it('destroying a power tower blacks out, a comm tower cuts comms', () => {
    const b = mk();
    for (let i = 0; i < 4; i++) { onImpact(b, proj({ x1: -300, y1: -300 })); onImpact(b, proj({ x1: 300, y1: -300 })); }
    expect(b.blackout).toBe(1); expect(b.commsDown).toBe(1);
    expect(b.ev?.filter((e) => e.k === 'infraDestroyed').length).toBe(2);
  });
  it('tunnels shelter infantry from air strikes', () => {
    const b = mk();
    const inf = b.ents.filter((e) => e.kind === 'infantry' && e.side === 0).slice(0, 2);
    [inf[0].x, inf[0].y, inf[1].x, inf[1].y] = [-600, 500, -650, 500];
    rebuildCache(b);
    const h = inf.map((e) => e.hp);
    b.proj.push(proj({ kind: 'bomb', x1: -620, y1: 500, ar: 38, dmg: 160, t1: 0 }));
    stepProjectiles(b);
    expect(inf[0].hp).toBe(h[0]); expect(inf[1].hp).toBeLessThan(h[1]);
  });
  it('artillery ignites forest, fire spreads, smoke blocks sight, burning hurts', () => {
    const b = mk();
    for (let i = 0; i < 40; i++) onImpact(b, proj({ x1: (i % 8) * 8, y1: 1300 }));
    expect(b.fires?.length).toBeGreaterThan(0);
    const n0 = b.fires!.length;
    const e = b.ents.find((q) => q.kind === 'infantry')!;
    const f0 = b.fires![0], r = navOf(b.map)!, x = ((f0.c % r.n) + 0.5) * r.cs - 1500, y = (Math.floor(f0.c / r.n) + 0.5) * r.cs - 1500;
    e.x = x; e.y = y; const hp = e.hp;
    rebuildCache(b);
    for (let i = 0; i < 20; i++) { b.t += 1; stepFires(b); }
    expect(b.smokes.length).toBeGreaterThan(0);
    expect(e.hp).toBeLessThan(hp);
    expect(b.fires!.length + (b.burnt?.length ?? 0)).toBeGreaterThanOrEqual(n0);
    stepBattle(b, 0.05);
  });
  it('every surface class has a complete rule and every source rule points at a known class', () => {
    for (const k of Object.values(SURF)) { const r = SURFACE_RULES[k]; expect(r, `surface ${k}`).toBeTruthy(); expect(r.spd).toHaveLength(3); expect(r.color).toHaveLength(3); }
    for (const [k, v] of Object.entries(SOURCE_RULES)) expect(v.to || v.ignore, k).toBeTruthy();
  });
});
