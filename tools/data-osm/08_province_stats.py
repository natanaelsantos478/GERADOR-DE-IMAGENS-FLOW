# province_stats.json: {provinceId: {kind:n,..., airport,airport_mil,port,powerplant,school,road_km:[c0,c1,c2,c3,c4]}} (só chaves != 0)
import json,collections,numpy as np
from common import *
S=collections.defaultdict(lambda:collections.Counter())
F=jload("facilities.json")["cols"];fp=np.load(CACHE+"/fac_prov.npy")
for k,p in zip(F["kind"],fp):
    if p:S[p][k]+=1
for name,key in[("airports.json","airport"),("ports.json","port"),("powerplants.json","powerplant")]:
    d=jload(name)["cols"];pi,ids=province_of(d["lon"],d["lat"])
    for j,p in enumerate(pi):
        if p>=0:
            S[ids[p]][key]+=1
            if key=="airport" and d["military"][j]:S[ids[p]]["airport_mil"]+=1
for p,n in json.load(open(CACHE+"/school_counts.json")).items():S[p]["school"]=n
R=jload("roads.json");e=R["edges"];g=np.array(R["geom"]).reshape(-1,2)
mid=np.array(e["geomStart"])+np.array(e["geomLen"])//2;pi,ids=province_of(g[mid,0],g[mid,1])
road=collections.defaultdict(lambda:[0.0]*5)
for p,c,km in zip(pi,e["cls"],e["km"]):
    if p>=0:road[ids[p]][c]+=km
out={}
for p in jload("provinces.json"):
    i=p["id"];o=dict(S.get(i,{}))
    if i in road:o["road_km"]=[round(x) for x in road[i]]
    out[i]=o
jsave("province_stats.json",out);print("provincias com dados",sum(1 for v in out.values() if v),"de",len(out))
