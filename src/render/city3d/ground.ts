/** Ground height sampler for a z14 tile from the same Terrarium z13 data the globe terrain uses. */
import { loadElevTile, TILE_PX } from '../globe/elevTiles';
import { TZ, type TileRef } from './geo';

const Z = 13;
export type Ground = (x: number, y: number) => number;

export async function loadGround(t: TileRef, alive: () => boolean): Promise<Ground | null> {
  const tx = t.x >> (TZ - Z), ty = t.y >> (TZ - Z);
  let src: Float32Array | undefined;
  for (let i = 0; i < 60 && !src && alive(); i++) {
    const p = loadElevTile(Z, tx, ty);
    if (!p) { await new Promise((r) => setTimeout(r, 120)); continue; }
    try { src = await p; } catch { return null; }
  }
  if (!src) return null;
  const s = src, k = t.sizeM, f = 2 ** (TZ - Z);
  return (x, y) => {
    // fractional z13 tile coordinates of this point
    const gx = (t.x + 0.5 + x / k) / f - tx, gy = (t.y + 0.5 - y / k) / f - ty;
    const px = Math.min(TILE_PX - 1.001, Math.max(0, gx * TILE_PX - 0.5)), py = Math.min(TILE_PX - 1.001, Math.max(0, gy * TILE_PX - 0.5));
    const ix = Math.floor(px), iy = Math.floor(py), a = px - ix, b = py - iy, i = iy * TILE_PX + ix;
    const h = (s[i] * (1 - a) + s[i + 1] * a) * (1 - b) + (s[i + TILE_PX] * (1 - a) + s[i + TILE_PX + 1] * a) * b;
    return h > 0 ? h : 0;
  };
}
