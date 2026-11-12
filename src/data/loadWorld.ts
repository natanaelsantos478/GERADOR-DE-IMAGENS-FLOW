/**
 * Loads every file of PLANO §4 from public/data and builds WorldStatic (indices + spatial queries).
 * Works in the browser (`browserFetchJson`) and in Node (`nodeFetchJson` from ./fetchNode).
 */
import type {
  Airport, AllianceData, City, Country, CountryId, CountryStats, GeoFeatureCollection, LocatedPoint,
  MilitaryInventory, Port, PowerPlant, Province, ProvinceId, WorldStatic,
} from '../core/world-types';
import { FUELS } from '../core/world-types';
import { haversineKm } from '../core/geo';
import { hashSeed } from '../core/rng';
import { DataFormatError, decodeTable, num, str, type Row } from './decode';
import { buildElevGrid, buildNavGrid } from './grids';
import { buildRoadGraph, createNearestRoadNode } from './roads';
import { buildPolygonIndex } from './spatial';

/** Fetches and parses one file of public/data by name; must throw when it does not exist. */
export type FetchJson = (file: string) => Promise<unknown>;

export interface LoadProgress {
  loaded: number;
  total: number;
  file: string;
  phase: 'fetch' | 'index';
}

export const DATA_FILES = [
  'countries.json', 'countries.geo.json', 'provinces.json', 'provinces.geo.json', 'cities.json', 'powerplants.json',
  'airports.json', 'ports.json', 'roads.json', 'navgrid.json', 'elev.json', 'stats.json', 'military.json', 'alliances.json',
] as const;
export type DataFile = (typeof DATA_FILES)[number];

export class MissingDataError extends Error {
  constructor(public readonly file: string, cause?: unknown) {
    super(
      `Arquivo de dados ausente ou ilegível: public/data/${file} — gere-o com \`cd tools && npm i && npm run data:all\`` +
        (cause instanceof Error ? ` (${cause.message})` : ''),
    );
    this.name = 'MissingDataError';
  }
}

/** Browser fetcher relative to `baseUrl` (e.g. `new URL('data/', document.baseURI)`). */
export function browserFetchJson(baseUrl: string | URL): FetchJson {
  return async (file) => {
    const res = await fetch(new URL(file, baseUrl));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Dev servers answer unknown paths with index.html: treat that as missing too.
    if (text.trimStart().startsWith('<')) throw new Error('resposta não é JSON');
    return JSON.parse(text);
  };
}

const ASSOC_MAX_KM = 100;
const HINT_BORDER_KM = 10;

export async function loadWorldStatic(fetchJson: FetchJson, onProgress?: (p: LoadProgress) => void): Promise<WorldStatic> {
  let loaded = 0;
  const raw = {} as Record<DataFile, unknown>;
  await Promise.all(
    DATA_FILES.map(async (file) => {
      try {
        raw[file] = await fetchJson(file);
      } catch (e) {
        throw new MissingDataError(file, e);
      }
      onProgress?.({ loaded: ++loaded, total: DATA_FILES.length + 1, file, phase: 'fetch' });
    }),
  );
  const world = buildWorldStatic(raw);
  onProgress?.({ loaded: DATA_FILES.length + 1, total: DATA_FILES.length + 1, file: '', phase: 'index' });
  return world;
}

const lonLat = (v: unknown): [number, number] => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [0, 0]);

function parseCountries(json: unknown): Country[] {
  if (!Array.isArray(json)) throw new DataFormatError('countries.json', 'esperado array');
  return json.map((r: Row) => {
    const cap = (r.capital ?? {}) as Row;
    return {
      id: str(r.id),
      iso2: str(r.iso2),
      name: str(r.name),
      namePt: str(r.namePt) || str(r.name),
      continent: str(r.continent),
      subregion: str(r.subregion),
      sovereign: r.sovereign === true,
      centroid: lonLat(r.centroid),
      bbox: (Array.isArray(r.bbox) ? r.bbox.map((x) => num(x)) : [0, 0, 0, 0]) as Country['bbox'],
      color: (Array.isArray(r.color) ? r.color.map((x) => num(x)) : [128, 128, 128]) as Country['color'],
      capital: { name: str(cap.name), lon: num(cap.lon), lat: num(cap.lat) },
      neighbors: Array.isArray(r.neighbors) ? r.neighbors.map(str) : [],
      coastal: r.coastal === true,
    };
  });
}

