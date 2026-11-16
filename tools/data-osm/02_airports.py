# airports.json ampliado: OurAirports/airport-codes (domínio público) + Natural Earth atual; mesmo esquema.
import csv,re,os,numpy as np
from common import *
rows=[r for r in csv.DictReader(open(os.path.join(CACHE,"airport-codes.csv"))) if r["type"] in("large_airport","medium_airport","small_airport")]
MIL=re.compile(r"\b(air ?base|afb|air force|raf|naval air|nas |army air|aaf|military|militar|base a[eé]rea|fliegerhorst|marine corps|mcas|joint base|air station|aeronaval|a[eé]rodrome militaire|base a[eé]rienne|luftwaffe|fuerza a[eé]rea|aviation base|kuvvetleri|vvs|air defen[cs]e)\b",re.I)
old=jload("airports.json");oc=old["cols"]
L=[];La=[];N=[];I=[];S=[];M=[]
for r in rows:
    lat,lon=map(float,r["coordinates"].split(","))
    L.append(lon);La.append(lat);N.append(r["name"]);I.append(r["iata_code"] or "")
    S.append({"large_airport":2,"medium_airport":1,"small_airport":0}[r["type"]])
    M.append(1 if MIL.search(r["name"]) else 0)
L=np.array(L);La=np.array(La)
# NE atual: acrescenta os que não existem (3 km) e marca military do NE
def near(lon,lat,arrL,arrA,km):
    d=hav(lon,lat,arrL,arrA);j=int(np.argmin(d));return j if d[j]<km else -1
add=0
for i in range(old["n"]):
    j=near(oc["lon"][i],oc["lat"][i],L,La,3)
    if j>=0:
        if oc["military"][i]:M[j]=1
        if not I[j] and oc["iata"][i]:I[j]=oc["iata"][i]
    else:
        L=np.append(L,oc["lon"][i]);La=np.append(La,oc["lat"][i]);N.append(oc["name"][i]);I.append(oc["iata"][i]);S.append(oc["size"][i]);M.append(oc["military"][i]);add+=1
import duckdb;c=duckdb.connect()
mb=c.execute(f"select x0,y0,x1,y1 from '{CACHE}/landuse.parquet' where subtype='military' and diag<=40").fetchnumpy()
mc=c.execute(f"select lon,lat from '{CACHE}/infra.parquet' where class='military_airport'").fetchnumpy()
from scipy.spatial import cKDTree
t=cKDTree(np.c_[mc["lon"]*np.cos(np.radians(mc["lat"])),mc["lat"]]);dd,_=t.query(np.c_[L*np.cos(np.radians(La)),La])
for i in np.where(dd*111<3)[0]:M[i]=1
# aeroporto dentro (bbox) de polígono land_use=military
gx=np.floor(L/0.5).astype(int);gy=np.floor(La/0.5).astype(int);cell={}
for j in range(len(mb["x0"])):
    for x in range(int(mb["x0"][j]//0.5),int(mb["x1"][j]//0.5)+1):
        for y in range(int(mb["y0"][j]//0.5),int(mb["y1"][j]//0.5)+1):cell.setdefault((x,y),[]).append(j)
for i in range(len(L)):
    for j in cell.get((gx[i],gy[i]),()):
        if mb["x0"][j]<=L[i]<=mb["x1"][j] and mb["y0"][j]<=La[i]<=mb["y1"][j]:M[i]=1;break
o=np.argsort(-np.array(S),kind="stable")
cols={"name":[N[i] for i in o],"lon":[round(float(L[i]),4) for i in o],"lat":[round(float(La[i]),4) for i in o],"iata":[I[i] for i in o],"size":[S[i] for i in o],"military":[M[i] for i in o]}
jsave("airports.json",{"n":len(o),"cols":cols})
print("airports",len(o),"mil",sum(M),"NE adicionais",add)
