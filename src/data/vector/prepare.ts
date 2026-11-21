/** Async preparation of the real vector map for a tactical battle (call before `tac.start`). Never throws: null = use the procedural map. */
import type { NavData } from './nav';
import { rasterizeNav } from './rasterize';
import { loadFromSources, openFreeMapSource, overtureSource, type VectorTileSource } from './source';
import { idbStore } from './tiles';
import { TAC_SIZE_M } from '../../sim/tactical/mapWorld';

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
    const sizeM = o.sizeM ?? TAC_SIZE_M;
    const got = await loadFromSources(srcs, { lon, lat, sizeM }, o.timeoutMs);
    if (!got) return null;
    return rasterizeNav(got.area, { sizeM, cell: o.cell, heights: o.heights, hn: o.hn });
  } catch { return null; }
}

let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, (nav: NavData | null) => void>();
/**
 * Same as prepareTacticalVector, in a Web Worker when the platform has them: decoding a 10 km city (tens of thousands of
 * buildings) takes seconds and briefly hundreds of MB, which must not freeze or bloat the page. Plain data options only.
 */
export function prepareTacticalVectorOffThread(lon: number, lat: number, o: Omit<PrepareOptions, 'sources' | 'fetchFn'> = {}): Promise<NavData | null> {
  if (typeof Worker === 'undefined') return prepareTacticalVector(lon, lat, o);
  try {
    worker ??= (() => {
      const w = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; nav: NavData | null }>) => { waiting.get(e.data.id)?.(e.data.nav); waiting.delete(e.data.id); };
      return w;
    })();
  } catch { return prepareTacticalVector(lon, lat, o); }
  const id = ++seq;
  return new Promise((ok) => { waiting.set(id, ok); worker!.postMessage({ id, lon, lat, o }); });
}
