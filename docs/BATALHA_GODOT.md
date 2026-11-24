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

## 7b. Próxima geração: leitura do local por IA, mundo destrutível, explosões

### Leitura das vias e calçadas por IA (pavimentadas)
Objetivo: cada via pavimentada com as mesmas faixas, largura, calçadas, meio-fio, cores e placas do lugar real.
1. **Recorte**: cada via do OSM vira uma **faixa endireitada** da foto aérea de alta resolução (Esri z19, ~0,2 m):
   linhas ao longo do eixo, colunas atravessando a rua (pista + calçadas + 6 m de cada lado). Trechos inteiros de
   rua (até ~150 m por vez, com sobreposição), não janelas minúsculas.
2. **Análise do trecho** (só leitura — a IA **não gera imagem**; GPU local, RTX 4060 8 GB):
   - um modelo de difusão treinado para **análise** (estilo Marigold: a difusão produz um *mapa* da foto, não uma
     foto nova) ou um modelo de segmentação (SAM 2.1 / SegFormer) marca pixel a pixel: pista, faixa contínua,
     tracejada, dupla, faixa de pedestre, seta, calçada, meio-fio, canteiro, vaga; carros e sombras são ignorados.
   - O que a foto não mostra (faixa sob um carro) é completado pela continuidade do próprio trecho.
3. **Construção por cima**: a foto fica por baixo e o sistema desenha as faixas, bordas e calçadas por cima, no
   mesmo lugar em que foram vistas — essa sobreposição é também a conferência visual de cada rua.
4. **Junção**: os trechos são mesclados com peso maior no centro (sem emenda entre eles), vetorizados em linhas
   ao longo do eixo da via (offset, tipo, período do tracejado, largura) e corrigidas por regras: tracejado com
   período constante, faixas paralelas ao eixo, continuidade nos cruzamentos. Resultado: **um modelo de via só**.
5. **Placas**: posições do OSM (`traffic_sign`, `maxspeed`, `crossing`, `stop`, `give_way`) + detecção na foto;
   desenho pelo padrão do país (Convenção de Viena na Bélgica/França, MUTCD nos EUA).
6. **Calçadas**: largura, altura do meio-fio (0,12–0,18 m) e cor/material (concreto, lajota, pedra) medidos na foto.

### A IA de vias (decisões depois dos primeiros testes, 24/11)
- **Foto**: a mais nítida aberta de cada país; Esri World Imagery como reserva mundial. Testado em Bastogne:
  Esri só chega a z19 (0,19 m — pintura borrada; z20/21 "Map data not yet available"); a ortofoto oficial da
  Valônia (SPW `ORTHO_LAST`) mostra zebras, setas, hachuras e vagas nítidas (~0,1 m). Outras fontes abertas a ligar:
  Flandres (7,5 cm), França IGN, Holanda PDOK (8 cm), Espanha PNOA, EUA NAIP. Leitor: `tools/godot/ortho.py`.
- **Rede neural treinada, não limiar de contraste.** Segmentação semântica leve (U-Net com codificador estilo
  MobileNet, ~1–3 M parâmetros, INT8 ≈ 1–3 MB) sobre a faixa endireitada a 10 cm, classes: pista, calçada, meio-fio,
  linha contínua, tracejada, dupla, zebra, linha de parada, seta, hachura/chevron, vaga, área vermelha, amarela,
  carro/sombra (ignorar).
- **Treino**: (a) rótulos iniciais gerados pelo detector por contraste (`road_reader.paint_mask`, só para começar),
  revisados e corrigidos; (b) ruas sintéticas renderizadas no próprio Godot com marcações conhecidas (rótulo
  perfeito) e aumentação de luz, sombra, desgaste e carros; (c) detecções abertas do Mapillary quando houver.
  Conjunto de teste fixo com ruas conferidas a olho; o modelo só entra no jogo se passar nele.
- **Construção pelo padrão real**: o que a rede vê vira primitivas vetoriais (linha, tracejado com período,
  zebra, seta por tipo, hachura) encaixadas nas **medidas oficiais do país** (Bélgica: zebra 0,5 m × 4 m,
  linha 15 cm, tracejado 3/9 m etc.) — desenho limpo no tamanho real, não a mancha da foto.
- **Foto torta em relação ao OSM**: a pista prevista pela rede é alinhada ao eixo do OSM por correlação trecho a
  trecho (deslocamento e ângulo); as marcações acompanham esse alinhamento, sem se perder.
- **Celular, < 1 min**: inferência em *compute shader* do Godot (Vulkan, roda em celular), sem rede no servidor.
  Raio de 2 km em volta das tropas no carregamento (~2.300 imagens, ~15–20 s em 4G); o resto em segundo plano.
  Tudo vira parâmetros salvos: na segunda vez no mesmo lugar não há download nem inferência.

### Parâmetros salvos (não a cena)
Tudo o que a análise mede vira **números por objeto**, guardados por região (tile z13) em `params/<z13>.json.gz`,
chaveados pelo id do OSM e por um hash da geometria (refaz só o que mudou no OSM). Exemplos:
via `{largura, faixas, eixo:[offset,tipo,período], calçada:[larg,altura,material,cor], placas:[...], conf}`;
prédio `{telhado:{forma,material,cor}, altura, andares, parede:{material,cor}}`. Algumas dezenas de bytes por objeto:
a análise pesada roda uma vez; na próxima batalha no mesmo lugar a reconstrução lê os números e só gera malhas.

### Mundo modificável e destrutível
- Cada prédio, trecho de via, ponte e árvore é um **objeto de dados com estado** (íntegro, danificado, destruído,
  cratera). As malhas são geradas por célula de 256 m a partir dos dados; um dano altera o dado e **refaz só a célula**.
- **Prédios**: dano por andar/parede (buracos, fachada caída, telhado aberto), entulho que vira obstáculo.
- **Vias e terreno**: crateras deformam o relevo (Terrain3D `set_height`) e cortam a malha da via; o raio e a
  profundidade definem se passa infantaria, roda ou lagarta (mesma regra na simulação tática: `navGrid` atualizado).
- O estado de dano volta no `result.json` para o jogo estratégico (cidade e estradas danificadas no mapa).

### Explosões
Clarão (luz curta), bola de fogo e fumaça em *flipbooks* renderizados no Blender, partículas GPU (terra, faíscas,
estilhaços), onda de choque (distorção de tela), decalque de cratera, detritos com física e som com atraso pela
distância. Tamanho e efeito pelo calibre (morteiro, artilharia 155 mm, bomba).

### Ordem sugerida
1. Dados destrutíveis + cache de parâmetros (base de tudo).  2. Telhados e calçadas por regras + OSM.
3. Pipeline de IA das vias (recorte → segmentação → junção → parâmetros).  4. Crateras e dano de prédios.
5. Explosões.  6. Placas por país.

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
