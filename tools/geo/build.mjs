// Orchestrator: node geo/build.mjs  (npm run data:geo)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OUT, CACHE, ROOT, readJson } from './lib.mjs';
import { fetchAll } from './fetch.mjs';
import { rasterizeLand, buildNavgrid, writeNavgrid } from './raster.mjs';
import { buildElev, writeElev } from './elev.mjs';
import { buildAdmin } from './admin.mjs';
import { writeSources } from './sources.mjs';

fs.mkdirSync(path.join(OUT, 'flags'), { recursive: true });
const t0 = Date.now();
console.log('[1/6] natural earth');
const paths = await fetchAll();
console.log('[2/6] land raster + navgrid');
const fine = rasterizeLand(paths('ne_10m_land'));
const { land, carved } = buildNavgrid(fine);
writeNavgrid(land);
console.log('  carved cells:', JSON.stringify(carved));
console.log('[3/6] elevation (terrarium z5)');
const elev = await buildElev(fine);
writeElev(elev.mean);
console.log('[4/6] countries / provinces / cities');
const res = buildAdmin({ paths, fine, elev });
console.log('[5/6] flags');
const require = createRequire(import.meta.url);
const flagDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
let flags = 0; const noFlag = [];
for (const c of res.countryRows) {
  if (!c.iso2) { noFlag.push(c.id); continue; }
  const src = path.join(flagDir, `${c.iso2.toLowerCase()}.svg`);
  if (!fs.existsSync(src)) { noFlag.push(c.id + '(' + c.iso2 + ')'); continue; }
  fs.copyFileSync(src, path.join(OUT, 'flags', `${c.iso2.toLowerCase()}.svg`)); flags++;
}
console.log(`  flags copied: ${flags}; countries without flag: ${noFlag.join(' ')}`);
console.log('[6/6] sources');
const report = { carved, simplifyPct: res.pct, remapped: res.remapped, fallbackProvinceCountries: res.fallbackCountries, capitalMethod: res.capMethod, notes: res.notes, flags, noFlag };
fs.writeFileSync(path.join(CACHE, 'geo-build-report.json'), JSON.stringify(report, null, 1));
writeSources(report, readJson(path.join(ROOT, 'tools/package.json')));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
