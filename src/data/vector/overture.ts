/** Overture Maps (PMTiles over HTTP Range) adapter: reads only the tiles of the area and maps its schema to the neutral `VectorArea`. */
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { classify, USE_RULES } from '../../sim/tactical/terrainRules';
import { groupRings, note, tileConverter, tilesFor } from './area';
import type { TileStore } from './tiles';
import { emptyArea, type VectorArea, type VLine, type VPoly } from './types';

export type OvertureFile = 'buildings' | 'base' | 'transportation';
/** Zoom of each archive (data max zoom: buildings/transportation 14, base 13). */
export const OV_ZOOM: Record<OvertureFile, number> = { buildings: 14, transportation: 14, base: 13 };
export type OvertureReader = (file: OvertureFile, z: number, x: number, y: number) => Promise<Uint8Array | null>;
export const OVERTURE_FALLBACK_RELEASE = '2026-10-21.0';
const enc = new TextEncoder(), dec = new TextDecoder();

/** Latest release from the STAC catalog (cached); falls back to the last known one. Never throws. */
export async function discoverRelease(fetchFn: typeof fetch = (...a) => fetch(...a), store?: TileStore): Promise<string> {
  try {
    const r = await fetchFn('https://stac.overturemaps.org/catalog.json');
    const latest = r.ok ? ((await r.json()) as { latest?: string }).latest : undefined;
    if (latest && /^\d{4}-\d\d-\d\d(\.\d+)?$/.test(latest)) { await store?.put('meta/overture-release', enc.encode(latest)).catch(() => {}); return latest; }
  } catch { /* offline */ }
  const c = await store?.get('meta/overture-release').catch(() => null);
  return c ? dec.decode(c) : OVERTURE_FALLBACK_RELEASE;
}

/** HTTP Range source with an injectable fetch (the pmtiles FetchSource cannot be injected). */
function rangeSource(url: string, f: typeof fetch, headers?: Record<string, string>): Source {
  return {
    getKey: () => url,
    async getBytes(offset, length, signal): Promise<RangeResponse> {
      const r = await f(url, { signal, headers: { ...headers, Range: `bytes=${offset}-${offset + length - 1}` } });
      if (r.status === 416) throw new Error('range');
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.arrayBuffer();
      if (r.status === 200) return { data: data.slice(offset, offset + length) }; // server ignored Range
      return { data };
    },
  };
}

