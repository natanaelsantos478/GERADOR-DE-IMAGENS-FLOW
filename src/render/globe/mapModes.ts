/** Map modes: built-in ones plus a registry other modules can extend. */
import type { Ctx, CountryId, WorldStatic } from '../../core/contracts';
import type { Legend, MapMode, MapModeContext, MapModeDef, RGBA } from './types';

const lerp = (a: number[], b: number[], t: number): RGBA => {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, 1];
};
const ramp3 = (lo: number[], mid: number[], hi: number[], t: number) => (t < 0.5 ? lerp(lo, mid, t * 2) : lerp(mid, hi, (t - 0.5) * 2));
const NEUTRAL: RGBA = [96, 100, 104, 1];

/** Runs `fn` with a system API, or returns null when that system is not registered. */
function api<K extends keyof Ctx['api'], T>(ctx: MapModeContext, key: K, fn: (a: Ctx['api'][K], c: Ctx) => T): T | null {
  const c = ctx.game?.ctx;
  if (!c) return null;
  try {
    return fn(c.api[key], c);
  } catch {
    return null;
  }
}
const probe = (ctx: MapModeContext, key: keyof Ctx['api']) => api(ctx, key, (a) => !!a) === true;

export function createBuiltinModes(world: WorldStatic): MapMode[] {
  const stat = (items: [string, string][]): Legend['items'] => items.map(([c, label]) => ({ color: c, label }));
  const countryCache = new Map<CountryId, RGBA>();
  const political: MapMode = {
    id: 'political', label: 'Político', labelKey: 'globe.mode.political', base: 'shade',
    colorOfProvince(pid, ctx) {
      const cid = ctx.countryOf(pid);
      const col = cid ? world.countryById.get(cid)?.color : undefined;
      return col ? [col[0], col[1], col[2], 1] : NEUTRAL;
    },
  };

  const diplomatic: MapMode = {
    id: 'diplomatic', label: 'Diplomático', labelKey: 'globe.mode.diplomatic', base: 'shade', dynamic: true,
    available: (ctx) => probe(ctx, 'diplomacy'),
    legend: {
      title: 'Relação com o jogador', titleKey: 'globe.legend.diplomatic',
      items: stat([['rgb(255,200,60)', 'Você'], ['rgb(60,120,230)', 'Aliado'], ['rgb(200,40,40)', 'Em guerra'], ['rgb(180,70,60)', 'Hostil'], ['rgb(150,150,150)', 'Neutro'], ['rgb(70,170,90)', 'Amigável']]),
    },
  };
  // diplomatic needs the context in compute(); wrap manually
  let dipCtx: MapModeContext | null = null;
  diplomatic.prepare = (ctx) => {
    countryCache.clear();
    dipCtx = ctx;
  };
  diplomatic.colorOfProvince = (pid, ctx) => {
    const cid = ctx.countryOf(pid);
    if (!cid) return null;
    let c = countryCache.get(cid);
    if (!c) {
      c =
        api(dipCtx ?? ctx, 'diplomacy', (d, g) => {
          const me = g.state.meta.playerCountryId;
          if (cid === me) return [255, 200, 60, 1] as RGBA;
          if (d.atWar(me, cid)) return [200, 40, 40, 1] as RGBA;
          if (d.allied(me, cid)) return [60, 120, 230, 1] as RGBA;
          return ramp3([180, 70, 60], [150, 150, 150], [70, 170, 90], (d.relation(me, cid) + 100) / 200);
        }) ?? NEUTRAL;
      countryCache.set(cid, c);
    }
    return c;
  };

  const satMap = new Map<string, number>();
  const satisfaction: MapMode = {
    id: 'satisfaction', label: 'Satisfação', labelKey: 'globe.mode.satisfaction', base: 'shade', dynamic: true,
    available: (ctx) => probe(ctx, 'economy'),
    prepare(ctx) {
      satMap.clear();
      api(ctx, 'economy', (eco) => {
        const acc = new Map<string, [number, number]>();
        world.cities.forEach((city, i) => {
          if (!city.provinceId) return;
          const s = eco.citySatisfaction(i);
          const a = acc.get(city.provinceId) ?? [0, 0];
          a[0] += s * city.pop;
          a[1] += city.pop;
          acc.set(city.provinceId, a);
        });
        for (const [p, a] of acc) satMap.set(p, a[0] / Math.max(1, a[1]));
      });
    },
    colorOfProvince: (pid) => {
      const s = satMap.get(pid);
      return s === undefined ? NEUTRAL : ramp3([200, 40, 40], [235, 205, 70], [60, 170, 90], s / 100);
    },
    legend: { title: 'Satisfação média', titleKey: 'globe.legend.satisfaction', items: stat([['rgb(200,40,40)', '0'], ['rgb(235,205,70)', '50'], ['rgb(60,170,90)', '100']]) },
  };

  const energy: MapMode = {
    id: 'energy', label: 'Energia', labelKey: 'globe.mode.energy', base: 'shade', dynamic: true,
    available: (ctx) => probe(ctx, 'economy'),
    prepare: () => countryCache.clear(),
    colorOfProvince(pid, ctx) {
      const cid = ctx.countryOf(pid);
      if (!cid) return null;
      let c = countryCache.get(cid);
      if (!c) {
        c = api(ctx, 'economy', (eco) => {
          const e = eco.energy(cid);
          if (e.demandMw <= 0 && e.supplyMw <= 0) return NEUTRAL;
          return ramp3([150, 25, 25], [240, 200, 60], [60, 180, 100], (e.ratio - 0.5) / 0.6);
        }) ?? NEUTRAL;
        countryCache.set(cid, c);
      }
      return c;
    },
    legend: { title: 'Oferta / demanda de energia', titleKey: 'globe.legend.energy', items: stat([['rgb(150,25,25)', '≤ 50%'], ['rgb(240,200,60)', '80%'], ['rgb(60,180,100)', '≥ 110%']]) },
  };

  const economy: MapMode = {
    id: 'economy', label: 'Economia', labelKey: 'globe.mode.economy', base: 'shade',
    prepare: () => countryCache.clear(),
    colorOfProvince(pid, ctx) {
      const cid = ctx.countryOf(pid);
      if (!cid) return null;
      let c = countryCache.get(cid);
      if (!c) {
        const s = world.stats[cid];
        if (!s || !s.pop) c = NEUTRAL;
        else {
          const gpc = s.gdpUsd / s.pop;
          c = ramp3([70, 40, 90], [40, 130, 160], [250, 235, 120], (Math.log10(Math.max(300, gpc)) - Math.log10(300)) / (Math.log10(80000) - Math.log10(300)));
        }
        countryCache.set(cid, c);
      }
      return c;
    },
    legend: { title: 'PIB per capita (US$)', titleKey: 'globe.legend.economy', items: stat([['rgb(70,40,90)', '300'], ['rgb(40,130,160)', '5 k'], ['rgb(250,235,120)', '80 k']]) },
  };

  const supMap = new Map<string, number>();
  const supply: MapMode = {
    id: 'supply', label: 'Suprimento', labelKey: 'globe.mode.supply', base: 'shade', dynamic: true,
    available: (ctx) => probe(ctx, 'military'),
    prepare(ctx) {
      supMap.clear();
      api(ctx, 'military', (m) => {
        const acc = new Map<string, [number, number]>();
        for (const f of m.formations()) {
          if (!f.province) continue;
          const a = acc.get(f.province) ?? [0, 0];
          a[0] += f.supply;
          a[1]++;
          acc.set(f.province, a);
        }
        for (const [p, a] of acc) supMap.set(p, a[0] / a[1]);
      });
    },
    colorOfProvince: (pid) => {
      const s = supMap.get(pid);
      return s === undefined ? [70, 74, 80, 1] : ramp3([200, 40, 40], [235, 205, 70], [60, 170, 90], s);
    },
    legend: { title: 'Suprimento das formações', titleKey: 'globe.legend.supply', items: stat([['rgb(200,40,40)', '0%'], ['rgb(235,205,70)', '50%'], ['rgb(60,170,90)', '100%'], ['rgb(70,74,80)', 'sem tropas']]) },
  };

  return [
    { id: 'satellite', label: 'Satélite', labelKey: 'globe.mode.satellite', base: 'satellite' },
    political,
    { id: 'terrain', label: 'Terreno', labelKey: 'globe.mode.terrain', base: 'relief' },
    diplomatic,
    satisfaction,
    energy,
    economy,
    supply,
  ];
}

export function toMode(id: string, def: MapModeDef): MapMode {
  return { label: id, base: 'shade', ...def, id };
}

