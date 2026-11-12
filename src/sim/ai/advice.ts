/** Advisor for the player's country: actionable suggestions, highest priority first. */
import type { AdviceItem, CountryId, Ctx, FormationView } from '../../core/contracts';
import { build, buildOptions, countryCausesAvg, countrySummary, setSpend } from '../economy/index';
import { economyPt } from '../economy/i18n.pt';
import { milCmd } from '../military/index';
import { dist, viewsOf, weight } from './util';

function biggestOwnProvince(ctx: Ctx, c: CountryId): { prov: string; name: string; lon: number; lat: number } | null {
  let best = -1, out = null as ReturnType<typeof biggestOwnProvince>;
  for (const ci of ctx.world.citiesByCountry.get(c) ?? []) {
    const k = ctx.world.cities[ci];
    if (!k.provinceId || ctx.api.worldDyn.controllerOf(k.provinceId) !== c || k.pop <= best) continue;
    best = k.pop;
    out = { prov: k.provinceId, name: k.name, lon: k.lon, lat: k.lat };
  }
  return out;
}

function energyAdvice(ctx: Ctx, c: CountryId, out: AdviceItem[]): void {
  const en = ctx.api.economy.energy(c);
  if (en.ratio >= 0.97 || en.demandMw <= 0) return;
  const site = biggestOwnProvince(ctx, c);
  if (!site) return;
  const deficit = Math.max(1, Math.round(en.demandMw - en.supplyMw));
  const opts = buildOptions(ctx, c, site.prov).filter((o) => o.kind === 'powerPlant' && !o.blocked && (o.mw ?? 0) * 0.5 >= deficit * 0.5);
  opts.sort((a, b) => (a.cost.money ?? 0) / (a.mw ?? 1) - (b.cost.money ?? 0) / (b.mw ?? 1));
  const o = opts[0];
  out.push({
    key: 'ai.advice.energy', params: { mw: deficit, place: site.name, fuel: o?.fuel ?? 'gas' }, priority: 90 - Math.round(en.ratio * 40),
    where: { lon: site.lon, lat: site.lat },
    ...(o ? { command: build(c, 'powerPlant', site.prov, { variant: o.variant, mw: o.mw }) } : {}),
  });
}

function approvalAdvice(ctx: Ctx, c: CountryId, out: AdviceItem[]): void {
  const sum = countrySummary(ctx, c);
  if (!sum || sum.approval >= 50) return;
  const worst = countryCausesAvg(ctx, c).filter((x) => x.value < -1).sort((a, b) => a.value - b.value)[0];
  const cause = worst?.key ?? '';
  const pillar = /health/.test(cause) ? 'health' : /educ/.test(cause) ? 'education' : /secur/.test(cause) ? 'security' : null;
  out.push({
    key: 'ai.advice.approval', params: { approval: Math.round(sum.approval), cause: economyPt[cause] ?? cause },
    priority: 80 - Math.round(sum.approval / 2),
    ...(pillar ? { command: setSpend(c, pillar, Math.min(2, (sum.spending[pillar] ?? 1) * 1.2)) } : {}),
  });
}

function frontAdvice(ctx: Ctx, c: CountryId, out: AdviceItem[]): void {
  const enemies = ctx.api.diplomacy.enemies(c);
  if (!enemies.length) return;
  const mine = viewsOf(ctx, c).filter((f) => f.domain === 'land' && !f.rebel);
  const foes: FormationView[] = [];
  for (const e of enemies) for (const f of viewsOf(ctx, e)) if (f.domain === 'land' && f.strength > 0.3 && ctx.api.military.visibleTo(c, f.id)) foes.push(f);
  let best: { city: number; gap: number } | null = null;
  const cities = (ctx.world.citiesByCountry.get(c) ?? []).filter((ci) => ctx.world.cities[ci].pop > 150_000);
  for (const ci of cities) {
    const k = ctx.world.cities[ci];
    const p: [number, number] = [k.lon, k.lat];
    const foe = foes.reduce((a, f) => (dist(f.pos, p) < 250 ? a + weight(f) : a), 0);
    if (foe <= 0) continue;
    const own = mine.reduce((a, f) => (dist(f.pos, p) < 150 ? a + weight(f) : a), 0);
    const gap = foe - own;
    if (gap > 0.5 && (!best || gap > best.gap)) best = { city: ci, gap };
  }
  if (!best) return;
  const k = ctx.world.cities[best.city];
  const spare = mine.filter((f) => f.order === 'idle' && f.strength > 0.5).sort((a, b) => dist(a.pos, [k.lon, k.lat]) - dist(b.pos, [k.lon, k.lat])).slice(0, 3);
  out.push({
    key: 'ai.advice.front', params: { place: k.name }, priority: 95, where: { lon: k.lon, lat: k.lat },
    ...(spare.length ? { command: milCmd.move(c, spare.map((f) => f.id), [k.lon, k.lat], false) } : {}),
  });
}

function deficitAdvice(ctx: Ctx, c: CountryId, out: AdviceItem[]): void {
  const sum = countrySummary(ctx, c);
  if (sum && sum.balance < 0 && sum.treasury < Math.abs(sum.balance) * 3) out.push({ key: 'ai.advice.deficit', params: { balance: Math.round(sum.balance) }, priority: 70 });
}

export function advice(ctx: Ctx, c: CountryId): AdviceItem[] {
  const out: AdviceItem[] = [];
  energyAdvice(ctx, c, out);
  approvalAdvice(ctx, c, out);
  frontAdvice(ctx, c, out);
  deficitAdvice(ctx, c, out);
  if (ctx.api.research.progress(c).current === null) out.push({ key: 'ai.advice.research', params: {}, priority: 40 });
  return out.sort((a, b) => b.priority - a.priority);
}
