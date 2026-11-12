/** Public surface of the military module: types, command creators, selectors for UI / render / TAC. */
import type { BattleId, BattleView, CountryId, Ctx, FormationId, FormationView, LonLat, UnitTemplateId } from '../../core/contracts';
import { UNIT_IDS, UNIT_LIST, UNITS, type UnitTemplate } from './catalog';
import { apisOf, dist } from './env';
import { formationsOf, S, viewOf } from './forces';
import { visibleTo } from './logistics';
import { routePolyline } from './pathing';
import { validTargets } from './strikes';
import type { BaseRef, QueueItem, StockState, TargetRef, TacticalOutcome } from './types';

export { militarySystem } from './system';
export { milPt } from './i18n.pt';
export { UNIT_IDS, UNIT_LIST, UNITS };
export type { UnitTemplate };
export type { BaseRef, Formation, MilitaryState, QueueItem, StockState, TacticalOutcome, TargetRef } from './types';
export { battleForces, applyTacticalOutcome, setTacticalActive, TAC_KIND } from './tactical';
export type { BattleForces, BattleForceUnit, BattleSideForces } from './tactical';

// ------------------------------------------------------------------ command creators (player and AI use the same ones)

export const milCmd = {
  move: (country: CountryId, formations: FormationId[], to: LonLat, attack = false) => ({ type: 'mil.move' as const, country, formations, to, attack }),
  stop: (country: CountryId, formations: FormationId[]) => ({ type: 'mil.stop' as const, country, formations }),
  defend: (country: CountryId, formations: FormationId[]) => ({ type: 'mil.defend' as const, country, formations }),
  retreat: (country: CountryId, formations: FormationId[]) => ({ type: 'mil.retreat' as const, country, formations }),
  blockade: (country: CountryId, formations: FormationId[], port: number) => ({ type: 'mil.blockade' as const, country, formations, port }),
  produce: (country: CountryId, template: UnitTemplateId, qty = 1, at?: BaseRef) => ({ type: 'mil.produce' as const, country, template, qty, at }),
  cancelProduction: (country: CountryId, id: number) => ({ type: 'mil.cancelProduction' as const, country, id }),
  merge: (country: CountryId, a: FormationId, b: FormationId) => ({ type: 'mil.merge' as const, country, a, b }),
  split: (country: CountryId, formation: FormationId, slots: number[]) => ({ type: 'mil.split' as const, country, formation, slots }),
  embark: (country: CountryId, formation: FormationId, carrier: FormationId) => ({ type: 'mil.embark' as const, country, formation, carrier }),
  disembark: (country: CountryId, formation: FormationId) => ({ type: 'mil.disembark' as const, country, formation }),
  strike: (country: CountryId, formation: FormationId, target: TargetRef) => ({ type: 'mil.strike' as const, country, formation, target }),
  launch: (country: CountryId, weapon: 'cruise' | 'ballistic' | 'nuke', target: TargetRef, from?: LonLat) => ({ type: 'mil.launch' as const, country, weapon, target, from }),
  setTactical: (country: CountryId, battle: BattleId, active: boolean) => ({ type: 'mil.setTactical' as const, country, battle, active }),
  applyTacticalResult: (country: CountryId, result: TacticalOutcome) => ({ type: 'mil.applyTacticalResult' as const, country, result }),
  rename: (country: CountryId, formation: FormationId, name: string) => ({ type: 'mil.rename' as const, country, formation, name }),
};

// ------------------------------------------------------------------ selectors

/** Formations the viewer may see (fog of war applied), optionally limited to a bbox. */
export function visibleFormations(ctx: Ctx, viewer: CountryId, bbox?: [number, number, number, number]): FormationView[] {
  const A = apisOf(ctx);
  const out: FormationView[] = [];
  const st = S(ctx);
  for (const id in st.forms) {
    const f = st.forms[id];
    if (f.cr) continue;
    if (bbox && (f.p[0] < bbox[0] || f.p[0] > bbox[2] || f.p[1] < bbox[1] || f.p[1] > bbox[3])) continue;
    if (visibleTo(ctx, A, viewer, f)) out.push(viewOf(ctx, f));
  }
  return out;
}

