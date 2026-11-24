# MERIDIANO — Batalha próxima em Godot · Plano

O jogo estratégico continua no navegador/Cesium. **Só a batalha próxima** roda em Godot: um mundo
finito de 10×10 km, construído do zero a partir dos dados reais do local, durante uma tela de carregamento.
Não existe mundo além do campo.

## 1. Objetivo e limites

- Visual de jogo atual (céu, luz, sombras, névoa, vegetação densa, casas, efeitos), não de mapa.
- Área fixa: quadrado de **10×10 km** centrado na batalha + faixa de borda de 500 m só visual
  (névoa e relevo que sobe; câmera e unidades não saem do campo).
- Tudo gerado na hora a partir do **pacote de batalha**; nada é pré-modelado por local.
- Meta de desempenho: RTX 4060 Laptop, 1080p, **≥ 60 fps** em qualidade alta; GPU integrada ≥ 30 fps em baixa.
- Meta de carregamento: **≤ 30 s** do clique até jogar (área urbana densa, 600 soldados + 60 veículos).

## 2. Arquitetura

```
Jogo estratégico (web, Cesium)                     Batalha (Godot 4.7, .exe)
 ├─ encontra combate                               ├─ lê o pacote
 ├─ monta o PACOTE (dados reais da área) ─────────►├─ tela de carregamento: gera o mundo
 │    relevo, solo, casas, estradas, água,         ├─ joga a batalha (render + entrada)
 │    árvores, unidades, hora, clima               │       ▲ estado / ordens
 │                                                 │       ▼
 │                      simulação tática (TS) ◄────┤  (ver D2)
 ◄──────────── RESULTADO (baixas, moral, vencedor, dano ao local)
```

Casca desktop (ver D1) junta os dois num único executável e troca os arquivos.

## 3. Pacote de batalha (contrato)

Pasta `battle/<id>/` escrita pelo jogo web, lida pelo Godot. Coordenadas em **metros locais**:
origem no centro, +X leste, +Z sul (convenção Godot), Y para cima.

| Arquivo | Conteúdo | Tamanho típico |
|---|---|---|
| `battle.json` | versão, lat/lon do centro, `sizeM`, hora local, clima, estação, `TacticalBattleInput` completo (lados, esquadrões, objetivos) | < 1 MB |
| `height.bin` | float32 LE, grade 2049×2049 cobrindo campo + borda (11 km, ≈5,4 m), Terrarium z14 bicúbico, picos falsos do dado removidos | 16,8 MB |
| `landcover.png` | RGB 2048² (≈5,4 m): R = classe (0 indefinido, 1 pasto, 2 lavoura verde, 3 lavoura seca, 4 terra, 5 mata folhosa, 6 mata de coníferas, 7 área construída, 8 prédio, 9 água, 10 rocha, 11 estrada), G = confiança 0–255. Decide grama e árvores | 3–4 MB |
| `cover.png` | RGB 4096² (≈2,7 m): material base, material sobreposto, mistura 0–255 (ids de `godot/scripts/world/ground_materials.gd`), bordas suaves entre classes | 10–14 MB |
| `tint.png` | RGBA 2048²: cor da foto relativa à média local (≤ 1), alfa 128 = rugosidade neutra | 7–8 MB |
| `world.json` | casas (pegada, altura, andares, tipo, telhado), estradas (linha, classe, largura, ponte), água (polígonos), árvores (pontos ou polígonos de floresta), marcos | 1–20 MB |
| `result.json` | escrito pelo Godot no fim: baixas, moral, vencedor, posições finais, dano por célula urbana | < 1 MB |

Fontes (as mesmas que o jogo já usa e testa): Terrarium AWS (relevo), OpenFreeMap/OSM e Overture
(casas, estradas, uso do solo, água) via `src/data/vector`, cor da foto de satélite como pista de vegetação
(`src/render/city3d/vegetation.ts`). O construtor do pacote reaproveita os decodificadores de `src/render/city3d`.

