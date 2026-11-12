/** Strategic AI (PLANO §7.8). Time-sliced: every country thinks on its own days; countries at war think more often. */
import type { CountryId } from '../../core/contracts';
import { defineSystem } from '../../core/registry';
import { advice } from './advice';
import { answerProposals, garrison, production } from './peace';
import type { AiState } from './types';
import { dropViews, hash, isAiControlled } from './util';
import { warThink } from './war';

const WAR_PERIOD = 2;
const PEACE_PERIOD = 9;

export const aiSystem = defineSystem({
  id: 'ai',
  createSlice: (): AiState => ({
    op: {}, bad: {}, nuked: {}, retreated: {}, ordered: {}, nextGarrison: {}, nextPeace: {}, seen: {},
    stats: { thinks: 0, warThinks: 0, orders: 0, battles: 0, produced: 0, strikes: 0, launches: 0, peaceOffers: 0 },
  }),
  init(ctx) {
    ctx.bus.on('mil.battleEnded', () => void ctx.state.ai.stats.battles++);
    ctx.bus.on('mil.nukeDetonated', (e) => {
      if (e.targetCountry) ctx.state.ai.nuked[e.targetCountry] = { by: e.country, at: ctx.state.time.hours };
    });
  },
  onLoad: () => dropViews(),
  onDay(ctx) {
    const s = ctx.state.ai;
    const day = Math.floor(ctx.state.time.hours / 24);
    const d = ctx.api.diplomacy;
    for (const c of ctx.api.worldDyn.aliveCountries()) {
      const info = ctx.world.countryById.get(c);
      if (!info?.sovereign || !isAiControlled(ctx, c)) continue;
      const h = hash(c);
      const enemies = d.enemies(c);
      const war = enemies.length > 0;
      if ((day + h) % (war ? WAR_PERIOD : PEACE_PERIOD) !== 0) continue;
      s.stats.thinks++;
      if (c === ctx.state.meta.playerCountryId) answerProposals(ctx, c);
      if (war) warThink(ctx, s, c as CountryId, enemies);
      else garrison(ctx, s, c);
      production(ctx, s, c, war);
    }
    if (day % 30 === 0) {
      const live = new Set(d.wars().map((w) => w.id));
      for (const k of Object.keys(s.seen)) if (!live.has(k)) delete s.seen[k];
      const alive = new Set(Object.keys(ctx.state.military.forms));
      for (const f of Object.keys(s.retreated)) if (!alive.has(f)) delete s.retreated[f];
      for (const f of Object.keys(s.ordered)) if (!alive.has(f)) delete s.ordered[f];
      const now = ctx.state.time.hours;
      for (const k of Object.keys(s.bad)) if (s.bad[k] < now) delete s.bad[k];
      for (const c of Object.keys(s.op)) if (!ctx.api.worldDyn.isAlive(c)) delete s.op[c];
    }
  },
  api: (ctx) => ({ advice: (c) => advice(ctx, c) }),
  metrics(ctx) {
    const s = ctx.state.ai;
    return { thinks: s.stats.thinks, warThinks: s.stats.warThinks, orders: s.stats.orders, battles: s.stats.battles, produced: s.stats.produced, strikes: s.stats.strikes, launches: s.stats.launches, ops: Object.keys(s.op).length };
  },
});
