import json,os,numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
CACHE=os.path.join(HERE,"..",".cache","osm")
DATA=os.path.join(HERE,"..","..","public","data")
def jload(n): return json.load(open(os.path.join(DATA,n)))
def jsave(n,o):
    with open(os.path.join(DATA,n),"w") as f: json.dump(o,f,separators=(",",":"),ensure_ascii=False)
def iso2_to_id():
    return {c["iso2"]:c["id"] for c in jload("countries.json")}
def hav(lon1,lat1,lon2,lat2):
    p=np.pi/180;a=np.sin((lat2-lat1)*p/2)**2+np.cos(lat1*p)*np.cos(lat2*p)*np.sin((lon2-lon1)*p/2)**2
    return 12742*np.arcsin(np.sqrt(a))
def dedupe(lon,lat,r_km=3):
    """greedy: mantém o primeiro de cada grupo dentro de r_km (grade)"""
    lon=np.asarray(lon);lat=np.asarray(lat);keep=np.ones(len(lon),bool);grid={}
    for i in range(len(lon)):
        gx,gy=int(lon[i]//0.1),int(lat[i]//0.1);hit=False
        for dx in(-1,0,1):
            for dy in(-1,0,1):
                for j in grid.get((gx+dx,gy+dy),()):
                    if hav(lon[i],lat[i],lon[j],lat[j])<r_km:hit=True;break
                if hit:break
            if hit:break
        if hit:keep[i]=False
        else:grid.setdefault((gx,gy),[]).append(i)
    return keep

_prov=None
def province_of(lon,lat,maxd=0.25):
    """índice de província (ids de provinces.json) por ponto-em-polígono; fora de polígono -> mais próxima dentro de maxd graus; -1 se nenhuma."""
    global _prov
    import shapely
    if _prov is None:
        g=json.load(open(os.path.join(DATA,"provinces.geo.json")))["features"]
        geoms=[shapely.from_geojson(json.dumps(f["geometry"])) for f in g]
        _prov=(shapely.STRtree(geoms),[f["properties"]["id"] for f in g])
    tree,ids=_prov
    pts=shapely.points(np.asarray(lon,float),np.asarray(lat,float))
    out=np.full(len(pts),-1,np.int32)
    pi,gi=tree.query(pts,predicate="within")
    out[pi]=gi
    miss=np.where(out<0)[0]
    if len(miss):
        q,g2=tree.query_nearest(pts[miss],max_distance=maxd,all_matches=False)
        out[miss[q]]=g2
    return out,ids
