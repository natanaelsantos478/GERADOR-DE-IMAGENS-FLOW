/**
 * Ground height sampler for a z14 tile that reproduces the surface Cesium actually draws: the Terrarium tile of the
 * level is resampled to the same GRID x GRID heightmap as `globe/terrain.ts` and interpolated on the same two
 * triangles per cell. Sampling the 256 px tile directly differed from the drawn mesh by up to ~50 m on steep hills
 * (trees and buildings floating); this matches it to ~0.1 m. Lower levels (12, 11) give the surface Cesium draws when
 * the terrain under the tile is still coarse.
 */
import { loadElevTile, TILE_PX } from '../globe/elevTiles';
import { TERRAIN_GRID, terrainMaxLevel } from '../globe/terrain';
import { TZ, type TileRef } from './geo';

/** Finest terrain level (the city tiles use it for buildings, roads and bridges). */
export const groundLevel = () => terrainMaxLevel();
export type Ground = (x: number, y: number) => number;

const G = TERRAIN_GRID;
/** Same resampling as the terrain provider (pixel 0 / 255 on the tile edges, sea floor flattened to 0). */
function gridOf(src: Float32Array): Float32Array {
  const buf = new Float32Array(G * G), s = TILE_PX - 1;
  for (let j = 0; j < G; j++) {
    const fy = (j / (G - 1)) * s, y0 = Math.floor(fy), y1 = Math.min(s, y0 + 1), ty = fy - y0;
    for (let i = 0; i < G; i++) {
      const fx = (i / (G - 1)) * s, x0 = Math.floor(fx), x1 = Math.min(s, x0 + 1), tx = fx - x0;
      const h = src[y0 * TILE_PX + x0] * (1 - tx) * (1 - ty) + src[y0 * TILE_PX + x1] * tx * (1 - ty) + src[y1 * TILE_PX + x0] * (1 - tx) * ty + src[y1 * TILE_PX + x1] * tx * ty;
      buf[j * G + i] = h > 0 ? h : 0;
    }
  }
  return buf;
}

/** Sampler of the level-`z` terrain surface (z <= 13) in the local metres of tile `t`. */
export async function loadGround(t: TileRef, alive: () => boolean, z = groundLevel()): Promise<Ground | null> {
  const f = 2 ** (TZ - z), tx = t.x >> (TZ - z), ty = t.y >> (TZ - z);
  let src: Float32Array | undefined;
  for (let i = 0; i < 60 && !src && alive(); i++) {
    const p = loadElevTile(z, tx, ty);
    if (!p) { await new Promise((r) => setTimeout(r, 120)); continue; }
    try { src = await p; } catch { return null; }
  }
  if (!src) return null;
  const b = gridOf(src), k = t.sizeM, n1 = G - 1;
  return (x, y) => {
    // fractional position inside the level-z tile, then inside the heightmap grid
    const fx = Math.min(n1 - 1e-6, Math.max(0, ((t.x + 0.5 + x / k) / f - tx) * n1));
    const fy = Math.min(n1 - 1e-6, Math.max(0, ((t.y + 0.5 - y / k) / f - ty) * n1));
    const i = Math.min(n1 - 1, Math.floor(fx)), j = Math.min(n1 - 1, Math.floor(fy)), u = fx - i, w = fy - j;
    const h00 = b[j * G + i], h10 = b[j * G + i + 1], h01 = b[(j + 1) * G + i], h11 = b[(j + 1) * G + i + 1];
    // Cesium splits each heightmap cell along the (i+1, j) - (i, j+1) diagonal
    return u + w <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * w : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - w);
  };
}
