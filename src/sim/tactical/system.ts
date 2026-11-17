/** `tacticalSystem`: bridges the strategic battle (MIL) and the pure tactical simulation. */
import type { Command, CommandResult, Ctx, FormationView, KnownCommand, TacticalApi } from '../../core/contracts';
import { defineSystem } from '../../core/registry';
import { createBattle, result, snapshotBattle, stepBattle } from './core';
import { issueOrder } from './orders';
import { buildMapFromWorld, defaultObjectives, type MapOptions } from './mapWorld';
import { engineOf, temperatureOf } from '../neural/engine';
import type { AiEngine, Order, Side, SquadFx, SquadInput, SideInput, Support, TacticalOutcomeLike, TacticalResult, TacticalState } from './types';
import { UNITS, kindFromTemplate } from './units';

const SCALES = [0.5, 1, 2, 4];
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const st = (ctx: Ctx): TacticalState => ctx.state.tactical;
const cmd = (ctx: Ctx, type: string, country: string, rest: Record<string, unknown>) => ctx.dispatch({ type, country, ...rest } as Command);

/** Optional hook: the render injects real terrain heights (n*n, row-major from the south-west) before `start`. */
let mapOptionsProvider: ((lon: number, lat: number) => MapOptions | undefined) | null = null;
export function setTacticalMapProvider(fn: typeof mapOptionsProvider): void { mapOptionsProvider = fn; }

/** Commander, equipment and fatigue of a formation as tactical multipliers. */
function fxOf(f: FormationView): SquadFx | undefined {
  const m = f.commander?.mods, q = f.readiness ?? 1, fg = f.fatigue ?? 0;
  if (!m && q >= 0.999 && fg < 0.005) return undefined;
  const sk = f.commander ? f.commander.attack : 5;
  return {
    acc: Math.max(0.7, Math.min(1.3, (m ? Math.pow(m.attack, 0.7) : 0.97) * (0.9 + 0.1 * q) * (1 + 0.01 * (sk - 5)))),
    spd: Math.max(0.7, Math.min(1.25, (m?.speed ?? 0.97) * (0.92 + 0.08 * q))),
    resolve: m?.morale ?? 1.05, fatigue: fg,
  };
}

function sideFromFormations(ctx: Ctx, ids: string[]): SideInput | null {
  const squads: SquadInput[] = [];
  const support: Support = { artillery: 0, airstrike: 0, drone: 0 };
  let country = '';
  for (const fid of ids) {
    const f: FormationView | null = ctx.api.military.formation(fid);
    if (!f || f.domain === 'naval') continue;
    country ||= f.country;
    f.units.forEach((u, slot) => {
      if (u.strength < 0.02) return;
      if (f.domain === 'air') {
        if (u.template.includes('bomber')) support.airstrike += 1;
        else if (u.template.includes('drone')) support.drone += 1;
        else if (u.template.includes('attack_heli')) squads.push({ ref: `${fid}:${slot}`, name: f.name, kind: 'attackHeli', count: Math.max(1, Math.round(UNITS.attackHeli.n * u.strength)), morale: f.morale, ammo: f.supply, modelId: u.modelId, country: f.rebel ? 'REB' : f.country, fx: fxOf(f) });
        return;
      }
      const kind = kindFromTemplate(u.template);
      if (!kind) return;
      const n = Math.max(1, Math.round(UNITS[kind].n * u.strength));
      squads.push({ ref: `${fid}:${slot}`, name: f.name, kind, count: n, morale: f.morale, ammo: Math.max(0.2, f.supply), cargo: kind === 'mech' ? Math.round(n / 2) : undefined, modelId: u.modelId, country: f.rebel ? 'REB' : f.country, fx: fxOf(f) });
    });
  }
  if (!squads.length) return null;
  support.artillery = Math.min(3, squads.filter((s) => s.kind === 'artillery' || s.kind === 'mlrs').length);
  return { country, squads, support };
}

function startBattle(ctx: Ctx, battleId: string): CommandResult {
  const s = st(ctx);
  if (s.battle && !s.battle.result) return fail('tac.err.busy');
  const bv = ctx.api.military.battle(battleId);
  if (!bv) return fail('tac.err.noBattle');
  const a = sideFromFormations(ctx, bv.attackers), d = sideFromFormations(ctx, bv.defenders);
  if (!a || !d) return fail('tac.err.noForces');
  const w = ctx.api.military.weather(bv.pos[0], bv.pos[1]);
  const map = buildMapFromWorld(ctx.world, bv.pos[0], bv.pos[1], mapOptionsProvider?.(bv.pos[0], bv.pos[1]));
  const me = ctx.state.meta.playerCountryId;
  const player: Side | null = bv.attackerCountries.includes(me) ? 0 : bv.defenderCountries.includes(me) ? 1 : null;
  s.counter++;
  const seed = ctx.rng.int(1, 2 ** 31 - 1);
  s.battle = createBattle({
    id: `tac${s.counter}`, strategicBattleId: battleId, center: bv.pos, map, sides: [a, d], attacker: 0, player, weather: { vis: w.mods.vis, rain: w.precip, fog: w.fog, mud: w.mud },
    objectives: defaultObjectives(map, 0),
    engine: (engineOf(ctx.state.meta) === 'rules' ? ['rules', 'rules'] : ['neural', 'neural']) as [AiEngine, AiEngine], aiTemp: temperatureOf(ctx.state.meta.difficulty) * 0.15,
  }, seed);
  s.countries = [bv.attackerCountries.slice(), bv.defenderCountries.slice()];
  s.applied = false; s.paused = false; s.timeScale = 1;
  s.resume = !ctx.state.time.paused;
  if (s.resume) ctx.dispatch({ type: 'game.pause', country: me });
  cmd(ctx, 'mil.setTactical', me, { battle: battleId, active: true });
  ctx.bus.emit({ type: 'tac.battleStarted', battleId, tacticalId: s.battle.id });
  return { ok: true };
}

