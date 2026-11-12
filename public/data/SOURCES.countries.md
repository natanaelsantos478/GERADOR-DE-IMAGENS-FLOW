# Fontes — dados por país (stats, military, alliances)

Gerado por `tools/countries/build.mjs` (`cd tools && npm run data:countries`) em 2026-11-12.
Chave de todos os arquivos: `ADM0_A3` de Natural Earth `ne_10m_admin_0_countries` (258 ids).

## stats.json
- **Banco Mundial (World Development Indicators)**, API pública `https://api.worldbank.org/v2/country/all/indicator/<IND>?format=json&per_page=20000&date=2015:2025`, licença CC BY 4.0.
  Indicadores: SP.POP.TOTL, NY.GDP.MKTP.CD, NY.GDP.MKTP.KD.ZG, MS.MIL.XPND.CD (fonte original SIPRI), MS.MIL.TOTL.P1 (fonte original IISS),
  EG.USE.ELEC.KH.PC, SP.URB.TOTL.IN.ZS, SP.DYN.LE00.IN. Usa-se o último valor não nulo de 2015–2025 por país; o ano de cada campo está em `years`; `year` = ano da população.
- **Natural Earth** `ne_10m_admin_0_countries` (domínio público, https://www.naturalearthdata.com): `POP_EST` e `GDP_MD` quando o Banco Mundial não tem o país.
- **Preenchimento de lacunas** (sempre listado em `estimated`): média ponderada por população da sub-região Natural Earth para taxas
  (crescimento do PIB, kWh per capita, urbanização, expectativa de vida); mediana da sub-região para razões (PIB per capita, gasto militar/PIB, efetivos/população).
  Territórios dependentes (id ≠ SOV_A3), concessões e áreas indeterminadas têm `armedForces` e `milExpUsd` = 0 (defesa a cargo do soberano), marcados em `estimated`.
- **Suplemento público** (valores aproximados, marcados `estimated`; em `tools/countries/stats.mjs`): Taiwan (Ministério da Defesa de Taiwan / IISS 2024), Coreia do Norte (IISS 2024; gasto é estimativa de baixa confiança), Eritreia, Cuba, Síria, Somália, Kosovo (IISS 2024).
- **oilProdBpd** (55 países): produção total de petróleo (cru + condensado + NGL), barris/dia, ~2023, arredondada. Fontes: Energy Institute Statistical Review of World Energy 2024 e US EIA International Energy Statistics; tabela em `tools/countries/oil.json`.
  Campo omitido para países sem produção relevante.

## military.json
- 61 forças armadas com inventário aproximado do mundo real em `tools/countries/military-known.json` (IISS The Military Balance 2024/2025, SIPRI, FAS Nuclear Notebook 2025 — números públicos arredondados, ordem de grandeza correta, não exatos; campo `obs` por país).
- Demais países (133 com efetivos > 0): derivados por regressão log-linear
  `contagem = exp(b0 + b1·ln(efetivos/1000) + b2·ln(gastoMilUSD/1e9)) − 1`, ajustada por campo sobre os 61 países da tabela conhecida (calibração) e limitada por tetos plausíveis
  (ex.: veículos ≤ efetivos/25, drones ≤ efetivos/20, aeronaves/helis ≤ efetivos/150, navios ≤ efetivos/800). Naval só para países com litoral.
  `bombers`, `destroyers`, `carriers` e `nukes` nunca são derivados (0 fora da tabela). `nukes` > 0 só para os 9 países nucleares reais (estoque militar estimado FAS 2025).

| campo | b0 | b1 (efetivos) | b2 (gasto) | R² (espaço log1p) |
|---|---|---|---|---|
| tanks | 1.1238 | 0.8705 | 0.0293 | 0.346 |
| ifv | 4.0001 | 0.4205 | 0.2187 | 0.606 |
| artillery | 1.2894 | 0.9142 | -0.0257 | 0.655 |
| mlrs | -1.9724 | 1.1764 | -0.145 | 0.445 |
| sam | 0.9538 | 0.559 | 0.2493 | 0.54 |
| fighters | 0.9168 | 0.4789 | 0.4205 | 0.646 |
| attackHelis | -2.2386 | 0.852 | 0.2976 | 0.537 |
| transports | 0.4129 | 0.4129 | 0.3165 | 0.701 |
| drones | -0.3453 | 0.5821 | 0.433 | 0.548 |
| frigates | -0.3646 | 0.2345 | 0.3162 | 0.449 |
| subs | -1.5931 | 0.4097 | 0.3233 | 0.45 |

## alliances.json
Estrutura `{alliances:[{id,name,kind,members,note?}], rivalries:[{a,b,level 1..3}], conflicts:[{a,b,note}]}`.
Composição vigente em 2025/início de 2026 segundo conhecimento público (tratados, sites oficiais das organizações). `kind: defense` só para tratados de defesa mútua (OTAN, OTSC, AUKUS, ANZUS e pactos bilaterais).
Fonte editável: `tools/countries/alliances-src.json`. Rivalidades e conflitos são julgamento editorial a partir de fatos públicos; a lista de `conflicts` (guerras/confrontos interestatais ativos no início de 2026) deve ser revisada pelo dono do jogo, pois a situação muda rápido.
