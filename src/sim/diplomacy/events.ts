/** Random world events (data table + engine). Choice effects are data: see `Fx`. */
import type { Command, CommandResult, CountryId, Ctx } from '../../core/contracts';
import { fail } from './actions';
import { DAY, addRep, enemiesOf, isLive, modRelation, monthlyGdp, rivalries, st, optApi } from './relations';
import type { PendingEvent, WorldEventView } from './types';

/** Effect ops: money (% of the monthly GDP, negative = cost), unrest (points, days), mod (key, factor, days), rel (delta with `other`), rep, damage. */
type Fx =
  | ['money', number]
  | ['unrest', number, number]
  | ['mod', string, number, number]
  | ['rel', number]
  | ['rep', number]
  | ['damage', 'city' | 'plant', number];
type Need = 'warNeighbor' | 'rival' | 'lowStability' | 'partner';
interface Choice {
  id: string;
  /** Weight of the AI/auto choice. */
  w: number;
  fx: Fx[];
}
interface EventDef {
  id: string;
  weight: number;
  need?: Need;
  /** Applied before any choice (the event itself). */
  fx?: Fx[];
  /** The LAST choice is the default when the player lets the event expire. */
  choices: Choice[];
}

export const EVENTS: readonly EventDef[] = [
  { id: 'earthquake', weight: 3, fx: [['damage', 'city', 0.25]], choices: [
    { id: 'rebuild', w: 5, fx: [['money', -0.4], ['unrest', -2, 60]] },
    { id: 'appealAid', w: 3, fx: [['rep', 1], ['mod', 'eco.buildSpeed', 0.9, 120]] },
    { id: 'ignore', w: 1, fx: [['unrest', 6, 90]] },
  ] },
  { id: 'flood', weight: 4, fx: [['mod', 'eco.agri', 0.92, 150]], choices: [
    { id: 'emergency', w: 4, fx: [['money', -0.25]] },
    { id: 'ignore', w: 2, fx: [['unrest', 4, 60]] },
  ] },
  { id: 'drought', weight: 4, fx: [['mod', 'eco.agri', 0.88, 270]], choices: [
    { id: 'importFood', w: 4, fx: [['money', -0.4], ['mod', 'eco.agri', 1.05, 240]] },
    { id: 'ration', w: 2, fx: [['unrest', 5, 120]] },
  ] },
  { id: 'pandemic', weight: 2, fx: [['mod', 'eco.industry', 0.95, 120]], choices: [
    { id: 'lockdown', w: 3, fx: [['money', -0.5], ['mod', 'eco.industry', 0.92, 45], ['unrest', 3, 60]] },
    { id: 'staysOpen', w: 3, fx: [['unrest', 6, 90], ['mod', 'eco.popGrowth', 0.97, 180]] },
  ] },
  { id: 'financialCrisis', weight: 2, fx: [['mod', 'eco.taxEfficiency', 0.92, 365]], choices: [
    { id: 'bailout', w: 3, fx: [['money', -1.0], ['mod', 'eco.taxEfficiency', 1.04, 365]] },
    { id: 'austerity', w: 3, fx: [['unrest', 8, 150]] },
  ] },
  { id: 'oilShock', weight: 3, fx: [['mod', 'eco.energyDemand', 1.04, 200]], choices: [
    { id: 'subsidize', w: 3, fx: [['money', -0.6]] },
    { id: 'passOn', w: 3, fx: [['unrest', 4, 90]] },
  ] },
  { id: 'election', weight: 5, choices: [
    { id: 'campaign', w: 3, fx: [['money', -0.2], ['mod', 'eco.approval', 1.05, 240]] },
    { id: 'populist', w: 2, fx: [['money', -0.5], ['unrest', -4, 120]] },
    { id: 'neutral', w: 3, fx: [] },
  ] },
  { id: 'scandal', weight: 4, choices: [
    { id: 'investigate', w: 3, fx: [['mod', 'eco.approval', 0.97, 90], ['rep', 1]] },
    { id: 'coverUp', w: 2, fx: [['unrest', 6, 90]] },
  ] },
  { id: 'strikes', weight: 4, choices: [
    { id: 'negotiate', w: 4, fx: [['money', -0.3], ['unrest', -2, 60]] },
    { id: 'repress', w: 2, fx: [['unrest', 6, 90], ['rep', -1]] },
  ] },
  { id: 'refugees', weight: 3, need: 'warNeighbor', choices: [
    { id: 'accept', w: 3, fx: [['money', -0.3], ['rep', 2], ['mod', 'eco.popGrowth', 1.02, 360]] },
    { id: 'closeBorder', w: 3, fx: [['rep', -2], ['rel', -6]] },
  ] },
  { id: 'breakthrough', weight: 3, choices: [
    { id: 'invest', w: 3, fx: [['money', -0.4], ['mod', 'eco.research', 1.3, 365]] },
    { id: 'share', w: 2, fx: [['rep', 2], ['mod', 'eco.research', 1.1, 365]] },
  ] },
  { id: 'industrialAccident', weight: 3, fx: [['damage', 'plant', 0.3]], choices: [
    { id: 'compensate', w: 3, fx: [['money', -0.2], ['rep', 1]] },
    { id: 'deny', w: 2, fx: [['unrest', 5, 60]] },
  ] },
  { id: 'cyberattack', weight: 3, need: 'rival', fx: [['mod', 'eco.industry', 0.95, 60]], choices: [
    { id: 'harden', w: 4, fx: [['money', -0.3], ['mod', 'eco.cyberDefense', 1.2, 365]] },
    { id: 'retaliate', w: 2, fx: [['rel', -15]] },
    { id: 'ignore', w: 1, fx: [['mod', 'eco.industry', 0.97, 60]] },
  ] },
  { id: 'coupAttempt', weight: 2, need: 'lowStability', choices: [
    { id: 'concessions', w: 3, fx: [['money', -0.6], ['unrest', -5, 120]] },
    { id: 'purge', w: 3, fx: [['unrest', 4, 120], ['rep', -2]] },
  ] },
  { id: 'borderIncident', weight: 4, need: 'rival', choices: [
    { id: 'protest', w: 4, fx: [['rel', -3]] },
    { id: 'retaliate', w: 1, fx: [['rel', -12], ['rep', -1]] },
    { id: 'ignoreIncident', w: 2, fx: [['mod', 'eco.approval', 0.98, 90]] },
  ] },
  { id: 'summit', weight: 4, need: 'partner', choices: [
    { id: 'attend', w: 4, fx: [['rel', 8], ['money', -0.1]] },
    { id: 'skip', w: 1, fx: [] },
  ] },
  { id: 'volcano', weight: 1, fx: [['damage', 'city', 0.35], ['mod', 'eco.agri', 0.95, 150]], choices: [
    { id: 'evacuate', w: 4, fx: [['money', -0.5], ['rep', 1]] },
    { id: 'ignore', w: 1, fx: [['unrest', 7, 90]] },
  ] },
  { id: 'bumperHarvest', weight: 4, fx: [['mod', 'eco.agri', 1.12, 180]], choices: [
    { id: 'export', w: 3, fx: [['money', 0.4]] },
    { id: 'stockpile', w: 3, fx: [['mod', 'eco.stability', 1.03, 180]] },
  ] },
  { id: 'energyDiscovery', weight: 2, choices: [
    { id: 'develop', w: 3, fx: [['money', -0.5], ['mod', 'eco.oil', 1.2, 1500]] },
    { id: 'sellRights', w: 3, fx: [['money', 0.6]] },
  ] },
  { id: 'spyScandal', weight: 3, need: 'rival', choices: [
    { id: 'expel', w: 3, fx: [['rel', -8]] },
    { id: 'denyScandal', w: 2, fx: [['rep', -1]] },
  ] },
];
export const EVENT_BY_ID: ReadonlyMap<string, EventDef> = new Map(EVENTS.map((e) => [e.id, e]));

