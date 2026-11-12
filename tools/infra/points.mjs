// powerplants.json, airports.json, ports.json
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { RAW, round, writeJson } from './util.mjs';

// WRI primary_fuel -> plan enum
const FUEL = {
  Coal: 'coal', Gas: 'gas', Oil: 'oil', Petcoke: 'oil', Nuclear: 'nuclear', Hydro: 'hydro', Wind: 'wind',
  Solar: 'solar', Biomass: 'biomass', Waste: 'biomass', Geothermal: 'geothermal',
  Cogeneration: 'other', Storage: 'other', 'Wave and Tidal': 'other', Other: 'other',
};
// WRI country codes that differ from Natural Earth ADM0_A3 (loader remaps the rest by location)
const ISO_FIX = { XKX: 'KOS', XKO: 'KOS' };

function plants() {
  const rows = parse(fs.readFileSync(path.join(RAW, 'gppd.csv')), { columns: true, skip_empty_lines: true, relax_column_count: true });
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const fuel = FUEL[r.primary_fuel];
    const lon = parseFloat(r.longitude), lat = parseFloat(r.latitude), mw = parseFloat(r.capacity_mw);
    if (!fuel || !isFinite(lon) || !isFinite(lat) || !isFinite(mw) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; continue; }
    out.push({ name: r.name, lon: round(lon, 4), lat: round(lat, 4), fuel, mw: round(mw, 1), iso3: ISO_FIX[r.country] || r.country });
  }
  out.sort((a, b) => b.mw - a.mw || a.name.localeCompare(b.name));
  const cols = { name: [], lon: [], lat: [], fuel: [], mw: [], iso3: [] };
  for (const p of out) for (const k in cols) cols[k].push(p[k]);
  const size = writeJson('powerplants.json', { n: out.length, cols });
  console.log(`powerplants.json: ${out.length} usinas (descartadas ${skipped}), ${(size / 1e6).toFixed(2)} MB`);
}

function readGeo(f) { return JSON.parse(fs.readFileSync(path.join(RAW, f))).features; }

function airports() {
  const out = readGeo('ne_10m_airports.geojson').map((f) => {
    const p = f.properties, t = p.type || '';
    const military = /military/.test(t) ? 1 : 0;
    let size = /major/.test(t) ? 2 : /mid/.test(t) ? 1 : t === 'small' ? 0 : p.scalerank <= 3 ? 2 : 1; // pure "military"/"spaceport"
    return { name: p.name_en || p.name, lon: round(f.geometry.coordinates[0], 4), lat: round(f.geometry.coordinates[1], 4), iata: p.iata_code || p.abbrev || '', size, military };
  });
  const cols = { name: [], lon: [], lat: [], iata: [], size: [], military: [] };
  for (const p of out) for (const k in cols) cols[k].push(p[k]);
  const size = writeJson('airports.json', { n: out.length, cols });
  console.log(`airports.json: ${out.length}, ${(size / 1e3).toFixed(0)} KB`);
}

function ports() {
  const out = readGeo('ne_10m_ports.geojson').map((f) => {
    const sr = f.properties.scalerank;
    return { name: f.properties.name, lon: round(f.geometry.coordinates[0], 4), lat: round(f.geometry.coordinates[1], 4), size: sr <= 4 ? 2 : sr <= 6 ? 1 : 0 };
  });
  const cols = { name: [], lon: [], lat: [], size: [] };
  for (const p of out) for (const k in cols) cols[k].push(p[k]);
  const size = writeJson('ports.json', { n: out.length, cols });
  console.log(`ports.json: ${out.length}, ${(size / 1e3).toFixed(0)} KB`);
}

plants(); airports(); ports();
