import { join } from 'node:path';
import { OUT, readJson, here, loadCountries } from './common.mjs';
import { FIELDS } from './military.mjs';

const countries = loadCountries();
const ids = countries.map((c) => c.id);
const stats = readJson(join(OUT, 'stats.json'));
const mil = readJson(join(OUT, 'military.json'));
const all = readJson(join(OUT, 'alliances.json'));
const known = readJson(join(here, 'military-known.json')); delete known._meta;
const errors = [];
const fail = (m) => errors.push(m);
const REQ = ['pop', 'gdpUsd', 'gdpGrowth', 'milExpUsd', 'armedForces', 'electricityKwhPc', 'urbanPct', 'lifeExp', 'year'];
const bn = (v) => (v / 1e9).toFixed(1);

// 1. coverage
for (const [name, obj] of [['stats', stats], ['military', mil]]) {
  const miss = ids.filter((i) => !(i in obj)), extra = Object.keys(obj).filter((i) => !ids.includes(i));
  if (miss.length || extra.length) fail(`${name}: missing ${miss.join(',')} extra ${extra.join(',')}`);
  console.log(`cobertura ${name}: ${Object.keys(obj).length - extra.length}/${ids.length}`);
}
// 2. NaN / null
for (const id of ids) {
  for (const f of REQ) { const v = stats[id]?.[f]; if (typeof v !== 'number' || !Number.isFinite(v)) fail(`stats ${id}.${f} = ${v}`); }
  for (const f of FIELDS) { const v = mil[id]?.[f]; if (!Number.isInteger(v) || v < 0) fail(`military ${id}.${f} = ${v}`); }
  if (stats[id] && (stats[id].pop < 0 || stats[id].gdpUsd < 0)) fail(`negative ${id}`);
}
for (const id of Object.keys(known)) if (!ids.includes(id)) fail(`military-known: unknown id ${id}`);
// 3. world totals
const pop = ids.reduce((a, i) => a + stats[i].pop, 0), gdp = ids.reduce((a, i) => a + stats[i].gdpUsd, 0);
const mx = ids.reduce((a, i) => a + stats[i].milExpUsd, 0);
console.log(`população mundial: ${bn(pop)} bi ${pop >= 8.1e9 && pop <= 8.3e9 ? 'OK' : 'FORA'}`);
console.log(`PIB mundial: ${(gdp / 1e12).toFixed(1)} tri USD ${gdp >= 1.0e14 && gdp <= 1.2e14 ? 'OK' : 'FORA'} (alvo 100-115; último ano WB = 2025 -> ver nota)`);
console.log(`gasto militar mundial: ${(mx / 1e12).toFixed(2)} tri USD`);
if (pop < 8.1e9 || pop > 8.3e9) fail('population out of range');
if (gdp < 1.0e14 || gdp > 1.2e14) fail('gdp out of range');
// 4. tops
const top = (f, n = 10) => ids.map((i) => [i, stats[i][f]]).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log('top10 PIB (tri):', top('gdpUsd').map(([i, v]) => `${i} ${(v / 1e12).toFixed(2)}`).join(' | '));
console.log('top10 gasto militar (bi):', top('milExpUsd').map(([i, v]) => `${i} ${bn(v)}`).join(' | '));
console.log('top10 população (mi):', top('pop').map(([i, v]) => `${i} ${(v / 1e6).toFixed(0)}`).join(' | '));
const top10Gdp = top('gdpUsd').map((x) => x[0]), top10Mil = top('milExpUsd').map((x) => x[0]);
for (const must of ['USA', 'CHN', 'DEU', 'JPN', 'IND']) if (!top10Gdp.includes(must)) fail(`top10 PIB sem ${must}`);
for (const must of ['USA', 'CHN', 'RUS', 'IND']) if (!top10Mil.includes(must)) fail(`top10 gasto sem ${must}`);
// 5. estimated counts
const cnt = {};
for (const id of ids) for (const f of stats[id].estimated) cnt[f] = (cnt[f] ?? 0) + 1;
console.log('campos estimados por indicador:', JSON.stringify(cnt));
// 6. military sanity
const nukers = ids.filter((i) => mil[i].nukes > 0).sort();
console.log('países com nukes:', nukers.join(','), '=', nukers.length);
if (nukers.length !== 9) fail('nuclear countries != 9');
for (const [f, expect] of [['tanks', ['USA', 4000, 5200]], ['carriers', ['USA', 11, 11]]]) {
  const [id, lo, hi] = expect; if (mil[id][f] < lo || mil[id][f] > hi) fail(`${id}.${f} fora`);
}
const derivedTotals = {};
const derivedIds = ids.filter((i) => !known[i] && stats[i].armedForces > 0);
for (const f of FIELDS) derivedTotals[f] = derivedIds.reduce((a, i) => a + mil[i][f], 0);
console.log(`derivados (${derivedIds.length} países) soma por campo:`, JSON.stringify(derivedTotals));
const maxDerived = derivedIds.map((i) => [i, mil[i].tanks]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('maiores tanks derivados:', maxDerived.map((x) => x.join(':')).join(' '));
// 7. alliances
const idset = new Set(ids);
let nm = 0;
for (const a of all.alliances) {
  if (!['defense', 'economic', 'political'].includes(a.kind)) fail(`alliance ${a.id} kind`);
  if (new Set(a.members).size !== a.members.length) fail(`alliance ${a.id} duplicate members`);
  for (const m of a.members) { nm++; if (!idset.has(m)) fail(`alliance ${a.id} bad member ${m}`); }
}
for (const r of all.rivalries) { if (!idset.has(r.a) || !idset.has(r.b) || ![1, 2, 3].includes(r.level)) fail(`rivalry ${r.a}-${r.b}`); }
for (const c of all.conflicts) if (!idset.has(c.a) || !idset.has(c.b)) fail(`conflict ${c.a}-${c.b}`);
const size = (id) => all.alliances.find((a) => a.id === id)?.members.length;
console.log(`alianças: ${all.alliances.length} (${nm} adesões, todas válidas) | OTAN ${size('NATO')} UE ${size('EU')} BRICS ${size('BRICS')} UA ${size('AU')} Liga Árabe ${size('ARAB-LEAGUE')} ASEAN ${size('ASEAN')}`);
console.log(`rivalidades ${all.rivalries.length} | conflitos ${all.conflicts.length}: ${all.conflicts.map((c) => c.a + '-' + c.b).join(' ')}`);
if (size('NATO') !== 32 || size('EU') !== 27) fail('NATO/EU size');

if (errors.length) { console.error('\nFALHAS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nVALIDAÇÃO OK');