function pickOther(ctx: Ctx, c: CountryId, need?: Need): CountryId | undefined | null {
  const w = ctx.world;
  if (need === 'warNeighbor') {
    const n = (w.countryById.get(c)?.neighbors ?? []).filter((x) => isLive(ctx, x) && enemiesOf(ctx, x).length > 0);
    return n.length ? ctx.rng.pick(n) : null;
  }
  if (need === 'rival') {
    const r = (rivalries(ctx).get(c) ?? []).filter((x) => isLive(ctx, x));
    return r.length ? ctx.rng.pick(r) : null;
  }
  if (need === 'partner') {
    const n = (w.countryById.get(c)?.neighbors ?? []).filter((x) => isLive(ctx, x));
    return n.length ? ctx.rng.pick(n) : null;
  }
  if (need === 'lowStability') {
    const stab = optApi(ctx, 'economy')?.stability(c) ?? null;
    return stab !== null && stab < 40 ? undefined : null;
  }
  return undefined;
}

function applyFx(ctx: Ctx, c: CountryId, other: CountryId | undefined, fx: Fx[], type: string): void {
  const now = ctx.state.time.hours;
  const eco = optApi(ctx, 'economy');
  for (const f of fx) {
    switch (f[0]) {
      case 'money': {
        const amount = Math.round(Math.abs(f[1]) * monthlyGdp(ctx, c));
        if (!eco || amount <= 0) break;
        if (f[1] > 0) eco.credit(c, amount, `dip.event.${type}`);
        else if (!eco.charge(c, { money: amount }, `dip.event.${type}`)) eco.addUnrest({ country: c }, 2, `dip.event.${type}`, 60);
        break;
      }
      case 'unrest': eco?.addUnrest({ country: c }, f[1], `dip.event.${type}`, f[2]); break;
      case 'mod': optApi(ctx, 'research')?.addModifier(c, f[1], f[2], now + f[3] * DAY, `dip.event.${type}`); break;
      case 'rel': if (other) modRelation(ctx, c, other, f[1], `dip.event.${type}`); break;
      case 'rep': addRep(ctx, c, f[1]); break;
      case 'damage': {
        if (f[1] === 'city') {
          const list = ctx.world.citiesByCountry.get(c);
          if (list?.length) ctx.api.worldDyn.damage('city', ctx.rng.pick(list), f[2], `dip.event.${type}`);
        } else {
          const list = ctx.world.plantsByCountry.get(c);
          if (list?.length) ctx.api.worldDyn.damage('plant', ctx.rng.pick(list), f[2], `dip.event.${type}`);
        }
        break;
      }
    }
  }
}