function parseProvinces(json: unknown): Province[] {
  if (!Array.isArray(json)) throw new DataFormatError('provinces.json', 'esperado array');
  return json.map((r: Row, index) => ({
    id: str(r.id),
    countryId: str(r.countryId),
    name: str(r.name),
    centroid: lonLat(r.centroid),
    areaKm2: num(r.areaKm2),
    neighbors: Array.isArray(r.neighbors) ? r.neighbors.map(str) : [],
    coastal: r.coastal === true,
    elevMean: num(r.elevMean),
    rugged: num(r.rugged),
    index,
  }));
}

/** Object keyed by country id, or array of `{ id, … }`. */
function byCountry<T>(file: string, json: unknown): Record<CountryId, T> {
  if (Array.isArray(json)) {
    const out: Record<CountryId, T> = {};
    for (const r of json as Row[]) {
      const id = str(r.id ?? r.countryId);
      if (!id) throw new DataFormatError(file, 'item sem id');
      out[id] = r as T;
    }
    return out;
  }
  if (json && typeof json === 'object') return json as Record<CountryId, T>;
  throw new DataFormatError(file, 'esperado objeto por país');
}

function parseAlliances(json: unknown): AllianceData {
  if (Array.isArray(json)) return { alliances: json as AllianceData['alliances'], rivalries: [], conflicts: [] };
  const j = json as Partial<AllianceData> | null;
  if (!j || !Array.isArray(j.alliances)) throw new DataFormatError('alliances.json', 'esperado { alliances, rivalries, conflicts }');
  return { alliances: j.alliances, rivalries: Array.isArray(j.rivalries) ? j.rivalries : [], conflicts: Array.isArray(j.conflicts) ? j.conflicts : [] };
}

function pushTo<K>(m: Map<K, number[]>, k: K, v: number) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

