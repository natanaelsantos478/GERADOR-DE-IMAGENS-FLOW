// Elevation grid 0.25 deg from AWS Terrarium tiles (z=5), resampled by averaging.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { CACHE, OUT, toBase64 } from './lib.mjs';
import { FW, FH, NW, NH } from './raster.mjs';

const Z = 5, N = 1 << Z, T = 256;
const URL = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;

const tilePath = (x, y) => path.join(CACHE, 'terrarium', String(Z), String(x), `${y}.png`);
const execFileP = promisify(execFile);

async function ensureTile(x, y) {
  const f = tilePath(x, y);
  if (fs.existsSync(f)) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (let a = 0; ; a++) {
    try { await execFileP('curl', ['-fsSL', '--retry', '3', '-o', f + '.part', URL(x, y)]); fs.renameSync(f + '.part', f); return; }
    catch (e) { if (a >= 4) throw e; }
  }
}

async function fetchAllTiles() {
  const jobs = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) jobs.push([x, y]);
  let next = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (next < jobs.length) { const [x, y] = jobs[next++]; await ensureTile(x, y); }
  }));
}

const getTile = (x, y) => PNG.sync.read(fs.readFileSync(tilePath(x, y))).data;

/** Returns {mean: Int16Array(NW*NH) land-weighted mean m, std: Float32Array within-cell std dev}. */
export async function buildElev(fine) {
  await fetchAllTiles();
  const sum = new Float64Array(NW * NH), sq = new Float64Array(NW * NH), cnt = new Uint32Array(NW * NH);
  const sumA = new Float64Array(NW * NH), cntA = new Uint32Array(NW * NH);
  const P = N * T;
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const d = getTile(tx, ty);
    for (let py = 0; py < T; py++) {
      const Py = ty * T + py + 0.5;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * Py) / P))) * 180) / Math.PI;
      const j = Math.min(NH - 1, Math.floor((90 - lat) / 0.25));
      const fj = Math.min(FH - 1, Math.floor(((90 - lat) / 180) * FH));
      for (let px = 0; px < T; px++) {
        const lon = ((tx * T + px + 0.5) / P) * 360 - 180;
        const i = Math.min(NW - 1, Math.floor((lon + 180) / 0.25));
        const o = (py * T + px) * 4;
        const h = d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
        const q = j * NW + i;
        sumA[q] += h; cntA[q]++;
        if (fine[fj * FW + Math.min(FW - 1, Math.floor(((lon + 180) / 360) * FW))]) { sum[q] += h; sq[q] += h * h; cnt[q]++; }
      }
    }
  }
  const mean = new Int16Array(NW * NH), std = new Float32Array(NW * NH);
  for (let q = 0; q < NW * NH; q++) {
    if (cnt[q] > 0) {
      const m = sum[q] / cnt[q];
      mean[q] = Math.round(m);
      std[q] = Math.sqrt(Math.max(0, sq[q] / cnt[q] - m * m));
    } else if (cntA[q] > 0) mean[q] = Math.round(sumA[q] / cntA[q]); // open sea: bathymetry mean
    // rows beyond the Web-Mercator limit (|lat| > 85.05) stay 0
  }
  return { mean, std };
}

export function writeElev(mean) {
  fs.writeFileSync(path.join(OUT, 'elev.json'), JSON.stringify({
    w: NW, h: NH, res: 0.25, lon0: -180, lat0: 90, unit: 'm', encoding: 'Int16 little-endian base64, row-major from north-west',
    note: 'Land cells: mean of land samples; sea cells: mean bathymetry; |lat|>85.05 = 0 (outside Web Mercator tiles)',
    data: toBase64(mean),
  }));
}
