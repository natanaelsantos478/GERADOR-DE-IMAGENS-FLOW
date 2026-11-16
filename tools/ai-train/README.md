# Treino da IA neural (MERIDIANO)

Sem API externa: redes pequenas (MLP em TS puro, `src/sim/neural`) que ESCOLHEM e DOSAM sobre opções legais geradas pelas regras.
Pesos em `public/data/ai/policy.json` (versionado; importado estaticamente pela sim). PADRÃO = regras; `automation['ai.engine.neural'] = true` liga a neural
(por país: `ai.engine.neural.<ID>`). Temperatura da escolha por dificuldade em `src/sim/neural/engine.ts`.

| Rede | Onde | Escolhe |
|---|---|---|
| `tac` | `src/sim/tactical/aiNeural.ts` | por esquadrão: objetivo / flanco / engajar / focar / manter / cobertura / recuar / fumaça / defender + chamar apoio |
| `opGoal`, `opStance` | `src/sim/ai/neuralOp.ts` | alvo da operação (top-6 candidatos das regras) e razões de ataque/abortar |
| `strat` | `src/sim/ai/neuralPlan.ts` | mix de produção, intensidade, gasto defesa/pesquisa/segurança, vontade de paz, iniciativa diplomática |

Todas são políticas RESIDUAIS: rede zerada = IA de regras. Travas ficam fora da rede (recuo forçado, sem recuo de tropa saudável, gasto militar
bloqueado com aprovação/caixa fracos, nuclear e declarações de guerra só pelas regras). Features têm slots de extensão (comandante, fadiga, clima,
desgaste) lidos de forma tolerante (0 se o campo não existir): `TAC_EXT`, `STRAT_EXT`, `opt()` em `src/sim/ai/util.ts`. Ao mudar o tamanho das
features, os pesos antigos deixam de carregar (o teste "the shipped weights load" falha) — retreine com `--fresh`.

## Treino longo (um comando; Node >= 22; Windows/macOS/Linux)
```
npm install
npx tsx tools/ai-train/train.ts --hours 8 --workers 6
```
Opções: `--hours N` (relógio total), `--workers N` (padrão: núcleos-1, máx. 8), `--seed N`, `--war-days 90`, `--fresh` (ignora checkpoints),
`--stages bc,tac,war,final`, `--version rótulo`. **Retomada:** rode o mesmo comando de novo — checkpoints em `tools/ai-train/ckpt/*.es.json`
(a cada geração) são retomados; use `--stages war,final` para só refazer uma etapa. Curvas: `tools/ai-train/logs/{tac,war}.csv`.
Etapas: `bc` clonagem de comportamento da IA tática de regras → `tac` ES (OpenAI-ES, antitético) auto-jogo tático em mapas reais de treino →
`war` ES em guerras regionais forçadas (vizinhos reais, 90 dias, neural × regras, lados alternados) → `final` grava `public/data/ai/policy.json`.
Reprodutível (seeds fixas); o ES usa 45%/45% do tempo para tac/war.

## Aceite
```
npx tsx tools/ai-train/tournament.ts --tac 48 --war 6      # tático em mapas de teste + guerras em pares de teste (grava logs/tournament.json)
npm run sim:soak -- --years 5 --player BRA                  # mundo inteiro com a IA neural (--engine rules para comparar)
```
Scripts auxiliares: `probe-tac.ts` (sensibilidade do ES), `try-tac.ts <min>` (só etapa tática). Se mudar mecânicas (comandantes, fadiga, clima, desgaste),
exponha-as como campos numéricos em `Squad`/`FormationView` (`cmdSkill`, `fatigue`, `weather`, `wear`) ou ajuste os nomes em `extFeatures()`/`opt()` e retreine.
