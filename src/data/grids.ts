/** navgrid.json and elev.json → NavGrid / ElevGrid (0.25° equirectangular, row 0 = north). */
import type { ElevGrid, GlobalGrid, LonLat, NavGrid } from '../core/world-types';
import { base64ToBytes, base64ToInt16, DataFormatError } from './decode';

function gridBase(w: number, h: number): GlobalGrid {
  const cellDeg = 360 / w;
  if (Math.abs(180 / h - cellDeg) > 1e-9) throw new Error(`grade ${w}×${h} não é equirretangular global`);
  return {
    w,
    h,
    cellDeg,
    cellOf(lon: number, lat: number): [number, number] {
      let x = Math.floor((lon + 180) / cellDeg) % w;
      if (x < 0) x += w;
      let y = Math.floor((90 - lat) / cellDeg);
      y = y < 0 ? 0 : y >= h ? h - 1 : y;
      return [x, y];
    },
    cellCenter(x: number, y: number): LonLat {
      return [-180 + (x + 0.5) * cellDeg, 90 - (y + 0.5) * cellDeg];
    },
  };
}

export function buildNavGrid(json: unknown): NavGrid {
  const j = json as { w?: number; h?: number; sea?: string } | null;
  if (!j || typeof j.w !== 'number' || typeof j.h !== 'number' || typeof j.sea !== 'string')
    throw new DataFormatError('navgrid.json', 'esperado { w, h, sea: base64 }');
  const sea = base64ToBytes(j.sea);
  if (sea.length < Math.ceil((j.w * j.h) / 8)) throw new DataFormatError('navgrid.json', `bitset curto (${sea.length} bytes)`);
  const g = gridBase(j.w, j.h);
  const w = j.w;
  const isSeaCell = (x: number, y: number) => {
    const i = y * w + x;
    return ((sea[i >> 3] >> (i & 7)) & 1) === 1;
  };
  return { ...g, sea, isSeaCell };
}

export function buildElevGrid(json: unknown): ElevGrid {
  const j = json as { w?: number; h?: number; [k: string]: unknown } | null;
  const b64 = j && (['data', 'elev', 'b64', 'values'].map((k) => j[k]).find((v) => typeof v === 'string') as string | undefined);
  if (!j || typeof j.w !== 'number' || typeof j.h !== 'number' || !b64)
    throw new DataFormatError('elev.json', 'esperado { w, h, data: base64 Int16 }');
  const data = base64ToInt16(b64);
  if (data.length !== j.w * j.h) throw new DataFormatError('elev.json', `esperados ${j.w * j.h} valores, há ${data.length}`);
  const g = gridBase(j.w, j.h);
  const { w, h, cellDeg } = g;
  const sample = (x: number, y: number) => {
    x = ((x % w) + w) % w;
    y = y < 0 ? 0 : y >= h ? h - 1 : y;
    return data[y * w + x];
  };
  return {
    ...g,
    data,
    at(lon: number, lat: number) {
      // Cell centres sit at half-cell offsets.
      const fx = (lon + 180) / cellDeg - 0.5;
      const fy = (90 - lat) / cellDeg - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const a = sample(x0, y0), b = sample(x0 + 1, y0), c = sample(x0, y0 + 1), d = sample(x0 + 1, y0 + 1);
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    },
  };
}
