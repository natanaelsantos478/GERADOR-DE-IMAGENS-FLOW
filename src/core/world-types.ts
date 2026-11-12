/**
 * Static world data (PLANO §4) in its IN-MEMORY form, as produced by `src/data/loadWorld.ts`.
 * Never part of GameState: it is immutable, may use Map/typed arrays and is rebuilt from
 * `public/data` on every start. Re-exported by `src/core/contracts.ts`.
 */

/** Natural Earth `ADM0_A3` (e.g. 'BRA'). */
export type CountryId = string;
/** Natural Earth `adm1_code` (or `${adm0_a3}-X${n}` when absent/duplicated). */
export type ProvinceId = string;
/** `[lon, lat]` in WGS84 degrees. */
export type LonLat = [number, number];
/** `[west, south, east, north]` in degrees. */
export type BBox = [number, number, number, number];
export type RGB = [number, number, number];

export interface Country {
  id: CountryId;
  iso2: string;
  name: string;
  namePt: string;
  continent: string;
  subregion: string;
  sovereign: boolean;
  centroid: LonLat;
  bbox: BBox;
  /** Fill colour, distinct between neighbours. */
  color: RGB;
  capital: { name: string; lon: number; lat: number };
  /** Land-border neighbours. */
  neighbors: CountryId[];
  coastal: boolean;
}

export interface Province {
  id: ProvinceId;
  countryId: CountryId;
  name: string;
  centroid: LonLat;
  areaKm2: number;
  neighbors: ProvinceId[];
  coastal: boolean;
  /** Mean elevation in metres. */
  elevMean: number;
  /** Ruggedness 0..1. */
  rugged: number;
  /** Position in `WorldStatic.provinces` (added by the loader). */
  index: number;
}

/** Common fields every point dataset gets from the loader's spatial association. */
export interface LocatedPoint {
  /** Position in its dataset array; this is the index used by WorldDyn damage maps. */
  index: number;
  name: string;
  lon: number;
  lat: number;
  /** Province containing the point (or nearest one within ~100 km for coastal/offshore points). */
  provinceId: ProvinceId | null;
  /** Owner country at game start (from the province, else from the source `iso3` hint). */
  countryId: CountryId | null;
}

/** 0 = none, 1 = admin-1 capital, 2 = national capital. */
export type CapitalRank = 0 | 1 | 2;

export interface City extends LocatedPoint {
  pop: number;
  capital: CapitalRank;
  /** Source ISO3 hint (may differ from countryId). */
  iso3: string;
}

export type Fuel = 'coal' | 'gas' | 'oil' | 'nuclear' | 'hydro' | 'wind' | 'solar' | 'biomass' | 'geothermal' | 'other';
export const FUELS: readonly Fuel[] = ['coal', 'gas', 'oil', 'nuclear', 'hydro', 'wind', 'solar', 'biomass', 'geothermal', 'other'];

export interface PowerPlant extends LocatedPoint {
  fuel: Fuel;
  /** Installed capacity in MW. */
  mw: number;
  iso3: string;
}

/** 0 = small, 1 = mid, 2 = major. */
export type SiteSize = 0 | 1 | 2;

export interface Airport extends LocatedPoint {
  iata: string;
  size: SiteSize;
  military: boolean;
}

export interface Port extends LocatedPoint {
  size: SiteSize;
}

/** 0 motorway, 1 primary, 2 secondary, 3 railway, 4 ferry. */
export type RoadClass = 0 | 1 | 2 | 3 | 4;

/**
 * Routable road/rail graph (`roads.json`) in typed arrays. Node/edge indices are stable and are the
 * keys used by `WorldDyn.roadDamage` (edge index).
 */
export interface RoadGraph {
  nodeCount: number;
  edgeCount: number;
  nodeLon: Float64Array;
  nodeLat: Float64Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeKm: Float32Array;
  edgeCls: Uint8Array;
  /** First point (pair index, not float index) of the edge polyline in `geom`. */
  edgeGeomStart: Int32Array;
  /** Number of points of the edge polyline. */
  edgeGeomLen: Int32Array;
  /** Flat `[lon, lat, lon, lat, ...]`. */
  geom: Float64Array;
  /** CSR adjacency: edges of node `n` are `adjEdge[adjStart[n] .. adjStart[n+1])`. */
  adjStart: Int32Array;
  adjEdge: Int32Array;
  /** Polyline of an edge, oriented from `edgeA` to `edgeB`. */
  edgeGeometry(edge: number): LonLat[];
  /** The node at the other end of `edge` from `node`. */
  otherEnd(edge: number, node: number): number;
}

/** Equirectangular global grid; row 0 is the northernmost row, column 0 starts at lon −180. */
export interface GlobalGrid {
  w: number;
  h: number;
  /** Cell size in degrees (0.25). */
  cellDeg: number;
  /** Cell coordinates containing a point (clamped/wrapped to the grid). */
  cellOf(lon: number, lat: number): [number, number];
  /** Centre of a cell. */
  cellCenter(x: number, y: number): LonLat;
}

