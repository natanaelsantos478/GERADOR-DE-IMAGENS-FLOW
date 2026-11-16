/** Shared helpers: optional access to sibling APIs, per-world caches (never serialized), small utilities. */
import type {
  CountryId, Ctx, DiplomacyApi, EconomyApi, LonLat, ResearchApi, WorldDynApi, WorldStatic,
} from '../../core/contracts';
import { flattenRing, haversineKm } from '../../core/geo';
import type { Formation, MilitaryState } from './types';

export interface Apis3 {
  dip: DiplomacyApi | null;
  eco: EconomyApi | null;
  res: ResearchApi | null;
  wd: WorldDynApi;
  /** Per-entry-point (A is rebuilt on every hook/command) memo of diplomacy queries: access, hostility. */
  enter?: Map<CountryId, Map<CountryId, boolean>>;
  war?: Map<CountryId, Map<CountryId, boolean>>;
  mods?: Map<CountryId, Map<string, number>>;
}

/** Sibling systems may be absent (unit tests, partial builds): every use goes through these nullable handles. */
export function apisOf(ctx: Ctx): Apis3 {
  const g = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  return { dip: g(() => ctx.api.diplomacy), eco: g(() => ctx.api.economy), res: g(() => ctx.api.research), wd: ctx.api.worldDyn };
}

export interface LegGeo {
  rt: object;
  i: number;
  pts: LonLat[];
  cum: number[];
}

export interface Env {
  comp: Int32Array | null;
  nodeProv: Int32Array;
  cosLat: Float64Array | null;
  accStamp: Int32Array;
  accVal: Uint8Array;
  accN: number;
  provRings: Map<string, ChunkedRing[]> | null;
  /** Geometry of road legs by edge code (edge*2+direction), shared by every formation. */
  edgeLegs: Map<number, { pts: LonLat[]; cum: number[] }>;
  /** nearestRoadNode(…, 200) by 1e-4° position. */
  nrn: Map<number, number | null>;
  provIndex: Map<string, number>;
  seaCache: Map<string, number[]>;
  legs: Map<string, LegGeo>;
  /** Scratch caches rebuilt when the state object changes. */
  stateRef: MilitaryState | null;
  byCountry: Map<CountryId, Formation[]>;
  all: Formation[];
  /** `set` = countries in a war; `cands` = formations that may make contact (war countries + rebels + formations near rebels). */
  warring: { until: number; ver: number; set: Set<CountryId>; cands: Formation[] };
  byCountryVer: number;
  ver: number;
  powerCache: Map<CountryId, { day: number; v: number; ref: object }>;
}

const envs = new WeakMap<WorldStatic, Env>();
export function envOf(world: WorldStatic): Env {
  let e = envs.get(world);
  if (!e) {
    const provIndex = new Map<string, number>();
    world.provinces.forEach((p, i) => provIndex.set(p.id, i));
    e = {
      comp: null, nodeProv: new Int32Array(world.roads.nodeCount).fill(-2), cosLat: null, accStamp: new Int32Array(world.provinces.length), accVal: new Uint8Array(world.provinces.length), accN: 0, provRings: null, edgeLegs: new Map(), nrn: new Map(), provIndex, seaCache: new Map(), legs: new Map(),
      stateRef: null, byCountry: new Map(), all: [], warring: { until: -1, ver: -1, set: new Set(), cands: [] }, byCountryVer: -1, ver: 0, powerCache: new Map(),
    };
    envs.set(world, e);
  }
  return e;
}

/** Connected components of the road graph (computed once per world). */
export function roadComponents(world: WorldStatic): Int32Array {
  const env = envOf(world);
  if (env.comp) return env.comp;
  const g = world.roads;
  const parent = new Int32Array(g.nodeCount);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let e = 0; e < g.edgeCount; e++) parent[find(g.edgeA[e])] = find(g.edgeB[e]);
  const comp = new Int32Array(g.nodeCount);
  for (let i = 0; i < comp.length; i++) comp[i] = find(i);
  return (env.comp = comp);
}

export const nodeProvArr = (world: WorldStatic): Int32Array => envOf(world).nodeProv;

/** Province index of a road node (-1 outside every province). */
export function nodeProvince(world: WorldStatic, node: number): number {
  const env = envOf(world);
  let v = env.nodeProv[node];
  if (v === -2) {
    const id = world.nearestProvince(world.roads.nodeLon[node], world.roads.nodeLat[node], 25);
    v = id === null ? -1 : (env.provIndex.get(id) ?? -1);
    env.nodeProv[node] = v;
  }
  return v;
}

export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const r4 = (v: number) => Math.round(v * 10000) / 10000;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const dist = (a: LonLat, b: LonLat) => haversineKm(a[0], a[1], b[0], b[1]);

/** Hostility between two formations (rebels are hostile only to the government they rose against). */
export function hostile(A: Apis3, a: Formation, b: Formation): boolean {
  if (a.c === b.c) return false;
  if (a.reb || b.reb) return (a.reb ?? '') === b.c || (b.reb ?? '') === a.c;
  if (!A.dip) return false;
  const m = (A.war ??= new Map());
  let row = m.get(a.c);
  if (!row) m.set(a.c, (row = new Map()));
  let v = row.get(b.c);
  if (v === undefined) row.set(b.c, (v = A.dip.atWar(a.c, b.c)));
  return v;
}

