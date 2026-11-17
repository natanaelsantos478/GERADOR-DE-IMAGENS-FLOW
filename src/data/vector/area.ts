/** Decode OpenMapTiles MVT tiles and merge them into typed local-metre geometry for a square area. */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { classify } from '../../sim/tactical/terrainRules';
import { emptyArea, type TileSource, type VectorArea } from './types';

const R = 6378137;
export const tileXY = (lon: number, lat: number, z: number): [number, number] => {
  const n = 2 ** z;
  return [((lon + 180) / 360) * n, ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n];
};
/** Tiles (x0..x1, y0..y1) covering a square of `sizeM` around lon/lat. */
export function tilesFor(lon: number, lat: number, sizeM: number, z: number) {
  const mPerLon = (Math.PI / 180) * R * Math.cos((lat * Math.PI) / 180), mPerLat = (Math.PI / 180) * R;
  const [xa, ya] = tileXY(lon - sizeM / 2 / mPerLon, lat + sizeM / 2 / mPerLat, z), [xb, yb] = tileXY(lon + sizeM / 2 / mPerLon, lat - sizeM / 2 / mPerLat, z);
  return { x0: Math.floor(xa), x1: Math.floor(xb), y0: Math.floor(ya), y1: Math.floor(yb) };
}

const area2 = (r: number[]) => { let a = 0; for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1]; return a / 2; };

/** Group rings into polygons: a ring with the sign of the first one starts a polygon, the opposite sign is a hole. */
export function groupRings(rings: number[][]): number[][][] {
  const out: number[][][] = [];
  let sign = 0;
  for (const r of rings) {
    const a = area2(r);
    if (a === 0) continue;
    if (!sign) sign = Math.sign(a);
    if (Math.sign(a) === sign || !out.length) out.push([r]); else out[out.length - 1].push(r);
  }
  return out;
}

/** Tile-local integer coords -> local metres (x east, y north) around lon0/lat0. */
export function tileConverter(z: number, tx: number, ty: number, lon0: number, lat0: number) {
  const [gx0, gy0] = tileXY(lon0, lat0, z);
  const mPerTile = (2 * Math.PI * R * Math.cos((lat0 * Math.PI) / 180)) / 2 ** z;
  return (g: { x: number; y: number }[], ext: number): number[] => {
    const r = new Array<number>(g.length * 2);
    for (let i = 0; i < g.length; i++) { r[i * 2] = (tx + g[i].x / ext - gx0) * mPerTile; r[i * 2 + 1] = -((ty + g[i].y / ext - gy0) * mPerTile); }
    return r;
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** Count a source class and map it through the rule table; undefined when it must be skipped (ignored or unknown). */
export function note(out: VectorArea, src: 'ov' | 'omt', layer: string, cls: string): string | undefined {
  const key = `${src}:${layer}:${cls}`;
  out.seen[key] = (out.seen[key] ?? 0) + 1;
  const r = classify(src, layer, cls);
  if (!r) { if (!out.unmapped.includes(key)) out.unmapped.push(key); return undefined; }
  return r.ignore ? undefined : r.to;
}
const centroid = (r: number[]): [number, number] => { let x = 0, y = 0; const n = r.length / 2; for (let i = 0; i < n; i++) { x += r[i * 2]; y += r[i * 2 + 1]; } return [x / n, y / n]; };

/** Decode one OpenMapTiles tile into `out`; `seen` dedupes buildings repeated by the tile buffer of neighbouring tiles. */
export function decodeTile(bytes: Uint8Array, z: number, tx: number, ty: number, lon0: number, lat0: number, seen: Set<string>, out: VectorArea): void {
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
  each('building', (f) => {
    const h = num(f.p.render_height), minH = num(f.p.render_min_height);
    for (const rings of polys(f)) {
      const k = `${tx * f.ext + f.g[0][0].x}:${ty * f.ext + f.g[0][0].y}:${rings[0].length}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.buildings.push({ rings, cls: 'building', h, minH });
    }
  });
  each('water', (f) => { const c = note(out, 'omt', 'water', str(f.p.class) ?? ''); if (c) for (const rings of polys(f)) out.water.push({ rings, cls: c }); });
  each('landcover', (f) => { const c = note(out, 'omt', 'landcover', str(f.p.class) ?? ''); if (c) for (const rings of polys(f)) out.landcover.push({ rings, cls: c }); });
  each('landuse', (f) => { const c = note(out, 'omt', 'landuse', str(f.p.class) ?? ''); if (c) for (const rings of polys(f)) out.landuse.push({ rings, cls: c }); });
  each('transportation', (f) => {
    const c = note(out, 'omt', 'road', str(f.p.class) ?? '');
    if (!c) return;
    if (f.type === 3) { if (c === 'pier') for (const rings of polys(f)) out.landuse.push({ rings, cls: 'port' }); return; }
    if (f.type === 2) for (const g of f.g) out.roads.push({ pts: conv(g, f.ext), cls: c === 'path' && str(f.p.subclass) === 'steps' ? 'steps' : c === 'path' && str(f.p.subclass) === 'bridleway' ? 'track' : c, brunnel: str(f.p.brunnel), surface: str(f.p.surface) });
  });
  each('waterway', (f) => { const c = note(out, 'omt', 'waterway', str(f.p.class) ?? ''); if (c && f.type === 2) for (const g of f.g) out.waterways.push({ pts: conv(g, f.ext), cls: c, brunnel: str(f.p.brunnel) }); });
  each('aeroway', (f) => {
    const c = note(out, 'omt', 'aeroway', str(f.p.class) ?? '');
    if (!c) return;
    if (f.type === 2) for (const g of f.g) out.aeroways.push({ pts: conv(g, f.ext), cls: c });
    else for (const rings of polys(f)) out.landuse.push({ rings, cls: 'airport' });
  });
  each('mountain_peak', (f) => { const c = note(out, 'omt', 'peak', str(f.p.class) ?? ''); if (c && f.type === 1) { const [x, y] = pt(f); out.peaks.push({ x, y, ele: num(f.p.ele) }); } });
  each('poi', (f) => {
    const sub = str(f.p.subclass) ?? '', cls = str(f.p.class) ?? '';
    const c = note(out, 'omt', 'poi', sub || cls);
    if (c && f.type === 1) { const [x, y] = pt(f); out.pois.push({ x, y, kind: c }); }
  });
}

/** Download/merge the tiles covering the square and return typed geometry (local metres). Missing tiles are skipped; `tiles` counts those obtained. */
export async function loadVectorArea(src: TileSource, bbox: { lon: number; lat: number; sizeM: number }, zoom = 14): Promise<VectorArea | null> {
  const { lon, lat, sizeM } = bbox;
  const r = tilesFor(lon, lat, sizeM, zoom);
  if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 64) throw new Error('area too large for the zoom');
  const jobs: Promise<{ x: number; y: number; b: Uint8Array | null }>[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push(src.get(zoom, x, y).then((b) => ({ x, y, b })));
  const got = await Promise.all(jobs);
  const ok = got.filter((t) => t.b);
  if (!ok.length) return null;
  const a = emptyArea(lon, lat, sizeM, zoom);
  a.tiles = ok.length;
  const seen = new Set<string>();
  for (const t of ok) {
    decodeTile(t.b!, zoom, t.x, t.y, lon, lat, seen, a);
  }
  return a;
}
