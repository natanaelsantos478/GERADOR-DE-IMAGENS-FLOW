# facilities.json + ports.json a partir dos caches (places/infra/landuse).
import re,os,duckdb,numpy as np,collections
from common import *
c=duckdb.connect()
def q(sql):
    r=c.execute(sql).fetchnumpy();o={}
    for k,v in r.items():
        if np.ma.isMaskedArray(v):v=np.ma.filled(v.astype(float),np.nan) if v.dtype.kind in 'fiu' else np.ma.filled(v.astype(object),None)
        o[k]=v
    return o
PL=CACHE+"/places/*.parquet"
rows=[]  # (kind,name,lon,lat,size,cc)
def clus(lon,lat,r):  # índices a manter (grade ~r km) preferindo ordem de entrada
    k=np.floor(lat/(r/111)).astype(np.int64)*10**7+np.floor(lon*np.cos(np.radians(lat))/(r/111)).astype(np.int64)
    _,i=np.unique(k,return_index=True);return np.sort(i)
def add(kind,d,size,r=0.0,sel=None):
    n=len(d["lon"]);ix=np.arange(n) if sel is None else np.where(sel)[0]
    if r and len(ix):
        ordr=ix[np.argsort(-np.asarray(size)[ix] if hasattr(size,"__len__") else 0,kind="stable")]
        ix=ordr[clus(d["lon"][ordr],d["lat"][ordr],r)]
    sz=np.asarray(size) if hasattr(size,"__len__") else np.full(n,size)
    nm=d.get("name",np.array([None]*n,object))
    cc=d.get("cc",np.array([None]*n,object))
    for i in ix:rows.append((kind,(nm[i] if sz[i]>0 or kind in("military_base","prison","dam","bridge_major") else "") if nm[i] is not None and nm[i]==nm[i] else "",float(d["lon"][i]),float(d["lat"][i]),int(sz[i]),cc[i]))
BIG=re.compile(r"universit|teaching|academic|medical cent|central|general|regional|cl[ií]nicas|charit|centre hospitalier|chu\b|military|militar|children|national|johns hopkins|mayo|cleveland",re.I)
def hsize(d):
    nm=d["name"];cf=d["conf"]
    return np.array([2 if (n and BIG.search(n) and f>=.5) else (1 if f>=.97 and n else 0) for n,f in zip(nm,cf)])
# hospitais
HN=r"(hospital|hospitalar|h[oô]pital|ospedale|krankenhaus|klinikum|szpital|bolnic|sjukhus|sykehus|k[óo]rh[áa]z|rumah sakit|\\brsu|\\brsud|ziekenhuis|nemocnice|sairaala|spital|hastane|больниц|госпитал|病院|医院|병원|مستشفى|bệnh viện|medical cent|medical college|infirmary|cl[ií]nicas)"
h=q(f"select name,lon,lat,conf,cc from '{PL}' where tax in('hospital','childrens_hospital','general_hospital','specialty_hospital','psychiatric_hospital','veterans_hospital') and conf>=0.9 and regexp_matches(lower(name),'{HN}') and not regexp_matches(lower(name),'dental|veterin|animal|pet |pharm|farm[aá]cia|cl[ií]nica|clinic')")
lu=q(f"select name,lon,lat,diag from '{CACHE}/landuse.parquet' where class='hospital'")
hs=hsize(h);add("hospital",h,hs,1.2)
lh=q(f"select * from (select 1)") if False else None
# landuse hospital sem place próximo: entra se não houver hospital a <0.5 km (aprox. por grade)
from scipy.spatial import cKDTree
def far(d,ref,km):
    if not len(ref["lon"]):return np.ones(len(d["lon"]),bool)
    t=cKDTree(np.c_[ref["lon"]*np.cos(np.radians(ref["lat"])),ref["lat"]]);dd,_=t.query(np.c_[d["lon"]*np.cos(np.radians(d["lat"])),d["lat"]])
    return dd*111>km
m=far(lu,h,0.6);add("hospital",lu,np.where(lu["diag"]>0.5,2,1),1.2,m)
# policia/bombeiros: places
for kind,tx,cf in[("police","police_station",.5),("fire_station","fire_station",.5)]:
    d=q(f"select name,lon,lat,conf,cc from '{PL}' where tax='{tx}' and conf>=0.95 and name is not null");add(kind,d,np.where(np.nan_to_num(d["conf"])>=.98,1,0),5.0)
