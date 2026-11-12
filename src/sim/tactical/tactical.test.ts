import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldStatic } from '../../core/contracts';
import { nodeFetchJson } from '../../data/fetchNode';
import { loadWorldStatic } from '../../data/loadWorld';
import { createBattle, result, snapshotBattle, stepBattle } from './core';
import { los } from './grid';
import { issueOrder } from './orders';
import { buildMapFromWorld, defaultObjectives } from './mapWorld';
import { flatMap, scenarioInput, sideForce } from './scenario.test-util';
import type { Battle, TacticalBattleInput } from './types';

const run = (b: Battle, seconds: number) => { for (let i = 0; i < seconds * 20; i++) stepBattle(b, 0.05); };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** One MBT shooter vs one MBT victim 1200 m apart; victim never fires. */
function duel(seed: number, victimFace: number, shooterAmmo = 1): Battle {
  const input: TacticalBattleInput = {
    id: 'd', strategicBattleId: 'x', center: [0, 0], map: flatMap(), attacker: 0, player: null,
    sides: [
      { country: 'A', support: { artillery: 0, airstrike: 0, drone: 0 }, squads: [{ ref: 's', kind: 'mbt', count: 1, morale: 1, ammo: shooterAmmo }] },
      { country: 'B', support: { artillery: 0, airstrike: 0, drone: 0 }, squads: [{ ref: 'v', kind: 'mbt', count: 1, morale: 1, ammo: 1 }] },
    ],
  };
  const b = createBattle(input, seed);
  b.noAi = true; b.phase = 'combat';
  const [s, v] = b.squads;
  s.x = 0; s.y = -1200; s.face = 0; v.x = 0; v.y = 0; v.face = victimFace; v.fireFree = false;
  for (const e of b.ents) { const q = b.squads[e.sq]; e.x = q.x; e.y = q.y; e.h = q.face; }
  return b;
}

describe('tactical core', () => {
  it('is deterministic and seed-sensitive', () => {
    const mk = (seed: number) => { const b = createBattle(scenarioInput(flatMap()), seed); run(b, 120); return JSON.stringify(b); };
    expect(mk(5)).toBe(mk(5));
    expect(mk(5)).not.toBe(mk(6));
  });

  it('serialize -> hydrate in the middle gives the same future', () => {
    const a = createBattle(scenarioInput(flatMap()), 11);
    run(a, 90);
    const c = clone(a);
    run(a, 60); run(c, 60);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(() => JSON.stringify(snapshotBattle(a, 1, false))).not.toThrow();
  });

  it('frontal armour resists more than the flank', () => {
    let front = 0, side = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const f = duel(seed, Math.PI), s = duel(seed, Math.PI / 2);
      run(f, 14); run(s, 14);
      front += 100 - f.ents[1].hp; side += 100 - s.ents[1].hp;
    }
    expect(side).toBeGreaterThan(front * 1.4);
  });

  it('without ammunition nothing is fired', () => {
    const b = duel(3, Math.PI, 0);
    let shots = 0;
    for (let i = 0; i < 40 * 20; i++) { stepBattle(b, 0.05); shots += b.proj.length; }
    expect(shots).toBe(0);
    expect(b.ents[1].hp).toBe(100);
    const armed = duel(3, Math.PI, 1);
    let armedShots = 0;
    for (let i = 0; i < 40 * 20; i++) { stepBattle(armed, 0.05); armedShots += armed.proj.length; }
    expect(armedShots).toBeGreaterThan(0);
  });

  it('smoke blocks line of sight and fire', () => {
    const m = flatMap();
    expect(los(m, [], 0, 0, -1200, 2, 0, 0, 2)).toBe(true);
    expect(los(m, [{ x: 0, y: -600, r: 40, until: 50 }], 0, 0, -1200, 2, 0, 0, 2)).toBe(false);
    expect(los(m, [{ x: 0, y: -600, r: 40, until: 5 }], 10, 0, -1200, 2, 0, 0, 2)).toBe(true);
    const b = duel(4, Math.PI);
    b.smokes.push({ x: 0, y: -600, r: 60, until: 1e9 });
    let shots = 0;
    for (let i = 0; i < 30 * 20; i++) { stepBattle(b, 0.05); shots += b.proj.length; }
    expect(shots).toBe(0);
  });

  it('hills block line of sight', () => {
    const m = flatMap();
    for (let y = 30; y < 34; y++) for (let x = 0; x < 64; x++) m.heights[y * 64 + x] = 400;
    expect(los(m, [], 0, 0, -1200, 2, 0, 1200, 2)).toBe(false);
  });

  it('orders: deployment placement, ready, retreat withdraws a squad', () => {
    const b = createBattle({ ...scenarioInput(flatMap()), player: 0 }, 2);
    expect(b.phase).toBe('deploy');
    expect(issueOrder(b, 0, [0], { kind: 'move', x: 100, y: -2000 }).ok).toBe(true);
    expect(issueOrder(b, 0, [0], { kind: 'attack', target: 12 }).ok).toBe(false);
    expect(issueOrder(b, 1, [0], { kind: 'hold' }).ok).toBe(false);
    issueOrder(b, 0, [], { kind: 'ready' });
    run(b, 1);
    expect(b.phase).toBe('combat');
    expect(issueOrder(b, 0, [0], { kind: 'retreat' }).ok).toBe(true);
    run(b, 600);
    expect(b.ents.filter((e) => e.sq === 0).every((e) => e.gone || !e.alive)).toBe(true);
  });
});

