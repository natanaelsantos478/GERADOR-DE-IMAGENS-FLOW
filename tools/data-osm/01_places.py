# Extrai de Overture places apenas as categorias relevantes (leitura colunar) -> tools/.cache/osm/places.parquet
import os,sys;from ov import *
OUT=os.path.join(os.path.dirname(__file__),"..",".cache","osm","places.parquet")  # diretório places/ com 1 parquet por arquivo-fonte
OUT=OUT[:-8]+".parquet"
if os.path.exists(OUT+'.done'): sys.exit(0)
c=con();ks=keys("theme=places/type=place/")
pat=r"hospital|police|fire_station|prison|universit|school|military|seaport|port$|harbor|marina|terminal|^dam$|oil|fuel|water_treat|telecom|power|bridge|tower|radio|satellite|airport|air_force|army|navy|government_office|courthouse|embassy"
neg="animal_hospital|b2b_|flight_school|driving_school|sport|cooking|surfing|cosmetology|massage|music_school|art_school|bartending|traffic_school|language_school|sporting|motorsport|oil_change|airport_shuttle|airport_lounge|passport|esports|medical_school_|hospital_equipment"
c.execute("set memory_limit='3GB';set threads=4")
D=OUT[:-8];os.makedirs(D,exist_ok=True)
for i,k in enumerate(ks):
    o=f"{D}/{i:02d}.parquet"
    if os.path.exists(o):continue
    c.execute(f"""copy (select taxonomy.primary tax, names.primary name, ST_X(geometry) lon, ST_Y(geometry) lat,
     confidence conf, operating_status st, addresses[1].country cc from read_parquet('{k}')
     where regexp_matches(taxonomy.primary,'{pat}') and not regexp_matches(taxonomy.primary,'{neg}') and coalesce(operating_status,'open')!='closed')
     to '{o}.tmp' (format parquet,compression zstd)""")
    os.rename(o+".tmp",o)
open(OUT+".done","w").write("1")