/** May country `c` move through territory controlled by `ctl`? */
export function mayEnter(A: Apis3, c: CountryId, ctl: CountryId): boolean {
  if (c === ctl) return true;
  if (!A.dip) return false;
  const m = (A.enter ??= new Map());
  let row = m.get(c);
  if (!row) m.set(c, (row = new Map()));
  let v = row.get(ctl);
  if (v === undefined) row.set(ctl, (v = A.dip.access(c, ctl)));
  return v;
}

/** Research multiplier (1 without research system). */
export function mod(A: Apis3, c: CountryId, key: string): number {
  if (!A.res) return 1;
  const m = (A.mods ??= new Map());
  let row = m.get(c);
  if (!row) m.set(c, (row = new Map()));
  let v = row.get(key);
  if (v === undefined) row.set(key, (v = A.res.mod(c, key)));
  return v;
}

/** Unit availability: baseline units always, others need `unit.<id>` unlocked (all allowed without research system). */
export const unitUnlocked = (A: Apis3, c: CountryId, t: string): boolean => (A.res ? A.res.unlocked(c, `unit.${t}`) : true);


/** A flat lon/lat ring with the bbox of each CH-vertex chunk, to prune ray-casts. */
interface ChunkedRing {
  r: Float64Array;
  cb: Float64Array; // [minX, minY, maxX, maxY] per chunk
}
const CH = 32;
function chunked(r: Float64Array): ChunkedRing {
  const n = r.length / 2, nc = Math.ceil(n / CH), cb = new Float64Array(nc * 4);
  for (let c = 0; c < nc; c++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    // vertex c*CH-1 belongs too: the edge (c*CH-1 → c*CH) is scanned with this chunk.
    for (let i = Math.max(0, c * CH - 1); i < Math.min(n, (c + 1) * CH); i++) {
      const x = r[2 * i], y = r[2 * i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    cb[4 * c] = x0; cb[4 * c + 1] = y0; cb[4 * c + 2] = x1; cb[4 * c + 3] = y1;
  }
  return { r, cb };
}

/** Even-odd ray-cast over all rings of a province, skipping chunks that cannot be crossed by a +x ray. */
function insideProvince(rings: ChunkedRing[], lon: number, lat: number): boolean {
  let inside = false;
  for (const { r, cb } of rings) {
    const n = r.length / 2, nc = cb.length / 4;
    for (let c = 0; c < nc; c++) {
      if (lat > cb[4 * c + 3] || lat < cb[4 * c + 1] || lon > cb[4 * c + 2]) continue;
      for (let i = Math.max(1, c * CH), e = Math.min(n, (c + 1) * CH); i < e; i++) {
        const ay = r[2 * i - 1], by = r[2 * i + 1];
        if (ay > lat === by > lat) continue;
        const ax = r[2 * i - 2], bx = r[2 * i];
        if (lon < ax + ((lat - ay) / (by - ay)) * (bx - ax)) inside = !inside;
      }
    }
  }
  return inside;
}

function provRingsOf(world: WorldStatic): Map<string, ChunkedRing[]> {
  const env = envOf(world);
  if (!env.provRings) {
    env.provRings = new Map();
    for (const ft of world.provincesGeo.features) {
      const g = ft.geometry, id = ft.properties?.id;
      if (!g || typeof id !== 'string') continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      env.provRings.set(id, polys.flatMap((poly) => poly.map((r) => chunked(flattenRing(r)))));
    }
  }
  return env.provRings;
}

/** `locateProvince` for a formation: confirms it is still inside its current province with a pruned ray-cast (cheap) before falling back to the polygon index. */
export function locateMoving(world: WorldStatic, hint: string | null, lon: number, lat: number): string | null {
  if (hint) {
    const rings = provRingsOf(world).get(hint);
    if (rings && insideProvince(rings, lon, lat)) return hint;
  }
  return world.locateProvince(lon, lat);
}

/** Fills the lazy road-node → province table once (≈0.25 s), so the first big war does not stall a game day on it. */
export function warmRoadProvinces(world: WorldStatic): void {
  provRingsOf(world);
  roadComponents(world);
  const env = envOf(world);
  if (env.nodeProv.length && env.nodeProv[env.nodeProv.length - 1] !== -2) return;
  for (let n = 0; n < env.nodeProv.length; n++) nodeProvince(world, n);
}

/** `world.nearestRoadNode(lon, lat, 200)`, memoized per 1e-4° position (formations and orders repeat the same points). */
export function nearestRoadNode200(world: WorldStatic, lon: number, lat: number): number | null {
  const c = envOf(world).nrn;
  const k = (Math.round(lon * 1e4) + 1_800_000) * 2_000_000 + Math.round(lat * 1e4) + 900_000;
  let v = c.get(k);
  if (v === undefined) {
    v = world.nearestRoadNode(lon, lat, 200);
    if (c.size > 200_000) c.clear();
    c.set(k, v);
  }
  return v;
}
