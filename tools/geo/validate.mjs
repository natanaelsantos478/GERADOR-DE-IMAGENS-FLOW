// Validation of public/data geo outputs. Exit code 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, CACHE, readJson, polygonsOf, pointInPoly, sizeMB } from './lib.mjs';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const J = (f) => readJson(path.join(OUT, f));

const countries = J('countries.json'), provinces = J('provinces.json');
const cGeo = J('countries.geo.json'), pGeo = J('provinces.geo.json');
const cities = J('cities.json'), nav = J('navgrid.json'), elev = J('elev.json');

console.log('== contagens');
const sov = countries.filter((c) => c.sovereign);
console.log(`países ${countries.length} (soberanos ${sov.length}), províncias ${provinces.length}, cidades ${cities.n}`);
ok(countries.length > 240 && sov.length >= 190 && sov.length <= 200, 'contagem de países/soberanos plausível');
ok(provinces.length >= 4500, 'províncias >= 4500');
ok(cities.n >= 7000, 'cidades >= 7000');
const dup = (arr) => arr.length - new Set(arr).size;
ok(dup(countries.map((c) => c.id)) === 0 && dup(provinces.map((p) => p.id)) === 0, '0 ids duplicados (países e províncias)');
const cIds = new Set(countries.map((c) => c.id)), pIds = new Set(provinces.map((p) => p.id));
ok(provinces.every((p) => cIds.has(p.countryId)), '0 countryId órfão em províncias');
const perCountry = new Map();
provinces.forEach((p) => perCountry.set(p.countryId, (perCountry.get(p.countryId) || 0) + 1));
ok(countries.every((c) => perCountry.get(c.id) >= 1), 'todo país tem >= 1 província');
ok(cGeo.features.length === countries.length && cGeo.features.every((f) => cIds.has(f.properties.id) && f.geometry), 'countries.geo.json 1:1 com countries.json');
ok(pGeo.features.length === provinces.length && pGeo.features.every((f) => pIds.has(f.properties.id) && polygonsOf(f.geometry).length), 'provinces.geo.json 1:1 com provinces.json (nenhuma removida)');

console.log('== adjacência');
const sym = (rows, ids) => rows.every((r) => r.neighbors.every((n) => ids.has(n) && rows.find((x) => x.id === n).neighbors.includes(r.id)));
const byC = new Map(countries.map((c) => [c.id, c]));
const byP = new Map(provinces.map((p) => [p.id, p]));
ok(countries.every((c) => c.neighbors.every((n) => byC.get(n)?.neighbors.includes(c.id))), 'simetria países');
ok(provinces.every((p) => p.neighbors.every((n) => byP.get(n)?.neighbors.includes(p.id))), 'simetria províncias');
ok(countries.every((c) => c.neighbors.every((n) => byC.get(n).color.join() !== c.color.join())), 'vizinhos terrestres com cores distintas');
const bra = byC.get('BRA');
console.log('BRA vizinhos:', bra.neighbors.join(' '));
ok(bra.neighbors.length === 10, 'Brasil faz fronteira com 10 (inclui FRA/Guiana Francesa)');
ok(byC.get('BOL').coastal === false && byC.get('BRA').coastal === true && byC.get('CHE').coastal === false, 'coastal: BOL/CHE false, BRA true');
console.log('PRT vizinhos', byC.get('PRT').neighbors.join(), '| DEU', byC.get('DEU').neighbors.length, '| CHN', byC.get('CHN').neighbors.length, '| RUS', byC.get('RUS').neighbors.length);
const isolated = provinces.filter((p) => !p.neighbors.length);
console.log(`províncias sem vizinho (ilhas): ${isolated.length}`);

