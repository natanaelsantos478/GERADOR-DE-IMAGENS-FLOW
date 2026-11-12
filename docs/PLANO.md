# MERIDIANO — Comando Global · Plano Mestre

Jogo ORIGINAL de grande estratégia moderna (2026) em tempo real com pausa, sobre um globo 3D real
(estilo Google Earth), com batalhas táticas em tempo real ao aproximar o zoom. Gênero: grande estratégia
+ RTS tático. NÃO copiar nome, arte, UI, música ou textos de nenhum jogo existente.

Público: um jogador, navegador desktop. Idioma da UI: **pt-BR** (dicionário i18n com `en` secundário).
Diretriz de design: **completo, não difícil**. Muita profundidade, mas tudo com automação opcional,
tooltips explicando causa→efeito, IA pouco agressiva na dificuldade padrão ("Normal" = fácil).

Este documento é o contrato. Se algo aqui conflitar com sua intuição, vale o documento. Se algo aqui for
impossível, faça a alternativa mais próxima e DIGA no relatório final.

---

## 1. Stack (fixo)

- Vite + TypeScript `strict` · Node 22 · ESM.
- **CesiumJS** (npm `cesium`) = único motor 3D: globo, terreno, imagens de satélite, modelos glTF, partículas.
  Não adicionar three.js/babylon.
- React 18 + zustand para a UI (HTML/CSS sobre o canvas). CSS puro com tokens em `src/ui/theme.css`.
- Simulação = TypeScript puro, sem DOM, sem Cesium, determinística (RNG com seed do core), roda em Node.
- Testes: vitest (sim) · Playwright (e2e; Chromium já instalado, NÃO rodar `playwright install`;
  WebGL headless: args `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`).
