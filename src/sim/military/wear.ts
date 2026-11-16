/** Daily fatigue recovery, equipment maintenance (costs money / steel / electronics) and population war support. */
import type { CountryId, Ctx, GameEvent } from '../../core/contracts';
import { type Apis3, apisOf, clamp, r3 } from './env';
import { cmdState, commanderFatigue, officerOf } from './commanders';
import { fatigueOf, readinessOf, weatherOf } from './effects';
import { UNITS } from './catalog';
import { S } from './forces';
import type { Formation } from './types';

/** Maintenance efficiency per country (embargoes and sanctions starve spare parts), rebuilt once per logistics pass. */
export type MaintMap = Map<CountryId, number>;
export function maintenanceMap(ctx: Ctx, A: Apis3): MaintMap {
  const m: MaintMap = new Map();
  const emb = (ctx.state as unknown as { economy?: { embargo?: Record<string, string[]> } }).economy?.embargo;
  const cnt = new Map<string, number>();
  if (emb) for (const a in emb) for (const t of emb[a]) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  const dip = A.dip as unknown as { sanctionLevel?: (c: string) => number } | null;
  for (const [c, n] of cnt) m.set(c, clamp(1 - 0.07 * n - 0.3 * (dip?.sanctionLevel?.(c) ?? 0), 0.5, 1));
  return m;
}
export const maintEff = (m: MaintMap, ctx: Ctx, A: Apis3, c: CountryId): number => {
  const v = m.get(c);
  if (v !== undefined) return v;
  const dip = A.dip as unknown as { sanctionLevel?: (c: string) => number } | null;
  return clamp(1 - 0.3 * (dip?.sanctionLevel?.(c) ?? 0), 0.5, 1);
};

const friendlyHome = (ctx: Ctx, f: Formation): boolean => {
  if (f.d === 'land') return !!f.pr && ctx.state.world.controller[f.pr] === f.c;
  return !!f.home;
};

/** One logistics pass of `days` days over formation `f` (called with the logistics stride). */
export function wearDay(ctx: Ctx, A: Apis3, f: Formation, days: number, mx: MaintMap): void {
  if (f.cr) return;
  const wx = weatherOf(ctx, f);
  const o = officerOf(ctx, f);
  const resting = !f.rt && !f.bt;
  const ws = S(ctx).cmd?.ws[f.c] ?? 65;
  // Fatigue: rest heals (needs supply), climate and hunger tire.
  let fg = fatigueOf(f);
  if (resting) fg -= 0.11 * days * (0.35 + 0.65 * f.s);
  fg += 0.02 * days * (wx.mods.fatigue - 1) * commanderFatigue(o, wx.mods.cold);
  if (f.s < 0.4) fg += 0.035 * days * ((0.4 - f.s) / 0.4);
  fg = clamp(fg, 0, 1);
  f.fg = fg < 0.002 ? undefined : r3(fg);
  if (f.fg === undefined) delete f.fg;
  if (fg > 0.6) f.m = r3(Math.max(0, f.m - 0.012 * days * ((fg - 0.6) / 0.4)));
  if (resting && f.m < 1) f.m = r3(clamp(f.m + 0.004 * days * ((ws - 50) / 50), 0, 1));
  // Equipment: wear from the elements, repair when resting at home.
  let q = readinessOf(f) - 0.0006 * days * wx.mods.wear;
  if (resting && q < 0.985 && friendlyHome(ctx, f)) {
    const eff = maintEff(mx, ctx, A, f.c);
    const dq = Math.min(1 - q, 0.045 * days);
    let money = 0, steel = 0, elec = 0;
    for (const s of f.u) {
      const c = UNITS[s.t].cost, w = s.k * s.s * 0.015 * dq;
      money += (c.money ?? 0) * w;
      steel += (c.steel ?? 0) * w;
      elec += (c.electronics ?? 0) * w;
    }
    const cost = { money, ...(steel > 0 ? { steel } : {}), ...(elec > 0 ? { electronics: elec } : {}) };
    const eco = A.eco;
    const paid = !eco || (eco.canAfford(f.c, cost) && eco.charge(f.c, cost, 'mil.maintenance'));
    q += dq * (paid ? 1 : 0.2) * eff;
  }
  q = clamp(q, 0.15, 1);
  if (q >= 0.999) delete f.q;
  else f.q = r3(q);
}

