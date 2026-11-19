# Ordem de batalha inicial (dados públicos, coleta única)

Roda uma vez para gerar a posição inicial das tropas; depois o jogo simula sozinho.

- `fetch-wikidata.py` → `wikidata-units.json`: unidades militares ativas com sede e coordenadas (Wikidata, CC0, via QLever).
- `oob/<ISO3>.json`: ordem de batalha por país lida de Wikipedia e sites oficiais (unidade, escalão, força, guarnição,
  fonte; efetivo ativo sem reservas). Países em guerra: só guarnição permanente e, quando houver fonte pública com
  semanas, a região de envio (`deployedRegion`), nunca coordenada. Parte das forças navais/aéreas veio da memória do
  leitor e precisa de conferência.
- Ordens de batalha lidas (23): ARG AUS BGD CAN CHN COL DZA ESP ETH FRA GRC IRQ JPN KOR MAR MEX NGA PAK POL SAU TWN UKR VEN.
  Outros 90 países usam as unidades do Wikidata. Sem dado: o jogo cai nas maiores cidades/aeroportos/portos.
- `node tools/military/build-garrisons.mjs` grava `garrisons` em `public/data/military.json` ([lon, lat, efetivo, 0 terra/1 ar/2 mar]);
  `initForces` (src/sim/military/forces.ts) distribui as formações iniciais por elas em proporção ao efetivo
  (nenhuma guarnição passa de 15% do país; bases navais encaixadas no porto real mais próximo).
