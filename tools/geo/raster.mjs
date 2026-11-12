// Land raster (0.05 deg) from NE land 10m and the 0.25 deg navigation grid with carved straits.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, polygonsOf, scanFill, toBase64, OUT } from './lib.mjs';

export const FW = 7200, FH = 3600;       // fine land raster 0.05 deg
export const NW = 1440, NH = 720;        // navgrid 0.25 deg

export function rasterizeLand(landPath) {
  const polys = [];
  for (const f of readJson(landPath).features) polys.push(...polygonsOf(f.geometry));
  const fine = new Uint8Array(FW * FH);
  scanFill(polys, FW, FH, (j, a, b) => fine.fill(1, j * FW + a, j * FW + b));
  return fine;
}

export const isLandFine = (fine, lon, lat) => {
  const i = Math.floor(((lon + 180) / 360) * FW), j = Math.floor(((90 - lat) / 180) * FH);
  if (j < 0 || j >= FH) return true;
  return fine[j * FW + ((i % FW) + FW) % FW] === 1;
};

/** Straits that a 0.25 deg majority raster would close. Waypoints are real channel axes [lon,lat]. */
export const CARVES = {
  gibraltar: [[-5.0, 36.05], [-5.6, 35.95], [-6.3, 36.1]],
  bosphorus: [[29.1, 41.3], [29.05, 41.05], [28.95, 40.95]],
  marmara: [[28.9, 40.95], [28.0, 40.75], [27.0, 40.5]],
  dardanelles: [[27.0, 40.5], [26.4, 40.2], [26.1, 40.0], [25.6, 40.0]],
  suez: [[32.32, 31.3], [32.35, 30.8], [32.4, 30.4], [32.5, 30.0], [32.6, 29.9], [32.75, 29.6], [32.9, 29.2]],
  panama: [[-79.9, 9.4], [-79.7, 9.15], [-79.55, 8.95], [-79.5, 8.75]],
  singapore: [[101.2, 2.9], [102.2, 2.2], [103.2, 1.4], [104.2, 1.2], [104.8, 1.4]],
  dover: [[-1.0, 50.3], [0.5, 50.6], [1.4, 51.0], [2.2, 51.4], [2.8, 52.0]],
  oresund: [[12.55, 56.2], [12.7, 55.8], [12.8, 55.4], [13.0, 55.1]],
  greatBelt: [[11.0, 56.4], [10.9, 55.8], [11.0, 55.3], [11.0, 54.9], [11.6, 54.7]],
  hormuz: [[56.6, 26.0], [56.4, 26.5], [55.6, 26.7], [54.5, 26.6]],
  babElMandeb: [[43.6, 12.4], [43.3, 12.7], [42.9, 13.1], [42.5, 13.9]],
};

export function buildNavgrid(fine) {
  const land = new Uint8Array(NW * NH);
  const k = FW / NW;
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    let c = 0;
    for (let y = 0; y < k; y++) { const o = (j * k + y) * FW + i * k; for (let x = 0; x < k; x++) c += fine[o + x]; }
    land[j * NW + i] = c >= (k * k) / 2 ? 1 : 0;
  }
  const carved = {};
  for (const [name, pts] of Object.entries(CARVES)) {
    let n = 0, pi = -1, pj = -1;
    const open = (i, j) => { const q = j * NW + (((i % NW) + NW) % NW); if (land[q]) { land[q] = 0; n++; } };
    for (let s = 0; s < pts.length - 1; s++) {
      const [x1, y1] = pts[s], [x2, y2] = pts[s + 1];
      const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 0.02);
      for (let t = 0; t <= steps; t++) {
        const x = x1 + ((x2 - x1) * t) / steps, y = y1 + ((y2 - y1) * t) / steps;
        const i = Math.floor((x + 180) / 0.25), j = Math.floor((90 - y) / 0.25);
        if (pi >= 0 && i !== pi && j !== pj) open(i, pj); // keep corridor 4-connected
        open(i, j); pi = i; pj = j;
      }
    }
    carved[name] = n;
  }
  return { land, carved };
}

export function navgridFile(land) {
  const bytes = new Uint8Array(Math.ceil((NW * NH) / 8));
  for (let q = 0; q < NW * NH; q++) if (!land[q]) bytes[q >> 3] |= 1 << (q & 7);
  return { w: NW, h: NH, res: 0.25, lon0: -180, lat0: 90, bitOrder: 'lsb-first, row-major from north-west', sea: toBase64(bytes) };
}

export function writeNavgrid(land) {
  fs.writeFileSync(path.join(OUT, 'navgrid.json'), JSON.stringify(navgridFile(land)));
}