// ------------------------------------------------------------------ war support

const pop = (ctx: Ctx, c: CountryId) => (ctx.state as unknown as { economy?: { c?: Record<string, { pop: number; warWeary: number }> } }).economy?.c?.[c];

function bump(ctx: Ctx, c: CountryId, delta: number): void {
  const cs = cmdState(ctx);
  cs.ws[c] = r3(clamp((cs.ws[c] ?? 65) + delta, 0, 100));
}

function casualtyHit(ctx: Ctx, c: CountryId, n: number): number {
  const p = pop(ctx, c)?.pop ?? 5e7;
  return Math.min(5, n / Math.max(1500, p * 0.00005));
}

export function onWarEvent(ctx: Ctx, e: GameEvent): void {
  if (e.type === 'mil.battleEnded') {
    const b = e as unknown as { winner: 'attackers' | 'defenders' | 'draw'; attackerCountries: string[]; defenderCountries: string[]; casualties: { byCountry: Record<string, number> } };
    const sides: [string[], boolean | null][] = [[b.attackerCountries, b.winner === 'draw' ? null : b.winner === 'attackers'], [b.defenderCountries, b.winner === 'draw' ? null : b.winner === 'defenders']];
    for (const [cs, won] of sides) {
      for (const c of cs) {
        bump(ctx, c, (won === null ? 0 : won ? 1.2 : -1.5) - casualtyHit(ctx, c, b.casualties.byCountry[c] ?? 0));
        if (won === false) apisOf(ctx).eco?.addUnrest({ country: c }, 0.4, 'mil.cause.defeat', 14);
      }
    }
  } else if (e.type === 'mil.provinceOccupied') {
    const o = e as unknown as { by: string; owner: string; from: string; capital: boolean };
    if (o.owner !== o.by) {
      bump(ctx, o.owner, o.capital ? -14 : -3);
      if (o.from !== o.owner) bump(ctx, o.from, -1);
    }
    bump(ctx, o.by, o.capital ? 6 : 2);
  } else if (e.type === 'mil.formationDestroyed') {
    bump(ctx, (e as unknown as { country: string }).country, -0.4);
  }
}

/** Daily: support drifts to a level set by approval and war weariness; weekly feedback into unrest. */
export function warSupportDay(ctx: Ctx, A: Apis3): void {
  const cs = cmdState(ctx);
  const day = Math.floor(ctx.state.time.hours / 24);
  const wars = A.dip?.wars() ?? [];
  const atWar = new Set<CountryId>();
  for (const w of wars) for (const c of [...w.attackers, ...w.defenders]) atWar.add(c);
  for (const c of Object.keys(cs.ws).sort()) {
    const e = pop(ctx, c);
    const appr = A.eco ? A.eco.approval(c) : 55;
    const target = clamp(66 + 0.3 * (appr - 50) - 0.5 * (e?.warWeary ?? 0), 5, 95);
    const ws = cs.ws[c];
    cs.ws[c] = r3(ws + (target - ws) * 0.02);
    if (!A.eco || !atWar.has(c)) continue;
    if ((day + c.charCodeAt(0)) % 7 !== 0) continue;
    const v = cs.ws[c];
    if (v < 40) A.eco.addUnrest({ country: c }, ((40 - v) / 40) * 3.5, 'mil.cause.lowWarSupport', 7);
    else if (v > 78) A.eco.addUnrest({ country: c }, -((v - 78) / 22) * 1.2, 'mil.cause.highWarSupport', 7);
  }
}