/** Default reader: PMTiles range reads (header + directories + only the tiles asked), with the tile bytes cached in `store`. */
export function pmtilesReader(o: { release?: string; store?: TileStore; fetchFn?: typeof fetch } = {}): OvertureReader {
  let rel: Promise<string> | null = null;
  const archives = new Map<string, PMTiles>();
  const headers = typeof window === 'undefined' ? { 'User-Agent': 'Meridiano-Game/1.0' } : undefined;
  return async (file, z, x, y) => {
    try {
      const release = await (rel ??= o.release ? Promise.resolve(o.release) : discoverRelease(o.fetchFn, o.store));
      const key = `ov/${release}/${file}/${z}/${x}/${y}`;
      const hit = await o.store?.get(key).catch(() => null);
      if (hit) return hit;
      const url = `https://tiles.overturemaps.org/${release}/${file}.pmtiles`;
      let pm = archives.get(url);
      if (!pm) { pm = new PMTiles(rangeSource(url, o.fetchFn ?? ((...a) => fetch(...a)), headers)); archives.set(url, pm); }
      const t = await pm.getZxy(z, x, y);
      const bytes = t ? new Uint8Array(t.data) : new Uint8Array(0);
      await o.store?.put(key, bytes).catch(() => {});
      return bytes;
    } catch { return null; }
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const json = (v: unknown): { value?: unknown; values?: string[]; between?: [number, number] }[] => { try { const r = JSON.parse(String(v)); return Array.isArray(r) ? r : []; } catch { return []; } };

/** Height of a building: real height, else floors x 3 m, else a typical value per class (documented defaults, in metres). */
export function buildingHeight(h: number | undefined, floors: number | undefined, cls?: string, subtype?: string): number {
  if (h && h > 0) return h;
  if (floors && floors > 0) return floors * 3;
  const c = cls ?? '', s = subtype ?? '';
  if (['shed', 'garage', 'garages', 'carport', 'kiosk', 'hut', 'cabin', 'greenhouse', 'barn', 'stable'].includes(c)) return 3.5;
  if (['house', 'detached', 'semidetached_house', 'bungalow', 'residential', 'terrace'].includes(c) || s === 'residential') return 6;
  if (['apartments', 'dormitory'].includes(c)) return 15;
  if (['commercial', 'office', 'retail', 'hotel', 'hospital', 'school', 'university', 'public', 'civic'].includes(c) || ['commercial', 'medical', 'education', 'civic'].includes(s)) return 12;
  if (['industrial', 'warehouse', 'factory', 'service'].includes(c) || s === 'industrial') return 8;
  return 7;
}

/** Cut [from,to] (0..1 along the length) out of a flat polyline. */
function sub(pts: number[], from: number, to: number): number[] {
  const n = pts.length / 2, L: number[] = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
  const tot = L[n - 1] || 1, a = from * tot, b = to * tot, out: number[] = [];
  const at = (d: number): [number, number] => { let i = 1; while (i < n - 1 && L[i] < d) i++; const t = L[i] > L[i - 1] ? (d - L[i - 1]) / (L[i] - L[i - 1]) : 0; return [pts[i * 2 - 2] + (pts[i * 2] - pts[i * 2 - 2]) * t, pts[i * 2 - 1] + (pts[i * 2 + 1] - pts[i * 2 - 1]) * t]; };
  out.push(...at(a));
  for (let i = 1; i < n - 1; i++) if (L[i] > a && L[i] < b) out.push(pts[i * 2], pts[i * 2 + 1]);
  out.push(...at(b));
  return out;
}

export function decodeOvertureTile(file: OvertureFile, bytes: Uint8Array, z: number, tx: number, ty: number, lon0: number, lat0: number, seen: Set<string>, out: VectorArea): void {
  if (!bytes.length) return;
  const vt = new VectorTile(new PbfReader(bytes));
  const conv = tileConverter(z, tx, ty, lon0, lat0);
  type F = { type: number; p: Record<string, unknown>; g: { x: number; y: number }[][]; ext: number };
  const each = (name: string, fn: (f: F) => void) => {
    const l = vt.layers[name];
    if (!l) return;
    for (let i = 0; i < l.length; i++) { const f = l.feature(i); fn({ type: f.type, p: f.properties as Record<string, unknown>, g: f.loadGeometry(), ext: l.extent }); }
  };
  const polys = (f: F) => (f.type === 3 ? groupRings(f.g.map((g) => conv(g, f.ext))) : []);
  const pt = (f: F): [number, number] => { const q = conv(f.g[0], f.ext); return [q[0], q[1]]; };
  if (file === 'buildings') each('building', (f) => {
    if (f.p.is_underground === true || f.p.is_underground === 'true') return;
    const cls = str(f.p.class), sub = str(f.p.subtype);
    note(out, 'ov', 'building', cls ?? '');
    const kind = (cls && classify('ov', 'bkind', cls)?.to) || (sub && classify('ov', 'bkind', sub)?.to) || undefined;
    const h = buildingHeight(num(f.p.height), num(f.p.num_floors), cls, sub);
    for (const rings of polys(f)) {
      const k = `${tx * f.ext + f.g[0][0].x}:${ty * f.ext + f.g[0][0].y}:${rings[0].length}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.buildings.push({ rings, cls: 'building', h, minH: 0, kind: kind || undefined });
    }
  });
  if (file === 'transportation') each('segment', (f) => {
    if (f.type !== 2) return;
    const sub0 = str(f.p.subtype) ?? '', cls0 = str(f.p.class) ?? '';
    const cls = note(out, 'ov', sub0 === 'rail' ? 'rail' : 'road', cls0 || sub0);
    if (!cls) return;
    const flags = json(f.p.road_flags).concat(json(f.p.rail_flags));
    const iv: { a: number; b: number; k: string }[] = [];
    for (const fl of flags) for (const v of fl.values ?? []) if (v === 'is_bridge' || v === 'is_tunnel') iv.push({ a: fl.between?.[0] ?? 0, b: fl.between?.[1] ?? 1, k: v === 'is_bridge' ? 'bridge' : 'tunnel' });
    iv.sort((p, q) => p.a - q.a);
    for (const g of f.g) {
      const pts = conv(g, f.ext);
      if (pts.length < 4) continue;
      let cur = 0;
      for (const v of iv) {
        if (v.a > cur + 1e-3) out.roads.push({ pts: sub(pts, cur, v.a), cls });
        out.roads.push({ pts: sub(pts, v.a, v.b), cls, brunnel: v.k });
        cur = Math.max(cur, v.b);
      }
      if (cur < 1 - 1e-3) out.roads.push({ pts: cur ? sub(pts, cur, 1) : pts, cls });
    }
  });
  if (file === 'base') {
    each('land_cover', (f) => {
      const c = note(out, 'ov', 'land_cover', str(f.p.subtype) ?? '');
      if (c) for (const rings of polys(f)) { if (c in USE_RULES) out.landuse.push({ rings, cls: c }); else out.landcover.push({ rings, cls: c }); }
    });
    each('land', (f) => {
      const c = note(out, 'ov', 'land', str(f.p.class) ?? '');
      if (!c) return;
      if (c === 'peak') { if (f.type === 1) { const [x, y] = pt(f); out.peaks.push({ x, y }); } return; }
      if (f.type === 3) for (const rings of polys(f)) out.landcover.push({ rings, cls: c });
    });
    each('land_use', (f) => { const c = note(out, 'ov', 'land_use', str(f.p.subtype) ?? ''); if (c) for (const rings of polys(f)) out.landuse.push({ rings, cls: c }); });
    each('infrastructure', (f) => {
      const c = note(out, 'ov', 'infra', str(f.p.class) ?? '');
      if (!c) return;
      const g = f.g[0];
      if (!g || !g.length) return;
      const q = conv(g, f.ext), n = q.length / 2;
      let x = 0, y = 0; for (let i = 0; i < n; i++) { x += q[i * 2]; y += q[i * 2 + 1]; }
      out.infra.push({ x: x / n, y: y / n, kind: c, cls: str(f.p.class) });
    });
    each('water', (f) => {
      const cl = str(f.p.class) ?? '';
      if (num(f.p.level) !== undefined && (num(f.p.level) as number) < 0) return;
      const c = note(out, 'ov', 'water', cl);
      if (!c) return;
      if (f.type === 3) for (const rings of polys(f)) out.water.push({ rings, cls: c });
      else if (f.type === 2) for (const g of f.g) out.waterways.push({ pts: conv(g, f.ext), cls: c === 'deep' ? (cl === 'canal' ? 'canal' : 'river') : c });
    });
  }
}

/** Load the area from Overture: buildings/transportation at z14 and base (cover, use, water) at z13. */
export async function loadOvertureArea(read: OvertureReader, bbox: { lon: number; lat: number; sizeM: number }): Promise<VectorArea | null> {
  const { lon, lat, sizeM } = bbox;
  const area = emptyArea(lon, lat, sizeM, 14);
  const seen = new Set<string>();
  const jobs: Promise<void>[] = [];
  for (const file of ['buildings', 'transportation', 'base'] as OvertureFile[]) {
    const z = OV_ZOOM[file], r = tilesFor(lon, lat, sizeM, z);
    if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 64) throw new Error('area too large');
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push(read(file, z, x, y).then((b) => { if (b) { area.tiles++; decodeOvertureTile(file, b, z, x, y, lon, lat, seen, area); } }));
  }
  await Promise.all(jobs);
  return area.tiles && (area.roads.length || area.buildings.length) ? area : null;
}
export type { VPoly, VLine };
