// Countries, provinces, cities: simplification (mapshaper), topology, attributes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ROOT, CACHE, OUT, readJson, round, polygonsOf, geomAreaKm2, interiorPoint, geomBbox, scanFill, pointInPoly, sizeMB,
} from './lib.mjs';
import { buildTopology, unsharedSegments } from './topo.mjs';
import { colorGraph } from './palette.mjs';
import { FW, FH, NW, NH } from './raster.mjs';

const MAPSHAPER = path.join(ROOT, 'tools', 'node_modules', '.bin', 'mapshaper');
const ms = (args) => execFileSync(MAPSHAPER, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).toString();
const notes = [];

// ---------------------------------------------------------------- inputs
function loadCountries(p0) {
  const feats = readJson(p0).features;
  const list = feats.map((f) => {
    const p = f.properties;
    const iso2 = [p.ISO_A2, p.ISO_A2_EH].find((v) => /^[A-Z]{2}$/.test(v || '')) || null; // TWN has ISO_A2 'CN-TW' -> ISO_A2_EH 'TW'
    // sovereign = the unit IS its own sovereign (ADMIN === SOVEREIGNT); NE gives SOV_A3 codes like FR1 that differ from ADM0_A3
    const okType = ['Sovereign country', 'Country', 'Sovereignty', 'Disputed'].includes(p.TYPE);
    const sovereign = okType && p.ADMIN === p.SOVEREIGNT && !['SOL', 'CYN'].includes(p.ADM0_A3);
    return {
      id: p.ADM0_A3, iso2: iso2 ? iso2.toUpperCase() : null, name: p.NAME || p.ADMIN, namePt: p.NAME_PT || p.NAME_EN || p.NAME,
      continent: p.CONTINENT, subregion: p.SUBREGION, sovereign, geometry: f.geometry, props: p,
    };
  });
  const ids = new Set();
  list.forEach((c) => { if (ids.has(c.id)) throw new Error('duplicate country id ' + c.id); ids.add(c.id); });
  return list;
}

function loadProvinces(p1, countries) {
  const cids = new Set(countries.map((c) => c.id));
  const bySov = new Map(countries.map((c) => [c.props.SOV_A3, c.id]));
  const seen = new Set();
  const out = [];
  let remapped = 0;
  readJson(p1).features.forEach((f, idx) => {
    const p = f.properties;
    let id = p.adm1_code;
    if (!id || seen.has(id)) id = `${p.adm0_a3}-X${idx}`;
    seen.add(id);
    let cid = p.adm0_a3;
    if (!cids.has(cid)) { cid = bySov.get(p.sov_a3); remapped++; notes.push(`province ${id}: adm0_a3 ${p.adm0_a3} -> ${cid}`); }
    out.push({ id, cid, name: p.name || p.name_en || p.name_local || id, geometry: f.geometry, fallback: false });
  });
  const have = new Set(out.map((p) => p.cid));
  const fallbackCountries = [];
  for (const c of countries) {
    if (have.has(c.id)) continue;
    out.push({ id: `${c.id}-X0`, cid: c.id, name: c.name, geometry: c.geometry, fallback: true });
    fallbackCountries.push(c.id);
  }
  return { provinces: out, remapped, fallbackCountries };
}

// ---------------------------------------------------------------- simplification
function simplify(provinces) {
  const dir = path.join(CACHE, 'simp');
  fs.mkdirSync(dir, { recursive: true });
  const input = path.join(dir, 'prov.in.geojson');
  fs.writeFileSync(input, JSON.stringify({
    type: 'FeatureCollection',
    features: provinces.map((p) => ({ type: 'Feature', properties: { id: p.id, cid: p.cid }, geometry: p.geometry })),
  }));
  for (const pct of [40, 35, 30, 26, 22, 18, 14, 10, 8, 6, 4]) {
    const pf = path.join(dir, 'prov.out.geojson'), cf = path.join(dir, 'country.out.geojson');
    ms([input, '-simplify', 'visvalingam', `percentage=${pct}%`, 'keep-shapes', '-clean', 'allow-overlaps', '-o', pf, 'format=geojson', 'precision=0.001']);
    ms([pf, '-dissolve', 'cid', '-o', cf, 'format=geojson', 'precision=0.001']);
    const a = sizeMB(pf), b = sizeMB(cf);
    console.log(`  simplify ${pct}%: provinces ${a.toFixed(2)} MB, countries ${b.toFixed(2)} MB`);
    if (a <= 6.5 && b <= 2.7) return { pf, cf, pct };
  }
  throw new Error('could not fit size limits');
}