**Classificação pela cor do satélite** (`tools/godot/test_pack.py`, protótipo até F2): cada classe tem uma regra de
cor medida em trechos conferidos a olho (pasto: brilho 0,26–0,35; mata: brilho 0,17–0,23 e vermelho < 0,16; lavoura seca:
verde ≤ vermelho; cidade: saturação < 0,2 e textura fina > 0,05). Só vence a classe com nota ≥ 0,35 e à frente da segunda;
o resto fica **indefinido** (solo neutro, pouca grama). Lavoura verde não se distingue de pasto pela cor: vem do OSM em F2,
que também confirma mata, água e área urbana. Na Bastogne de teste: 50% pasto, 13% folhosa, 12% conífera, 10% pavimentado,
6% lavoura seca, 8% indefinido; 75% com confiança alta.

**Estradas e construções** (`tools/godot/osm_roads.py` → `world.json`): vias e prédios do OSM. Superfície de cada via:
tag `surface`/`tracktype` do OSM → senão a classe da via (rodovia, residencial = asfalto) → senão a foto ao longo da linha
→ senão "terra" (confiança 0,3). Validação contra as tags em Bastogne: a foto de 3 m **separa pavimentado de não
pavimentado** (asfalto 88%, terra 93%, cascalho 72%, trilha de grama 100% de acerto) mas **não separa cascalho de terra**
(as trilhas de 3 m ficam sob árvores e bordas de mato). Resultado: 2.619 vias (1.705 com tag, 610 pela foto, 74 no
chute), 7.684 prédios. Vias e prédios são pintados no `cover.png` e marcados no `landcover.png` (sem grama nem árvore
em cima); malhas de estrada e casas 3D vêm em F3.

## 4. Geração do mundo (tela de carregamento)

Etapas em threads (`WorkerThreadPool`), barra de progresso por etapa:

1. **Terreno** — Terrain3D: importa `height.bin`, regiões de 1024 m, LOD por clipmap, bordas elevadas suaves.
2. **Solo** — `cover.png` → mapa de controle do Terrain3D (textura base + sobreposta + mistura); 12 materiais
   PBR CC0 (Poly Haven / ambientCG: cor, normal, rugosidade, AO, altura) com variação macro anti-repetição.
3. **Estradas** — malhas em faixa sobre o relevo (asfalto, terra, trilha) com bordas desgastadas; pontes como malha.
4. **Casas** — extrusão das pegadas com paredes em *trim sheet* (janelas, portas, andares), telhados de duas águas
   / planos pelo tipo e tamanho, 3 níveis de LOD; fundidas por bloco para poucas chamadas de desenho.
5. **Vegetação** — árvores (3 LOD + impostor), arbustos, grama e pedras por `MultiMesh`, densidade pela classe de solo,
   afastadas de casas e estradas.
6. **Água** — superfície com shader (rios, lagos), margem molhada.
7. **Unidades** — soldados e veículos nas zonas de implantação, coladas ao relevo.
8. **Pré-aquecimento** — compilação de shaders e cache de sombras antes de liberar o jogo.

## 5. O que dá cara de jogo (lista de render)

- Céu físico + sol pela hora/estação/latitude real, nuvens volumétricas leves, névoa de altura e de distância.
- Forward+: sombras direcionais em cascata, SSAO, SSIL ou SDFGI, glow, *tonemap* ACES/AgX, correção de cor.
- Câmera de jogo: baixa, com inclinação limitada, transição suave para a visão de comandante.
- Efeitos: clarão de disparo, traçantes, impacto em terra/concreto, explosões e fumaça
  (*flipbooks* renderizados no Blender + partículas GPU), crateras e marcas como *decals*, fogo em casas atingidas.
- Soldados: os 4 estilos do kit (`tools/models/soldados/kit`) com normal map. Já têm: parado, andar, correr,
  mirar, agachar e morrer. Faltam: deitar/rastejar e tiro com fuzil (a mira atual é pose de pistola).
- Veículos: substituir os atuais por modelos com materiais PBR corretos e escala real.