function outcome(ctx: Ctx, r: TacticalResult, battle: string): TacticalOutcomeLike {
  void ctx;
  return {
    battle, winner: r.winner === 0 ? 'attackers' : r.winner === 1 ? 'defenders' : 'draw',
    squads: r.squads.map((q) => ({ ref: q.ref, strength: q.strength, morale: q.morale, fatigue: q.fatigue })), collateral: r.collateral,
  };
}

function finishIfNeeded(ctx: Ctx): void {
  const s = st(ctx);
  const b = s.battle;
  if (!b || b.phase !== 'ended' || s.applied) return;
  s.applied = true;
  const r = result(b);
  const me = ctx.state.meta.playerCountryId;
  cmd(ctx, 'mil.applyTacticalResult', me, { result: outcome(ctx, r, b.strategicBattleId) });
  s.last = { strategicBattleId: b.strategicBattleId, winner: r.winner, reason: r.reason };
  ctx.bus.emit({ type: 'tac.battleEnded', battleId: b.strategicBattleId, result: r });
}

function exit(ctx: Ctx, auto = false): CommandResult {
  const s = st(ctx);
  const b = s.battle;
  if (!b) return fail('tac.err.none');
  if (!b.result) {
    cmd(ctx, 'mil.setTactical', ctx.state.meta.playerCountryId, { battle: b.strategicBattleId, active: false });
    ctx.bus.emit({ type: 'tac.battleEnded', battleId: b.strategicBattleId, result: null });
  }
  // "Resolve automatically": hand the battle back to the strategic auto-resolution and make sure time runs so it can progress.
  if (s.resume || (auto && !b.result)) ctx.dispatch({ type: 'game.resume', country: ctx.state.meta.playerCountryId });
  s.battle = null; s.resume = false;
  return { ok: true };
}

function sideOf(ctx: Ctx, country: string): Side | null {
  const s = st(ctx);
  if (s.countries[0].includes(country)) return 0;
  if (s.countries[1].includes(country)) return 1;
  return null;
}

export const tacticalSystem = defineSystem({
  id: 'tactical',
  createSlice: (): TacticalState => ({ battle: null, timeScale: 1, paused: false, counter: 0, countries: [[], []], resume: false, applied: false, last: null }),
  handle(ctx, c: Command | KnownCommand): CommandResult | undefined {
    const s = st(ctx);
    const k = c.type.slice(4);
    if (k === 'start') return startBattle(ctx, String((c as Command).battleId));
    const b = s.battle;
    if (!b) return fail('tac.err.none');
    const side = sideOf(ctx, c.country);
    switch (k) {
      case 'order': {
        if (side === null || (b.player !== null && side !== b.player)) return fail('tac.err.notYours');
        if (b.auto[side]) return fail('tac.err.auto');
        const r = issueOrder(b, side, (c as Command).squads as number[], (c as Command).order as Order);
        return r.ok ? { ok: true } : fail(r.reason);
      }
      case 'ready': if (side === null) return fail('tac.err.notYours'); b.ready[side] = true; return { ok: true };
      case 'speed': { const v = Number((c as Command).scale); if (!SCALES.includes(v)) return fail('tac.err.badSpeed'); s.timeScale = v; return { ok: true }; }
      case 'pause': { const p = (c as Command).paused; s.paused = typeof p === 'boolean' ? p : !s.paused; return { ok: true }; }
      case 'auto': {
        const side0 = b.player ?? side;
        if (side0 === null) return fail('tac.err.notYours');
        b.auto[side0] = !!(c as Command).value;
        return { ok: true };
      }
      case 'withdraw': {
        if (side === null) return fail('tac.err.notYours');
        b.withdrawing[side] = true;
        const ids = b.squads.filter((q) => q.side === side).map((q) => q.id);
        issueOrder(b, side, ids, { kind: 'retreat' });
        return { ok: true };
      }
      case 'exit': return exit(ctx, (c as Command).resolve === 'auto');
      default: return undefined;
    }
  },
  api(ctx): TacticalApi {
    return {
      active() {
        const b = st(ctx).battle;
        return b ? snapshotBattle(b, st(ctx).timeScale, st(ctx).paused).battle : null;
      },
      start: (id) => startBattle(ctx, id),
      snapshot() {
        const b = st(ctx).battle;
        return b ? snapshotBattle(b, st(ctx).timeScale, st(ctx).paused) : null;
      },
      advance(dt) {
        const s = st(ctx);
        if (!s.battle || s.paused || s.battle.phase === 'ended') return;
        stepBattle(s.battle, dt * s.timeScale);
        for (const e of s.battle.ev?.splice(0) ?? []) {
          const battleId = s.battle.strategicBattleId;
          if (e.k === 'protectedHit') ctx.bus.emit({ type: 'tac.protectedHit', battleId, kind: e.kind, x: e.x, y: e.y, side: e.side });
          else if (e.k === 'bridgeDestroyed') ctx.bus.emit({ type: 'tac.bridgeDestroyed', battleId, x: e.x, y: e.y });
          else ctx.bus.emit({ type: 'tac.infraDestroyed', battleId, kind: e.kind, effect: e.effect, x: e.x, y: e.y });
        }
        finishIfNeeded(ctx);
      },
      battle: () => st(ctx).battle,
    };
  },
  metrics: (ctx) => ({ tacBattles: st(ctx).counter, tacActive: st(ctx).battle ? 1 : 0 }),
});
