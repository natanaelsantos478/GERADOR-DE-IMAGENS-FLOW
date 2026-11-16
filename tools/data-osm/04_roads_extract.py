# Overture transportation/segment: motorway+trunk+primary (sem *_link), geometria simplificada (~0,45 km), 1 parquet por arquivo-fonte.
import os,sys;from ov import *
D=os.path.join(os.path.dirname(__file__),"..",".cache","osm","roads");os.makedirs(D,exist_ok=True)
c=con();ks=keys("theme=transportation/type=segment/")
for i,k in enumerate(ks):
    o=f"{D}/{i:03d}.parquet"
    if os.path.exists(o):continue
    c.execute(f"""copy (select case class when 'motorway' then 0 when 'trunk' then 1 else 2 end cls, ST_AsWKB(ST_Simplify(geometry,0.004)) g
      from read_parquet('{k}') where subtype='road' and class in('motorway','trunk','primary') and coalesce(subclass,'')!='link')
      to '{o}.tmp' (format parquet,compression zstd)""")
    os.rename(o+".tmp",o);print(i,flush=True)
