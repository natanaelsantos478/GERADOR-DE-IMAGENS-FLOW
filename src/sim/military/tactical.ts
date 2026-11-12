/**
 * Interface for the tactical module (TAC). Pure helpers over the military slice:
 *  - `battleForces`: forces of a strategic battle per unit, ready to become TAC squads (`ref` = `${formationId}:${slotIndex}`);
 *  - `applyTacticalOutcome`: writes a finished tactical battle back (per-squad strength fraction, winner, collateral);
 *  - `setTacticalActive`: suspends/resumes the hourly auto-resolution of the strategic battle.
 */
import type { BattleId, CommandResult, CountryId, Ctx, FormationId, LonLat } from '../../core/contracts';
import { UNITS } from './catalog';
import { apisOf, dist } from './env';
import { formationsOf, S } from './forces';
import { applyOutcome } from './combat';
import type { TacticalOutcome } from './types';

/** Mapping to the tactical simulation's unit kinds. */
export const TAC_KIND: Record<string, string> = {
  infantry: 'infantry', special_forces: 'special', engineer: 'engineer', mech_infantry: 'mech', armor: 'mbt', recon: 'recon',
  artillery: 'artillery', mlrs: 'mlrs', air_defense: 'sam', logistics: 'logistics', attack_heli: 'attackHeli',
};

export interface BattleForceUnit {
  ref: string;
  formation: FormationId;
  slot: number;
  template: string;
  /** TAC `UnitKind`. */
  kind: string;
  modelId: string;
  /** Number of 3D elements to field. */
  count: number;
  /** Current strength of the slot, 0..1. */
  strength: number;
  morale: number;
  /** 0..1 (supply as proxy of ammunition). */
  ammo: number;
}
export interface BattleSideForces {
  countries: CountryId[];
  units: BattleForceUnit[];
  /** Strategic support available in range. */
  support: { artillery: number; airstrike: number; drone: number };
  /** Entrenchment 0..1 of this side's formations. */
  entrench: number;
}
export interface BattleForces {
  battle: BattleId;
  center: LonLat;
  province: string | null;
  attackers: BattleSideForces;
  defenders: BattleSideForces;
  /** Province ruggedness 0..1 and whether a city lies at the battle position. */
  rugged: number;
}

export function battleForces(ctx: Ctx, id: BattleId): BattleForces | null {
  const st = S(ctx);
  const b = st.battles[id];
  if (!b || b.kind !== 'land') return null;
  const side = (ids: string[], countries: CountryId[]): BattleSideForces => {
    const units: BattleForceUnit[] = [];
    let e = 0, n = 0;
    for (const fid of ids) {
      const f = st.forms[fid];
      if (!f) continue;
      f.u.forEach((s, slot) => {
        const kind = TAC_KIND[s.t];
        if (!kind || s.s < 0.05) return;
        const t = UNITS[s.t];
        units.push({
          ref: `${fid}:${slot}`, formation: fid, slot, template: s.t, kind, modelId: t.modelId,
          count: Math.max(1, Math.min(18, Math.round(t.ents * Math.min(s.k, 2.5) * Math.max(0.25, s.s)))),
          strength: s.s, morale: f.m, ammo: f.s,
        });
      });
      e += f.e;
      n++;
    }
    // Support: artillery/air batteries of these countries around, not in this battle.
    const support = { artillery: 0, airstrike: 0, drone: 0 };
    for (const c of countries) for (const f of formationsOf(ctx, c)) {
      if (b.a.includes(f.id) || b.d.includes(f.id) || f.cr || f.bt) continue;
      const d = dist(f.p, b.p);
      for (const s of f.u) {
        if (f.d === 'land' && UNITS[s.t].group === 'artillery' && d <= UNITS[s.t].range) support.artillery += s.k * s.s;
        else if (f.d === 'air' && d <= UNITS[s.t].radius) {
          if (s.t === 'bomber' || s.t === 'attack_heli') support.airstrike += s.k * s.s;
          else if (s.t === 'drone') support.drone += s.k * s.s;
        }
      }
    }
    return {
      countries, units, entrench: n ? e / n : 0,
      support: { artillery: Math.min(6, Math.round(support.artillery)), airstrike: Math.min(4, Math.round(support.airstrike)), drone: Math.min(4, Math.round(support.drone)) },
    };
  };
  const prov = b.pr ? ctx.world.provinceById.get(b.pr) : null;
  return { battle: id, center: b.p, province: b.pr, attackers: side(b.a, b.ac), defenders: side(b.d, b.dc), rugged: prov ? prov.rugged : 0.3 };
}

export function applyTacticalOutcome(ctx: Ctx, o: TacticalOutcome): CommandResult {
  const b = S(ctx).battles[o.battle];
  if (!b) return { ok: false, reason: 'err.mil.noSuchBattle' };
  applyOutcome(ctx, apisOf(ctx), b, o.squads, o.winner, o.collateral);
  return { ok: true };
}

export function setTacticalActive(ctx: Ctx, id: BattleId, active: boolean): CommandResult {
  const b = S(ctx).battles[id];
  if (!b) return { ok: false, reason: 'err.mil.noSuchBattle' };
  b.tac = active;
  return { ok: true };
}
