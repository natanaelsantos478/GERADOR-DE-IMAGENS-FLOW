/** Glue between commanders / fatigue / equipment / weather and the strategic mechanics (combat, movement, supply). */
import type { CountryId, Ctx, LonLat } from '../../core/contracts';
import { clamp } from './env';
import { commanderFatigue, commanderMove, commanderMul, commanderResolve, commanderSupply, officerOf, type Terrain } from './commanders';
import { S } from './forces';
import type { Formation } from './types';
import { type Weather, weatherAt } from './weather';

// ------------------------------------------------------------------ weather lookup (cached per game hour)

let wxHour = -1;
let wxSeed = 0;
const wxCache = new Map<string, Weather>();

/** Weather at a position now; province ruggedness / elevation refine the climate. */
export function localWeather(ctx: Ctx, p: LonLat, pr: string | null, hours = ctx.state.time.hours): Weather {
  const seed = ctx.state.meta?.seed ?? 0;
  const h = Math.floor(hours);
  if (h !== wxHour || seed !== wxSeed) {
    wxCache.clear();
    wxHour = h;
    wxSeed = seed;
  }
  const key = `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)},${pr ?? ''}`;
  let w = wxCache.get(key);
  if (!w) {
    const prov = pr ? ctx.world.provinceById.get(pr) : null;
    w = weatherAt(Math.round(p[0] * 4) / 4, Math.round(p[1] * 4) / 4, h + 0.5, { seed, rugged: prov?.rugged, elev: prov?.elevMean });
    if (wxCache.size > 6000) wxCache.clear();
    wxCache.set(key, w);
  }
  return w;
}
export const weatherOf = (ctx: Ctx, f: Formation): Weather => localWeather(ctx, f.p, f.pr);

// ------------------------------------------------------------------ condition factors

/** Fatigue / equipment as multipliers on power and speed. */
export const fatigueOf = (f: Formation) => f.fg ?? 0;
export const readinessOf = (f: Formation) => f.q ?? 1;
export const condPower = (f: Formation) => (0.7 + 0.3 * readinessOf(f)) * (1 - 0.3 * fatigueOf(f));
export const condDefense = (f: Formation) => (0.75 + 0.25 * readinessOf(f)) * (1 - 0.15 * fatigueOf(f));
export const condSpeed = (f: Formation) => (0.8 + 0.2 * readinessOf(f)) * (1 - 0.4 * fatigueOf(f));

// ------------------------------------------------------------------ battles

export interface BattleEnv { wx: Weather; terrain: Terrain }
export interface Fx {
  atk(f: Formation, group: string): number;
  def(f: Formation, group: string): number;
  /** Morale loss multiplier. */
  resolve(f: Formation): number;
  /** Wear/fatigue per round multipliers. */
  wear: number;
  fatigue: number;
}

export function battleFx(ctx: Ctx, env: BattleEnv): Fx {
  const { wx, terrain } = env;
  const grp = (g: string): number => (g === 'air' ? 0.35 + 0.65 * wx.mods.air : g === 'armor' ? 1 - 0.3 * wx.mud : g === 'naval' ? 0.6 + 0.4 * wx.mods.sea : 1);
  return {
    atk: (f, g) => {
      const m = commanderMul(officerOf(ctx, f), f, terrain);
      return condPower(f) * m.atk * grp(g);
    },
    def: (f, g) => {
      const m = commanderMul(officerOf(ctx, f), f, terrain);
      return condDefense(f) * m.def * (g === 'air' ? 0.6 + 0.4 * wx.mods.air : 1);
    },
    resolve: (f) => commanderResolve(officerOf(ctx, f)) * (1 + 0.5 * fatigueOf(f)),
    wear: wx.mods.wear,
    fatigue: wx.mods.fatigue,
  };
}

/** Best manoeuvre score of a side (4 when the side has no commanders). */
export function sideManeuver(ctx: Ctx, forms: Formation[]): number {
  let m = -1;
  for (const f of forms) {
    const o = officerOf(ctx, f);
    if (o) m = Math.max(m, o.m + 2.5 * o.x);
  }
  return m < 0 ? 4 : m;
}

/** Fatigue and wear caused by `rounds` hours of fighting at casualty rate `lam`. */
export function fightWear(f: Formation, lam: number, hours: number, fx: Fx, ctx: Ctx): void {
  const o = officerOf(ctx, f);
  const fatMul = commanderFatigue(o, fx.fatigue > 1 ? 1 : 0);
  f.fg = Math.round(Math.min(1, fatigueOf(f) + (0.0065 * hours + 0.25 * lam) * fx.fatigue * fatMul) * 1000) / 1000;
  f.q = Math.round(Math.max(0.15, readinessOf(f) - (0.0018 * hours + 1.1 * lam) * fx.wear) * 1000) / 1000;
}

// ------------------------------------------------------------------ movement and supply

export interface MoveFx { spd: number; wx: Weather; o: ReturnType<typeof officerOf> }
export function moveFx(ctx: Ctx, f: Formation): MoveFx {
  const o = officerOf(ctx, f);
  const wx = weatherOf(ctx, f);
  let spd = condSpeed(f) * commanderMove(o);
  if (o?.tr.includes('mountain') && f.pr) {
    const p = ctx.world.provinceById.get(f.pr);
    if (p && p.rugged > 0.5) spd *= 1.08;
  }
  if (o?.tr.includes('winter') && (wx.snowCover > 0.2 || wx.mud > 0.2)) spd *= 1.06;
  return { spd, wx, o };
}

/** Marching: fatigue and wear for `dt` hours of movement. */
export function marchWear(f: Formation, dt: number, m: MoveFx): void {
  const fat = commanderFatigue(m.o, m.wx.mods.cold);
  f.fg = Math.round(Math.min(1, fatigueOf(f) + 0.0052 * dt * m.wx.mods.fatigue * fat * (f.d === 'land' ? 1 : 0.6)) * 1000) / 1000;
  f.q = Math.round(Math.max(0.15, readinessOf(f) - 0.0011 * dt * m.wx.mods.wear) * 1000) / 1000;
}

/** Supply bonus/malus: logistics skill and weather on the daily target (land). */
export function supplyAdjust(ctx: Ctx, f: Formation, wx: Weather): number {
  const bonus = commanderSupply(officerOf(ctx, f));
  const bad = f.d === 'land' ? 0.12 * wx.mud + 0.12 * wx.snowCover : 0;
  return bonus - bad;
}

export function warSupportOf(ctx: Ctx, c: CountryId): number {
  return S(ctx).cmd?.ws[c] ?? 65;
}
export const clampUnit = (v: number) => clamp(v, 0, 1);

const summaries = new WeakMap<Weather, ReturnType<typeof summarize>>();
const summarize = (w: Weather) => ({ kind: w.kind, tempC: w.tempC, precip: w.precip, mud: w.mud, visKm: w.visKm, ceilingM: w.ceilingM, off: w.mods.off, air: w.mods.air });
export function weatherSummary(ctx: Ctx, f: Formation) {
  const w = weatherOf(ctx, f);
  let s = summaries.get(w);
  if (!s) summaries.set(w, (s = summarize(w)));
  return s;
}
