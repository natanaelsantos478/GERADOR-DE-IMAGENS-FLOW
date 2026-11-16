import duckdb,re,urllib.request
B="https://overturemaps-us-west-2.s3.amazonaws.com/"
REL="release/2026-10-21.0/"
def keys(prefix):
    out=[];tok=None
    while True:
        u=B+"?list-type=2&prefix="+REL+prefix+(("&continuation-token="+urllib.parse.quote(tok)) if tok else "")
        x=urllib.request.urlopen(u).read().decode()
        out+=re.findall("<Key>([^<]*)</Key>",x)
        m=re.search("<NextContinuationToken>([^<]*)",x)
        if not m:break
        tok=m.group(1)
    return [B+k for k in out]
import urllib.parse
def con():
    c=duckdb.connect();c.execute("install httpfs;load httpfs;install spatial;load spatial;set threads=4;set memory_limit='3GB'");return c
def lst(ks): return "["+",".join("'"+k+"'" for k in ks)+"]"
