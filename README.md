# MERIDIANO — Comando Global

Jogo de grande estratégia moderna (2026) em tempo real com pausa, jogado sobre um **globo 3D real** (CesiumJS):
fronteiras, províncias, cidades, usinas, estradas, aeroportos e portos vêm de dados reais; o relevo e o satélite
também. Você governa um país (economia, orçamento, energia, pesquisa, diplomacia, forças armadas), declara guerras e
pode **entrar numa batalha em modo tático**, comandando esquadrões sobre o terreno de verdade. Tudo roda estático no
navegador, sem backend. O plano mestre (contrato entre os módulos) está em [`docs/PLANO.md`](docs/PLANO.md).

## Como rodar

Requer Node 22.

```bash
npm ci
npm run dev          # http://localhost:5173
```

Outros comandos:

```bash
npm run build        # typecheck + build estático em dist/ (base relativa './')
npm run preview      # serve dist/
npm test             # vitest (simulação, core, loader de dados, batalha tática completa)
npm run typecheck    # tsc --noEmit
npm run e2e          # Playwright: partida completa (menu → guerra → modo tático → salvar/carregar); usa o Chromium já instalado
npm run sim:soak -- --years 3 --player BRA   # mundo inteiro headless; falha em NaN/exceção/estado não-JSON/orçamento
npx tsx src/app/perfwar.ts                   # cenário forçado Rússia × OTAN por 60 dias (ms/dia e custo dos A*)
```

Opções do `sim:soak`: `--years N`, `--days N`, `--player ISO3`, `--seed N`, `--difficulty sandbox|normal|hard`,
`--budget ms/dia` (padrão 16), `--data <dir>` (padrão `public/data`). `perfwar.ts` aceita `--days`, `--player`, `--target`.

Os dados de `public/data` são gerados pelo pipeline reproduzível em `tools/`:

```bash
cd tools && npm i && npm run data:all
```

## Como publicar no GitHub Pages

1. No repositório, abra **Settings → Pages** e, em **Build and deployment → Source**, escolha **GitHub Actions**.
2. Faça push em `main` (ou rode o workflow *Deploy GitHub Pages* manualmente em **Actions**).
   `.github/workflows/pages.yml` executa `npm ci`, `npm test`, `npm run build` e publica `dist/`.
3. O site fica em `https://<usuário>.github.io/<repositório>/`. O build usa base relativa (`./`), então funciona em
   qualquer subcaminho. Para publicar a partir de outro branch, libere-o nas regras do ambiente `github-pages`.

## Controles

| ação | como |
|---|---|
| girar / inclinar / zoom | arrastar com o botão esquerdo / botão direito ou Ctrl+arrastar / roda do mouse |
| selecionar país, província, cidade, formação | clique esquerdo |
| ordem de movimento (formação selecionada) | botão **Mover** no inspetor, depois clique no destino; clique direito também ordena |
| pausa / retomar | `Espaço` |
| velocidade | teclas `1`–`5` ou botões da barra superior |
| fechar seleção, janela ou abrir o menu | `Esc` |
| painéis | barra lateral (economia, orçamento, energia, construção, população, comércio, diplomacia, pesquisa, forças, produção, inteligência, guia) |
| modos de mapa e camadas | controles no canto direito (satélite, relevo, político, etc.; fronteiras, estradas, cidades…) |
| modo tático | em **Forças**, escolha uma batalha e clique em **Comandar batalha** |
| tático: selecionar | clique num esquadrão (ou na lista lateral); `Shift`+arrastar seleciona em caixa |
| tático: ordens | botões da barra inferior (Mover, Atacar-mover, Manter posição, Recuar, formações, fumaça, artilharia…); clique direito no terreno move, `Ctrl`/`Alt`+clique direito faz atacar-mover |
| tático: tempo | ×0,5 / ×1 / ×2 / ×4, pausa, **Auto-comandar**, **Retirar**, **Resolver automaticamente** (volta ao mapa e deixa a auto-resolução estratégica decidir) |

