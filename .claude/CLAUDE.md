# MERIDIANO: contexto da sessão "batalha detalhada" (até 21/11/2026)

Responder em português. O usuário quer economia de tokens e de subagentes (só Haiku, com prompt restrito, e só quando necessário).
Regras do projeto estão em docs/HANDOFF.md: Cesium é o único motor 3D, modelos com licença CC0/CC-BY registrados em
public/models/LICENSES.md, GLB de até 1,5 MB, testar antes de commitar e mostrar fotos.

## ATENÇÃO: dois ramos para juntar
- Este trabalho está no ramo `claude/batalha-detalhada-chao` (commit ecc4245 + este arquivo).
- Outra sessão enviou o commit `be40c95` em `claude/funny-tesla-3um51i`: "Batalha de perto: LOD de veículos com partes
  animadas, soldados animados, grama procedural" (public/models/near/*, src/render/city3d/grass.ts, grassScatter.ts,
  index.ts, LICENSES.md, e2e/near-photos.spec.ts).
- Os dois mexem em `src/render/city3d/grass.ts` e `src/render/city3d/index.ts`. PRIMEIRA TAREFA: juntar os dois ramos
  sem perder nada. Usar os modelos de perto da outra sessão (veículos e soldados) e manter daqui o chão próprio, a
  câmera, a grama em pé (ver a conta de eixos abaixo), a correção de memória e o botão.
- O workers.dev (https://meridiano-jogo.juliocezaramarildoper3.workers.dev) está com a versão DESTE ramo, sem be40c95.
  Depois de juntar: `npm run build:deploy && npx wrangler deploy`.

## Feito nesta sessão
- Guarnições reais em 113 países (public/data/military.json, tools/military/*); tropas iniciais nascem nelas.
- Visão externa: tropas nas ruas e em áreas militares, nunca dentro de prédios (city3d/spots.ts); aviões nos
  aeródromos; marcadores de hospital, base militar e aeroporto; zoom até 5 m; soldados ao lado dos veículos; tiro só de
  quem tem arma, com linha de visada contra prédios; sem tiro no vazio.
- Batalha tática (sim/tactical): imprevistos (pneu, esteira, motor, soldado passando mal: incidents.ts), cerco e morte
  do comandante derrubam a moral, a IA envolve e persegue, ordens do jogador passam por cima do auto-comando por 2 min.
- Etapa 1: botão "Visualizar batalha detalhada" (também para assistir batalhas de outros países), área de 10 x 10 km
  (TAC_SIZE_M/TAC_N em sim/tactical/mapWorld.ts), câmera presa à área (máx. 4,5 km de altura, até 2 m do chão), tela
  de carregamento (TacticalHud.tsx). A entrada por zoom foi removida.
- Etapa 2: chão próprio por tipo de solo, sem foto de satélite, só no modo detalhado (city3d/groundPaint.ts, texturas
  CC0 da Poly Haven em public/textures/ground, base pelo clima via aridityAt em sim/military/weather.ts); ruas com
  asfalto ou cascalho (roads.ts); grama 3D até 140 m da câmera (city3d/grass.ts, tufo de 6 triângulos gerado por
  tools/models/grass-tuft.mjs).
- Memória: antes, a cada 4 s, o jogo preparava o mapa vetorial de TODAS as batalhas (pico de 1,3 GB e 12,7 s de
  travamento). Agora prepara só ao clicar, num Web Worker (data/vector/prepare.worker.ts, prepareArea em
  render/tactical). Medido: pico da página 364 MB, travamento máximo 0,36 s.
- Conta de eixos das instâncias (EXT_mesh_gpu_instancing) no Cesium, medida com 3 instâncias de teste: num frame ENU
  ancorado no chão, o X da instância vira Norte, o Z vira Leste e o Y vira "para baixo", ou seja
  T = [n, -u, e]. Com frame ao nível do mar a esfera envolvente sai errada e o Cesium descarta o modelo. As árvores
  (trees.ts) usam outra conta; conferir se não estão deslocadas.

## Falta fazer (o que o usuário pediu)
1. Juntar com be40c95 (acima) e publicar.
2. Etapa 3: prédios mantidos no modo detalhado, mais 5 modelos de prédio destruído (casa térrea, sobrado, prédio médio
   com andares expostos, torre partida, galpão retorcido), todos com entulho em volta.
3. Etapa 4: soldados realistas. O usuário aprovou o `soldier_city` (Sketchfab, buh-late, CC-BY) em cores e camuflagens
   por país. Remover os bonecos cabeçudos da Quaternius. Animações CC0 da Quaternius (Universal Animation Library).
   Quatro níveis de detalhe (até 150 m completo, 150 a 600 m simplificado, impostor até 2 km, além disso um bloco
   por pelotão); orçamento de cerca de 150 animados na tela.
4. Etapa 5: tiro com efeitos e SOM (agora). Falas e gritos só depois, e só de perto.
5. Etapa 6: catálogo de soldados por função: ghillie, mergulhador, piloto de caça e de helicóptero, tripulante de
   blindado, paraquedista, fuzileiro naval, engenheiro, médico, oficial ou capitão, rádio, polícia, rebelde, civil.
   Só CC0/CC-BY, descartando modelos extraídos de jogos (Call of Duty, Call to Arms) e do Mixamo.
6. Etapa 7: carros parados e carros destruídos (só em ruas e áreas abertas, nunca dentro de prédios) e objetos de
   cena. Candidatos baixados para avaliação em tools/.cache/review (fora do git), com página index.html.
7. Etapa 8: feridos, sangue, corpos no chão e fumaça.
8. FÍSICA no modo detalhado (pedido do usuário): tanques e tudo com física (peso, suspensão, colisão, terreno,
   capotamento). Motor de física só dentro da área de 10 km.
9. Plataforma: o usuário perguntou sobre APK ou PC. Recomendação dada: PC instalável (Tauri ou Electron, mesmo código)
   primeiro; o APK (Capacitor) fica limitado como o navegador do celular. Aguardando a decisão dele.

## Testes conhecidos
- A falha de military.test (POL x BLR) é anterior a esta sessão. economy.test (powerPlant) também falha desde antes.
- battle-flow.test: a batalha passa de 25 min desde a mudança das guarnições.
- O benchmark do nav.test (A*) passa do limite nesta máquina.
- Teste visual sem janela: Playwright com channel 'msedge' (já instalado), sem precisar do painel do navegador do app.
