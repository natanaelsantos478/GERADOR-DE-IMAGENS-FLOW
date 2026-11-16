# Fontes — OSM/Overture (gerado por `cd tools/data-osm && ./run.sh`, 2026-11-16)

Atribuição obrigatória: **© OpenStreetMap contributors** (ODbL 1.0) — dados de base/infraestrutura/uso do solo/transportes do Overture vêm do OSM. Places: Overture (Meta/Microsoft/etc.), **CDLA-Permissive-2.0**.

| arquivo | fonte | licença |
|---|---|---|
| facilities.json | Overture Maps release 2026-10-21.0 (S3 público): theme=places/place; theme=base/infrastructure e base/land_use | places CDLA-Permissive-2.0; base ODbL-1.0 |
| airports.json | airport-codes (OurAirports) https://github.com/datasets/airport-codes + NE 10m atual; `military` por nome/NE/`infrastructure military_airport` (<3 km)/dentro do bbox de `land_use military` | domínio público |
| ports.json | NE 10m atual + clusters (~3 km) de `base/infrastructure` subtype quay, pier nomeado (>=0,5 km), ferry_terminal, a <=0,5° do mar (navgrid); Overture não tem categoria "porto" | ODbL-1.0 |
| roads.json | Overture transportation/segment (OSM): motorway=cls0, trunk=cls1, primary=cls2 (sem `*_link`) + ferrovias/balsas (cls 3/4) do roads.json anterior | ODbL-1.0 |
| province_stats.json | contagens por província (ponto-em-polígono em provinces.geo.json; fora do polígono -> mais próxima <=0,25°) | derivado |

## Regras de filtragem
- Leitura colunar por arquivo-fonte (cache em tools/.cache/osm/, gitignored). Orçamento: facilities.json ~13 MB.
- hospital: places hospital/general/childrens/specialty/psychiatric/veterans, conf>=0,9, nome com termo hospitalar multilíngue (exclui clínica/dental/veterinário) + polígonos land_use hospital sem place a <0,6 km; dedupe 1,2 km. size 2 = nome de hospital universitário/geral/regional/central etc.; 1 = conf>=0,97. (Overture tem ~540k "hospital"; a maioria é clínica/duplicata — descartada.)
- police/fire_station: places conf>=0,95 com nome, dedupe 5 km (limite de tamanho; subconjunto, não todas).
- university: places college_university conf>=0,95 + nome de universidade/college, + land_use university/college; dedupe 6 km / 4 km.
- military_base: land_use military (base, naval_base, barracks, airfield, military_school/hospital; "military" genérico só diag>=1 km) + places military_site/base; dedupe 10 km; size por diagonal do polígono (>=6 km=2, >=1,5=1). OSM em alguns países (ex.: Turquia, Tailândia) tagueia muitos terrenos militares: densidade reflete o mapeamento.
- prison: places jail_or_prison + land_use/infra prison; dedupe 3 km. dam: infra dam nomeada com diag>=0,5 km ou qualquer com >=1 km; dedupe 6 km; size por diag. bridge_major: bbox diag>=3 km (aprox. comprimento), dedupe 6 km, size 5 km=2, 3,5=1.
- fuel_depot: tanques `storage_tank` com conteúdo oil/fuel/gas/diesel/etc. agrupados em células de ~2 km com >=6 tanques (size por contagem: 8=1, 20=2). telecom: communication_tower com height>=120 m (180=1, 250=2). water_treatment: nenhuma classe correspondente existe no release (0 itens).
- Nomes vazios ("") em size 0 de hospital/university/police/fire_station para caber no orçamento.
- escolas (province_stats.school): places school/elementary/middle/high/public/private/religious/charter/montessori com conf>=0,5, apenas contagem.
- roads: grade ~1 km (nós = média dos extremos na célula), arestas internas à célula descartadas, duplicatas (a,b) -> menor (cls,km), nós grau 2 de mesma classe contraídos, componentes ligados por lacuna <=25 km (aresta cls2 reta), componentes <30 km removidos, Douglas-Peucker 0,004° (~0,45 km), geom 3 casas. `km` = haversine ao longo da geometria. Primary: células de 2° ordenadas pela população das cidades NE, até 1,1 M pontos (a maior parte das primary fora das regiões mais povoadas foi omitida; o antigo cls2 do NE (estradas secundárias) foi substituído).
