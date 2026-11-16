import matplotlib;matplotlib.use("Agg");import matplotlib.pyplot as plt,numpy as np,os
from common import *
fig=plt.figure(figsize=(20,10),dpi=100);ax=fig.add_axes([0,0,1,1]);ax.set_facecolor("#0b1020");fig.patch.set_facecolor("#0b1020")
R=jload("roads.json");g=np.array(R["geom"]).reshape(-1,2);e=R["edges"]
col={0:"#555566",1:"#444455",2:"#2a2a38"}
for c in(2,1,0):
    segs=[(s,l) for s,l,k in zip(e["geomStart"],e["geomLen"],e["cls"]) if k==c]
    x=[];y=[]
    for s,l in segs:x+=list(g[s:s+l,0])+[np.nan];y+=list(g[s:s+l,1])+[np.nan]
    ax.plot(x,y,lw=.25,c=col[c])
F=jload("facilities.json")["cols"];K=np.array(F["kind"]);lo=np.array(F["lon"]);la=np.array(F["lat"])
for k,cl,sz in[("hospital","#ff4040",1.2),("military_base","#ffd400",5)]:
    m=K==k;ax.scatter(lo[m],la[m],s=sz,c=cl,lw=0,label=k)
A=jload("airports.json")["cols"];a=np.array(A["military"])==0;ax.scatter(np.array(A["lon"])[a],np.array(A["lat"])[a],s=1,c="#40c0ff",lw=0,label="airport")
m=np.array(A["military"])==1;ax.scatter(np.array(A["lon"])[m],np.array(A["lat"])[m],s=6,c="#ff8000",lw=0,label="military airport")
P=jload("ports.json")["cols"];ax.scatter(P["lon"],P["lat"],s=2,c="#40ff80",lw=0,label="port")
ax.set_xlim(-180,180);ax.set_ylim(-60,85);ax.legend(loc="lower left",facecolor="#202030",labelcolor="w",markerscale=4)
fig.savefig(CACHE+"/../osm-preview.png")