Pontuação tática: cada objetivo mantido soma pontos com o tempo; quem abrir **100 pontos** de vantagem vence
(ou aniquilar/quebrar a moral do inimigo; limite de 30 min de jogo — uma batalha comandada termina em ~13 min).

## Chaves opcionais

Nada é obrigatório: o jogo usa imagens Esri/EOX e relevo Terrarium sem chave. Em **Configurações** você pode informar
(guardadas só no `localStorage` do navegador):

- **Token Cesium ion** — relevo mundial de alta resolução e prédios OSM 3D.
- **Chave Google Maps Platform** — malha fotorrealista 3D (Photorealistic 3D Tiles).

## Estrutura

| caminho | conteúdo |
|---|---|
| `src/core/` | contratos (`contracts.ts`), RNG determinístico, relógio, event bus, registry de sistemas, `worldDyn`, notícias, geo, A*, `Game` (loop, comandos, save) |
| `src/data/` | `loadWorldStatic` (browser e Node), decodificação colunar/base64, índice espacial de províncias, grafo de estradas, grades de navegação e elevação |
| `src/app/` | bootstrap do navegador, loop `requestAnimationFrame`, save/load (IndexedDB + arquivo gzip), registro de sistemas (`systems.ts`), runners headless (`soak.ts`, `perfwar.ts`) |
| `src/sim/*` | simulação: economia, diplomacia, pesquisa, militar, tático, IA |
| `src/render/*` | globo, unidades e visual tático (Cesium) |
| `src/audio/` | WebAudio: música por estado, efeitos posicionais ligados aos eventos de render (`events.ts`) |
| `src/ui/` | interface React |
| `e2e/` | testes Playwright (`full.spec.ts` é a partida completa; `smoke.spec.ts` é o teste rápido) |
| `tools/` | pipeline de dados e assets (package.json próprio) |
| `public/` | dados, modelos glTF, áudio, ícones e bandeiras |

Cada módulo de `src/sim` tipa sua fatia do estado, seus comandos e eventos por *declaration merging*
sobre `src/core/contracts.ts` e registra seu sistema em `src/app/systems.ts`. O estado da simulação é JSON puro e
determinístico (RNG semeado, sem `Date.now`).

## Créditos e licenças

