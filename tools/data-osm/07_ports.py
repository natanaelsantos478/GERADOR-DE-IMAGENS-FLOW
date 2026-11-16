# ports.json = NE atual + clusters de cais (Overture infrastructure quay/pier/ferry_terminal) próximos do mar, sem duplicatas (3 km).
import base64,duckdb,numpy as np,collections
from common import *
ng=jload("navgrid.json");W,H=ng["w"],ng["h"]
bits=np.unpackbits(np.frombuffer(base64.b64decode(ng["sea"]),np.uint8),bitorder='little')[:W*H].reshape(H,W)
def near_sea(lon,lat):
    x=((lon+180)/360*W).astype(int)%W;y=np.clip(((90-lat)/180*H).astype(int),0,H-1)
    r=np.zeros(len(lon),bool)
    for dx in(-2,-1,0,1,2):
        for dy in(-2,-1,0,1,2):r|=bits[np.clip(y+dy,0,H-1),(x+dx)%W]==1
    return r
c=duckdb.connect()
d=c.execute(f"select class,subtype,name,lon,lat,diag from '{CACHE}/infra.parquet' where subtype='quay' or class in('ferry_terminal','pier')").fetchnumpy()
lon,lat=d["lon"],d["lat"]
k=np.floor(lat/0.03).astype(np.int64)*10**7+np.floor(lon*np.cos(np.radians(lat))/0.03).astype(np.int64)
u,inv=np.unique(k,return_inverse=True);n=len(u)
isq=(d["subtype"]=="quay");L=np.bincount(inv,np.where(isq,d["diag"],0));Pn=np.bincount(inv,np.where(d["class"]=="pier",d["diag"],0));cnt=np.bincount(inv)
lo=np.bincount(inv,lon)/cnt;la=np.bincount(inv,lat)/cnt
names=[""]*n;best=np.zeros(n)
for i in np.where(d["name"]!=None)[0]:
    j=inv[i]
    if d["diag"][i]>=best[j]:best[j]=d["diag"][i];names[j]=d["name"][i]
ev=L+0.3*Pn;ok=ev>=0.4
ok&=near_sea(lo,la)
size=np.where(L>=3,2,np.where(L>=1,1,0))
old=jload("ports.json")["cols"];ol,oa=np.array(old["lon"]),np.array(old["lat"])
from scipy.spatial import cKDTree
t=cKDTree(np.c_[ol*np.cos(np.radians(oa)),oa]);dd,_=t.query(np.c_[lo*np.cos(np.radians(la)),la]);ok&=dd*111>3
idx=np.where(ok)[0];idx=idx[np.argsort(-size[idx],kind="stable")]
keep=dedupe(lo[idx],la[idx],3);idx=idx[keep]
cols={k2:list(v) for k2,v in old.items()}
cols["name"]+=[names[i] or "" for i in idx];cols["lon"]+=[round(float(lo[i]),4) for i in idx];cols["lat"]+=[round(float(la[i]),4) for i in idx];cols["size"]+=[int(size[i]) for i in idx]
jsave("ports.json",{"n":len(cols["lon"]),"cols":cols});print("ports",len(cols["lon"]),"novos",len(idx),collections.Counter(cols["size"]))
