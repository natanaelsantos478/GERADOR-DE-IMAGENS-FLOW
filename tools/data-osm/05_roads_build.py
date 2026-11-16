# Constroi roads.json: Overture motorway(0)/trunk(1)/primary(2, conforme regra) + ferrovias/balsas (cls 3/4) do roads.json atual.
import glob,os,sys,duckdb,shapely,numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from common import *
PRIMARY_KM_MAX=float(os.environ.get("PRIMARY_BUDGET_PTS","1100000"))  # orçamento de pontos para primary
TOL=0.004
files=sorted(glob.glob(CACHE+"/roads/*.parquet"));con=duckdb.connect()
P=[];SL=[];CL=[]
for f in files:
    w=con.execute(f"select cls,g from '{f}'").fetchnumpy()
    if not len(w["cls"]):continue
    g=shapely.from_wkb(np.array([bytes(x) if x is not None else None for x in w["g"]],dtype=object));xy,ix=shapely.get_coordinates(g,return_index=True)
    n=np.bincount(ix,minlength=len(g));ok=n>=2
    st=np.cumsum(n)-n
    for k in np.where(~ok)[0]:pass
    P.append(xy.astype(np.float32));SL.append(n);CL.append(w["cls"])
    del g
# monta segmentos
lens=np.concatenate(SL);cls=np.concatenate(CL).astype(np.int8);xy=np.concatenate(P).astype(np.float64);del P
start=np.cumsum(lens)-lens
keep=lens>=2;print("segs",len(lens),"pts",len(xy),{c:int(((cls==c)&keep).sum()) for c in(0,1,2)},flush=True)
# regra primary: inclui primary em células 2° ordenadas por pop de cidades (cidades NE) até estourar orçamento de pontos
ptsper=lens.copy()
base=int(ptsper[(cls<2)&keep].sum());cities=jload("cities.json")["cols"]
cx=np.floor((np.array(cities["lon"])+180)/2).astype(int);cy=np.floor((np.array(cities["lat"])+90)/2).astype(int)
cellpop={}
for x,y,p in zip(cx,cy,cities["pop"]):cellpop[(x,y)]=cellpop.get((x,y),0)+(p or 0)
sx=xy[start,0];sy=xy[start,1];scx=np.floor((sx+180)/2).astype(int);scy=np.floor((sy+90)/2).astype(int)
pop=np.array([cellpop.get((a,b),0) for a,b in zip(scx,scy)],float)
prim=np.where((cls==2)&keep)[0];o=prim[np.argsort(-pop[prim],kind="stable")]
cum=np.cumsum(ptsper[o]);sel=o[cum<=PRIMARY_KM_MAX]
use=(cls<2)&keep;use[sel]=True
print("primary usados",len(sel),"de",len(prim),"pts motor+trunk",base,flush=True)
idx=np.where(use)[0]
# --- nós por grade ~1 km
def cellkey(lon,lat):
    j=np.floor(lat/0.009).astype(np.int64);lc=np.cos(np.radians((j+0.5)*0.009));i=np.floor(lon*lc/0.009).astype(np.int64)
    return (j+20000)*(1<<24)+(i+(1<<22))
old=jload("roads.json");on=old["nodes"];oe=old["edges"]
rail=[i for i,c in enumerate(oe["cls"]) if c>=3]
ol=np.array(on["lon"]);oa=np.array(on["lat"])
S0=xy[start[idx]];S1=xy[start[idx]+lens[idx]-1]
RA=np.array([oe["a"][i] for i in rail]);RB=np.array([oe["b"][i] for i in rail])
allp=np.vstack([S0,S1,np.c_[ol[RA],oa[RA]],np.c_[ol[RB],oa[RB]]])
keys=cellkey(allp[:,0],allp[:,1]);uk,inv=np.unique(keys,return_inverse=True)
cnt=np.bincount(inv);NL=np.bincount(inv,allp[:,0])/cnt;NA=np.bincount(inv,allp[:,1])/cnt
m=len(idx);r=len(rail)
ea=inv[:m];eb=inv[m:2*m];ra=inv[2*m:2*m+r];rb=inv[2*m+r:]
# arestas: (a,b,cls,km,geometria como array)
def seglen(c):
    if len(c)<2:return 0
    return float(hav(c[:-1,0],c[:-1,1],c[1:,0],c[1:,1]).sum())
E=[];
for t,i in enumerate(idx):
    a,b=ea[t],eb[t]
    if a==b:continue
    c=xy[start[i]:start[i]+lens[i]].copy();c[0]=(NL[a],NA[a]);c[-1]=(NL[b],NA[b])
    E.append((a,b,int(cls[i]),seglen(c),c))
og=np.array(old["geom"]).reshape(-1,2)
for t,i in enumerate(rail):
    a,b=ra[t],rb[t]
    if a==b:continue
    s=oe["geomStart"][i];c=og[s:s+oe["geomLen"][i]]
    E.append((a,b,oe["cls"][i],oe["km"][i],c))
del xy
print("arestas brutas",len(E),flush=True)
def dedupe(E):
    best={}
    for e in E:
        k=(min(e[0],e[1]),max(e[0],e[1]))
        o=best.get(k)
        if o is None or (e[2],e[3])<(o[2],o[3]):best[k]=e
    return list(best.values())