- Fronteiras, províncias, cidades, aeroportos, portos, estradas e ferrovias: [Natural Earth](https://www.naturalearthdata.com/) (domínio público).
- Usinas: [WRI Global Power Plant Database](https://datasets.wri.org/dataset/globalpowerplantdatabase) (CC BY 4.0).
- Indicadores socioeconômicos: [Banco Mundial — WDI](https://data.worldbank.org/) (CC BY 4.0; gastos e efetivos militares, fontes originais SIPRI/IISS).
- Elevação: tiles Terrarium do [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (vários provedores; ver atribuições na fonte).
- Imagens de satélite: Esri World Imagery (Esri, Maxar, Earthstar Geographics e comunidade GIS User) e EOX Sentinel-2 cloudless (CC BY 4.0, contém dados Copernicus Sentinel modificados); NaturalEarthII incluso no CesiumJS como reserva offline. Os créditos aparecem no canto da tela.
- Bandeiras: [flag-icons](https://github.com/lipis/flag-icons) (MIT).
- Motor 3D: [CesiumJS](https://cesium.com/platform/cesiumjs/) (Apache 2.0); interface com React e Zustand (MIT).
- Modelos 3D (Polyfork CC BY 4.0, Geibu3D CC BY 4.0, Quaternius/Kenney/Sketlux e outros CC0): [`public/models/LICENSES.md`](public/models/LICENSES.md).
- Áudio (CC0, domínio público e um CC BY 3.0 — `jet_flyby`, dklon): [`public/audio/LICENSES.md`](public/audio/LICENSES.md).
- Ícones: [`public/icons/LICENSES.md`](public/icons/LICENSES.md). Fontes dos dados por arquivo: `public/data/SOURCES*.md`.

## Limitações conhecidas

- **Satélite e relevo dependem da rede.** Esri/EOX e os tiles de elevação são buscados online; sem rede o jogo cai para
  o NaturalEarthII (baixa resolução) e o campo de batalha fica sem detalhe. O jogo tenta recuperar a fonte online a cada 20 s.
- **Desempenho precisa de GPU.** Em renderização por software (SwiftShader, como no CI headless) a taxa de quadros é muito
  baixa; os testes avançam a simulação por chamadas diretas por esse motivo. Em GPU comum a meta é ≥ 30 fps na visão mundial,
  mas isso só foi medido de forma indireta.
- **Guerras muito grandes custam CPU.** No cenário forçado Rússia × OTAN a simulação gasta ~35–40 ms por dia de jogo
  (≈ 2.100 formações); o limite de nós por A*, o cache negativo de rotas e o orçamento por tick reduziram a busca em ~64 %,
  mas o restante (movimento, contatos, logística, IA) não foi otimizado e pode engasgar em velocidade 5.
- **Combate tático simplificado.** Só terra: esquadrões de infantaria, blindados, artilharia e apoio aéreo/drone por chamada;
  sem combate naval/aéreo tático, sem cobertura detalhada, sem destruição de prédios, e sem modelos animados de tiro.
  Batalhas navais e aéreas são resolvidas só na camada estratégica.
- **Mapa tático de 8 km × 8 km** em grade de 64 × 64 células, centrado no ponto da batalha; o relevo vem dos mesmos tiles
  Terrarium (≈ 19 m/pixel), sem malha de vegetação nem construções individuais.
- **Dados reais, mas escalados.** Economia, forças e relações iniciais usam dados reais (Banco Mundial, Natural Earth,
  listas de usinas) com lacunas preenchidas por médias sub-regionais (marcadas em `estimated`); a ordem de batalha é
  derivada de gastos/efetivos, não de inventários reais por unidade.
- **Sem multijogador, sem mods, sem tradução completa:** a interface está em português; o inglês é parcial.
- **Som:** o navegador só libera áudio após o primeiro clique; efeitos posicionais são atenuados pela distância da câmera
  e limitados a um disparo a cada 60 ms por tipo.
- **Navegadores:** testado só em Chromium. Safari/Firefox não foram verificados (WebGL2 é obrigatório).

## Jogar no celular

O jogo tem layout responsivo e controles de toque (arrastar = mover, pinça = zoom, dois dedos = girar/inclinar, toque = selecionar, toque longo = ordem contextual, botão flutuante = seleção em caixa). Em celulares o perfil gráfico "Móvel" é o padrão (Configurações → Gráficos: Móvel/Baixo/Médio/Alto, medidor de FPS opcional).

Instalar como app no Android Chrome: abra o endereço do jogo, depois Menu ⋮ → **Instalar app** (ou o botão "Instalar app" em Configurações → Jogo). O app abre em tela cheia, mantém a tela ligada durante a partida, pausa ao ir para segundo plano e salva automaticamente ao sair.

## Publicar no Cloudflare (Workers)

O endereço principal é o Worker de arquivos estáticos (`wrangler.jsonc`, plano grátis): https://meridiano-jogo.juliocezaramarildoper3.workers.dev.
A Overture Maps recusa pedidos vindos de sites `*.pages.dev`/`*.netlify.app` (cabeçalho Referer); nesses endereços a cidade 3D cai para o OpenFreeMap, com bem menos prédios. Em `workers.dev` ou num domínio próprio os prédios da Overture carregam.

O Cloudflare limita cada arquivo a 25 MiB; `public/data/roads.json` passa disso. O script `tools/deploy/split-large-data.mjs` divide arquivos grandes em partes (`roads.json.p0.json`…) e o jogo as remonta ao carregar.

```
npm run build:deploy
npx wrangler deploy
```

O projeto Pages antigo (`npx wrangler pages deploy dist --project-name=meridiano`, https://meridiano-ee9.pages.dev) continua funcionando, mas sem os prédios da Overture.

`build:deploy` = build + divisão dos dados; falha se algum arquivo em `dist/` ficar acima de 25 MiB. Funciona também em subcaminho (base `./`).
