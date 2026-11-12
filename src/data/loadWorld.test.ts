import { describe, expect, it } from 'vitest';
import { decodeTable } from './decode';
import { fixtureRaw, fixtureWorld } from './fixture.test-util';
import { buildWorldStatic, loadWorldStatic, MissingDataError, type LoadProgress } from './loadWorld';

describe('loadWorldStatic (fixture)', () => {
  const w = fixtureWorld();

  it('decodes columnar and row tables', () => {
    expect(decodeTable('x', { n: 2, cols: { a: [1, 2], b: ['x', 'y'] } })).toEqual([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    expect(decodeTable('x', [{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(() => decodeTable('x', { n: 3, cols: { a: [1] } })).toThrow(/coluna 'a'/);
  });

  it('builds indices and associates points to provinces/countries', () => {
    expect(w.countryById.get('BBB')?.iso2).toBe('BB');
    expect(w.provincesByCountry.get('AAA')).toEqual(['AAA-1', 'AAA-2']);
    expect(w.cities.map((c) => c.provinceId)).toEqual(['AAA-1', 'AAA-2', 'BBB-1', 'BBB-1']);
    expect(w.citiesByCountry.get('AAA')).toEqual([0, 1]);
    expect(w.plants[0]).toMatchObject({ provinceId: 'AAA-1', countryId: 'AAA', fuel: 'coal', mw: 500, index: 0 });
    expect(w.plants[1].fuel).toBe('other');
    expect(w.airports[0]).toMatchObject({ provinceId: 'AAA-2', military: true, size: 2 });
    // Port just offshore on the AAA/BBB border: nearest province, deterministic.
    expect(w.ports[0].provinceId).not.toBeNull();
    expect(w.capitalCityOf('AAA')).toBe(0);
    expect(w.mainCityOf('BBB-1')).toBe(2);
    expect(w.stats.BBB.estimated).toEqual(['lifeExp']);
    expect(w.alliances.alliances[0].members).toEqual(['AAA', 'BBB']);
  });

  it('answers spatial queries', () => {
    expect(w.locateProvince(1, 1)).toBe('AAA-1');
    expect(w.locateProvince(9.9, 9.9)).toBe('AAA-2');
    expect(w.locateProvince(15, 5)).toBe('BBB-1');
    expect(w.locateProvince(30, 5)).toBeNull();
    expect(w.nearestProvince(20.5, 5)).toBe('BBB-1');
    expect(w.nearestProvince(40, 5)).toBeNull();
    expect(w.isSea(5, 5)).toBe(false);
    expect(w.isSea(-30, 0)).toBe(true);
    expect(w.isSea(5, -5)).toBe(true);
    expect(w.elevationAt(-30, 30)).toBe(-3000);
    expect(w.elevationAt(5.125, 5.125)).toBe(513); // cell centre → exact sample
    expect(w.elevationAt(5.25, 5.125)).toBeCloseTo((513 + 538) / 2, 6); // bilinear between centres
    expect(w.nearestRoadNode(2.1, 5)).toBe(0);
    expect(w.nearestRoadNode(17, 6)).toBe(2);
    expect(w.nearestRoadNode(-120, -60, 500)).toBeNull();
  });

  it('builds a routable road graph', () => {
    const r = w.roads;
    expect([r.nodeCount, r.edgeCount]).toEqual([3, 2]);
    expect(Array.from(r.adjEdge.slice(r.adjStart[1], r.adjStart[2])).sort()).toEqual([0, 1]);
    expect(r.otherEnd(1, 2)).toBe(1);
    expect(r.edgeGeometry(0)).toEqual([[2, 5], [4.5, 5.5], [7, 5]]);
    expect(r.edgeGeometry(1)).toEqual([[7, 5], [18, 5]]);
  });

  it('reports progress and a clear error naming a missing file', async () => {
    const raw = fixtureRaw();
    const seen: LoadProgress[] = [];
    const ok = await loadWorldStatic(async (f) => raw[f as keyof typeof raw], (p) => seen.push(p));
    expect(ok.dataHash).toBe(w.dataHash);
    expect(seen.at(-1)?.phase).toBe('index');
    const missing = loadWorldStatic(async (f) => {
      if (f === 'roads.json') throw new Error('ENOENT');
      return raw[f as keyof typeof raw];
    });
    await expect(missing).rejects.toBeInstanceOf(MissingDataError);
    await expect(missing).rejects.toThrow(/public\/data\/roads\.json/);
  });

  it('dataHash changes with the data', () => {
    const raw = fixtureRaw();
    (raw['provinces.json'] as { countryId: string }[])[1].countryId = 'BBB';
    expect(buildWorldStatic(raw).dataHash).not.toBe(w.dataHash);
  });
});
