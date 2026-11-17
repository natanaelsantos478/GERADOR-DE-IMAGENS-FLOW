# MERIDIANO — Passagem de bastão (leia isto primeiro)

Jogo de grande estratégia moderna em tempo real sobre o globo real (CesiumJS), com batalha tática ao dar zoom.
Original (não copiar nome/arte de nenhum jogo existente). UI em pt-BR. Contrato de arquitetura: `docs/PLANO.md`.
Branch de trabalho: `claude/funny-tesla-3um51i`. O dono do projeto joga principalmente no **Android (Chrome)**.

## Como rodar
```
git clone https://github.com/natanaelsantos478/GERADOR-DE-IMAGENS-FLOW.git
cd GERADOR-DE-IMAGENS-FLOW && git checkout claude/funny-tesla-3um51i
npm ci            # Node 22
npm run dev       # jogo em http://localhost:5173
npm test          # vitest (sim/dados/render)   |  npm run typecheck
npm run sim:soak -- --years 3 --player BRA   # mundo inteiro headless (determinismo, JSON puro, custo/dia)
npm run build && npm run build:deploy         # build + divide arquivos >25 MiB (Cloudflare Pages)
```
Publicar: `npx wrangler pages deploy dist --project-name=meridiano` (ver README, seção Cloudflare).
E2E (lentos: 15–20 min no headless por software; rápidos com GPU): `npx playwright test e2e/<arquivo>`.

## Arquitetura em 10 linhas
- Simulação TS pura e determinística em `src/sim/*` (economy, diplomacy, research, military, tactical, ai, neural); núcleo em `src/core`; estado = JSON puro (save/load idêntico — testado no soak).
- Dados reais em `public/data` (países, 4.603 províncias, 7k cidades, 35k usinas, 48k aeroportos, portos, 297k trechos de estrada, instalações: hospitais/bases/etc.). Pipelines reproduzíveis em `tools/*`.
- Render: Cesium em `src/render/globe` (satélite ESRI/EOX + terreno Terrarium, camadas vetoriais por tiles), `src/render/units` (formações/efeitos), `src/render/tactical`, `src/render/city3d` (cidade 3D sob demanda), UI React em `src/ui` (painéis registrados via `registerPanel/registerInspector`).
- Mapa vetorial real: `src/data/vector` (Overture Maps PMTiles primário, OpenFreeMap reserva, procedural como último recurso) → grade fina de navegação 16 m + regras data-driven em `src/sim/tactical/terrainRules.ts`.
- Modelos 3D reais em `public/models` (`manifest.json`, `variants.json` por país, `landmarks/` + `public/data/landmarks.json`). Áudio CC0 em `public/audio`, ícones em `public/icons`.

## Decisões do dono (não reverter sem perguntar)
- IA dos países/tropas: **regras são o padrão**; a rede neural é opcional (`state.meta.automation['ai.engine.neural']`). O treino curto NÃO superou as regras (39,6% de vitórias táticas). Treino longo: `npx tsx tools/ai-train/train.ts --hours 8 --workers 6 --fresh` — rodar no PC do dono à noite só depois de a avaliação do treino ser menos ruidosa (ver `tools/ai-train/README.md`).
- Dificuldade padrão fácil; "completo, não difícil".
- Nada de modelagem procedural para unidades/monumentos: usar **modelos reais** baixados (licenças CC0/CC-BY/CC-BY-SA/GPL registradas em `LICENSES.md`). Prédios/árvores/vias da cidade são GERADOS em código sob demanda a partir de **padrões editáveis** (`public/data/styles/*.json`), só na área com zoom, descartados ao afastar.
- Carregar só a área onde há zoom (PMTiles por Range); nunca vários mapas em paralelo.
- Agrupar unidades em um ícone com quantidade quando se sobrepõem/estão longe.
- Publicação: Cloudflare Pages (conta do dono). Supabase só se for preciso (hoje não é).
- Atribuição obrigatória visível: © OpenStreetMap contributors, Overture Maps Foundation, ESA WorldCover; créditos de modelos CC-BY.