# universidades
d=q(f"select name,lon,lat,conf,cc from '{PL}' where tax='college_university' and conf>=0.95 and regexp_matches(lower(name),'(universit|universidad|universidade|polytechn|politecn|college|faculdade|facultad|hochschule|大学|大學|대학|университет|جامعة|institute of tech)')")
big=np.array([2 if re.search(r"universit|universidad|université|universität|institute of technology|\bmit\b",n or "",re.I) and f>=.7 else (1 if f>=.7 else 0) for n,f in zip(d["name"],d["conf"])])
add("university",d,big,6.0)
lu=q(f"select name,lon,lat,diag from '{CACHE}/landuse.parquet' where class in('university','college')")
add("university",lu,np.where(lu["diag"]>1,2,1),4.0,far(lu,d,3.0))
# presídios
d=q(f"select name,lon,lat,conf,cc from '{PL}' where tax='jail_or_prison'");add("prison",d,np.where(np.nan_to_num(d["conf"])>=.8,1,0),3.0)
lu=q(f"select name,lon,lat,diag from '{CACHE}/landuse.parquet' where class='prison'");add("prison",lu,1,3.0,far(lu,d,1.0))
ip=q(f"select name,lon,lat,diag from '{CACHE}/infra.parquet' where class='prison'");add("prison",ip,1,3.0,far(ip,d,1.0))
# bases militares
lu=q(f"select name,lon,lat,diag,class from '{CACHE}/landuse.parquet' where subtype='military' and (class!='military' or diag>=1)")
sz=np.where(lu["diag"]>=6,2,np.where(lu["diag"]>=1.5,1,0));add("military_base",lu,sz,10.0)
d=q(f"select name,lon,lat,cc from '{PL}' where tax in('military_site','military_base')");
add("military_base",d,np.full(len(d["lon"]),0),10.0,far(d,lu,8.0))
# infra
dm=q(f"select name,lon,lat,diag from '{CACHE}/infra.parquet' where class='dam' and ((name is not null and diag>=0.5) or diag>=1)");add("dam",dm,np.where(dm["diag"]>=1,2,np.where(dm["diag"]>=0.3,1,0)),1.0)
br=q(f"select name,lon,lat,diag from '{CACHE}/infra.parquet' where subtype='bridge' and diag>=3");add("bridge_major",br,np.where(br["diag"]>=5,2,np.where(br["diag"]>=3.5,1,0)),6.0)
tk=q(f"select lon,lat from '{CACHE}/infra.parquet' where class='storage_tank'")
if len(tk["lon"]):
    k=np.floor(tk["lat"]/0.02).astype(np.int64)*10**7+np.floor(tk["lon"]*np.cos(np.radians(tk["lat"]))/0.02).astype(np.int64)
    u,inv,n=np.unique(k,return_inverse=True,return_counts=True)
    lo=np.bincount(inv,tk["lon"])/n;la=np.bincount(inv,tk["lat"])/n;ok=n>=6
    add("fuel_depot",{"lon":lo,"lat":la},np.where(n>=20,2,np.where(n>=8,1,0)),0,ok)
tw=q(f"select name,lon,lat,height from '{CACHE}/infra.parquet' where class='communication_tower'")
add("telecom",tw,np.where(tw["height"]>=250,2,np.where(tw["height"]>=180,1,0)),2.0)
wt=q(f"select name,lon,lat,diag from '{CACHE}/infra.parquet' where regexp_matches(class,'water_treat|wastewater|sewage|water_works|treatment')")
add("water_treatment",wt,np.where(wt["diag"]>=0.4,1,0),1.0)
# país/iso3 via província
lon=np.array([r[2] for r in rows]);lat=np.array([r[3] for r in rows])
pi,ids=province_of(lon,lat);prov={p["id"]:p["countryId"] for p in jload("provinces.json")}
i2=iso2_to_id()
iso=[(prov[ids[p]] if p>=0 else i2.get(r[5] or "","")) for p,r in zip(pi,rows)]
# descarta pontos sem país (mar aberto)
ok=[i for i,x in enumerate(iso) if x]
rows=[rows[i] for i in ok];iso=[iso[i] for i in ok];pi=pi[ok]
cols={"kind":[r[0] for r in rows],"name":[r[1] for r in rows],"lon":[round(r[2],4) for r in rows],"lat":[round(r[3],4) for r in rows],"size":[r[4] for r in rows],"iso3":iso}
jsave("facilities.json",{"n":len(rows),"cols":cols})
np.save(CACHE+"/fac_prov.npy",np.array([ids[p] if p>=0 else "" for p in pi]))
print(collections.Counter(cols["kind"]),os.path.getsize(DATA+"/facilities.json")/1e6,"MB")
if os.path.exists(CACHE+'/school_counts.json'):raise SystemExit
# ---- escolas (só contagem por província)
s=q(f"select lon,lat from '{PL}' where regexp_matches(tax,'^(school|elementary_school|middle_school|high_school|public_school|private_school|religious_school|charter_school|montessori_school)$') and conf>=0.5")
sp,_=province_of(s["lon"],s["lat"]);cnt=collections.Counter(ids[p] for p in sp if p>=0)
import json;json.dump(dict(cnt),open(CACHE+"/school_counts.json","w"))
print("escolas",sum(cnt.values()))
