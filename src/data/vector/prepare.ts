/** Async preparation of the real vector map for a tactical battle (call before `tac.start`). Never throws: null = use the procedural map. */
import type { NavData } from './nav';
import { rasterizeNav } from './rasterize';
import { loadFromSources, openFreeMapSource, overtureSource, type VectorTileSource } from './source';
import { idbStore } from './tiles';

export interface PrepareOptions {
  sizeM?: number; cell?: number;
  /** Real terrain heights (hn*hn from the SW cell) for slopes, e.g. `sampleGrid(lon, lat, sizeM, hn)` of render/tactical/terrain.ts. */
  heights?: number[]; hn?: number;
  /** Injected sources in priority order (tests, offline). Default: Overture PMTiles, then OpenFreeMap, both cached in IndexedDB. */
  sources?: VectorTileSource[];
  fetchFn?: typeof fetch;
  /** Time budget per source (ms); beyond it the next source / procedural map is used. */
  timeoutMs?: number;
}
let shared: VectorTileSource[] | null = null;

/**
 * Download (cached) the z14 MVT tiles around lon/lat and rasterise them. Result goes into
 * `buildMapFromWorld(world, lon, lat, { heights, vectorArea })` (or the map provider's MapOptions).
 */
export async function prepareTacticalVector(lon: number, lat: number, o: PrepareOptions = {}): Promise<NavData | null> {
  try {
    const store = idbStore();
    const srcs = o.sources ?? (o.fetchFn ? [overtureSource({ store, fetchFn: o.fetchFn }), openFreeMapSource({ store, fetchFn: o.fetchFn })] : (shared ??= [overtureSource({ store }), openFreeMapSource({ store })]));
    const sizeM = o.sizeM ?? 8000;
    const got = await loadFromSources(srcs, { lon, lat, sizeM }, o.timeoutMs);
    if (!got) return null;
    return rasterizeNav(got.area, { sizeM, cell: o.cell, heights: o.heights, hn: o.hn });
  } catch { return null; }
}