describe('tactical on real maps', () => {
  let world: WorldStatic;
  beforeAll(async () => { world = await loadWorldStatic(nodeFetchJson()); }, 120_000);

  const places: [string, number, number][] = [['Alpes (Zermatt)', 7.75, 46.02], ['Sao Paulo', -46.63, -23.55], ['Donbas', 37.8, 48.0]];
  for (const [name, lon, lat] of places) {
    it(`AI x AI finishes with a winner: ${name}`, () => {
      const map = buildMapFromWorld(world, lon, lat);
      expect(map.heights.length).toBe(64 * 64);
      const input = { ...scenarioInput(map, name), objectives: defaultObjectives(map, 0) };
      const b = createBattle(input, 42);
      for (let i = 0; i < 1900 * 20 && b.phase !== 'ended'; i++) stepBattle(b, 0.05);
      const r = result(b);
      expect(b.phase).toBe('ended');
      expect(r.winner === 0 || r.winner === 1).toBe(true);
      expect(r.squads.length).toBeGreaterThan(0);
      for (const q of r.squads) { expect(q.strength).toBeGreaterThanOrEqual(0); expect(q.strength).toBeLessThanOrEqual(1.0001); }
    });
  }

  it('benchmark: 600+ entities at 20 Hz, mean <= 4 ms per step', () => {
    const base = scenarioInput(flatMap(), 'bench', true);
    const triple = (s: typeof base.sides[0]) => ({ ...s, squads: [0, 1, 2, 3].flatMap((k) => s.squads.map((q) => ({ ...q, ref: `${q.ref}${k}` }))) });
    const b = createBattle({ ...base, sides: [triple(sideForce('A', true)), triple(sideForce('B', true))] }, 9);
    expect(b.ents.length).toBeGreaterThanOrEqual(600);
    run(b, 10);
    const times: number[] = [];
    for (let i = 0; i < 20 * 420 && b.phase !== 'ended'; i++) { const t = performance.now(); stepBattle(b, 0.05); times.push(performance.now() - t); }
    const mean = times.reduce((a, v) => a + v, 0) / times.length;
    times.sort((x, y) => x - y);
    console.log(`bench: ${b.ents.length} ents, ${b.ents.filter((e) => e.alive).length} alive at end, mean ${mean.toFixed(2)} ms, p99 ${times[Math.floor(times.length * 0.99)].toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms`);
    expect(mean).toBeLessThanOrEqual(4);
  });
});
