/** Validates the loader against the REAL public/data (skipped, with a notice, while files are missing). */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldStatic } from '../core/world-types';
import { haversineKm } from '../core/geo';
import { DEFAULT_DATA_DIR, nodeFetchJson } from './fetchNode';
import { DATA_FILES, loadWorldStatic } from './loadWorld';

const missing = DATA_FILES.filter((f) => !existsSync(path.join(DEFAULT_DATA_DIR, f)));
if (missing.length) console.warn(`realData.test: arquivos ausentes em public/data: ${missing.join(', ')}`);

describe.skipIf(missing.length > 0)('loadWorldStatic (public/data real)', () => {
  let w: WorldStatic;
  beforeAll(async () => {
    w = await loadWorldStatic(nodeFetchJson());
  }, 120_000);

  it('has consistent ids and indices', () => {
    expect(w.countries.length).toBeGreaterThan(200);
    expect(w.provinces.length).toBeGreaterThan(4000);
    for (const p of w.provinces) expect(w.countryById.has(p.countryId)).toBe(true);
    for (const p of w.provinces) for (const n of p.neighbors) expect(w.provinceById.has(n)).toBe(true);
    for (const c of w.countries) for (const n of c.neighbors) expect(w.countryById.has(n)).toBe(true);
    expect(w.countryById.get('BRA')?.namePt).toBe('Brasil');
    expect(w.provincesByCountry.get('BRA')?.length).toBe(27);
  });

  it('locates well-known places', () => {
    const sp = w.locateProvince(-46.63, -23.55)!;
    expect(w.provinceById.get(sp)?.countryId).toBe('BRA');
    expect(w.provinceById.get(sp)?.name).toMatch(/São Paulo/);
    expect(w.provinceById.get(w.locateProvince(2.35, 48.85)!)?.countryId).toBe('FRA');
    expect(w.provinceById.get(w.locateProvince(139.69, 35.69)!)?.countryId).toBe('JPN');
    expect(w.locateProvince(-30, 0)).toBeNull();
  });

  it('associates most points to provinces with matching countries', () => {
    const rate = (arr: { provinceId: string | null }[]) => arr.filter((x) => x.provinceId).length / arr.length;
    expect(rate(w.cities)).toBeGreaterThan(0.99);
    expect(rate(w.plants)).toBeGreaterThan(0.97);
    expect(rate(w.airports)).toBeGreaterThan(0.97);
    expect(rate(w.ports)).toBeGreaterThan(0.95);
    const agree = w.cities.filter((c) => c.countryId === c.iso3).length / w.cities.length;
    expect(agree).toBeGreaterThan(0.9);
    const itaipu = w.plants.find((p) => p.name.startsWith('Itaipu (Parte Brasileira)'));
    if (itaipu) expect(itaipu.countryId).toBe('BRA');
    const cap = w.cities[w.capitalCityOf('BRA')!];
    expect(cap.name).toBe('Brasília');
  });

  it('grids are oriented north-up and agree with land/sea', () => {
    expect(w.isSea(-30, 0)).toBe(true); // mid-Atlantic
    expect(w.isSea(-150, -30)).toBe(true); // South Pacific
    expect(w.isSea(-55, -10)).toBe(false); // Mato Grosso
    expect(w.isSea(100, 45)).toBe(false); // Mongolia
    expect(w.elevationAt(86.92, 27.99)).toBeGreaterThan(4000); // Himalaya
    expect(w.elevationAt(-30, 0)).toBeLessThan(-1000);
    expect(w.elevationAt(-47.9, -15.8)).toBeGreaterThan(600); // Brasília plateau
  });

  it('road graph is consistent and searchable', () => {
    const r = w.roads;
    expect(r.edgeCount).toBeGreaterThan(10_000);
    let bad = 0;
    for (let e = 0; e < r.edgeCount; e += 97) {
      const g = r.edgeGeometry(e);
      const a = r.edgeA[e], b = r.edgeB[e];
      if (haversineKm(g[0][0], g[0][1], r.nodeLon[a], r.nodeLat[a]) > 3) bad++;
      if (haversineKm(g[g.length - 1][0], g[g.length - 1][1], r.nodeLon[b], r.nodeLat[b]) > 3) bad++;
    }
    expect(bad).toBe(0);
    const n = w.nearestRoadNode(-46.63, -23.55)!;
    expect(haversineKm(r.nodeLon[n], r.nodeLat[n], -46.63, -23.55)).toBeLessThan(50);
  });

  it('stats, military and alliances are keyed by real ids', () => {
    expect(w.stats.BRA.pop).toBeGreaterThan(150e6);
    expect(w.military.USA.carriers).toBeGreaterThan(5);
    expect(w.alliances.alliances.find((a) => a.id === 'NATO')?.members).toContain('USA');
    for (const a of w.alliances.alliances) for (const m of a.members) expect(w.countryById.has(m)).toBe(true);
  });
});
