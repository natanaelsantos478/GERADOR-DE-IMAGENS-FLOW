/** Loads the committed real-data fixtures (OpenFreeMap z14 tiles + Terrarium heights) for tests and tools. Node only. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { loadOvertureArea, type OvertureReader } from './overture';
import { openFreeMapSource } from './source';
import type { NavData } from './nav';
import { rasterizeNav } from './rasterize';
import type { TileSource, VectorArea } from './types';

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export type FixtureName = 'rio' | 'paris' | 'rural' | 'alpes';
export type FixtureSource = 'overture' | 'ofm';
export interface Fixture { name: FixtureName; source: FixtureSource; lon: number; lat: number; sizeM: number; hn: number; heights: number[]; heights64: number[]; area: VectorArea; nav: NavData }

export const fixtureSource = (name: string): TileSource => ({
  async get(z, x, y) {
    try { return new Uint8Array(gunzipSync(readFileSync(path.join(FIXTURE_DIR, name, 'ofm', `${z}-${x}-${y}.pbf.gz`)))); } catch { return null; }
  },
});

export const fixtureOvertureReader = (name: string): OvertureReader => async (file, z, x, y) => {
  try { return new Uint8Array(gunzipSync(readFileSync(path.join(FIXTURE_DIR, name, 'ov', `${file}-${z}-${x}-${y}.pbf.gz`)))); } catch { return null; }
};

/** Bilinear resample of a square height grid (row-major from the SW). */
export function resample(h: number[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < to; j++) for (let i = 0; i < to; i++) {
    const fx = Math.min(from - 1.001, Math.max(0, ((i + 0.5) * from) / to - 0.5)), fy = Math.min(from - 1.001, Math.max(0, ((j + 0.5) * from) / to - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, k = y0 * from + x0;
    out.push(Math.round(((h[k] * (1 - tx) + h[k + 1] * tx) * (1 - ty) + (h[k + from] * (1 - tx) + h[k + from + 1] * tx) * ty) * 10) / 10);
  }
  return out;
}

const cache = new Map<string, Promise<Fixture>>();
export function loadFixture(name: FixtureName, source: FixtureSource = 'overture', cell = 16): Promise<Fixture> {
  const k = `${name}:${source}:${cell}`;
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      const meta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, name, 'area.json'), 'utf8')) as { lon: number; lat: number; sizeM: number; zoom: number; hn: number; heights: number[] };
      const bb = { lon: meta.lon, lat: meta.lat, sizeM: meta.sizeM };
      const area = source === 'overture' ? await loadOvertureArea(fixtureOvertureReader(name), bb) : await openFreeMapSource({ tiles: fixtureSource(name) }).load(bb);
      if (!area) throw new Error(`fixture ${name} has no tiles`);
      const nav = rasterizeNav(area, { sizeM: meta.sizeM, cell, heights: meta.heights, hn: meta.hn });
      return { name, source, lon: meta.lon, lat: meta.lat, sizeM: meta.sizeM, hn: meta.hn, heights: meta.heights, heights64: resample(meta.heights, meta.hn, 64), area, nav };
    })();
    cache.set(k, p);
  }
  return p;
}
