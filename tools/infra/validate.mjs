// Validates infra datasets; exits non-zero on failure. Prints a summary.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, RAW, haversineKm, MinHeap } from './util.mjs';

const rd = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f)));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails++; };

// ---------- plants ----------
const pp = rd('powerplants.json');
check(pp.n === pp.cols.lon.length && Object.values(pp.cols).every((c) => c.length === pp.n), `powerplants colunar consistente (n=${pp.n})`);
const FUELS = ['coal', 'gas', 'oil', 'nuclear', 'hydro', 'wind', 'solar', 'biomass', 'geothermal', 'other'];
const byFuel = {}; let totalMw = 0;
for (let i = 0; i < pp.n; i++) {
  const f = pp.cols.fuel[i];
  if (!FUELS.includes(f)) { check(false, 'fuel invalido ' + f); break; }
  (byFuel[f] ||= { n: 0, mw: 0 }); byFuel[f].n++; byFuel[f].mw += pp.cols.mw[i]; totalMw += pp.cols.mw[i];
}
console.log('\nUSINAS por combustivel:');
for (const f of FUELS) console.log(`  ${f.padEnd(11)} ${String(byFuel[f]?.n ?? 0).padStart(6)} usinas ${((byFuel[f]?.mw ?? 0) / 1000).toFixed(0).padStart(7)} GW`);
console.log(`  TOTAL       ${pp.n} usinas ${(totalMw / 1000).toFixed(0)} GW`);
check(pp.n > 34000, 'usinas > 34k');
check(totalMw / 1000 > 4500 && totalMw / 1000 < 7000, `MW mundial em 4.5-7 mil GW (${(totalMw / 1000).toFixed(0)} GW)`);
for (const [label, re, iso] of [['Itaipu', /^itaipu/i, null], ['Three Gorges', /three gorges/i, 'CHN'], ['Kashiwazaki-Kariwa', /kashiwazaki/i, 'JPN'], ['Belo Monte', /belo monte/i, 'BRA']]) {
  const hits = [];
  for (let i = 0; i < pp.n; i++) if (re.test(pp.cols.name[i]) && (!iso || pp.cols.iso3[i] === iso)) hits.push(`${pp.cols.name[i]} ${pp.cols.mw[i]} MW ${pp.cols.fuel[i]} ${pp.cols.iso3[i]} [${pp.cols.lon[i]},${pp.cols.lat[i]}]`);
  check(hits.length > 0, `${label}: ${hits.slice(0, 2).join(' | ') || 'AUSENTE'}`);
}
const isoSet = new Set(pp.cols.iso3);
try {
  const countries = rd('countries.json');
  const ids = new Set(countries.map((c) => c.id));
  const miss = [...isoSet].filter((c) => !ids.has(c));
  console.log(`iso3 de usinas sem correspondencia em countries.json (${miss.length}): ${miss.join(' ')}`);
} catch { console.log(`(countries.json ainda ausente) iso3 distintos nas usinas: ${isoSet.size}`); }

// ---------- airports / ports ----------
const ap = rd('airports.json'), pt = rd('ports.json');
check(ap.n > 800 && ap.cols.size.every((s) => s >= 0 && s <= 2), `airports n=${ap.n}, sizes ${[0, 1, 2].map((s) => ap.cols.size.filter((x) => x === s).length)}, militares ${ap.cols.military.reduce((a, b) => a + b, 0)}`);
check(pt.n > 1000 && pt.cols.size.every((s) => s >= 0 && s <= 2), `ports n=${pt.n}, sizes ${[0, 1, 2].map((s) => pt.cols.size.filter((x) => x === s).length)}`);

// ---------- roads ----------
const rf = path.join(OUT, 'roads.json');
const rsize = fs.statSync(rf).size;
const roads = rd('roads.json');
const nN = roads.nodes.lon.length, nE = roads.edges.a.length;
const E = roads.edges;
check(rsize <= 16 * 1024 * 1024, `roads.json ${(rsize / 1e6).toFixed(2)} MB <= 16 MB`);
check(E.b.length === nE && E.km.length === nE && E.cls.length === nE && E.geomStart.length === nE && E.geomLen.length === nE, 'arrays de arestas com mesmo tamanho');
let okIdx = true, okGeom = true;
for (let i = 0; i < nE; i++) {
  if (!(E.a[i] >= 0 && E.a[i] < nN && E.b[i] >= 0 && E.b[i] < nN) || E.a[i] === E.b[i]) okIdx = false;
  if (E.geomLen[i] < 2 || (E.geomStart[i] + E.geomLen[i]) * 2 > roads.geom.length) okGeom = false;
}
check(okIdx, 'indices de nos validos, sem lacos'); check(okGeom, 'geomStart/geomLen (em pontos) dentro de geom');
const clsKm = [0, 0, 0, 0, 0], clsN = [0, 0, 0, 0, 0];
for (let i = 0; i < nE; i++) { clsKm[E.cls[i]] += E.km[i]; clsN[E.cls[i]]++; }
const names = ['autoestrada', 'principal', 'secundaria', 'ferrovia', 'balsa'];
console.log(`\nGRAFO: ${nN} nos, ${nE} arestas, ${roads.geom.length / 2} pontos de geometria`);
names.forEach((n, c) => console.log(`  cls ${c} ${n.padEnd(12)} ${String(clsN[c]).padStart(7)} arestas ${(clsKm[c] / 1000).toFixed(0).padStart(6)} mil km`));

