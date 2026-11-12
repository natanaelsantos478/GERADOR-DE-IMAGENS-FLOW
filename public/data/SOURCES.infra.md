# Fontes — infraestrutura (gerado por `cd tools && npm run data:infra`, 2026-11-12)

| arquivo | fonte | URL | licença |
|---|---|---|---|
| powerplants.json | WRI Global Power Plant Database v1.3 (34.936 usinas) | https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv | CC BY 4.0 |
| airports.json | Natural Earth 10m airports | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_airports.geojson | domínio público |
| ports.json | Natural Earth 10m ports | .../ne_10m_ports.geojson | domínio público |
| roads.json | Natural Earth 10m roads + railroads | .../ne_10m_roads.geojson, .../ne_10m_railroads.geojson | domínio público |

## Derivações
- Usinas: `primary_fuel` Coal/Gas/Oil/Nuclear/Hydro/Wind/Solar/Biomass/Geothermal -> mesmo nome; Petcoke -> oil; Waste -> biomass; Cogeneration/Storage/Wave and Tidal/Other -> other. `iso3` = `country` (XKX/XKO -> KOS). Ordenado por MW decrescente.
- Aeroportos: `size` 2 = type contém "major", 1 = "mid" (ou apenas military/spaceport com scalerank > 3), 0 = "small"; `military` = type contém "military"; `iata` = iata_code.
- Portos: `size` 2 = scalerank 3-4, 1 = 5-6, 0 = 7-8.
- Estradas: cls 0 = Major Highway com expressway=1; cls 1 = demais Major Highway, Beltway, Bypass; cls 2 = Secondary Highway, Road, Unknown, Track; cls 3 = ferrovia; cls 4 = balsa (Ferry Route/seasonal, Railroad ferry).
- Grafo: vértices agrupados por líderes a 1 km (sem encadeamento); nó = ponta de linha ou grupo visitado por >= 2 linhas; linhas quebradas nos nós; `km` = haversine ao longo da geometria original; arestas duplicadas fundidas; nós de grau 2 entre arestas da mesma classe fundidos; componentes menores ligados a componente maior mais próximo se lacuna <= 25 km (aresta cls 2 em linha reta); componentes < 30 km descartados.
- `geom`: lista plana [lon,lat,...] (3 casas), Douglas-Peucker; a aresta i ocupa os pontos `geomStart[i] .. geomStart[i]+geomLen[i]-1` (índices em PONTOS: ponto k está em geom[2k], geom[2k+1]); sempre orientada de `a` para `b`, com primeiro/último ponto = coordenadas dos nós. Tolerância 0,45 km (0,3 km estourava 16 MB).