## 6. Fases

Cada fase termina com captura de tela revisada, commit e push. Nada passa para a próxima sem o aceite.

| Fase | Entrega | Aceite |
|---|---|---|
| **F0 Base** | projeto `godot/` no repositório, Terrain3D em `godot/addons`, exportação de GLB sem quantização no pipeline dos soldados | projeto abre sem erro; soldado importa com 6 animações |
| **F1 Cena de visual** | um campo fixo (relevo real de um local de teste) com céu, sol, névoa, solo PBR e câmera de jogo | captura aprovada pelo usuário como "parece jogo" |
| **F2 Pacote** | construtor do pacote no jogo web + leitor no Godot; relevo, solo, estradas e água vindos do local real | mesmo local em Cesium e em Godot com relevo igual (erro < 2 m) |
| **F3 Casas e vegetação** | casas geradas, árvores, arbustos, grama, pedras | cidade e área rural reais reconhecíveis; ≥ 60 fps; carga ≤ 30 s |
| **F4 Unidades** | soldados e veículos com animação, seleção, ordens básicas, linha de visada | pelotão recebe ordem, corre, atira, se abriga, morre |
| **F5 Simulação** | ligação com a sim tática (D2), IA, objetivos, fim de batalha e `result.json` | batalha completa com resultado correto no jogo estratégico |
| **F6 Efeitos e som** | disparos, explosões, fumaça, fogo, destruição de casas, áudio posicional | revisão visual e sonora |
| **F7 Executável** | casca desktop + Godot exportado, instalador no GitHub Actions | instalar em PC limpo e jogar do início à batalha |

## 7. Decisões

- **D1 Casca desktop** — Electron empacota o jogo web e abre o `.exe` do Godot com `--battle <pasta>`.
  Recomendado. Alternativa: Tauri (menor, mas sem Node para a sim, ver D2).
- **D2 Onde roda a simulação tática** — (a) a sim TypeScript atual (4 mil linhas, testada, determinística) roda no
  Node da casca e conversa com o Godot por WebSocket local; o Godot só desenha e manda ordens. (b) Portar a sim
  para GDScript. Recomendado (a) até F5; reavaliar se a latência ou a física exigirem (b).
- **D3 Linguagem no Godot** — GDScript (texto, sem .NET). Trechos pesados de geração em threads; só migrar algo
  para C++/GDExtension se a carga passar de 30 s.
- **D4 Escala** — 1 unidade Godot = 1 m. Soldado 1,8 m, veículos com medidas reais (ver `public/models/manifest.json`).

## 8. Riscos conhecidos

- **GLB comprimido**: o Godot 4.7 não lê `KHR_mesh_quantization`. Os soldados precisam de exportação sem
  quantização (testado: `nsoldier_ru.glb` sem quantização tem 1,4 MB e carrega com as 6 animações).
- Relevo Terrarium z14 tem ≈ 7–10 m de resolução: falésias e taludes finos saem suaves; o detalhe vem de
  ruído e *displacement* do material, não do dado.
- Dados OSM incompletos fora de cidades grandes (casas sem altura, sem tipo): usar regras por região e tamanho.
- 10×10 km denso de casas pode passar de 100 mil pegadas: LOD agressivo, fusão por bloco e impostores ao longe.
- Licenças: só CC0/CC-BY com crédito em `public/models/LICENSES.md` e na tela de créditos.

## 9. Ferramentas (reprodução)

- Godot **4.7.2-stable** (win64, sem .NET) — instalado fora do projeto em `%LOCALAPPDATA%\Programs\Godot`.
- Terrain3D **v1.1.0-stable** (MIT, suporta Godot 4.5–4.8) — vai para `godot/addons/terrain_3d` em F0.
- Modelos de exportação do Godot 4.7.2 (1,3 GB) — baixar só em F7, para gerar o `.exe`.
- Blender 5.2 e gltf-transform 4 para o pipeline dos modelos (`tools/models/soldados`).
