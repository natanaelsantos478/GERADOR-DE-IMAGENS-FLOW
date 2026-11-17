/** Vector tile sources behind one interface: Overture (primary), OpenFreeMap (backup), then the caller's procedural map. */
import { loadVectorArea } from './area';
import { loadOvertureArea, pmtilesReader, type OvertureReader } from './overture';
import { createTileSource, type TileStore } from './tiles';
import type { TileSource, VectorArea } from './types';

export interface Bbox { lon: number; lat: number; sizeM: number }
export interface VectorTileSource { id: 'overture' | 'openfreemap'; load(b: Bbox): Promise<VectorArea | null> }

export function overtureSource(o: { read?: OvertureReader; store?: TileStore; fetchFn?: typeof fetch; release?: string } = {}): VectorTileSource {
  const read = o.read ?? pmtilesReader(o);
  return { id: 'overture', load: (b) => loadOvertureArea(read, b) };
}
export function openFreeMapSource(o: { tiles?: TileSource; store?: TileStore; fetchFn?: typeof fetch; zoom?: number } = {}): VectorTileSource {
  const tiles = o.tiles ?? createTileSource({ store: o.store, fetchFn: o.fetchFn });
  return { id: 'openfreemap', load: (b) => loadVectorArea(tiles, b, o.zoom ?? 14) };
}

const KEYS = ['buildings', 'roads', 'water', 'waterways', 'landcover', 'landuse', 'aeroways'] as const;
/** Fill the categories `a` lacks with those of `b` (e.g. Overture roads + OpenFreeMap buildings when Overture has none). */
export function mergeAreas(a: VectorArea, b: VectorArea): VectorArea {
  const r = { ...a };
  for (const k of KEYS) if (!a[k].length && b[k].length) (r[k] as unknown[]) = b[k];
  return r;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> => new Promise((res) => { const t = setTimeout(() => res(null), ms); p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(null); }); });

/** Try the sources in order (each with a time budget); a failed/empty one falls to the next; null when all fail. */
export async function loadFromSources(sources: VectorTileSource[], b: Bbox, timeoutMs = 25_000): Promise<{ area: VectorArea; source: string } | null> {
  let best: { area: VectorArea; source: string } | null = null;
  for (const s of sources) {
    const a = await withTimeout(s.load(b), timeoutMs);
    if (!a) continue;
    if (!best) best = { area: a, source: s.id }; else best = { area: mergeAreas(best.area, a), source: `${best.source}+${s.id}` };
    if (KEYS.slice(0, 3).every((k) => best!.area[k].length)) break;
  }
  return best;
}