E=dedupe(E);print("dedup",len(E),flush=True)
# contração de nós grau 2 com mesma classe
def contract(E):
    inc={}
    for k,e in enumerate(E):
        inc.setdefault(e[0],[]).append(k);inc.setdefault(e[1],[]).append(k)
    used=np.zeros(len(E),bool);out=[]
    def contractible(n):
        l=inc[n];return len(l)==2 and E[l[0]][2]==E[l[1]][2] and l[0]!=l[1]
    def orient(e,frm):  # devolve (to, coords) partindo de frm
        return (e[1],e[4]) if e[0]==frm else (e[0],e[4][::-1])
    for k0,e0 in enumerate(E):
        if used[k0]:continue
        # só inicia em aresta com ponta não contraível (ou ciclo tratado depois)
        for start_n in(e0[0],e0[1]):
            if not contractible(start_n):break
        else:continue
        if contractible(start_n):continue
        used[k0]=True;cur=e0[1] if start_n==e0[0] else e0[0]
        coords=[e0[4] if start_n==e0[0] else e0[4][::-1]];km=e0[3];cl=e0[2];k=k0
        while contractible(cur):
            l=inc[cur];nk=l[0] if l[0]!=k else l[1]
            if used[nk]:break
            used[nk]=True;nxt,c=orient(E[nk],cur);coords.append(c[1:]);km+=E[nk][3];cur=nxt;k=nk
        out.append((start_n,cur,cl,km,np.vstack(coords)))
    for k,e in enumerate(E):  # ciclos/restos
        if not used[k]:out.append(e)
    return [e for e in out if e[0]!=e[1]]
E=dedupe(contract(E));print("contraído",len(E),flush=True)
# componentes
N=len(uk)
def comps(E):
    a=np.array([e[0] for e in E]);b=np.array([e[1] for e in E])
    return connected_components(coo_matrix((np.ones(len(a)),(a,b)),shape=(N,N)),directed=False)[1]
for rnd in range(3):
    lab=comps(E);kmc=np.bincount(lab[[e[0] for e in E]],weights=[e[3] for e in E],minlength=N)
    deg=np.zeros(N,int)
    for e in E:deg[e[0]]+=1;deg[e[1]]+=1
    nodes=np.where(deg>0)[0];rank=np.argsort(np.argsort(-kmc[:]))  # menor rank = maior comp
    rk=rank[lab]
    xyz=lambda ids:np.c_[np.cos(np.radians(NA[ids]))*np.cos(np.radians(NL[ids])),np.cos(np.radians(NA[ids]))*np.sin(np.radians(NL[ids])),np.sin(np.radians(NA[ids]))]*6371
    tree=cKDTree(xyz(nodes));d,j=tree.query(xyz(nodes),k=12,distance_upper_bound=25)
    best={}
    for ii in range(len(nodes)):
        n=nodes[ii]
        for dd,jj in zip(d[ii],j[ii]):
            if jj>=len(nodes):break
            m2=nodes[jj]
            if rk[m2]<rk[n]:
                c=lab[n]
                if c not in best or dd<best[c][0]:best[c]=(dd,n,m2)
                break
    add=0
    for c,(dd,n,m2) in best.items():
        E.append((n,m2,2,float(dd),np.array([[NL[n],NA[n]],[NL[m2],NA[m2]]])));add+=1
    print("rodada",rnd,"ligações",add,flush=True)
    if not add:break
lab=comps(E);kmc=np.bincount(lab[[e[0] for e in E]],weights=[e[3] for e in E],minlength=N)
E=[e for e in E if kmc[lab[e[0]]]>=30]
# simplifica e escreve
used=sorted({e[0] for e in E}|{e[1] for e in E});nid={n:i for i,n in enumerate(used)}
nlon=np.round(NL[used],4);nlat=np.round(NA[used],4)
ls=[]
for e in E:
    c=np.array(e[4],float).copy();c[0]=(nlon[nid[e[0]]],nlat[nid[e[0]]]);c[-1]=(nlon[nid[e[1]]],nlat[nid[e[1]]]);ls.append(c)
lens2=np.array([len(c) for c in ls]);big=np.concatenate(ls);ix=np.repeat(np.arange(len(ls)),lens2)
lines=shapely.simplify(shapely.linestrings(big,indices=ix),TOL)
gx,gi=shapely.get_coordinates(lines,return_index=True);cnt=np.bincount(gi,minlength=len(E))
gx=np.round(gx,3);gs=np.cumsum(cnt)-cnt
# garante extremos exatos = nós (3 casas ~ nós 4 casas: arredonda nós p/ 3 casas p/ coerência com geom)
geom=[round(float(v),3) for v in gx.ravel()]
nodes_out={"lon":[float(v) for v in nlon],"lat":[float(v) for v in nlat]}
edges={"a":[nid[e[0]] for e in E],"b":[nid[e[1]] for e in E],"km":[round(e[3],1) for e in E],"cls":[e[2] for e in E],"geomStart":gs.tolist(),"geomLen":cnt.tolist()}
jsave("roads.json",{"nodes":nodes_out,"edges":edges,"geom":geom})
import collections;print("final nós",len(used),"arestas",len(E),"pts",len(gx),collections.Counter(edges["cls"]))
