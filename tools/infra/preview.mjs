// Renders tools/.cache/infra-preview.png: roads by class + plants by fuel + airports/ports.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { OUT, RAW } from './util.mjs';

const W = 3600, LAT_N = 84, LAT_S = -58, H = Math.round((W / 360) * (LAT_N - LAT_S));
const png = new PNG({ width: W, height: H });
const px = (lon, lat) => [((lon + 180) / 360) * W, ((LAT_N - lat) / (LAT_N - LAT_S)) * H];
for (let i = 0; i < W * H; i++) { png.data[i * 4] = 12; png.data[i * 4 + 1] = 16; png.data[i * 4 + 2] = 24; png.data[i * 4 + 3] = 255; }
function dot(x, y, c, r = 0) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const o = (yy * W + xx) * 4; png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2];
  }
}
function line(x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    dot(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
const rd = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f)));
const roads = rd('roads.json');
const CLS = [[255, 214, 10], [255, 140, 40], [120, 150, 190], [70, 200, 120], [60, 170, 255]];
const E = roads.edges, g = roads.geom;
// draw weakest classes first so important ones stay on top
for (const cls of [2, 3, 4, 1, 0]) {
  for (let i = 0; i < E.a.length; i++) {
    if (E.cls[i] !== cls) continue;
    let prev = null;
    for (let k = 0; k < E.geomLen[i]; k++) {
      const p = px(g[2 * (E.geomStart[i] + k)], g[2 * (E.geomStart[i] + k) + 1]);
      if (prev) line(prev[0], prev[1], p[0], p[1], CLS[cls]);
      prev = p;
    }
  }
}
const FUEL = { coal: [90, 90, 90], gas: [255, 130, 0], oil: [140, 70, 20], nuclear: [255, 0, 255], hydro: [0, 110, 255], wind: [0, 255, 255], solar: [255, 255, 80], biomass: [120, 220, 60], geothermal: [255, 60, 60], other: [200, 200, 200] };
const pp = rd('powerplants.json');
const order = Object.keys(FUEL);
const idx = [...Array(pp.n).keys()].sort((a, b) => order.indexOf(pp.cols.fuel[a]) - order.indexOf(pp.cols.fuel[b]));
for (const i of idx) {
  const [x, y] = px(pp.cols.lon[i], pp.cols.lat[i]);
  dot(x, y, FUEL[pp.cols.fuel[i]], pp.cols.mw[i] > 1000 ? 2 : 0);
}
const ap = rd('airports.json');
for (let i = 0; i < ap.n; i++) { const [x, y] = px(ap.cols.lon[i], ap.cols.lat[i]); dot(x, y, [255, 255, 255], 1); }
const pt = rd('ports.json');
for (let i = 0; i < pt.n; i++) { const [x, y] = px(pt.cols.lon[i], pt.cols.lat[i]); dot(x, y, [255, 80, 160], 1); }
const out = path.resolve(RAW, '../infra-preview.png');
fs.writeFileSync(out, PNG.sync.write(png));
console.log('preview:', out);
