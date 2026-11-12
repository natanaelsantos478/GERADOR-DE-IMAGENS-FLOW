// Builds public/data/{stats,military,alliances}.json and SOURCES.countries.md. Run via `npm run data:countries`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, readJson, here, loadCountries } from './common.mjs';
import { buildStats } from './stats.mjs';
import { buildMilitary } from './military.mjs';
import { buildAlliances } from './alliances.mjs';

mkdirSync(OUT, { recursive: true });
const countries = loadCountries();
const stats = buildStats(countries);

const oil = readJson(join(here, 'oil.json')); delete oil._meta;
for (const [id, bpd] of Object.entries(oil)) {
  if (!stats[id]) throw new Error('oil.json: unknown id ' + id);
  stats[id].oilProdBpd = bpd;
}

const { military, coef, knownCount, derivedCount, trainN } = buildMilitary(countries, stats);
const alliances = buildAlliances(countries);

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const write = (f, d) => writeFileSync(join(OUT, f), JSON.stringify(d));
write('stats.json', sortKeys(stats));
write('military.json', sortKeys(military));
write('alliances.json', alliances);

const day = new Date().toISOString().slice(0, 10);
const coefRows = Object.entries(coef).map(([f, c]) => `| ${f} | ${c.coef.join(' | ')} | ${c.r2} |`).join('\n');
writeFileSync(join(OUT, 'SOURCES.countries.md'), `# Fontes — dados por país (stats, military, alliances)

Gerado por \`tools/countries/build.mjs\` (\`cd tools && npm run data:countries\`) em ${day}.
Chave de todos os arquivos: \`ADM0_A3\` de Natural Earth \`ne_10m_admin_0_countries\` (${countries.length} ids).

## stats.json
- **Banco Mundial (World Development Indicators)**, API pública \`https://api.worldbank.org/v2/country/all/indicator/<IND>?format=json&per_page=20000&date=2015:2025\`, licença CC BY 4.0.
  Indicadores: SP.POP.TOTL, NY.GDP.MKTP.CD, NY.GDP.MKTP.KD.ZG, MS.MIL.XPND.CD (fonte original SIPRI), MS.MIL.TOTL.P1 (fonte original IISS),
  EG.USE.ELEC.KH.PC, SP.URB.TOTL.IN.ZS, SP.DYN.LE00.IN. Usa-se o último valor não nulo de 2015–2025 por país; o ano de cada campo está em \`years\`; \`year\` = ano da população.
- **Natural Earth** \`ne_10m_admin_0_countries\` (domínio público, https://www.naturalearthdata.com): \`POP_EST\` e \`GDP_MD\` quando o Banco Mundial não tem o país.
- **Preenchimento de lacunas** (sempre listado em \`estimated\`): média ponderada por população da sub-região Natural Earth para taxas
  (crescimento do PIB, kWh per capita, urbanização, expectativa de vida); mediana da sub-região para razões (PIB per capita, gasto militar/PIB, efetivos/população).
  Territórios dependentes (id ≠ SOV_A3), concessões e áreas indeterminadas têm \`armedForces\` e \`milExpUsd\` = 0 (defesa a cargo do soberano), marcados em \`estimated\`.
- **Suplemento público** (valores aproximados, marcados \`estimated\`; em \`tools/countries/stats.mjs\`): Taiwan (Ministério da Defesa de Taiwan / IISS 2024), Coreia do Norte (IISS 2024; gasto é estimativa de baixa confiança), Eritreia, Cuba, Síria, Somália, Kosovo (IISS 2024).
- **oilProdBpd** (${Object.keys(oil).length} países): produção total de petróleo (cru + condensado + NGL), barris/dia, ~2023, arredondada. Fontes: Energy Institute Statistical Review of World Energy 2024 e US EIA International Energy Statistics; tabela em \`tools/countries/oil.json\`.
  Campo omitido para países sem produção relevante.

## military.json
- ${knownCount} forças armadas com inventário aproximado do mundo real em \`tools/countries/military-known.json\` (IISS The Military Balance 2024/2025, SIPRI, FAS Nuclear Notebook 2025 — números públicos arredondados, ordem de grandeza correta, não exatos; campo \`obs\` por país).
- Demais países (${derivedCount} com efetivos > 0): derivados por regressão log-linear
  \`contagem = exp(b0 + b1·ln(efetivos/1000) + b2·ln(gastoMilUSD/1e9)) − 1\`, ajustada por campo sobre os ${trainN} países da tabela conhecida (calibração) e limitada por tetos plausíveis
  (ex.: veículos ≤ efetivos/25, drones ≤ efetivos/20, aeronaves/helis ≤ efetivos/150, navios ≤ efetivos/800). Naval só para países com litoral.
  \`bombers\`, \`destroyers\`, \`carriers\` e \`nukes\` nunca são derivados (0 fora da tabela). \`nukes\` > 0 só para os 9 países nucleares reais (estoque militar estimado FAS 2025).

| campo | b0 | b1 (efetivos) | b2 (gasto) | R² (espaço log1p) |
|---|---|---|---|---|
${coefRows}

## alliances.json
Estrutura \`{alliances:[{id,name,kind,members,note?}], rivalries:[{a,b,level 1..3}], conflicts:[{a,b,note}]}\`.
Composição vigente em 2025/início de 2026 segundo conhecimento público (tratados, sites oficiais das organizações). \`kind: defense\` só para tratados de defesa mútua (OTAN, OTSC, AUKUS, ANZUS e pactos bilaterais).
Fonte editável: \`tools/countries/alliances-src.json\`. Rivalidades e conflitos são julgamento editorial a partir de fatos públicos; a lista de \`conflicts\` (guerras/confrontos interestatais ativos no início de 2026) deve ser revisada pelo dono do jogo, pois a situação muda rápido.
`);
console.log(`stats: ${Object.keys(stats).length} | military: known ${knownCount}, derived ${derivedCount} | alliances: ${alliances.alliances.length}, rivalries ${alliances.rivalries.length}, conflicts ${alliances.conflicts.length}`);