const par = new Int32Array(nN).map((_, i) => i);
const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (let i = 0; i < nE; i++) { const a = find(E.a[i]), b = find(E.b[i]); if (a !== b) par[a] = b; }
const compKm = new Map();
for (let i = 0; i < nE; i++) { const r = find(E.a[i]); compKm.set(r, (compKm.get(r) || 0) + E.km[i]); }
const sorted = [...compKm.entries()].sort((x, y) => y[1] - x[1]);
const mainRoot = sorted[0][0];
const totalKm = sorted.reduce((s, x) => s + x[1], 0);
console.log(`  componentes: ${sorted.length}; maior = ${(sorted[0][1] / 1000).toFixed(0)} mil km (${((100 * sorted[0][1]) / totalKm).toFixed(1)}% do total); menor = ${sorted[sorted.length - 1][1].toFixed(0)} km`);
check(sorted[sorted.length - 1][1] >= 30, 'nenhum componente < 30 km');
try {
  const conts = JSON.parse(fs.readFileSync(path.resolve(RAW, '../roads.edge-continent.json')));
  if (conts.length === nE) {
    // per-continent: km in global main component, and in the continent's own largest component
    const per = {};
    const subKm = {}; // cont -> root -> km
    for (let i = 0; i < nE; i++) {
      const c = conts[i], r = find(E.a[i]);
      (per[c] ||= { km: 0, main: 0 }); per[c].km += E.km[i]; if (r === mainRoot) per[c].main += E.km[i];
      ((subKm[c] ||= new Map())).set(r, (subKm[c].get(r) || 0) + E.km[i]);
    }
    console.log('  por continente (km totais | % no maior componente global | % no maior componente do proprio continente):');
    for (const c of Object.keys(per).sort()) {
      const best = Math.max(...subKm[c].values());
      console.log(`    ${c.padEnd(14)} ${(per[c].km / 1000).toFixed(1).padStart(7)} mil km | ${((100 * per[c].main) / per[c].km).toFixed(1).padStart(5)}% | ${((100 * best) / per[c].km).toFixed(1).padStart(5)}%`);
    }
  } else console.log('  (cache de continentes desatualizado, ignorado)');
} catch { console.log('  (sem cache de continente)'); }

// ---------- Dijkstra route tests ----------
const adj = Array.from({ length: nN }, () => []);
for (let i = 0; i < nE; i++) { adj[E.a[i]].push(E.b[i], E.km[i]); adj[E.b[i]].push(E.a[i], E.km[i]); }
function nearest(lon, lat, onlyMain) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < nN; i++) {
    if (onlyMain && find(i) !== mainRoot) continue;
    const d = haversineKm(lon, lat, roads.nodes.lon[i], roads.nodes.lat[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return [best, bd];
}
function dijkstra(src, dst) {
  const dist = new Float64Array(nN).fill(Infinity); dist[src] = 0;
  const h = new MinHeap(); h.push(0, src);
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    if (u === dst) return d;
    const a = adj[u];
    for (let k = 0; k < a.length; k += 2) { const nd = d + a[k + 1]; if (nd < dist[a[k]]) { dist[a[k]] = nd; h.push(nd, a[k]); } }
  }
  return null;
}
console.log('\nROTAS (Dijkstra no grafo; no mais proximo):');
const tests = [
  ['Sao Paulo', [-46.63, -23.55], 'Brasilia', [-47.88, -15.79], 900, 1350],
  ['Lisboa', [-9.14, 38.72], 'Moscou', [37.62, 55.75], 4300, 5600],
  ['Nova York', [-74.0, 40.71], 'Los Angeles', [-118.24, 34.05], 4300, 5400],
  ['Cairo', [31.24, 30.04], 'Cidade do Cabo', [18.42, -33.92], 8000, 20000],
];
for (const [n1, p1, n2, p2, lo, hi] of tests) {
  const [a, da] = nearest(...p1, false), [b, db] = nearest(...p2, false);
  const d = dijkstra(a, b);
  const gc = haversineKm(...p1, ...p2);
  check(d !== null && d >= lo && d <= hi, `${n1}->${n2}: ${d === null ? 'SEM ROTA' : d.toFixed(0) + ' km'} (circulo maximo ${gc.toFixed(0)} km; no a ${da.toFixed(1)} km / b ${db.toFixed(1)} km; esperado ${lo}-${hi})`);
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTodas as validacoes passaram');
process.exit(fails ? 1 : 0);
