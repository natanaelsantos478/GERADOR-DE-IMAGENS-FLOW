# Validação: contagens, conhecidos, Dijkstra, tamanhos.
import time,heapq,os,collections,numpy as np
from common import *
C=jload("countries.json");cont={c["id"]:c["continent"] for c in C}
F=jload("facilities.json")["cols"]
print("facilities por kind:",dict(collections.Counter(F["kind"])))
print("por continente:",dict(collections.Counter((k,cont.get(i,"?")) for k,i in zip(F["kind"],F["iso3"])).most_common(60)))
def find(cols,sub,lon0,lat0,r=0.3,kind=None):
    return [(cols["name"][i],cols["lon"][i],cols["lat"][i]) for i in range(len(cols["lon"])) if (kind is None or cols["kind"][i]==kind) and sub.lower() in cols["name"][i].lower() and abs(cols["lon"][i]-lon0)<r and abs(cols["lat"][i]-lat0)<r][:2]
for s,x,y in[("Cl",-46.67,-23.55),("Charit",13.38,52.53),("Johns Hopkins",-76.59,39.30)]:print("hospital",s,find(F,s,x,y,0.4,"hospital"))
A=jload("airports.json")["cols"];print("aeroportos",len(A["lon"]),"militares",sum(A["military"]),collections.Counter(A["size"]))
for s,x,y in[("Ramstein",7.6,49.44),("Al Udeid",51.3,25.1),("Edwards",-117.9,34.9)]:print("airport",s,[(A["name"][i],A["military"][i]) for i in range(len(A["lon"])) if abs(A["lon"][i]-x)<.4 and abs(A["lat"][i]-y)<.4 and A["size"][i]>=0][:4])
P=jload("ports.json")["cols"];print("portos",len(P["lon"]),collections.Counter(P["size"]))
for s,x,y in[("Santos",-46.3,-23.95),("Rotterdam",4.1,51.95),("Shanghai",121.6,31.3)]:print("porto",s,[(P["name"][i],P["size"][i]) for i in range(len(P["lon"])) if abs(P["lon"][i]-x)<.5 and abs(P["lat"][i]-y)<.5][:3])
R=jload("roads.json");n=R["nodes"];e=R["edges"];N=len(n["lon"])
adj=[[] for _ in range(N)]
for a,b,k in zip(e["a"],e["b"],e["km"]):adj[a].append((b,k));adj[b].append((a,k))
nl=np.array(n["lon"]);na=np.array(n["lat"])
def nearest(lon,lat):return int(np.argmin(hav(lon,lat,nl,na)))
def dij(s,t):
    d={s:0};h=[(0,s)]
    while h:
        k,u=heapq.heappop(h)
        if u==t:return k
        if k>d[u]:continue
        for v,w in adj[u]:
            if k+w<d.get(v,1e18):d[v]=k+w;heapq.heappush(h,(k+w,v))
for nm,a,b in[("SP->Brasilia",(-46.63,-23.55),(-47.93,-15.78)),("Lisboa->Moscou",(-9.14,38.72),(37.62,55.75)),("NY->LA",(-74.0,40.71),(-118.24,34.05))]:
    t=time.time();r=dij(nearest(*a),nearest(*b));print(nm,None if r is None else round(r),"km",round((time.time()-t)*1000),"ms")
print("roads: nós",N,"arestas",len(e["a"]),dict(collections.Counter(e["cls"])))
tot=0
for f in sorted(os.listdir(DATA)):
    s=os.path.getsize(DATA+"/"+f)
    if f in("facilities.json","airports.json","ports.json","roads.json","province_stats.json"):print(f,round(s/1e6,2),"MB")
for dp,_,fs in os.walk(DATA):tot+=sum(os.path.getsize(dp+"/"+f) for f in fs)
print("public/data total",round(tot/1e6,1),"MB")
