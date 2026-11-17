/** Serializable navigation raster (pure data, no IO): surface classes, building list and RLE/base64 codec. */

export const SURF = {
  FIELD: 0, WOOD: 1, ROCK: 2, SAND: 3, WETLAND: 4, URBAN: 5, BUILDING: 6, DEEP: 7, SHALLOW: 8, BRIDGE: 9, TUNNEL: 10,
  PATH: 11, MOTORWAY: 12, PRIMARY: 13, SECONDARY: 14, TERTIARY: 15, MINOR: 16, SERVICE: 17, TRACK: 18, RAIL: 19, FOOTBRIDGE: 20,
  SNOW: 21, SCRUB: 22, RUNWAY: 23, PIER: 24, STEPS: 25,
} as const;
export const SURF_NAMES = ['field', 'wood', 'rock', 'sand', 'wetland', 'urban', 'building', 'deep water', 'shallow water', 'bridge', 'tunnel', 'path', 'motorway', 'primary', 'secondary', 'tertiary', 'street', 'service', 'track', 'rail', 'footbridge', 'snow/ice', 'scrub', 'runway/apron', 'pier', 'steps'];
export const isRoadSurf = (s: number) => (s >= SURF.MOTORWAY && s <= SURF.SERVICE) || s === SURF.BRIDGE || s === SURF.TUNNEL;

export const ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps Foundation (inclui dados Microsoft e Google), ESA WorldCover, OpenFreeMap';
/** One infantry squad per this many m² of footprint. */
export const GARRISON_M2 = 300;

export interface NavBuilding {
  id: number;
  /** Simplified outer ring, flat [x,y,...] in local metres. */
  poly: number[];
  h: number; minH: number; area: number; cx: number; cy: number;
  enterable: boolean;
  /** Function (hospital, school, religious, military, police, ...) when the source says so. */
  kind?: string;
  /** Squads that fit (1 per GARRISON_M2). */
  cap: number;
}

/** Destructible / strategic structure (tower, substation, dam, ...). */
export interface NavInfra { id: number; kind: string; x: number; y: number; hp: number }
export interface NavPoi { x: number; y: number; kind: string }
export interface NavData {
  v: 1;
  sizeM: number;
  n: number;
  center: [number, number];
  /** RLE+base64 of the n*n Uint8 surface class (row-major from the SW cell). */
  surf: string;
  /** RLE+base64 of the n*n Uint16 building id (0 = none). */
  bld: string;
  /** Optional finer real-terrain heights (hn*hn, decimetres, Int16 RLE+base64, from the SW). */
  hn?: number;
  hgt?: string;
  /** RLE+base64 of the n*n Uint8 land-use code (see USE_RULES in terrainRules). */
  use: string;
  buildings: NavBuilding[];
  infra: NavInfra[];
  pois: NavPoi[];
  peaks: { x: number; y: number; ele?: number }[];
  attribution: string;
}

// ---------------------------------------------------------------- codec (varint pairs value,run)
const toB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

export function encodeRle(a: ArrayLike<number>, signed = false): string {
  const out: number[] = [];
  const put = (v: number) => { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); };
  const zz = (v: number) => (signed ? (v < 0 ? -2 * v - 1 : 2 * v) : v);
  let i = 0;
  while (i < a.length) { let j = i + 1; while (j < a.length && a[j] === a[i]) j++; put(zz(a[i])); put(j - i); i = j; }
  return toB64(Uint8Array.from(out));
}
export function decodeRle<T extends Uint8Array | Uint16Array | Int16Array>(s: string, len: number, ctor: new (n: number) => T, signed = false): T {
  const u = fromB64(s), r = new ctor(len);
  let p = 0, k = 0;
  const get = () => { let v = 0, m = 1, b: number; do { b = u[p++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
  while (p < u.length && k < len) {
    let v = get(); const run = get();
    if (signed) v = v & 1 ? -(v + 1) / 2 : v / 2;
    r.fill(v, k, k + run); k += run;
  }
  return r;
}
