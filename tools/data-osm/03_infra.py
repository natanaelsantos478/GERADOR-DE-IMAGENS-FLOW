# Overture base/infrastructure + base/land_use: só colunas leves (bbox/classe/nome) -> tools/.cache/osm/infra.parquet, landuse.parquet
import os,sys;from ov import *
C=os.path.join(os.path.dirname(__file__),"..",".cache","osm")
c=con()
DIAG="sqrt(power((bbox.xmax-bbox.xmin)*cos(radians((bbox.ymin+bbox.ymax)/2)),2)+power(bbox.ymax-bbox.ymin,2))*111"
CEN="(bbox.xmin+bbox.xmax)/2 lon,(bbox.ymin+bbox.ymax)/2 lat"
if not os.path.exists(C+"/infra.parquet"):
    ks=keys("theme=base/type=infrastructure/")
    c.execute(f"""copy (select class,subtype,names.primary name,{CEN},{DIAG} diag,height,
      coalesce(source_tags['content'],source_tags['substance'],source_tags['man_made']) tag
      from read_parquet({lst(ks)}) where
       (subtype='bridge' and class in('bridge','viaduct','cantilever','movable','suspension','cable_stayed') and {DIAG}>=1.2)
    or (class='dam' and (names.primary is not null or {DIAG}>=0.4))
    or (class='storage_tank' and coalesce(source_tags['content'],source_tags['substance']) in('oil','fuel','gas','propane','petrol','diesel','kerosene','jet_fuel','lpg','chemicals'))
    or (class in('communication_tower') and height>=120)
    or regexp_matches(class,'water_treat|wastewater|sewage|water_works|treatment|refiner|oil_|depot|bunker|prison|military')
    or subtype='quay' or class='ferry_terminal' or (class='pier' and names.primary is not null and {DIAG}>=0.5)
    or (subtype='water' and class in('wastewater','water_works','reservoir_covered'))
    ) to '{C}/infra.parquet.tmp' (format parquet,compression zstd)""")
    os.rename(C+"/infra.parquet.tmp",C+"/infra.parquet")
if not os.path.exists(C+"/landuse.parquet"):
    ks=keys("theme=base/type=land_use/")
    c.execute(f"""copy (select subtype,class,names.primary name,{CEN},bbox.xmin x0,bbox.ymin y0,bbox.xmax x1,bbox.ymax y1,{DIAG} diag
      from read_parquet({lst(ks)}) where (subtype='military' and class in('military','base','naval_base','barracks','airfield','military_school','military_hospital'))
      or class in('hospital','university','college','prison')) to '{C}/landuse.parquet.tmp' (format parquet,compression zstd)""")
    os.rename(C+"/landuse.parquet.tmp",C+"/landuse.parquet")
print("ok")
