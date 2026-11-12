/**
 * Tiny synthetic dataset for UNIT TESTS ONLY (never shipped): two countries on a 20°×10° block
 * of land around (0..20E, 0..10N), split into three square provinces.
 */
import type { WorldStatic } from '../core/world-types';
import { buildWorldStatic, type DataFile } from './loadWorld';

const square = (w: number, s: number, e: number, n: number) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

function bitsetB64(w: number, h: number, isSea: (lon: number, lat: number) => boolean): string {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  const cd = 360 / w;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (isSea(-180 + (x + 0.5) * cd, 90 - (y + 0.5) * cd)) bytes[i >> 3] |= 1 << (i & 7);
    }
  return Buffer.from(bytes).toString('base64');
}

function elevB64(w: number, h: number, f: (lon: number, lat: number) => number): string {
  const buf = Buffer.alloc(w * h * 2);
  const cd = 360 / w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf.writeInt16LE(f(-180 + (x + 0.5) * cd, 90 - (y + 0.5) * cd), (y * w + x) * 2);
  return buf.toString('base64');
}

const onLand = (lon: number, lat: number) => lon >= 0 && lon <= 20 && lat >= 0 && lat <= 10;

export function fixtureRaw(): Record<DataFile, unknown> {
  const country = (id: string, iso2: string, cx: number, capLon: number) => ({
    id, iso2, name: id, namePt: id, continent: 'Test', subregion: 'Test', sovereign: true, centroid: [cx, 5], bbox: [cx - 5, 0, cx + 5, 10],
    color: [10, 20, 30], capital: { name: `${id} City`, lon: capLon, lat: 5 }, neighbors: [id === 'AAA' ? 'BBB' : 'AAA'], coastal: true,
  });
  const prov = (id: string, countryId: string, cx: number, nb: string[]) => ({
    id, countryId, name: id, centroid: [cx, 5], areaKm2: 1000, neighbors: nb, coastal: true, elevMean: 100, rugged: 0.1,
  });
  return {
    'countries.json': [country('AAA', 'AA', 5, 2), country('BBB', 'BB', 15, 18)],
    'countries.geo.json': {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'AAA' }, geometry: { type: 'Polygon', coordinates: square(0, 0, 10, 10) } },
        { type: 'Feature', properties: { id: 'BBB' }, geometry: { type: 'Polygon', coordinates: square(10, 0, 20, 10) } },
      ],
    },
    'provinces.json': [prov('AAA-1', 'AAA', 2.5, ['AAA-2']), prov('AAA-2', 'AAA', 7.5, ['AAA-1', 'BBB-1']), prov('BBB-1', 'BBB', 15, ['AAA-2'])],
    'provinces.geo.json': {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'AAA-1' }, geometry: { type: 'Polygon', coordinates: square(0, 0, 5, 10) } },
        { type: 'Feature', properties: { id: 'AAA-2' }, geometry: { type: 'MultiPolygon', coordinates: [square(5, 0, 10, 10)] } },
        { type: 'Feature', properties: { id: 'BBB-1' }, geometry: { type: 'Polygon', coordinates: square(10, 0, 20, 10) } },
      ],
    },
    'cities.json': {
      n: 4,
      cols: {
        name: ['Alpha', 'Beta', 'Gamma', 'Offshore'], lon: [2, 7, 18, 20.3], lat: [5, 5, 5, 5],
        pop: [1_000_000, 200_000, 500_000, 1000], capital: [2, 1, 2, 0], iso3: ['AAA', 'AAA', 'BBB', 'BBB'],
      },
    },
    'powerplants.json': [{ name: 'P1', lon: 3, lat: 3, fuel: 'coal', mw: 500, iso3: 'AAA' }, { name: 'P2', lon: 15, lat: 3, fuel: 'weird', mw: 10, iso3: 'BBB' }],
    'airports.json': { n: 1, cols: { name: ['Air'], lon: [7.5], lat: [8], iata: ['AIR'], size: [2], military: [1] } },
    'ports.json': { n: 1, cols: { name: ['Port'], lon: [10], lat: [-0.2], size: [1] } },
    'roads.json': {
      nodes: { lon: [2, 7, 18], lat: [5, 5, 5] },
      edges: { a: [0, 1], b: [1, 2], km: [554, 1219], cls: [0, 3], geomStart: [0, 3], geomLen: [3, 0] },
      geom: [2, 5, 4.5, 5.5, 7, 5],
    },
    'navgrid.json': { w: 1440, h: 720, sea: bitsetB64(1440, 720, (lon, lat) => !onLand(lon, lat)) },
    'elev.json': { w: 1440, h: 720, data: elevB64(1440, 720, (lon, lat) => (onLand(lon, lat) ? Math.round(lon * 100) : -3000)) },
    'stats.json': {
      AAA: { pop: 1e7, gdpUsd: 1e11, gdpGrowth: 2, milExpUsd: 1e9, armedForces: 5e4, electricityKwhPc: 3000, urbanPct: 80, lifeExp: 75, year: 2024 },
      BBB: { pop: 5e6, gdpUsd: 5e10, gdpGrowth: 3, milExpUsd: 5e8, armedForces: 2e4, electricityKwhPc: 2000, urbanPct: 60, lifeExp: 70, year: 2024, estimated: ['lifeExp'] },
    },
    'military.json': {
      AAA: { tanks: 100, ifv: 50, artillery: 30, mlrs: 10, sam: 5, fighters: 20, bombers: 0, attackHelis: 5, transports: 3, drones: 10, destroyers: 0, frigates: 2, subs: 1, carriers: 0, nukes: 0 },
      BBB: { tanks: 50, ifv: 20, artillery: 10, mlrs: 5, sam: 2, fighters: 10, bombers: 0, attackHelis: 2, transports: 1, drones: 3, destroyers: 0, frigates: 1, subs: 0, carriers: 0, nukes: 0 },
    },
    'alliances.json': { alliances: [{ id: 'TEST', name: 'Test Pact', kind: 'defense', members: ['AAA', 'BBB'] }], rivalries: [{ a: 'AAA', b: 'BBB', level: 1 }], conflicts: [] },
  };
}

export function fixtureWorld(): WorldStatic {
  return buildWorldStatic(fixtureRaw());
}