export interface FormationDetail extends FormationView {
  slots: { template: UnitTemplateId; k: number; strength: number; men: number; iconId: string; modelId: string }[];
  route: LonLat[];
  etaHours: number | null;
  carried: FormationId[];
  base: BaseRef | null;
  entrenchment: number;
}
export function formationDetail(ctx: Ctx, id: FormationId): FormationDetail | null {
  const f = S(ctx).forms[id];
  if (!f) return null;
  const carried = Object.values(S(ctx).forms).filter((o) => o.cr === id).map((o) => o.id);
  return {
    ...viewOf(ctx, f),
    slots: f.u.map((s) => ({ template: s.t, k: s.k, strength: s.s, men: Math.round(UNITS[s.t].men * s.k * s.s), iconId: UNITS[s.t].iconId, modelId: UNITS[s.t].modelId })),
    route: f.rt ? routePolyline(ctx, f.rt, 120) : [],
    etaHours: f.rt ? Math.max(0, Math.round((f.rt.tot - f.rt.dn) / Math.max(1, f.rt.tot) * f.rt.eta)) : null,
    carried, base: f.home, entrenchment: f.e,
  };
}

export interface QueueView extends QueueItem {
  name: string;
  progress: number;
}
export function productionQueue(ctx: Ctx, c: CountryId): QueueView[] {
  return (S(ctx).queue[c] ?? []).map((q) => ({ ...q, name: q.t, progress: q.left > 0 ? 1 - q.left / UNITS[q.t].pts : 0 }));
}

/** Catalog with availability for a country (unlock via research when that system exists). */
export function unitCatalog(ctx: Ctx, c: CountryId): (UnitTemplate & { available: boolean })[] {
  const A = apisOf(ctx);
  return UNIT_LIST.map((u) => ({ ...u, available: A.res ? A.res.unlocked(c, `unit.${u.id}`) : true }));
}

export interface BattlePreview extends BattleView {
  attackerStrength: number;
  defenderStrength: number;
  /** Rough days until one side breaks at the current balance (null when stalemate). */
  etaDays: number | null;
}
export function battlePreviews(ctx: Ctx): BattlePreview[] {
  const st = S(ctx);
  return Object.values(st.battles).map((b) => {
    const sum = (ids: string[]) => ids.reduce((a, id) => a + (st.forms[id] ? viewOf(ctx, st.forms[id]).strength : 0), 0);
    const bal = Math.abs(b.bal);
    return {
      ...ctx.api.military.battle(b.id)!, attackerStrength: sum(b.a), defenderStrength: sum(b.d),
      etaDays: bal < 0.05 ? null : Math.round(Math.min(60, 2.5 / bal) * 10) / 10,
    };
  });
}

/** Targets the country may strike from a position within range (war required). */
export function strikeTargets(ctx: Ctx, c: CountryId, from: LonLat, rangeKm: number): TargetRef[] {
  return validTargets(ctx, apisOf(ctx), c, from, rangeKm);
}

export function missilesInFlight(ctx: Ctx): { id: number; country: CountryId; weapon: string; from: LonLat; to: LonLat; progress: number }[] {
  const now = ctx.state.time.hours;
  return S(ctx).flights.map((f) => ({ id: f.id, country: f.c, weapon: f.w, from: f.from, to: f.to, progress: Math.min(1, Math.max(0, (now - f.t0) / Math.max(0.01, f.eta - f.t0))) }));
}

export function radiationZones(ctx: Ctx): { pos: LonLat; until: number }[] {
  return S(ctx).rad.map((r) => ({ pos: r.p, until: r.until }));
}

export function formationRoute(ctx: Ctx, id: FormationId): LonLat[] {
  const f = S(ctx).forms[id];
  return f?.rt ? routePolyline(ctx, f.rt, 200) : [];
}

export function nearestFormation(ctx: Ctx, viewer: CountryId, p: LonLat, maxKm: number): FormationView | null {
  let best: FormationView | null = null, bd = maxKm;
  for (const f of visibleFormations(ctx, viewer, [p[0] - maxKm / 80, p[1] - maxKm / 100, p[0] + maxKm / 80, p[1] + maxKm / 100])) {
    const d = dist(f.pos, p);
    if (d < bd) (bd = d), (best = f);
  }
  return best;
}

export const countryFormationCount = (ctx: Ctx, c: CountryId) => formationsOf(ctx, c).length;
export const stockView = (ctx: Ctx, c: CountryId): StockState => ctx.api.military.stock(c);