- Sem backend. Tudo estático (`vite build` → `dist/`, `base: './'`). Save em IndexedDB + exportar/importar arquivo.
- Sem chaves obrigatórias. Provedores sem chave por padrão:
  - Imagem: ESRI World Imagery `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
    alternativa EOX Sentinel-2 cloudless `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg`;
    fallback offline: NaturalEarthII que vem dentro do pacote cesium.
  - Terreno: provider próprio que decodifica tiles Terrarium da AWS
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (altura = R*256+G+B/256-32768) em `HeightmapTerrainData`.
  - `Ion.defaultAccessToken` deve ficar vazio; nunca usar provider que dependa do token default.
  - Opcional (tela Configurações): token Cesium ion → World Terrain + OSM Buildings; chave Google → Photorealistic 3D Tiles.
  - Créditos/atribuições visíveis (ESRI, EOX, Natural Earth, WRI, Banco Mundial, autores dos modelos).

## 2. Regras para TODOS os agentes

1. Só escreva dentro dos diretórios que o seu prompt declara como seus. Leia qualquer coisa.
2. **Proibido**: `git commit/push/checkout/stash/reset/clean`, matar processos que você não criou, apagar arquivos de outros.
3. **Proibido mocks/stubs/dados inventados/"TODO depois"**. Dados vêm de fontes reais; funcionalidade listada é implementada de verdade.
   Se uma fonte falhar, tente outra fonte real; se nenhuma, reporte — não invente.
4. Dependência nova na raiz: `flock /tmp/meridiano-npm.lock npm install <pkg>` (evita corrida no package.json). Só se necessário.
5. Teste antes de declarar pronto: seus testes vitest passam; `npx tsc --noEmit` sem erros NOS SEUS diretórios
   (erros em diretórios de outros agentes em andamento: ignore e reporte). Quem mexe em algo visual valida com
   Playwright + screenshot e OLHA o screenshot (ferramenta Read abre PNG).
6. Dev server: use a porta indicada no seu prompt (`npx vite --port N --strictPort`), encerre ao terminar.
7. Estado da simulação é JSON puro (sem classes, Map, Set, funções, typed arrays). `JSON.parse(JSON.stringify(state))` deve preservar tudo.
8. Nada de `Math.random()`/`Date.now()` na simulação: use `ctx.rng` e `state.time`.
9. Contratos de `src/core` só são alterados pelo dono (Fundação/Integração). Precisa de algo novo? Resolva dentro
   do seu módulo e liste "pedidos de contrato" no relatório.
10. Código e identificadores em inglês; textos de UI via i18n (pt-BR completo, en opcional); comentários só onde o porquê não é óbvio.
11. Arquivos ≤ ~500 linhas; módulos pequenos e coesos.
12. Relatório final curto (≤ 40 linhas): o que foi feito, como verificou (comandos + resultado), o que NÃO funcionou,
    pedidos de contrato, caminhos dos screenshots. Seja honesto: falha reportada vale mais que sucesso falso.

## 3. Estrutura de diretórios e donos

```
docs/PLANO.md                 orquestrador
tools/                        pipeline de dados e assets (package.json PRÓPRIO; raw em tools/.cache/ — gitignored)
public/data/                  dados gerados (seção 4)
public/models/ + manifest.json   modelos glb
public/audio/ public/icons/ public/flags/
src/core/                     Fundação: contratos, estado, loop, bus, rng, geo, registry, world-dyn
src/data/                     Fundação: loaders + índice espacial
src/app/                      Fundação→Integração: bootstrap, game loop, headless runner, save/load
src/sim/economy/              ECO: economia, energia, população, construções, recursos, comércio
src/sim/diplomacy/            DIP: diplomacia, guerras/paz, alianças, eventos mundiais
src/sim/research/             DIP: árvore tecnológica + modificadores
src/sim/military/             MIL: unidades, formações, movimento, logística, batalhas estratégicas, mísseis
src/sim/tactical/             TAC: simulação de batalha tática (pura)
src/sim/ai/                   IA estratégica dos países
src/render/globe/             GLOBO: viewer, imagens, terreno, camadas, modos de mapa, câmera, picking
src/render/units/             unidades/estruturas no globo (ícones longe, modelos 3D perto) + efeitos
src/render/tactical/          visual da batalha tática
src/ui/                       UI React
src/audio/
e2e/                          Playwright
```

## 4. Dados reais — esquemas de `public/data/` (fixos)

IDs canônicos: **país = `ADM0_A3`** de `ne_10m_admin_0_countries` (Natural Earth). **província = `adm1_code`** de
`ne_10m_admin_1_states_provinces` (se ausente/duplicado: `${adm0_a3}-X${índice no arquivo bruto}`); o `countryId` de
província é o `adm0_a3` remapeado para um id existente em countries (garantir 100% de correspondência).
Coordenadas sempre `[lon, lat]` graus WGS84, arredondadas a 4 casas (3 em geometrias). Associação ponto→província é
feita em runtime pelo loader (índice espacial), então arquivos de pontos trazem só lon/lat (+ `iso3` da fonte como dica).
Todo arquivo de pontos é "colunar" quando > 5k itens: `{ "n": N, "cols": { "lon":[...], "lat":[...], ... } }`.

| arquivo | conteúdo |
|---|---|
| `countries.json` | `[{id, iso2, name, namePt, continent, subregion, sovereign: bool, centroid, bbox:[w,s,e,n], color:[r,g,b] (distintas entre vizinhos), capital:{name,lon,lat}, neighbors:[id] (fronteira terrestre), coastal}]` |
| `countries.geo.json` | FeatureCollection simplificada (≤ 3 MB), `properties:{id}` |
| `provinces.json` | `[{id, countryId, name, centroid, areaKm2, neighbors:[provinceId], coastal, elevMean, rugged (0..1)}]` |
| `provinces.geo.json` | FeatureCollection simplificada preservando topologia (≤ 9 MB), `properties:{id}`; NENHUMA província removida |
| `cities.json` | colunar: `name, lon, lat, pop, capital (0/1/2 = não/admin1/nacional), iso3` — NE populated places 10m (~7k) |
| `powerplants.json` | colunar: `name, lon, lat, fuel, mw, iso3` — WRI Global Power Plant Database completo (~35k). `fuel` ∈ coal, gas, oil, nuclear, hydro, wind, solar, biomass, geothermal, other |
| `airports.json` | `name, lon, lat, iata, size (0..2), military (0/1)` — NE 10m airports |
| `ports.json` | `name, lon, lat, size (0..2)` — NE 10m ports |
| `roads.json` | grafo roteável: `{nodes:{lon:[],lat:[]}, edges:{a:[],b:[],km:[],cls:[], geomStart:[], geomLen:[]}, geom:[lon,lat,...]}`; `cls` 0=autoestrada 1=principal 2=secundária 3=ferrovia 4=balsa. NE 10m roads + railroads, nós fundidos em interseções/pontas (snap ~1 km), componentes conectados |
| `navgrid.json` | grade 0.25° (1440×720): `{w,h, sea: base64 bitset}` (1 = navegável) a partir de NE land 10m |
| `elev.json` | grade 0.25° de elevação em metros (Int16 base64) amostrada dos tiles Terrarium z≈5 |
| `stats.json` | por país: `{pop, gdpUsd, gdpGrowth, milExpUsd, armedForces, electricityKwhPc, oilProdBpd?, urbanPct, lifeExp, year}` — Banco Mundial (último ano disponível); lacunas preenchidas por dado real alternativo (NE `POP_EST`/`GDP_MD`) e marcadas em `estimated:[campos]` |
| `military.json` | por país: inventário inicial aproximado do mundo real `{tanks, ifv, artillery, mlrs, sam, fighters, bombers, attackHelis, transports, drones, destroyers, frigates, subs, carriers, nukes}`; para quem não tiver dado: derivado de `milExpUsd`/`armedForces` por fórmula documentada |
| `alliances.json` | `[{id, name, kind: defense|economic|political, members:[countryId]}]` — OTAN, UE, OTSC, BRICS, OCX, AUKUS, Liga Árabe, UA, ASEAN, Mercosul… e `rivalries:[{a,b,level}]`, `conflicts:[{a,b}]` (guerras ativas no início de 2026) |
| `flags/{iso2}.svg` | do pacote npm `flag-icons` (MIT) |
| `SOURCES.md` | fonte, URL, licença e data de cada arquivo |

Pipeline reproduzível: `cd tools && npm i && npm run data:all`. Tamanho total de `public/data` ≤ 45 MB.

## 5. Modelos 3D, áudio e ícones

`public/models/manifest.json`: `{ [modelId]: {file, lengthM (comprimento real desejado), yawOffsetDeg, zOffsetM, license, author, source} }`.
Licenças aceitas: CC0, CC-BY (com atribuição), domínio público, MIT. Cada glb ≤ 1.5 MB (reduzir texturas p/ ≤1024px, draco NÃO).
modelIds obrigatórios: `mbt, ifv, apc, truck, spg, mlrs, sam, radar, soldier, attack_heli, transport_heli, fighter, bomber,
transport_plane, drone, destroyer, frigate, carrier, submarine, cargo_ship, missile, plant_thermal, plant_nuclear, plant_hydro,
wind_turbine, solar_farm, factory, refinery, airport, port, military_base, city_block, capital_building`.
Áudio (ogg/mp3, CC0): tiros, canhão, explosões, jato, hélice, míssil, sirene, cliques de UI, notificação, trilha ambiente.
Ícones SVG de UI: coerentes, monocromáticos (`currentColor`).

## 6. Arquitetura da simulação (core)

```ts
interface WorldStatic { countries, provinces, cities, plants, airports, ports, roads, navGrid, elev, stats, military, alliances;
  // índices prontos:
  countryById, provinceById, citiesByProvince, citiesByCountry, plantsByCountry, provincesByCountry,
  locateProvince(lon,lat): ProvinceId|null, nearestRoadNode(lon,lat), isSea(lon,lat), elevationAt(lon,lat) }

