import { describe, expect, it } from 'vitest';
import { decodeRle, SURF } from './nav';
import { USE_RULES } from '../../sim/tactical/terrainRules';
import { fixtureOvertureReader, fixtureSource, loadFixture, type FixtureName } from './fixtures.test-util';
import { prepareTacticalVector } from './prepare';
import { buildingHeight } from './overture';
import { buildingsIn } from './query';
import { rasterizeNav } from './rasterize';
import { loadFromSources, openFreeMapSource, overtureSource } from './source';

const AREAS: FixtureName[] = ['rio', 'paris', 'rural', 'alpes'];
const surfOf = (nav: Awaited<ReturnType<typeof loadFixture>>['nav']) => decodeRle(nav.surf, nav.n * nav.n, Uint8Array);
const count = (s: Uint8Array, v: number) => s.reduce((a, x) => a + (x === v ? 1 : 0), 0);

describe('vector adapters', () => {
  for (const name of AREAS) {
    it(`both sources give the same kind of raster: ${name}`, async () => {
      const [ov, ofm] = [await loadFixture(name, 'overture'), await loadFixture(name, 'ofm')];
      expect(ov.nav.n).toBe(ofm.nav.n);
      const [a, b] = [surfOf(ov.nav), surfOf(ofm.nav)];
      for (const s of [a, b]) {
        expect(s.length).toBe(ov.nav.n ** 2);
        expect(Math.max(...s)).toBeLessThanOrEqual(SURF.STEPS);
        expect(s.some((v) => v >= SURF.MOTORWAY && v <= SURF.SERVICE)).toBe(true);
      }
      if (name !== 'alpes') expect(count(a, SURF.BUILDING)).toBeGreaterThan(40);
      // both see the same water within a loose tolerance (same real river/lake)
      const wa = count(a, SURF.DEEP), wb = count(b, SURF.DEEP);
      if (name === 'paris' || name === 'rio') expect(Math.abs(wa - wb) / Math.max(wa, wb)).toBeLessThan(0.35);
      expect(JSON.parse(JSON.stringify(ov.nav))).toEqual(ov.nav);
    });
  }

  it('no source class present in the 4 areas is left without a rule', async () => {
    const missing: string[] = [];
    let seen = 0;
    for (const name of AREAS) for (const src of ['overture', 'ofm'] as const) {
      const f = await loadFixture(name, src);
      seen += Object.keys(f.area.seen).length;
      for (const k of f.area.unmapped) missing.push(`${name}/${src}: ${k}`);
    }
    expect(missing, `unmapped classes:\n${missing.join('\n')}`).toEqual([]);
    expect(seen).toBeGreaterThan(150);
  });

  it('layers beyond buildings reach the raster: use zones, structures, POIs, peaks, steps, snow/scrub', async () => {
    const ov = await Promise.all(AREAS.map((a) => loadFixture(a, 'overture')));
    const use = (f: typeof ov[0]) => decodeRle(f.nav.use, f.nav.n ** 2, Uint8Array);
    expect(ov.some((f) => use(f).some((v) => v === USE_RULES.hospital.code))).toBe(true);
    expect(ov.some((f) => use(f).some((v) => v === USE_RULES.school.code))).toBe(true);
    expect(ov.some((f) => use(f).some((v) => v === USE_RULES.military.code))).toBe(true);
    expect(ov.reduce((a, f) => a + f.nav.infra.length, 0)).toBeGreaterThan(5);
    expect(ov.reduce((a, f) => a + f.nav.pois.length, 0)).toBeGreaterThan(5);
    expect(ov.reduce((a, f) => a + f.nav.peaks.length, 0)).toBeGreaterThan(0);
    const all = ov.map((f) => surfOf(f.nav));
    for (const v of [SURF.STEPS, SURF.SCRUB, SURF.ROCK, SURF.WOOD, SURF.BRIDGE, SURF.TUNNEL, SURF.FOOTBRIDGE, SURF.SHALLOW, SURF.DEEP, SURF.URBAN, SURF.BUILDING, SURF.PATH, SURF.MOTORWAY]) expect(all.some((s) => count(s, v) > 0), `surface ${v}`).toBe(true);
    const ofm = await Promise.all(AREAS.map((a) => loadFixture(a, 'ofm')));
    expect(ofm.reduce((a, f) => a + f.nav.pois.length, 0)).toBeGreaterThan(5);
    expect(ofm.reduce((a, f) => a + f.nav.peaks.length, 0)).toBeGreaterThan(0);
  });

  it('Overture heights: real > floors*3 > class default', () => {
    expect(buildingHeight(21, 3)).toBe(21);
    expect(buildingHeight(undefined, 4)).toBe(12);
    expect(buildingHeight(undefined, undefined, 'house')).toBe(6);
    expect(buildingHeight(undefined, undefined)).toBe(7);
  });

  it('building query by bbox and area', async () => {
    const f = await loadFixture('paris');
    const all = buildingsIn(f.nav, { x0: -1500, y0: -1500, x1: 1500, y1: 1500 });
    const big = buildingsIn(f.nav, { x0: -1500, y0: -1500, x1: 1500, y1: 1500 }, 500);
    expect(all.length).toBeGreaterThan(1000);
    expect(big.length).toBeLessThan(all.length);
    expect(big.every((b) => b.area >= 500 && b.h >= 3)).toBe(true);
  });

  it('primary failure falls to the backup, total failure gives null (procedural)', async () => {
    const bb = { lon: (await loadFixture('rural')).lon, lat: (await loadFixture('rural')).lat, sizeM: 3000 };
    const dead = { id: 'overture' as const, load: async () => { throw new Error('network'); } };
    const empty = overtureSource({ read: async () => null });
    const ofm = openFreeMapSource({ tiles: fixtureSource('rural') });
    const r = await loadFromSources([dead, empty, ofm], bb);
    expect(r?.source).toBe('openfreemap');
    expect(await loadFromSources([dead, empty], bb)).toBeNull();
    const ok = await loadFromSources([overtureSource({ read: fixtureOvertureReader('rural') }), ofm], bb);
    expect(ok?.source.startsWith('overture')).toBe(true);
    // a slow primary is abandoned after its time budget
    const slow = { id: 'overture' as const, load: () => new Promise<never>(() => {}) };
    expect((await loadFromSources([slow, ofm], bb, 50))?.source).toBe('openfreemap');
  });

  it('offline: prepareTacticalVector resolves null without throwing', async () => {
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await prepareTacticalVector(-0.48, 48.98, { fetchFn: down, sizeM: 3000, timeoutMs: 2000 })).toBeNull();
    const dead = [{ id: 'overture' as const, load: async () => null }];
    expect(await prepareTacticalVector(-0.48, 48.98, { sources: dead })).toBeNull();
  });

  it('prepareTacticalVector with injected sources rasterises', async () => {
    const f = await loadFixture('rural');
    const nav = await prepareTacticalVector(f.lon, f.lat, { sizeM: 3000, sources: [overtureSource({ read: fixtureOvertureReader('rural') })], heights: f.heights, hn: f.hn });
    expect(nav?.n).toBe(f.nav.n);
    expect(nav?.hgt).toBeTruthy();
    void rasterizeNav;
  });
});
