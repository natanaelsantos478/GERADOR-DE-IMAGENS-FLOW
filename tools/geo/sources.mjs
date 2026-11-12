import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './lib.mjs';

export function writeSources(r, pkg) {
  const today = new Date().toISOString().slice(0, 10);
  const cap = Object.entries(r.capitalMethod).filter(([m]) => m !== 'ADM0CAP')
    .map(([m, ids]) => `  - ${m}: ${ids.join(', ')}`).join('\n');
  const md = `# Fontes de dados geográficos (DADOS-GEO)

Gerado em ${today} por \`tools/geo/build.mjs\` (\`cd tools && npm run data:geo\`). Domínio público / MIT, sem chaves.

| arquivo | fonte | URL | licença |
|---|---|---|---|
| countries.json, countries.geo.json | Natural Earth 10m admin_0_countries (atributos, NAME_PT, ADM0CAP via populated places); geometria = dissolução das províncias simplificadas | https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip | Domínio público |
| provinces.json, provinces.geo.json | Natural Earth 10m admin_1_states_provinces; simplificação mapshaper (visvalingam ${r.simplifyPct}%, keep-shapes, clean allow-overlaps) | https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip | Domínio público |
| cities.json | Natural Earth 10m populated_places (pop = POP_MAX) | https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip | Domínio público |
| navgrid.json | Natural Earth 10m land rasterizado (0.05° -> 0.25°, maioria de terra) + estreitos abertos | https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip | Domínio público |
| elev.json | Tiles Terrarium z=5 (AWS Open Data: SRTM, GMTED, ETOPO1 e outras) reamostrados em 0.25° | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png | https://github.com/tilezen/joerd/blob/master/docs/attribution.md |
| flags/*.svg | npm flag-icons ${pkg.dependencies['flag-icons']} (4x3) | https://github.com/lipis/flag-icons | MIT |

## Decisões e métodos
- IDs: país = ADM0_A3; província = adm1_code (fallback \`\${adm0}-X<índice>\` se ausente/duplicado). Remapeamentos de countryId necessários: ${r.remapped} (todo adm0_a3 de admin_1 já existia em admin_0).
- Países sem nenhuma feature admin_1 recebem uma província de fallback \`<ID>-X0\` com a geometria real do admin_0: ${r.fallbackProvinceCountries.join(', ') || 'nenhum'}.
- \`sovereign\`: TYPE ∈ {Sovereign country, Country, Sovereignty, Disputed} e ADMIN = SOVEREIGNT (a unidade é o próprio soberano; ex.: FRA, USA, CHN, ISR, KOS true; HKG, GRL, GIB false); Somalilândia (SOL) e Chipre do Norte (CYN) marcados false (não reconhecidos); dependências, territórios, arrendamentos e indeterminados = false.
- \`iso2\`: ISO_A2, ou ISO_A2_EH quando -99 (França, Noruega, Kosovo…); \`null\` se não existe (sem bandeira).
- \`namePt\`: NAME_PT do Natural Earth (fallback NAME_EN quando vazio).
- \`neighbors\`: segmentos de fronteira compartilhados (hash de arestas) na topologia simplificada; países = união com a topologia bruta do admin_0. Áreas micro-disputadas tipo Indeterminate (BRI, CNM, KAS, SPI, BRT, PGA, BJN, SER, SCR) ficam fora das listas de vizinhos (Brasil = 10 vizinhos reais); PSX, SAH e ATA continuam.
- \`coastal\`: alguma aresta externa (não compartilhada) da província está a ≤ ~0,1° de célula de mar do raster NE land 0.05°. País coastal = alguma província coastal.
- \`color\`: coloração de grafo DSATUR em paleta de 10 cores; vizinhos terrestres nunca repetem cor.
- \`capital\`: ADM0CAP=1 de populated places (maior população). Fallbacks (não-ADM0CAP):
${cap || '  (nenhum)'}
- \`bbox\`: min/max simples de longitude (países que cruzam o antimeridiano, ex.: Rússia, Fiji, EUA, têm w≈-180 e e≈180).
- \`areaKm2\`: área esférica da geometria original (não simplificada).
- \`elevMean\`: média (m) das células de 0.25° cujo centro cai na província (célula = média das amostras de terra z5); \`rugged\` = min(1, desvio-padrão das altitudes z5 na província / 800 m).
- \`elev.json\`: Int16 LE base64, linha 0 = lat 90 (norte), coluna 0 = lon -180; mar = batimetria; |lat|>85,05° = 0.
- \`navgrid.json\`: bit 1 = mar navegável (LSB-first dentro de cada byte, índice = linha*1440+coluna); célula é terra se ≥50% do raster 0.05° é terra; estreitos abertos por corredores (${Object.entries(r.carved).map(([k, v]) => `${k}:${v}`).join(', ')} células abertas).
`;
  fs.writeFileSync(path.join(OUT, 'SOURCES.geo.md'), md);
}
