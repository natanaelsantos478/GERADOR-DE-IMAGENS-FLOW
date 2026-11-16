/** Headless tactical scenarios on real maps (shared by trainer, tournament and tests). */
import type { WorldStatic } from '../../src/core/contracts';
import { createBattle, stepBattle } from '../../src/sim/tactical/core';
import { buildMapFromWorld, defaultObjectives } from '../../src/sim/tactical/mapWorld';
import type { AiEngine, Battle, SideInput, SquadInput, TacticalMap } from '../../src/sim/tactical/types';

export interface Loc { lon: number; lat: number; name: string }

/** Deterministic spread of real cities (pop >= 150k) over the world; `test` locations are disjoint from `train` ones. */
export function locations(world: WorldStatic): { train: Loc[]; test: Loc[] } {
  const big = world.cities.filter((c) => c.pop >= 150_000).sort((a, b) => a.lon * 1000 + a.lat - (b.lon * 1000 + b.lat));
  const train: Loc[] = [], test: Loc[] = [];
  big.forEach((c, i) => ((i % 5 === 2 ? test : train).push({ lon: c.lon, lat: c.lat, name: c.name })));
  return { train, test };
}

const mapCache = new Map<string, TacticalMap>();
export function mapAt(world: WorldStatic, l: Loc): TacticalMap {
  const k = `${l.lon},${l.lat}`;
  let m = mapCache.get(k);
  if (!m) { m = buildMapFromWorld(world, l.lon, l.lat); if (mapCache.size > 400) mapCache.clear(); mapCache.set(k, m); }
  return m;
}

const sq = (ref: string, kind: SquadInput['kind'], count: number, o: Partial<SquadInput> = {}): SquadInput => ({ ref, kind, count: Math.max(1, Math.round(count)), morale: 0.8, ammo: 1, ...o });
/** Side force; `k` scales numbers, `mix` in [0,1] shifts armour (0) vs infantry (1) weight. */
export function force(prefix: string, k = 1, mix = 0.5): SideInput {
  const a = 1.4 - mix * 0.8, i = 0.6 + mix * 0.8;
  return {
    country: prefix, support: { artillery: 2, airstrike: 1, drone: 1 },
    squads: [
      sq(`${prefix}-mbt1`, 'mbt', 8 * k * a), sq(`${prefix}-mbt2`, 'mbt', 6 * k * a),
      sq(`${prefix}-mech1`, 'mech', 8 * k, { cargo: 6 }), sq(`${prefix}-inf1`, 'infantry', 12 * k * i), sq(`${prefix}-inf2`, 'infantry', 12 * k * i),
      sq(`${prefix}-spec`, 'special', 6 * k), sq(`${prefix}-rec`, 'recon', 4), sq(`${prefix}-art`, 'artillery', 6), sq(`${prefix}-sam`, 'sam', 3),
      sq(`${prefix}-log`, 'logistics', 3), sq(`${prefix}-eng`, 'engineer', 6),
    ],
  };
}

export interface Match { loc: Loc; seed: number; neuralSide: 0 | 1; attacker: 0 | 1; k0: number; k1: number; mix0: number; mix1: number }

export function build(world: WorldStatic, m: Match, engines: [AiEngine, AiEngine], temp: number, timeLimitS = 900): Battle {
  const map = mapAt(world, m.loc);
  const b = createBattle({
    id: 't', strategicBattleId: 'b', center: [m.loc.lon, m.loc.lat], map, attacker: m.attacker, player: null, timeLimitS, deployLimitS: 20,
    sides: [force('A', m.k0, m.mix0), force('B', m.k1, m.mix1)], objectives: defaultObjectives(map, m.attacker), engine: engines, aiTemp: temp,
  }, m.seed);
  return b;
}

export function run(b: Battle): void {
  let guard = 0;
  while (b.phase !== 'ended' && guard++ < 200_000) stepBattle(b, 1);
}

/** Outcome from the neural side's point of view in [-1, 1] (win/loss + casualty margin). */
export function score(b: Battle, side: 0 | 1): { win: number; fit: number } {
  const r = b.result!;
  const win = r.winner === null ? 0 : r.winner === side ? 1 : -1;
  const own = r.casualties[side], foe = r.casualties[1 - side];
  const margin = (foe - own) / Math.max(1, foe + own);
  return { win, fit: 0.6 * win + 0.4 * margin };
}