// ---------------------------------------------------------------- cities & capitals
// populated_places uses ADM0_A3 codes that have no admin_0 unit: remap to the existing country id.
const PLACE_ALIAS = { SSD: 'SDS', SJM: 'NOR', TKL: 'NZL' };
// Nauru has no populated place in NE; Yaren is the de facto seat of government (real coordinates).
const CAPITAL_OVERRIDE = { NRU: { name: 'Yaren', lon: 166.9209, lat: -0.5477 } };
const loadPlaces = (pp) => readJson(pp).features.map((f) => { const p = f.properties; p.ADM0_A3 = PLACE_ALIAS[p.ADM0_A3] || p.ADM0_A3; return p; });

function loadCities(pp) {
  const feats = loadPlaces(pp);
  feats.sort((a, b) => b.POP_MAX - a.POP_MAX || a.NAME.localeCompare(b.NAME));
  const cols = { name: [], lon: [], lat: [], pop: [], capital: [], iso3: [] };
  for (const p of feats) {
    cols.name.push(p.NAME); cols.lon.push(round(p.LONGITUDE, 4)); cols.lat.push(round(p.LATITUDE, 4));
    cols.pop.push(Math.round(p.POP_MAX));
    cols.capital.push(p.ADM0CAP === 1 ? 2 : /^Admin-1 (region )?capital$/.test(p.FEATURECLA) ? 1 : 0);
    cols.iso3.push(p.ADM0_A3);
  }
  return { raw: feats, file: { n: feats.length, cols } };
}

function pickCapitals(countries, places) {
  const method = {};
  for (const c of countries) {
    if (CAPITAL_OVERRIDE[c.id]) { c.capital = CAPITAL_OVERRIDE[c.id]; (method['manual-override'] ||= []).push(c.id); continue; }
    const mine = places.filter((p) => p.ADM0_A3 === c.id);
    const best = (arr) => arr.sort((a, b) => b.POP_MAX - a.POP_MAX)[0];
    let p = best(mine.filter((q) => q.ADM0CAP === 1));
    let m = 'ADM0CAP';
    if (!p) { p = best(mine.filter((q) => /^Admin-0 (region )?capital/.test(q.FEATURECLA))); m = 'featurecla-admin0'; }
    if (!p) { p = best(mine.filter((q) => q.FEATURECLA !== 'Scientific station')); m = 'largest-place'; }
    if (!p) {
      // largest place physically inside the country
      const polys = polygonsOf(c.geometry);
      p = best(places.filter((q) => polys.some((pl) => pointInPoly(q.LONGITUDE, q.LATITUDE, pl))));
      m = 'largest-place-inside';
    }
    if (p) c.capital = { name: p.NAME, lon: round(p.LONGITUDE, 4), lat: round(p.LATITUDE, 4) };
    else { const ip = interiorPoint(c.geometry); c.capital = { name: c.name, lon: round(ip[0], 4), lat: round(ip[1], 4) }; m = 'interior-point'; }
    (method[m] ||= []).push(c.id);
  }
  return method;
}