console.log('== cidades x províncias');
const cell = new Map();
const bb = pGeo.features.map((f) => {
  let w = 181, s = 91, e = -181, n = -91;
  for (const poly of polygonsOf(f.geometry)) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
});
bb.forEach((b, i) => { for (let x = Math.floor(b[0] - 0.5); x <= Math.floor(b[2] + 0.5); x++) for (let y = Math.floor(b[1] - 0.5); y <= Math.floor(b[3] + 0.5); y++) { const k = x * 1000 + y; (cell.get(k) || cell.set(k, []).get(k)).push(i); } });
const segDistKm = (px, py, a, b) => {
  const k = Math.cos((py * Math.PI) / 180), ax = (a[0] - px) * k, ay = a[1] - py, bx = (b[0] - px) * k, by = b[1] - py;
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * 111.195;
};
let inside = 0, near = 0, far = 0; const farList = [];
const locate = (x, y) => {
  const cand = cell.get(Math.floor(x) * 1000 + Math.floor(y)) || [];
  for (const i of cand) if (polygonsOf(pGeo.features[i].geometry).some((p) => pointInPoly(x, y, p))) return i;
  return -1;
};
for (let q = 0; q < cities.n; q++) {
  const x = cities.cols.lon[q], y = cities.cols.lat[q];
  if (locate(x, y) >= 0) { inside++; continue; }
  let best = 1e9;
  for (const i of cell.get(Math.floor(x) * 1000 + Math.floor(y)) || []) for (const poly of polygonsOf(pGeo.features[i].geometry)) for (const ring of poly) for (let k = 0; k < ring.length - 1; k++) best = Math.min(best, segDistKm(x, y, ring[k], ring[k + 1]));
  if (best <= 30) near++; else { far++; if (farList.length < 8) farList.push(`${cities.cols.name[q]}(${cities.cols.iso3[q]})`); }
}
const pct = (v) => ((100 * v) / cities.n).toFixed(2) + '%';
console.log(`dentro de província: ${inside} (${pct(inside)}); a <=30 km: ${near} (${pct(near)}); sem província (>30 km): ${far} (${pct(far)}) ${farList.join(', ')}`);
ok((inside + near) / cities.n > 0.99, '>= 99% das cidades em província ou a <= 30 km');

console.log('== pontuais');
const at = (name, lon, lat, id) => { const i = locate(lon, lat); const p = i >= 0 ? provinces[i] : null; console.log(`   ${name}: ${p ? p.id + ' ' + p.name + ' [' + p.countryId + ']' : 'nenhuma'}`); return p; };
const sp = at('São Paulo', -46.6333, -23.5505);
ok(sp && sp.countryId === 'BRA' && /S[ãa]o Paulo/.test(sp.name), 'São Paulo cai na província de São Paulo');
const pa = at('Paris', 2.3522, 48.8566);
const rawA1 = readJson(path.join(CACHE, 'raw', 'ne_10m_admin_1_states_provinces.geojson')).features.find((f) => f.properties.adm1_code === pa?.id);
console.log('   (NE admin-1 da França = départements; região da província:', rawA1?.properties.region + ')');
ok(pa && pa.countryId === 'FRA' && rawA1?.properties.region === 'Île-de-France', 'Paris em Île-de-France (departamento Paris, região Île-de-France)');
const seaAt = (lon, lat) => { const i = Math.floor((lon + 180) / 0.25), j = Math.floor((90 - lat) / 0.25), q = j * nav.w + i; return ((Buffer.from(nav.sea, 'base64')[q >> 3] >> (q & 7)) & 1) === 1; };
ok(seaAt(-30, 30) && locate(-30, 30) < 0, 'ponto no meio do Atlântico é mar');
ok(!seaAt(-47, -15), 'Brasília (interior) é terra na navgrid');
const ev = Buffer.from(elev.data, 'base64'); const el = new Int16Array(ev.buffer, ev.byteOffset, ev.length / 2);
const eAt = (lon, lat) => el[Math.floor((90 - lat) / 0.25) * elev.w + Math.floor((lon + 180) / 0.25)];
console.log('   elev Everest', eAt(86.925, 27.988), 'm; Amazonas', eAt(-60, -3), 'm; Mar Morto', eAt(35.5, 31.5));
ok(eAt(86.925, 27.988) > 5000, 'Everest > 5000 m em elev');
const hi = provinces.filter((p) => p.countryId === 'NPL' || p.countryId === 'NLD');
console.log('   elevMean/rugged: NPL', hi.filter((p) => p.countryId === 'NPL').map((p) => `${p.elevMean}/${p.rugged}`).slice(0, 3).join(' '), '| NLD', hi.filter((p) => p.countryId === 'NLD').map((p) => `${p.elevMean}/${p.rugged}`).slice(0, 3).join(' '));
ok(provinces.every((p) => Number.isFinite(p.elevMean) && p.rugged >= 0 && p.rugged <= 1 && p.areaKm2 >= 0), 'elevMean/rugged/areaKm2 válidos');
ok(countries.every((c) => c.capital && Number.isFinite(c.capital.lon)), 'todo país tem capital');
ok(countries.filter((c) => c.iso2).every((c) => fs.existsSync(path.join(OUT, 'flags', c.iso2.toLowerCase() + '.svg'))), 'bandeira para todo país com iso2');