export function buildWorldStatic(raw: Record<DataFile, unknown>): WorldStatic {
  const countries = parseCountries(raw['countries.json']);
  const provinces = parseProvinces(raw['provinces.json']);
  const countryById = new Map(countries.map((c) => [c.id, c]));
  const provinceById = new Map(provinces.map((p) => [p.id, p]));
  if (countryById.size !== countries.length) throw new DataFormatError('countries.json', 'ids duplicados');
  if (provinceById.size !== provinces.length) throw new DataFormatError('provinces.json', 'ids duplicados');
  const provincesByCountry = new Map<CountryId, ProvinceId[]>();
  for (const p of provinces) {
    if (!countryById.has(p.countryId)) throw new DataFormatError('provinces.json', `província ${p.id} com countryId desconhecido ${p.countryId}`);
    const l = provincesByCountry.get(p.countryId);
    if (l) l.push(p.id);
    else provincesByCountry.set(p.countryId, [p.id]);
  }

  const countriesGeo = raw['countries.geo.json'] as GeoFeatureCollection;
  const provincesGeo = raw['provinces.geo.json'] as GeoFeatureCollection;
  const provIndex = buildPolygonIndex(provincesGeo, 'provinces.geo.json');
  const shapeIds = new Set(provIndex.ids);
  const missingShapes = provinces.filter((p) => !shapeIds.has(p.id)).length;
  if (missingShapes > 0) throw new DataFormatError('provinces.geo.json', `${missingShapes} províncias sem geometria`);

  const locate = (lon: number, lat: number, hint: string): { provinceId: ProvinceId | null; countryId: CountryId | null } => {
    const hinted = countryById.has(hint) ? hint : null;
    const isHinted = hinted ? (id: string) => provinceById.get(id)?.countryId === hinted : undefined;
    let pid = provIndex.nearest(lon, lat, ASSOC_MAX_KM, isHinted);
    // Simplified borders misplace points sitting right on them: trust the source country within a few km.
    if (pid && isHinted && !isHinted(pid)) {
      const near = provIndex.nearestBorder(lon, lat, HINT_BORDER_KM, isHinted);
      if (near) pid = near;
    }
    if (pid) return { provinceId: pid, countryId: provinceById.get(pid)!.countryId };
    return { provinceId: null, countryId: hinted };
  };
  const points = <T extends LocatedPoint>(file: DataFile, make: (r: Row, base: LocatedPoint) => T, hintField?: string): T[] =>
    decodeTable(file, raw[file]).map((r, index) => {
      const lon = num(r.lon), lat = num(r.lat);
      const loc = locate(lon, lat, hintField ? str(r[hintField]) : '');
      return make(r, { index, name: str(r.name), lon, lat, ...loc });
    });

  const cities = points<City>('cities.json', (r, b) => ({ ...b, pop: num(r.pop), capital: Math.max(0, Math.min(2, num(r.capital))) as City['capital'], iso3: str(r.iso3) }), 'iso3');
  const plants = points<PowerPlant>('powerplants.json', (r, b) => {
    const fuel = str(r.fuel) as PowerPlant['fuel'];
    return { ...b, fuel: FUELS.includes(fuel) ? fuel : 'other', mw: num(r.mw), iso3: str(r.iso3) };
  }, 'iso3');
  const airports = points<Airport>('airports.json', (r, b) => ({ ...b, iata: str(r.iata), size: num(r.size) as Airport['size'], military: num(r.military) === 1 || r.military === true }));
  const ports = points<Port>('ports.json', (r, b) => ({ ...b, size: num(r.size) as Port['size'] }));

  const index = <T extends LocatedPoint>(arr: T[]) => {
    const byP = new Map<ProvinceId, number[]>(), byC = new Map<CountryId, number[]>();
    for (const x of arr) {
      if (x.provinceId) pushTo(byP, x.provinceId, x.index);
      if (x.countryId) pushTo(byC, x.countryId, x.index);
    }
    return [byP, byC] as const;
  };
  const [citiesByProvince, citiesByCountry] = index(cities);
  const [plantsByProvince, plantsByCountry] = index(plants);
  const [airportsByProvince, airportsByCountry] = index(airports);
  const [portsByProvince, portsByCountry] = index(ports);

  const roads = buildRoadGraph(raw['roads.json']);
  const nearestRoadNode = createNearestRoadNode(roads);
  const navGrid = buildNavGrid(raw['navgrid.json']);
  const elev = buildElevGrid(raw['elev.json']);
  const stats = byCountry<CountryStats>('stats.json', raw['stats.json']);
  const military = byCountry<MilitaryInventory>('military.json', raw['military.json']);
  const alliances = parseAlliances(raw['alliances.json']);

  const capitalCache = new Map<CountryId, number | null>();
  const capitalCityOf = (c: CountryId): number | null => {
    if (capitalCache.has(c)) return capitalCache.get(c)!;
    const list = citiesByCountry.get(c) ?? [];
    const country = countryById.get(c);
    let best: number | null = null, bestScore = Infinity;
    for (const i of list) {
      const city = cities[i];
      // Prefer national capitals nearest to the official capital point; else the biggest city.
      const score = country && city.capital === 2 ? haversineKm(city.lon, city.lat, country.capital.lon, country.capital.lat) : 1e9 - city.pop / 1e3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    capitalCache.set(c, best);
    return best;
  };
  const mainCityOf = (p: ProvinceId): number | null => {
    let best: number | null = null;
    for (const i of citiesByProvince.get(p) ?? []) if (best === null || cities[i].pop > cities[best].pop) best = i;
    return best;
  };

  const dataHash = computeDataHash(countries, provinces, [cities, plants, airports, ports], roads.nodeCount, roads.edgeCount, navGrid.w, elev.w);

  return {
    dataHash, countries, provinces, cities, plants, airports, ports, roads, navGrid, elev, stats, military, alliances,
    countriesGeo, provincesGeo, countryById, provinceById, provincesByCountry,
    citiesByProvince, citiesByCountry, plantsByProvince, plantsByCountry, airportsByProvince, airportsByCountry, portsByProvince, portsByCountry,
    locateProvince: (lon, lat) => provIndex.locate(lon, lat),
    nearestProvince: (lon, lat, maxKm = ASSOC_MAX_KM) => provIndex.nearest(lon, lat, maxKm),
    nearestRoadNode,
    isSea: (lon, lat) => {
      const [x, y] = navGrid.cellOf(lon, lat);
      return navGrid.isSeaCell(x, y);
    },
    elevationAt: (lon, lat) => elev.at(lon, lat),
    capitalCityOf,
    mainCityOf,
  };
}

function computeDataHash(
  countries: Country[], provinces: Province[], pointSets: LocatedPoint[][], nodes: number, edges: number, navW: number, elevW: number,
): string {
  const parts = [
    countries.map((c) => c.id).join(','),
    provinces.map((p) => `${p.id}:${p.countryId}`).join(','),
    pointSets.map((s) => `${s.length}:${s.reduce((a, p) => a + p.lon * 7 + p.lat * 13, 0).toFixed(2)}`).join('|'),
    `${nodes}/${edges}/${navW}/${elevW}`,
  ].join('#');
  return hashSeed(parts).toString(16).padStart(8, '0') + hashSeed(parts.split('').reverse().join('')).toString(16).padStart(8, '0');
}
