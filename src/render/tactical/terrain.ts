/** Real terrain heights for the tactical grid, sampled from the same Terrarium tiles the globe uses (z13 ≈ 19 m/px). */
import { loadElevTile, TILE_PX } from '../globe/elevTiles';
import { M_PER_DEG } from '../units/common';

const Z = 13;
const tileOf = (lon: number, lat: number) => {
  const n = 2 ** Z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
};

/** Heights (n*n, row-major from the south-west cell centre) around `lon/lat`, or null when tiles are unreachable. */
export async function sampleGrid(lon: number, lat: number, sizeM = 8000, n = 64): Promise<number[] | null> {
  const cs = sizeM / n, mPerLon = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const pts: { lo: number; la: number }[] = [];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) pts.push({ lo: lon + ((cx + 0.5) * cs - sizeM / 2) / mPerLon, la: lat + ((cy + 0.5) * cs - sizeM / 2) / M_PER_DEG });
  const need = new Map<string, [number, number]>();
  for (const p of pts) { const t = tileOf(p.lo, p.la); const k = `${Math.floor(t.x)}/${Math.floor(t.y)}`; need.set(k, [Math.floor(t.x), Math.floor(t.y)]); }
  const tiles = new Map<string, Float32Array>();
  try {
    await Promise.all([...need].map(async ([k, [x, y]]) => {
      let tries = 0, r: Float32Array | undefined;
      while (!r && tries++ < 40) {
        const p = loadElevTile(Z, x, y);
        if (p) r = await p; else await new Promise((res) => setTimeout(res, 150));
      }
      if (!r) throw new Error('tile');
      tiles.set(k, r);
    }));
  } catch { return null; }
  const at = (tx: number, ty: number) => {
    const t = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
    if (!t) return 0;
    const px = Math.min(TILE_PX - 1, Math.floor((tx - Math.floor(tx)) * TILE_PX)), py = Math.min(TILE_PX - 1, Math.floor((ty - Math.floor(ty)) * TILE_PX));
    return t[py * TILE_PX + px];
  };
  return pts.map((p) => { const t = tileOf(p.lo, p.la); return Math.max(0, Math.round(at(t.x, t.y) * 10) / 10); });
}