## Estado (verificado por testes até o último commit)
Pronto e no GitHub: simulação completa (economia, diplomacia, pesquisa, militar com comandantes/fadiga/clima/desgaste, tático, IA regras + neural opcional), dados reais, globo, UI desktop e **celular** (toque, gavetas, PWA, divisão de dados), modelos reais por país (tanques com textura), mapa vetorial + regras de terreno na sim tática, 36 marcos famosos (`landmarks`).
Em andamento no momento da escrita (pode estar parcialmente no GitHub — veja `git log`): **cidade 3D** (`src/render/city3d`, `public/data/styles`, árvores `public/models/nature`), agrupamento de unidades, visibilidade das unidades na batalha tática, integração dos marcos.

## Problemas conhecidos (por prioridade)
1. Batalha tática: unidades 3D ainda pequenas/pouco legíveis em algumas distâncias; efeitos de combate (clarão/explosão/poeira) nunca confirmados em screenshot; faixa laranja larga de estrada desalinhada sobre rios; terreno às vezes sem satélite quando os tiles não carregam a tempo.
2. Cidade 3D: prédios com pouca variedade visual; marcos famosos ainda não posicionados no jogo; posições/orientações dos marcos foram anotadas de memória (conferir no mapa vetorial). MASP e Angkor sem modelo bom; 18 marcos sem modelo (Congresso Nacional, Maracanã, Itaipu, Kremlin, etc.).
3. Desempenho: guerra RUS×OTAN ~35–43 ms/dia no início (meta 16); batalha tática urbana densa ~4,5 ms/passo (meta 4); `nav` salvo passa de 1,7 MB em cidades densas; abrir o jogo baixa ~43 MB (sem compressão).
4. Celular: tutorial cobre parte da tela; não testado em Android real (instalação PWA, giro com 2 dedos, toque longo dando ordem). Toque dentro da batalha tática (selecionar/ordenar esquadrão com o dedo) ainda NÃO existe.
5. Tanques: formas de kits de impressão 3D só pintados (sem escotilhas); soldados "cabeçudos" (Quaternius recolorido); faltam Merkava, Rafale, Patriot, navios russos/chineses etc. → um token de API do **Sketchfab** resolveria (o dono pode fornecer via formulário seguro, nunca no chat).
6. Licenças: ~60 modelos GPL/CC-BY-SA (FlightGear, Thingiverse) exigem manter a mesma licença se redistribuir; se o dono for vender/fechar o código, remover.
7. Placar tático mostra pontos de objetivos (ok), mas testes automáticos deixam o lado do jogador sem ordens — comportamento esperado.

## Próximos passos sugeridos (ordem)
1. Terminar/validar a cidade 3D (prédios, árvores, vias, marcos, agrupamento) com screenshots do jogo (Paris, Rio, floresta, batalha urbana).
2. Entrada por toque na batalha tática; revisar tutorial no celular.
3. Publicar no Cloudflare (`build:deploy` + wrangler) e testar no Android do dono.
4. Modo de mapa "Parâmetros" no globo (mostrar camadas vetoriais/regras sobre o satélite).
5. Ligar hospitais/aeroportos/portos/bases à simulação (hoje só dados; `public/data/facilities.json` ainda não é lido pela sim).
6. Otimizar guerras grandes; depois treino longo da IA neural.

## Como trabalhar (preferências do dono)
- Responder em português. Economizar tokens: o modelo caro planeja e confere; **sub-agentes baratos (Sonnet)** fazem o trabalho pesado; ler o mínimo de arquivos.
- Nunca criar mocks; testar antes de commitar; mostrar **fotos do jogo rodando** a cada etapa; ser honesto sobre falhas (nada de "pronto" sem prova).
- Nunca usar nomes de modelos Gemini 2.0 (descontinuados) — conferir o modelo atual antes de qualquer menção.
- O headless não tem GPU: testes visuais lentos; avançar a simulação por chamadas diretas (`window.__game`, `__globe`, `__units`, `__tactical`, `__ui`).
- Limite de uso de 5 h por conta: poucos agentes em paralelo (2–3), cada um com diretórios próprios para não colidir.