function rollType(ctx: Ctx, c: CountryId): { def: EventDef; other: CountryId | undefined } | null {
  const opts: { def: EventDef; other: CountryId | undefined }[] = [];
  for (const def of EVENTS) {
    const other = pickOther(ctx, c, def.need);
    if (other === null) continue;
    opts.push({ def, other });
  }
  const i = ctx.rng.weightedIndex(opts.map((o) => o.def.weight));
  return i < 0 ? null : opts[i];
}

function resolve(ctx: Ctx, c: CountryId, def: EventDef, other: CountryId | undefined, choiceId: string): void {
  const ch = def.choices.find((x) => x.id === choiceId) ?? def.choices[def.choices.length - 1];
  applyFx(ctx, c, other, ch.fx, def.id);
  st(ctx).stats.events++;
  ctx.bus.emit({ type: 'dip.worldEvent', event: def.id, country: c });
}

/** Daily: AI countries get resolved events (feed only), the player gets one with choices every ~40 days. */
export function dailyEvents(ctx: Ctx): void {
  const s = st(ctx);
  const now = ctx.state.time.hours;
  const player = ctx.state.meta.playerCountryId;
  if (s.event && s.event.until <= now) {
    const def = EVENT_BY_ID.get(s.event.type);
    const ev = s.event;
    s.event = null;
    if (def) resolve(ctx, ev.country, def, ev.other, def.choices[def.choices.length - 1].id);
  }
  if (ctx.rng.chance(0.5)) {
    const alive = ctx.api.worldDyn.aliveCountries();
    const c = alive[ctx.rng.int(0, alive.length - 1)];
    if (c && c !== player && ctx.world.countryById.get(c)?.sovereign) {
      const r = rollType(ctx, c);
      if (r) {
        applyFx(ctx, c, r.other, r.def.fx ?? [], r.def.id);
        const i = ctx.rng.weightedIndex(r.def.choices.map((x) => x.w));
        resolve(ctx, c, r.def, r.other, r.def.choices[Math.max(0, i)].id);
        const big = (r.def.fx ?? []).some((f) => f[0] === 'damage');
        ctx.news(big ? 'disaster' : 'world', `dip.event.${r.def.id}.news`, { country: c, other: r.other ?? '' }, { country: c }, { countries: [c], importance: 0 });
      }
    }
  }
  if (!s.event && now >= s.nextPlayerEvent && isLive(ctx, player)) {
    s.nextPlayerEvent = now + ctx.rng.int(25, 55) * DAY;
    const r = rollType(ctx, player);
    if (r) {
      const ev: PendingEvent = { id: s.nextId++, type: r.def.id, country: player, since: now, until: now + 20 * DAY, ...(r.other ? { other: r.other } : {}) };
      s.event = ev;
      applyFx(ctx, player, r.other, r.def.fx ?? [], r.def.id);
      ctx.news('world', `dip.event.${r.def.id}.news`, { country: player, other: r.other ?? '' }, { country: player }, { countries: [player], importance: 2 });
    }
  }
}

export function eventChoose(ctx: Ctx, cmd: Command): CommandResult {
  const s = st(ctx);
  const ev = s.event;
  if (!ev || ev.id !== Number(cmd.event) || ev.country !== cmd.country) return fail('dip.err.noEvent');
  const def = EVENT_BY_ID.get(ev.type);
  if (!def || !def.choices.some((c) => c.id === cmd.choice)) return fail('dip.err.badChoice');
  s.event = null;
  resolve(ctx, ev.country, def, ev.other, String(cmd.choice));
  return { ok: true };
}

export function currentEvent(ctx: Ctx): WorldEventView | null {
  const ev = st(ctx).event;
  const def = ev && EVENT_BY_ID.get(ev.type);
  if (!ev || !def) return null;
  return { id: ev.id, type: ev.type, country: ev.country, ...(ev.other ? { other: ev.other } : {}), until: ev.until, choices: def.choices.map((c) => ({ id: c.id, key: `dip.event.${def.id}.c.${c.id}` })) };
}
