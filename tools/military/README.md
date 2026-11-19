# Ordem de batalha inicial (dados públicos, coleta única)

Roda uma vez para gerar a posição inicial das tropas; depois o jogo simula sozinho.

- `fetch-wikidata.py` → `wikidata-units.json`: unidades militares ativas com sede e coordenadas (Wikidata, CC0, via QLever).
- `oob/<ISO3>.json`: ordem de batalha por país lida de Wikipedia e sites oficiais (unidade, escalão, força, guarnição,
  fonte; efetivo ativo sem reservas). Países em guerra: só guarnição permanente e, quando houver fonte pública com
  semanas, a região de envio (`deployedRegion`), nunca coordenada. Parte das forças navais/aéreas veio da memória do
  leitor e precisa de conferência.
- Prontos: ARG AUS CAN COL DZA ESP ETH FRA GRC IRQ JPN KOR MAR MEX NGA SAU TWN UKR.
- Faltam: CHN IND USA RUS PRK PAK IRN VNM EGY IDN BRA MMR THA TUR DEU GBR ITA ISR PHL BGD POL VEN.
- Próximo passo: script de montagem que relocaliza cada guarnição pela base de cidades/bases do jogo, distribui o
  efetivo ativo pelo porte das unidades e gera `public/data/` para `initForces` (src/sim/military/forces.ts).