console.log('== navegação (flood fill 4-conexo, wrap em lon)');
const W = nav.w, H = nav.h, sb = Buffer.from(nav.sea, 'base64');
const isSea = (i, j) => { const q = j * W + i; return ((sb[q >> 3] >> (q & 7)) & 1) === 1; };
const cellOf = (lon, lat) => {
  const i0 = Math.floor((lon + 180) / 0.25), j0 = Math.floor((90 - lat) / 0.25);
  for (let r = 0; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = (i0 + di + W) % W, j = j0 + dj; if (j >= 0 && j < H && isSea(i, j)) return [i, j]; }
  return null;
};
function fill(start, box) {
  const [bw, bs, be, bn] = box || [-180, -90, 180, 90];
  const i0 = (x) => Math.floor((x + 180) / 0.25), j0 = (y) => Math.floor((90 - y) / 0.25);
  const iMin = i0(bw), iMax = i0(be), jMin = j0(bn), jMax = j0(bs);
  const seen = new Uint8Array(W * H), st = [start[1] * W + start[0]]; seen[st[0]] = 1;
  while (st.length) {
    const q = st.pop(), i = q % W, j = (q / W) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let ni = i + di; const nj = j + dj;
      if (box) { if (ni < iMin || ni > iMax) continue; } else ni = (ni + W) % W;
      if (nj < 0 || nj >= H || (box && (nj < jMin || nj > jMax))) continue;
      const nq = nj * W + ni;
      if (!seen[nq] && isSea(ni, nj)) { seen[nq] = 1; st.push(nq); }
    }
  }
  return seen;
}
const reach = (seen, p) => { const c = cellOf(...p); return !!c && seen[c[1] * W + c[0]] === 1; };
const seeds = { Atlântico: [-30, 30], Mediterrâneo: [18, 35], 'Mar Negro': [34, 43], 'Mar Báltico': [19, 58], 'Mar Vermelho': [38, 20], 'Golfo Pérsico': [51, 27], Índico: [70, -10], Pacífico: [-150, 0], 'Mar do Norte': [3, 55], 'Mar da China Meridional': [114, 12] };
const g = fill(cellOf(...seeds['Atlântico']));
for (const [n, p] of Object.entries(seeds)) ok(reach(g, p), `global: Atlântico -> ${n}`);
const straits = [
  ['Gibraltar', [-7.5, 36.0], [-3.0, 36.3], [-8, 34.5, -2, 37.5]],
  ['Bósforo', [29.3, 41.4], [28.8, 40.8], [27.5, 40.4, 30, 41.6]],
  ['Dardanelos', [27.7, 40.7], [25.5, 40.0], [25, 39.5, 28, 41]],
  ['Suez', [32.3, 31.6], [33.5, 28.5], [31.5, 27.5, 34.5, 32]],
  ['Panamá', [-79.8, 9.7], [-79.4, 8.6], [-81, 8, -78, 10]],
  ['Malaca', [97.5, 6.0], [106, 3.5], [95, 0.5, 109, 9]],
  ['Ormuz', [58.5, 24.5], [52, 27], [50, 23.5, 60, 28]],
  ['Bab-el-Mandeb', [46, 12], [40, 15], [38, 11, 48, 17]],
  ['Canal da Mancha/Dover', [-3, 49.8], [2.5, 52.5], [-6, 48.5, 5, 54]],
  ['Öresund', [11.8, 57.0], [14.0, 55.2], [10, 54, 16, 58]],
];
for (const [n, a, b, box] of straits) { const ca = cellOf(...a); ok(!!ca && reach(fill(ca, box), b), `estreito aberto: ${n}`); }
const cas = cellOf(50.5, 41.5);
console.log('   Mar Cáspio (isolado esperado): alcançável do Atlântico =', cas ? reach(g, [50.5, 41.5]) : 'n/a');

console.log('== tamanhos');
const lim = { 'countries.geo.json': 3, 'provinces.geo.json': 9 };
for (const f of ['countries.json', 'countries.geo.json', 'provinces.json', 'provinces.geo.json', 'cities.json', 'navgrid.json', 'elev.json']) {
  const m = sizeMB(path.join(OUT, f)); console.log(`   ${f}: ${m.toFixed(2)} MB`); if (lim[f]) ok(m <= lim[f], `${f} <= ${lim[f]} MB`);
}
const flagsMB = fs.readdirSync(path.join(OUT, 'flags')).reduce((s, f) => s + fs.statSync(path.join(OUT, 'flags', f)).size, 0) / 1048576;
console.log(`   flags/: ${fs.readdirSync(path.join(OUT, 'flags')).length} arquivos, ${flagsMB.toFixed(2)} MB`);
const rep = path.join(CACHE, 'geo-build-report.json');
if (fs.existsSync(rep)) { const r = readJson(rep); console.log('   capitais com fallback:', Object.entries(r.capitalMethod).filter(([m]) => m !== 'ADM0CAP').map(([m, v]) => `${m}=${v.length}`).join(' ')); }
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
