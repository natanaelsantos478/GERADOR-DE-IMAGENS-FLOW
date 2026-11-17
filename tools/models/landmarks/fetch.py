# usage: python3 -I fetch.py ia_id... -> downloads the first zip (or STL/OBJ files) of archive.org thingiverse-<id> into tools/.cache/landmarks/<id>/ and unzips it. Writes meta.json.
import sys, os, json, urllib.request, subprocess, concurrent.futures as cf
C = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../.cache/landmarks')
H = {'User-Agent': 'Meridiano-Game/1.0'}
def get(u, dst=None):
    r = urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=120)
    d = r.read()
    if dst: open(dst, 'wb').write(d)
    return d
def one(i):
    d = os.path.join(C, str(i))
    if os.path.exists(os.path.join(d, 'meta.json')): return i, 'cached'
    try:
        os.makedirs(d, exist_ok=False)
        m = json.loads(get('https://archive.org/metadata/thingiverse-%s' % i))
        fs = [f for f in m['files'] if f['name'].lower().endswith(('.zip', '.stl', '.obj')) and int(f.get('size', 0)) < 40e6]
        for f in fs[:6]:
            p = os.path.join(d, os.path.basename(f['name']))
            get('https://archive.org/download/thingiverse-%s/%s' % (i, urllib.parse.quote(f['name'])), p)
            if p.lower().endswith('.zip'): subprocess.run(['unzip', '-oq', p, '-d', os.path.join(d, 'x')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        mm = m['metadata']; json.dump({k: mm.get(k) for k in ('title', 'creator', 'licenseurl', 'description')}, open(os.path.join(d, 'meta.json'), 'w'))
        return i, 'ok'
    except Exception as e: return i, 'ERR %s' % e
import urllib.parse
with cf.ThreadPoolExecutor(4) as ex:
    for i, s in ex.map(one, sys.argv[1:]): print(i, s)
