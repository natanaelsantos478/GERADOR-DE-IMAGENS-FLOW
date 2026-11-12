// Preview PNG: provinces coloured by country colour, country borders dark, province borders light.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { OUT, CACHE, readJson, polygonsOf, scanFill } from './lib.mjs';

const W = 2880, H = 1440;
const countries = readJson(path.join(OUT, 'countries.json'));
const provinces = readJson(path.join(OUT, 'provinces.json'));
const geo = readJson(path.join(OUT, 'provinces.geo.json'));
const cIdx = new Map(countries.map((c, i) => [c.id, i]));
const pCountry = new Map(provinces.map((p) => [p.id, cIdx.get(p.countryId)]));
const area = new Map(provinces.map((p) => [p.id, p.areaKm2]));
const order = geo.features.map((f, i) => i).sort((a, b) => area.get(geo.features[b].properties.id) - area.get(geo.features[a].properties.id));
const lab = new Int32Array(W * H).fill(-1);
for (const i of order) scanFill(polygonsOf(geo.features[i].geometry), W, H, (j, a, b) => lab.fill(i, j * W + a, j * W + b));
const png = new PNG({ width: W, height: H });
for (let q = 0; q < W * H; q++) {
  const l = lab[q], o = q * 4;
  let c = [18, 38, 64];
  if (l >= 0) {
    c = countries[pCountry.get(geo.features[l].properties.id)].color;
    const r = q % W < W - 1 ? lab[q + 1] : l, d = q + W < W * H ? lab[q + W] : l;
    const diff = (n) => n >= 0 && n !== l;
    if (diff(r) || diff(d)) {
      const cn = (n) => pCountry.get(geo.features[n].properties.id) !== pCountry.get(geo.features[l].properties.id);
      c = (diff(r) && cn(r)) || (diff(d) && cn(d)) ? [30, 30, 30] : c.map((v) => Math.min(255, v + 45));
    }
  }
  png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
}
const out = path.join(CACHE, 'geo-preview.png');
fs.writeFileSync(out, PNG.sync.write(png));
console.log('preview ->', out);
