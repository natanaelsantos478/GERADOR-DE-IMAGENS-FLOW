// Step 1: download Natural Earth zips (cached) and convert shapefiles to GeoJSON.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CACHE, ROOT } from './lib.mjs';

const BASE = 'https://naciscdn.org/naturalearth/10m';
const FILES = [
  ['cultural', 'ne_10m_admin_0_countries'],
  ['cultural', 'ne_10m_admin_1_states_provinces'],
  ['cultural', 'ne_10m_populated_places'],
  ['physical', 'ne_10m_land'],
];
const MAPSHAPER = path.join(ROOT, 'tools', 'node_modules', '.bin', 'mapshaper');

export async function fetchAll() {
  const raw = path.join(CACHE, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  for (const [dir, name] of FILES) {
    const geo = path.join(raw, `${name}.geojson`);
    if (fs.existsSync(geo)) continue;
    const zip = path.join(CACHE, `${name}.zip`);
    if (!fs.existsSync(zip)) {
      console.log('download', name);
      execFileSync('curl', ['-fsSL', '-o', zip, `${BASE}/${dir}/${name}.zip`]);
    }
    const d = path.join(raw, name);
    fs.mkdirSync(d, { recursive: true });
    execFileSync('unzip', ['-oq', zip, '-d', d]);
    execFileSync(MAPSHAPER, [path.join(d, `${name}.shp`), '-o', geo, 'format=geojson'], { stdio: 'ignore' });
  }
  return (name) => path.join(raw, `${name}.geojson`);
}