// ---------------------------------------------------------------- main
export function buildAdmin({ paths, fine, elev }) {
  const countries = loadCountries(paths('ne_10m_admin_0_countries'));
  const { provinces, remapped, fallbackCountries } = loadProvinces(paths('ne_10m_admin_1_states_provinces'), countries);
  console.log(`countries ${countries.length}, provinces ${provinces.length} (${fallbackCountries.length} fallback)`);
  const { pf, cf, pct } = simplify(provinces);

  // simplified geometry
  const pOut = readJson(pf).features;
  const byId = new Map(provinces.map((p) => [p.id, p]));
  const missing = provinces.filter((p) => !pOut.some((f) => f.properties.id === p.id));
  const pIndex = new Map(pOut.map((f, i) => [f.properties.id, i]));
  if (missing.length || pOut.some((f) => !f.geometry)) throw new Error('provinces lost in simplification: ' + missing.map((m) => m.id).join(','));
  const prov = provinces.map((p) => ({ ...p, sim: pOut[pIndex.get(p.id)].geometry }));

  // province topology & attributes
  const topoP = buildTopology(prov.map((p) => ({ geometry: p.sim })));
  const label = new Int32Array(NW * NH).fill(-1);
  const areas = prov.map((p) => geomAreaKm2(p.geometry));
  [...prov.keys()].sort((a, b) => areas[b] - areas[a]).forEach((i) => {
    scanFill(polygonsOf(prov[i].sim).map((x) => x), NW, NH, (j, a, b) => label.fill(i, j * NW + a, j * NW + b));
  });
  const acc = prov.map(() => ({ n: 0, s: 0, s2: 0, v: 0 }));
  for (let q = 0; q < label.length; q++) {
    const l = label[q]; if (l < 0) continue;
    const a = acc[l], m = elev.mean[q];
    a.n++; a.s += m; a.s2 += m * m; a.v += elev.std[q] ** 2;
  }
  const isFineSea = (lon, lat) => {
    const i = Math.floor(((lon + 180) / 360) * FW), j = Math.floor(((90 - lat) / 180) * FH);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const jj = j + dj, ii = (((i + di) % FW) + FW) % FW;
      if (jj >= 0 && jj < FH && !fine[jj * FW + ii]) return true;
    }
    return false;
  };
  const provRows = prov.map((p, i) => {
    let coastal = false;
    for (const [a, b] of unsharedSegments(topoP, { geometry: p.sim }, i)) {
      if ([a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]].some(([x, y]) => isFineSea(x, y))) { coastal = true; break; }
    }
    const ip = interiorPoint(p.geometry);
    let { n, s, s2, v } = acc[i];
    if (!n) { const q = Math.floor((90 - ip[1]) / 0.25) * NW + Math.floor((ip[0] + 180) / 0.25); n = 1; s = elev.mean[q]; s2 = s * s; v = elev.std[q] ** 2; }
    const mean = s / n, varM = Math.max(0, s2 / n - mean * mean);
    return {
      id: p.id, countryId: p.cid, name: p.name, centroid: [round(ip[0], 4), round(ip[1], 4)], areaKm2: round(areas[i], 3),
      neighbors: [...topoP.adj[i]].map((k) => prov[k].id).sort(), coastal, elevMean: Math.round(mean),
      rugged: round(Math.min(1, Math.sqrt(v / n + varM) / 800), 3),
    };
  });

  // countries
  const cOut = readJson(cf).features;
  const cIndex = new Map(cOut.map((f, i) => [f.properties.cid, i]));
  if (countries.some((c) => !cIndex.has(c.id))) throw new Error('country missing after dissolve');
  const cGeo = countries.map((c) => {
    const g = cOut[cIndex.get(c.id)].geometry;
    if (g && polygonsOf(g).length) return { geometry: g };
    // dissolve can return null for slivers overlapping a neighbour (Bir Tawil): use its province geometry
    const parts = prov.filter((p) => p.cid === c.id).flatMap((p) => polygonsOf(p.sim));
    notes.push(`country ${c.id}: dissolved geometry empty, used province geometry`);
    return { geometry: { type: 'MultiPolygon', coordinates: parts } };
  });
  const topoC = buildTopology(cGeo);
  const topoRaw = buildTopology(countries.map((c) => ({ geometry: c.geometry })), 4);
  const cidx = new Map(countries.map((c, i) => [c.id, i]));
  // disputed micro-areas / glaciers (Indeterminate, except Palestine, W. Sahara, Antarctica) are not real land neighbours
  const skipAdj = countries.map((c) => c.props.TYPE === 'Indeterminate' && !['PSX', 'SAH', 'ATA'].includes(c.id));
  const adj = countries.map((_, i) => new Set([...topoC.adj[i], ...topoRaw.adj[i]].filter((k) => !skipAdj[i] && !skipAdj[k])));
  const onlyRaw = countries.reduce((s, _, i) => s + [...topoRaw.adj[i]].filter((k) => !topoC.adj[i].has(k)).length, 0);
  notes.push(`country adjacency: ${onlyRaw / 2} pairs only found in raw admin_0 topology (merged), union used`);
  const colors = colorGraph(adj);
  const capMethod = pickCapitals(countries, loadPlaces(paths('ne_10m_populated_places')));
  const provByCountry = new Map();
  provRows.forEach((r) => { (provByCountry.get(r.countryId) || provByCountry.set(r.countryId, []).get(r.countryId)).push(r); });
  const countryRows = countries.map((c, i) => {
    const ip = interiorPoint(c.geometry);
    return {
      id: c.id, iso2: c.iso2, name: c.name, namePt: c.namePt, continent: c.continent, subregion: c.subregion, sovereign: c.sovereign,
      centroid: [round(ip[0], 4), round(ip[1], 4)], bbox: geomBbox(c.geometry).map((v) => round(v, 3)), color: colors[i],
      capital: c.capital, neighbors: [...adj[i]].map((k) => countries[k].id).sort(), coastal: (provByCountry.get(c.id) || []).some((p) => p.coastal),
    };
  });

  // write
  const fc = (features) => JSON.stringify({ type: 'FeatureCollection', features });
  fs.writeFileSync(path.join(OUT, 'provinces.geo.json'), fc(prov.map((p) => ({ type: 'Feature', properties: { id: p.id }, geometry: p.sim }))));
  fs.writeFileSync(path.join(OUT, 'countries.geo.json'), fc(countries.map((c, i) => ({ type: 'Feature', properties: { id: c.id }, geometry: cGeo[i].geometry }))));
  fs.writeFileSync(path.join(OUT, 'provinces.json'), JSON.stringify(provRows));
  fs.writeFileSync(path.join(OUT, 'countries.json'), JSON.stringify(countryRows));
  const cities = loadCities(paths('ne_10m_populated_places'));
  fs.writeFileSync(path.join(OUT, 'cities.json'), JSON.stringify(cities.file));
  return { countryRows, provRows, pct, remapped, fallbackCountries, capMethod, notes };
}
