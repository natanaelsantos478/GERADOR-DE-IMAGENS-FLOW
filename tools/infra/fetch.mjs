// Downloads raw sources into tools/.cache/raw (skips files already present).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RAW } from './util.mjs';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const FILES = {
  'gppd.csv': 'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv',
  'ne_10m_airports.geojson': `${NE}/ne_10m_airports.geojson`,
  'ne_10m_ports.geojson': `${NE}/ne_10m_ports.geojson`,
  'ne_10m_roads.geojson': `${NE}/ne_10m_roads.geojson`,
  'ne_10m_railroads.geojson': `${NE}/ne_10m_railroads.geojson`,
};
fs.mkdirSync(RAW, { recursive: true });
for (const [f, url] of Object.entries(FILES)) {
  const p = path.join(RAW, f);
  if (fs.existsSync(p) && fs.statSync(p).size > 1000) { console.log('cached', f); continue; }
  console.log('download', url);
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', p, url], { stdio: 'inherit' });
}
