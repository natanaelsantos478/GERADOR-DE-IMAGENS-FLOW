# usage: python3 paint-batch.py [id...]  -- paints every untextured ground vehicle in public/models via paint2glb.py (needs .venv with bpy)
import json, struct, subprocess, sys, os, re
H = os.path.dirname(os.path.abspath(__file__)); PUB = os.path.join(H, '../../public/models'); OUT = os.path.join(H, '../.cache/paint-out')
SCHEME = {'mbt': 'rus', 'ifv': 'nato', 'apc': 'rus', 'spg': 'rus', 'mlrs': 'rus', 'sam': 'rus', 'mbt_m1abrams': 'des', 'mbt_leopard2': 'nato', 'mbt_leclerc': 'des3',
  'mbt_challenger2': 'des', 'mbt_t72': 'rus', 'mbt_t90': 'rus2', 'mbt_type99': 'pla', 'mbt_strv103': 'swe', 'apc_btr80': 'rus', 'ifv_puma': 'nato', 'apc_boxer': 'nato',
  'ifv_bradley': 'od', 'apc_fennek': 'des3', 'spg_m109': 'od', 'spg_pzh2000': 'nato', 'spg_2s1': 'rus', 'spg_2s3': 'rus', 'spg_rch155': 'nato', 'mlrs_m270': 'od',
  'mlrs_tos1': 'rus2', 'mlrs_iskander': 'rus', 'sam_pantsir': 'rus2', 'sam_tor': 'rus', 'sam_s300': 'rus', 'sam_tunguska': 'rus'}
def images(f):
    d = open(f, 'rb').read(); l = struct.unpack('<I', d[12:16])[0]; return len(json.loads(d[20:20 + l]).get('images', []))
os.makedirs(OUT, exist_ok=True)
ids = sys.argv[1:] or [k for k in SCHEME if images(f'{PUB}/{k}.glb') == 0]
for k in ids:
    r = subprocess.run([f'{H}/.venv/bin/python', '-I', f'{H}/paint2glb.py', f'{PUB}/{k}.glb', f'{OUT}/{k}.glb', SCHEME[k]], capture_output=True, text=True)
    print(k, SCHEME[k], 'ok' if r.returncode == 0 and os.path.exists(f'{OUT}/{k}.glb') else 'FAIL ' + r.stdout[-300:] + r.stderr[-300:], flush=True)
