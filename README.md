# MERIDIANO — Comando Global

Jogo original de grande estratégia moderna (2026) em tempo real com pausa, sobre um globo 3D real
(CesiumJS), com batalhas táticas ao aproximar o zoom. Tudo estático no navegador, sem backend.
O plano mestre (contrato entre os módulos) está em [`docs/PLANO.md`](docs/PLANO.md).

## Como rodar

Requer Node 22.

```bash
npm ci
npm run dev          # http://localhost:5173
npm run build        # typecheck + build estático em dist/ (base relativa './')
npm run preview      # serve dist/
npm test             # vitest (simulação, core, loader de dados)
npm run typecheck    # tsc --noEmit
npm run e2e          # Playwright (usa o Chromium já instalado; build + preview na porta 5173)
npm run sim:soak -- --years 3 --player BRA   # simulação headless do mundo inteiro, falha em NaN/exceção/orçamento
```

Opções do `sim:soak`: `--years N`, `--days N`, `--player ISO3`, `--seed N`, `--difficulty sandbox|normal|hard`,
`--budget ms/dia` (padrão 12), `--data <dir>` (padrão `public/data`).

Os dados de `public/data` são gerados pelo pipeline reproduzível em `tools/`:

```bash
cd tools && npm i && npm run data:all
```

## Estrutura

| caminho | conteúdo |
|---|---|
| `src/core/` | contratos (`contracts.ts`), RNG determinístico, relógio, event bus, registry de sistemas, `worldDyn`, notícias, geo, A*, `Game` (loop, comandos, save) |
| `src/data/` | `loadWorldStatic` (browser e Node), decodificação colunar/base64, índice espacial de províncias, grafo de estradas, grades de navegação e elevação |
| `src/app/` | bootstrap do navegador (`main.tsx`), loop `requestAnimationFrame`, `host` (zustand), save/load (IndexedDB + arquivo gzip), registro central de sistemas (`systems.ts`), runner headless (`soak.ts`) |
| `src/sim/*` | módulos da simulação (economia, diplomacia, pesquisa, militar, tático, IA) |
| `src/render/*` | globo, unidades e visual tático (Cesium) |
| `src/ui/` | interface React |
| `e2e/` | testes Playwright |
| `tools/` | pipeline de dados e assets (package.json próprio) |
| `public/` | dados, modelos glTF, áudio, ícones e bandeiras |

Cada módulo de `src/sim` tipa sua fatia do estado, seus comandos e eventos por *declaration merging*
sobre `src/core/contracts.ts` (veja o comentário no topo do arquivo) e registra seu sistema em `src/app/systems.ts`.

## Publicação

`.github/workflows/pages.yml` testa, compila e publica `dist/` no GitHub Pages a cada push em `main`
(e no branch de desenvolvimento) ou manualmente. Em *Settings → Pages*, a fonte deve ser "GitHub Actions";
para publicar a partir de um branch que não seja o padrão, libere-o nas regras do ambiente `github-pages`.

## Créditos de dados e bibliotecas

- Fronteiras, províncias, cidades, aeroportos, portos, estradas e ferrovias: [Natural Earth](https://www.naturalearthdata.com/) (domínio público).
- Usinas: [WRI Global Power Plant Database](https://datasets.wri.org/dataset/globalpowerplantdatabase) (CC BY 4.0).
- Indicadores socioeconômicos: [Banco Mundial — World Development Indicators](https://data.worldbank.org/) (CC BY 4.0).
- Elevação: tiles Terrarium do [AWS Open Data Terrain](https://registry.opendata.aws/terrain-tiles/) (vários provedores; ver atribuições).
- Imagens de satélite: Esri World Imagery e EOX Sentinel-2 cloudless (s2cloudless, CC BY 4.0, contém dados Copernicus Sentinel modificados); NaturalEarthII incluso no CesiumJS.
- Bandeiras: [flag-icons](https://github.com/lipis/flag-icons) (MIT).
- Motor 3D: [CesiumJS](https://cesium.com/platform/cesiumjs/) (Apache 2.0).
- Fontes e licenças detalhadas de cada arquivo: `public/data/SOURCES*.md`; modelos: `public/models/manifest.json`.
