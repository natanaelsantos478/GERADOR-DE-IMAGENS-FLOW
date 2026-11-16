/**
 * Neural operational layer: a shared goal-scoring net (pointer style: group features + candidate features, one scalar per
 * candidate) and a stance net (attack/abort force ratios). Rules enumerate the legal candidates and keep the traps.
 */
import type { CountryId, Ctx, FormationView, LonLat } from '../../core/contracts';
import { chooseIndex } from '../neural/mlp';
import { netOf } from '../neural/pack';
import { temperatureOf } from '../neural/engine';
import { dist, extOf, weight } from './util';

export const GOAL_IN = 14;
export const STANCE_IN = 12;
const PRIOR = 2.5;
const MAXK = 6;
const X = new Float64Array(GOAL_IN);
const SX = new Float64Array(STANCE_IN);
const OUT = new Float64Array(MAXK);
const SCR = new Float64Array(MAXK);
const cl = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export interface GoalCand { ci: number; sc: number; recon: boolean }

function ext(ready: FormationView[]): [number, number, number, number] {
  let a = 0, f = 0, w = 0, n = Math.max(1, ready.length);
  let wx = 0;
  for (const r of ready) { const e = extOf(r); a += e[0]; f += e[1]; wx += e[2]; w += e[3]; }
  return [cl(a / n, 0, 2), cl(f / n, 0, 1), cl(wx / n, 0, 1), cl(w / n, 0, 1)];
}

/** Picks one of the top candidates (sorted by rule score, best first). Returns the index into `cands`. */
export function chooseGoal(ctx: Ctx, c: CountryId, cands: GoalCand[], ready: FormationView[], enemyLand: FormationView[], from: LonLat, ws: number): number {
  const net = netOf('opGoal', GOAL_IN);
  const n = Math.min(MAXK, cands.length);
  if (!net || n < 2) return 0;
  const best = cands[0].sc || 1;
  const mine = ready.reduce((a, f) => a + weight(f), 0);
  const e = ext(ready);
  for (let i = 0; i < n; i++) {
    const k = cands[i], city = ctx.world.cities[k.ci], pos: LonLat = [city.lon, city.lat];
    const foe = enemyLand.reduce((a, f) => (dist(f.pos, pos) < 380 ? a + weight(f) : a), 0);
    let j = 0;
    X[j++] = Math.log1p(ready.length) / 3; X[j++] = Math.log1p(mine) / 3; X[j++] = Math.log1p(foe) / 3; X[j++] = cl(Math.log((mine + 0.2) / (foe + 0.4)), -3, 3);
    X[j++] = cl(dist(from, pos) / 1500, 0, 3); X[j++] = cl(city.pop / 2e6, 0, 3); X[j++] = city.capital === 2 ? 1 : city.capital === 1 ? 0.5 : 0;
    X[j++] = k.recon ? 1 : 0; X[j++] = k.sc / best; X[j++] = ws / 100;
    X[j++] = e[0]; X[j++] = e[1]; X[j++] = e[2]; X[j++] = e[3];
    OUT[i] = net.forward(X)[0] + (i === 0 ? PRIOR : 0);
  }
  const T = temperatureOf(ctx.state.meta.difficulty);
  return chooseIndex(OUT, n, T, T > 0 ? ctx.rng.next() : null, SCR);
}

/** Force ratios needed to start an attack / below which to fall back (rules: 1.1 and 0.6; the net moves them within trap bounds). */
export function stance(ctx: Ctx, c: CountryId, mine: number, foe: number, nReady: number, nEnemy: number, days: number, attacking: boolean, ws: number, ready: FormationView[]): { attack: number; abort: number } {
  const net = netOf('opStance', STANCE_IN);
  if (!net) return { attack: 1.1, abort: 0.6 };
  const own = ctx.api.military.power(c);
  const sm = ctx.state.economy.c[c];
  const e = ext(ready);
  let j = 0;
  SX[j++] = cl(Math.log((mine + 0.2) / (foe + 0.4)), -3, 3); SX[j++] = nReady / 10; SX[j++] = nEnemy / 10; SX[j++] = cl(days / 30, 0, 3);
  SX[j++] = attacking ? 1 : 0; SX[j++] = ws / 100; SX[j++] = Math.log10(Math.max(1e-3, own)); SX[j++] = (sm?.approval ?? 50) / 100;
  SX[j++] = e[0]; SX[j++] = e[1]; SX[j++] = e[2]; SX[j++] = e[3];
  const o = net.forward(SX);
  return { attack: 1.1 * Math.exp(0.35 * Math.tanh(o[0])), abort: 0.6 * Math.exp(0.4 * Math.tanh(o[1])) };
}