export interface NavGrid extends GlobalGrid {
  /** Bitset, bit `y*w+x` (LSB first inside each byte); 1 = navigable sea. */
  sea: Uint8Array;
  isSeaCell(x: number, y: number): boolean;
}

export interface ElevGrid extends GlobalGrid {
  /** Metres, row-major, `y*w+x`. */
  data: Int16Array;
  /** Bilinear elevation in metres. */
  at(lon: number, lat: number): number;
}

export interface CountryStats {
  pop: number;
  gdpUsd: number;
  /** Annual real GDP growth in %. */
  gdpGrowth: number;
  milExpUsd: number;
  armedForces: number;
  electricityKwhPc: number;
  oilProdBpd?: number;
  urbanPct: number;
  lifeExp: number;
  /** Reference year of the data. */
  year: number;
  /** Fields filled from an alternative real source. */
  estimated?: string[];
}

export interface MilitaryInventory {
  tanks: number;
  ifv: number;
  artillery: number;
  mlrs: number;
  sam: number;
  fighters: number;
  bombers: number;
  attackHelis: number;
  transports: number;
  drones: number;
  destroyers: number;
  frigates: number;
  subs: number;
  carriers: number;
  nukes: number;
  [extra: string]: number | string | boolean | string[] | undefined;
}

export type AllianceKind = 'defense' | 'economic' | 'political';

export interface Alliance {
  id: string;
  name: string;
  kind: AllianceKind;
  members: CountryId[];
  [extra: string]: unknown;
}

export interface Rivalry {
  a: CountryId;
  b: CountryId;
  level: number;
}

export interface Conflict {
  a: CountryId;
  b: CountryId;
  [extra: string]: unknown;
}

export interface AllianceData {
  alliances: Alliance[];
  rivalries: Rivalry[];
  conflicts: Conflict[];
}

/** Minimal GeoJSON (only what the data files use). */
export type GeoPolygon = { type: 'Polygon'; coordinates: number[][][] };
export type GeoMultiPolygon = { type: 'MultiPolygon'; coordinates: number[][][][] };
export interface GeoFeature {
  type: 'Feature';
  properties: { id: string; [k: string]: unknown };
  geometry: GeoPolygon | GeoMultiPolygon;
}
export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

/** Kinds of damageable static infrastructure; the index is the position in the matching array. */
export type InfraKind = 'city' | 'plant' | 'airport' | 'port' | 'road';

export interface WorldStatic {
  /** Identifies the dataset; saves made with another dataHash are rejected. */
  dataHash: string;
  countries: Country[];
  provinces: Province[];
  cities: City[];
  plants: PowerPlant[];
  airports: Airport[];
  ports: Port[];
  roads: RoadGraph;
  navGrid: NavGrid;
  elev: ElevGrid;
  stats: Record<CountryId, CountryStats>;
  military: Record<CountryId, MilitaryInventory>;
  alliances: AllianceData;
  countriesGeo: GeoFeatureCollection;
  provincesGeo: GeoFeatureCollection;

  // ---- indices (arrays hold indices into the dataset arrays) ----
  countryById: Map<CountryId, Country>;
  provinceById: Map<ProvinceId, Province>;
  provincesByCountry: Map<CountryId, ProvinceId[]>;
  citiesByProvince: Map<ProvinceId, number[]>;
  citiesByCountry: Map<CountryId, number[]>;
  plantsByProvince: Map<ProvinceId, number[]>;
  plantsByCountry: Map<CountryId, number[]>;
  airportsByProvince: Map<ProvinceId, number[]>;
  airportsByCountry: Map<CountryId, number[]>;
  portsByProvince: Map<ProvinceId, number[]>;
  portsByCountry: Map<CountryId, number[]>;

  // ---- spatial queries ----
  /** Province whose polygon contains the point, or null (sea / outside every polygon). */
  locateProvince(lon: number, lat: number): ProvinceId | null;
  /** Containing province, else the province whose border is nearest within `maxKm` (default 100). */
  nearestProvince(lon: number, lat: number, maxKm?: number): ProvinceId | null;
  /** Nearest road-graph node within `maxKm` (default 500), or null. */
  nearestRoadNode(lon: number, lat: number, maxKm?: number): number | null;
  isSea(lon: number, lat: number): boolean;
  /** Metres above sea level (bilinear on the 0.25° grid). */
  elevationAt(lon: number, lat: number): number;
  /** City index of the national capital (capital rank 2, else the most populous city), or null. */
  capitalCityOf(country: CountryId): number | null;
  /** Most populous city of a province, or null. */
  mainCityOf(province: ProvinceId): number | null;
}