interface GameState {
  meta: { version, dataHash, seed, playerCountryId, difficulty: 'sandbox'|'normal'|'hard', automation: Record<string,boolean> };
  time: { hours: number /* desde 2026-01-01T00:00Z */, speed: 0..5, paused: boolean };
  rng: RngState;
  world: WorldDyn;            // core
  economy; diplomacy; research; military; ai; tactical;   // fatia de cada módulo, tipada no próprio módulo
  news: NewsItem[];           // core (limite 300)
}
interface WorldDyn {
  owner: Record<ProvinceId, CountryId>; controller: Record<ProvinceId, CountryId>;
  alive: Record<CountryId, boolean>; overlord: Record<CountryId, CountryId>;      // fantoches
  cityDamage, plantDamage, airportDamage, portDamage, roadDamage: Record<number, number>; // esparso 0..1
}
interface SimSystem<Slice> {
  id: 'economy'|'diplomacy'|'research'|'military'|'ai'|'tactical';
  createSlice(ctx): Slice;                 // novo jogo
  update?(ctx, dtHours): void;             // todo substep (≤ 1 h de jogo)
  onDay?(ctx): void; onWeek?(ctx): void; onMonth?(ctx): void;
  handle?(ctx, cmd: Command): CommandResult | undefined;   // comandos com o prefixo do módulo
  api(ctx): object;                        // API pública registrada em ctx.api[id]
}
interface Ctx { world: WorldStatic; state: GameState; rng; bus; api: {economy, diplomacy, research, military, ai, tactical, worldDyn}; dispatch(cmd) }
type Command = { type: `${prefixo}.${ação}`; country: CountryId; [k]: unknown };   // jogador e IA usam os MESMOS comandos
type CommandResult = { ok: true } | { ok: false; reason: string /* chave i18n */ };
```

- Ordem de update: research → economy → diplomacy → military → tactical → ai.
- Velocidades: 1 = 1 h de jogo/s · 2 = 4 h/s · 3 = 12 h/s · 4 = 1 dia/s · 5 = 4 dias/s. Substeps ≤ 1 h. Orçamento: 1 dia de jogo
  simulado (mundo inteiro, IA incluída) ≤ 12 ms em média no Node.
- `worldDyn` (core) expõe mutadores que emitem eventos: `setController`, `setOwner`, `damage(kind,index,amount,cause)`, `repair`,
  `killCountry`, e leituras (`controllerOf`, `provincesControlledBy`, `effectiveHealth(kind,index)`).
- Eventos `bus.emit({type:'mil.battleStarted', ...})`: mesma convenção de prefixo. `news.push` via helper `ctx.news(kind, textKey, params, where?)`.
- **Modificadores**: `ctx.api.research.mod(country, key)` devolve multiplicador (default 1). Chaves namespaced (`eco.taxEfficiency`, `mil.armor.attack`, …).
  Qualquer módulo pode registrar fontes de modificador temporário (`addModifier(country,key,value,untilHours,source)`).
- Runner headless: `npm run sim:soak -- --years 3 --player BRA` roda o mundo inteiro com IA, imprime métricas, falha em NaN/exceção/estouro de orçamento.

### APIs públicas mínimas (cada dono pode ampliar; assinaturas finais ficam em `src/core/contracts.ts`)

- **economy**: `treasury(c)`, `canAfford(c,cost)`, `charge(c,cost,reason)`, `credit(c,amount,reason)`, `stock(c,res)`, `consume(c,res,amount)→consumido`,
  `energy(c)→{supplyMw,demandMw,ratio}`, `stability(c)`, `approval(c)`, `citySatisfaction(cityIdx)`, `addUnrest(target,delta,reasonKey,days)`,
  `manpower(c)`, `drawManpower(c,n)`, `returnManpower(c,n)`, `militaryIndustry(c)→pontos/dia`, `structures(filtro)`, `structureAt(...)`, `ledger(c)→linhas do orçamento`.
  Recursos (`res`): money, energy (fluxo), oil, food, steel, electronics, rareEarth, uranium, munitions, consumerGoods.
- **diplomacy**: `relation(a,b)` −100..100, `atWar(a,b)`, `allied(a,b)`, `enemies(c)`, `wars()`, `access(a,b)`, `tradeDeal(a,b)`, `modRelation(a,b,delta,reasonKey)`,
  `declareWar` só via comando; `warScore(war, lado)`.
- **research**: `has(c,tech)`, `mod(c,key)`, `addModifier(...)`, `progress(c)`.
- **military**: `formations(filtro)`, `formation(id)`, `power(c)`, `upkeepPerDay(c)→cost`, `battles()`, `battle(id)`, `spawn(c, template, where)`,
  `strikeCapability(c)`, `pathPreview(formationId, destino)`.
- **tactical**: `active()→TacticalBattle|null`, `start(battleId)`, `snapshot()`.

## 7. Sistemas de jogo (o que precisa existir)

### 7.1 Tempo, início e fim
Novo jogo: escolher QUALQUER país soberano no globo (ficha com dados reais), dificuldade, automações. Data inicial 01/01/2026.
Sem "game over" forçado exceto perder todo o território; objetivos opcionais (pontuação, metas nacionais) e modo sandbox (dinheiro livre).

### 7.2 Território
Província (admin-1 real) = unidade territorial; tem dono (de jure) e controlador (ocupação). País = conjunto de províncias.
Cidades reais com população real; usinas, aeroportos, portos, estradas e ferrovias reais, cada um com dano 0..1 e reparo (custo + tempo).

### 7.3 Economia e população (ECO)
- PIB real como base; setores (agro, indústria, serviços, energia, extração) por país, influenciados por estruturas e população.
- Orçamento mensal: impostos (renda, empresas, consumo — sliders) → receita; despesas por pasta (saúde, educação, segurança,
  infraestrutura, social, defesa, pesquisa — sliders) + manutenção militar + juros. Dívida, rating, inflação simples.
- **Energia**: cada usina real gera MW × fator de capacidade do combustível × saúde × disponibilidade de combustível; demanda = população × consumo per capita + indústria.
  Déficit → apagões por cidade → cai produção e satisfação. Construir novas usinas (tipo, local, custo, prazo), importar/exportar energia com vizinhos.
- Recursos com produção/consumo/estoque diários e comércio (acordos bilaterais e mercado global com preço por oferta/demanda; sanções/bloqueio naval cortam).
- **Satisfação por cidade** (0..100) com causas visíveis: impostos, emprego, energia, comida, bens, saúde/educação, segurança, guerra (baixas, bombardeio, ocupação),
  ideologia. Agrega em aprovação e estabilidade nacional. Baixa → greves, protestos, revoltas (formações rebeldes), golpe/eleição.
- Crescimento populacional, migração/refugiados em guerra, mão de obra (manpower) para recrutamento.
- Construções por província/cidade: usinas, fábricas civis, fábricas militares, refinaria, mina, fazenda, hospital, universidade, estrada/ferrovia (liga 2 nós do grafo),
  porto, aeroporto, base militar, defesa antiaérea, radar, silo, bunker. Fila de construção com custo, prazo e pré-requisitos.
- Automação: orçamento automático, construção automática, comércio automático (liga/desliga cada uma).

### 7.4 Diplomacia (DIP)
Relações bilaterais com histórico de causas; alianças reais iniciais; ações: melhorar relações, acordo comercial, pacto de não agressão, acesso militar,
aliança defensiva, garantir independência, embargo/sanção, exigir tributo/território, apoiar rebeldes, declarar guerra (com casus belli e custo de reputação),
chamar aliados, propor paz. Guerra com placar; capitulação (capital + ≥50% da população urbana ocupadas) → conferência de paz: anexar tudo / anexar ocupado /
fantoche / mudar regime / reparações / paz branca. Reputação global ("opinião internacional"), organização tipo assembleia mundial com votações de sanção.
Eventos mundiais aleatórios plausíveis (crise, desastre, eleição, escândalo) com escolhas. Armas nucleares têm consequência diplomática massiva.

### 7.5 Pesquisa (DIP)
Árvore com ≥ 60 tecnologias em 6 ramos (exército, aeronáutica, marinha, mísseis/nuclear/espaço/ciber, economia/indústria, energia/sociedade);
custo em pontos de pesquisa (orçamento + universidades); desbloqueia unidades, construções e modificadores. País já começa com tecnologias conforme seu nível real.

### 7.6 Militar estratégico (MIL)
- Tipos de unidade (batalhão/esquadrão/navio) com atributos: ataque mole/duro/aéreo/naval, defesa, alcance, velocidade (estrada/fora), consumo (combustível, munição),
  custo, tempo, manpower, modelId. Mínimo: infantaria, inf. mecanizada, blindado (MBT), reconhecimento, artilharia AP, MLRS, antiaérea (SAM), engenharia, logística,
  forças especiais, heli de ataque, heli de transporte, caça, bombardeiro, transporte aéreo, drone, destróier, fragata, submarino, porta-aviões, navio de desembarque,
  míssil de cruzeiro, míssil balístico, ogiva nuclear.
- **Formações** (brigadas/divisões, alas aéreas, frotas) = lista de unidades com força, organização, moral, experiência, suprimento, ordem e posição [lon,lat].
  Forças iniciais geradas de `military.json`, baseadas em cidades/aeroportos/portos reais do país.
- Movimento em tempo de jogo: terra pelo grafo de estradas (estrada rápida; fora de estrada lento e dependente de relevo; trecho danificado = muito lento até reparo),
  mar por A* na navgrid, ar por grande círculo a partir de aeroportos com raio de ação. Transporte naval/aéreo de tropas. Travessia de fronteira exige guerra ou acesso.
- Logística: suprimento flui de depósitos/cidades por estradas/portos; sem suprimento a formação perde organização. Combustível e munição saem do estoque nacional.
- Missões aéreas (superioridade, ataque ao solo, bombardeio estratégico de usina/estrada/fábrica/porto, reconhecimento, transporte), ataques de míssil e drone contra
  alvos reais, defesa antiaérea intercepta, radar dá visão. Névoa de guerra por alcance de visão/radar/satélite.
- Naval: bloqueio de portos, combate de frotas, desembarque anfíbio, escolta.
- Produção militar: fila por país consumindo pontos de indústria militar + recursos + manpower; treinamento; reforço; modernização.
- **Batalha** nasce quando formações hostis entram em contato. Resolve-se sozinha a cada hora de jogo (auto-resolução usando os mesmos atributos, terreno, entrincheiramento,
  suprimento, apoio aéreo/artilharia) OU o jogador entra em **modo tático**. Ocupar a cidade principal de uma província sem inimigos por N horas troca o controlador.
- Dano colateral real: combate e bombardeio danificam cidade, usinas, estradas e população → efeitos em energia/satisfação/economia.
- Nuclear: pesquisar → construir ogivas e vetores → lançar; destrói alvo, mata população, radiação temporária, reação mundial.

### 7.7 Batalha tática (TAC) — o "zoom"
Ao escolher "Comandar batalha": relógio estratégico congela, câmera voa para o local real, área de ~8×8 km sobre o terreno e imagem de satélite reais.
Cada unidade da formação vira um grupo de N entidades 3D (ex.: batalhão de MBT = 10–14 tanques; infantaria = pelotões). Tempo real ×0.5/×1/×2/×4 com pausa.
- Sim pura recebe `TacticalMapInput {sizeM, heights[grid], cover[grid], roads, urban areas}` (alturas amostradas do terreno pelo render; em teste headless vem de `elev`).
- Ordens: mover, atacar-mover, atacar alvo, manter posição, recuar, formação (linha/coluna/cunha/dispersa), direção de frente, cessar fogo/fogo à vontade,
  entrincheirar, fumaça, pedir artilharia/ataque aéreo/drone (se houver recursos estratégicos em alcance), desembarcar infantaria de IFV.
- Modelo: linha de visada pelo relevo, alcance, blindagem frontal/lateral/traseira (flanquear importa), supressão, moral e debandada, munição, cobertura
  (urbano/floresta/relevo), velocidade por inclinação e estrada, zonas de implantação, objetivos (pontos de controle) + destruição/moral como condição de vitória.
- IA tática para o inimigo E para aliados/"auto-comandar" (o jogador pode delegar tudo e só assistir).
- Resultado (baixas, moral, vencedor, dano ao local) volta para a batalha estratégica. Jogador pode sair e deixar auto-resolver.

### 7.8 IA estratégica
Cada país IA: gere orçamento, constrói, pesquisa, comercia, reage à satisfação, mantém forças, posiciona defesa, responde a guerras (frente, objetivos, recuo),
faz diplomacia coerente com alianças/rivalidades reais. Agressividade por dificuldade: `sandbox` nunca ataca o jogador; `normal` só em casus belli forte/aliança;
`hard` oportunista. Fatiada no tempo (cada país pensa em dias diferentes) para caber no orçamento de CPU. Conselheiro do jogador: sugestões acionáveis ("faltam 2 GW — construir usina em X").

### 7.9 Globo e render
- Zoom contínuo do planeta até ~200 m do solo. Atmosfera, iluminação dia/noite opcional, céu.
- Camadas (com LOD por distância): fronteiras de países/províncias, preenchimento do modo de mapa, nomes, cidades (por porte), usinas (ícone por combustível),
  aeroportos, portos, estradas/ferrovias (danificadas em destaque), estruturas construídas, formações, batalhas, rotas, mísseis em voo, alcance de radar/SAM, névoa de guerra.
- Polígonos/linhas em escala mundial: fatiar GeoJSON com `geojson-vt` e desenhar em canvas por tile dentro de um `ImageryProvider` próprio (nítido em qualquer zoom,
  acompanha o relevo, recolorível). NÃO criar milhares de entidades-polígono Cesium.
- Modos de mapa: satélite puro, político, diplomático, satisfação, energia, economia, suprimento, terreno.
- Longe: marcador da formação (símbolo tático + bandeira + barra de força). Perto: modelos glb em formação, orientados ao movimento, colados ao terreno;
  aeronaves na altitude; navios no mar. Efeitos: disparos, traçantes, explosões, fumaça, incêndio em estrutura danificada, cratera/decals, cogumelo nuclear.
- Picking → seleção; clique direito → ordem contextual; caixa de seleção; atalhos; minimapa; "ir para" capital/alerta.

### 7.10 UI
Barra superior (bandeira, data, velocidade/pausa, dinheiro ±, energia, estabilidade, manpower, alertas), barra lateral de pastas (Economia, Orçamento, Energia,
Construção, População, Comércio, Diplomacia, Pesquisa, Forças Armadas, Produção, Inteligência), painel contextual do que foi selecionado (província, cidade, usina,
formação, batalha, país estrangeiro), feed de notícias, alertas clicáveis que levam ao local, livro-razão, gráficos históricos, tela de paz, tela de batalha (HUD tático),
menu principal, escolha de país, salvar/carregar, configurações (gráficos, áudio, idioma, tokens opcionais), tutorial guiado, enciclopédia. Visual próprio, limpo e legível.

## 8. Definição de pronto (aceite)

1. `npm ci && npm run build` sem erros; `npm run typecheck` limpo; `npm test` verde; `npm run sim:soak -- --years 3` verde.
2. E2E Playwright verde: abrir → novo jogo com Brasil → rodar 60 dias → abrir todos os painéis → construir usina → recrutar → mover formação →
   declarar guerra (em sandbox) → batalha → entrar no modo tático → dar ordens → concluir → salvar → recarregar → carregar.
3. Screenshots reais (globo longe, país, cidade perto com modelos, batalha tática, cada painel) revisados pelo orquestrador.
4. Zero erro no console durante o e2e; ≥ 30 fps em GPU comum na visão mundial.
