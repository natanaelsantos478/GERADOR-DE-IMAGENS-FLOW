# usage: python3 -I mkfinal.py -> jobs for select.json (+ yaw.json fronts) -> tools/.cache/landmarks/final-jobs.json, output public/models/landmarks/<key>.glb
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
from specs import S
C = os.path.join(here, '../../.cache/landmarks'); P = os.path.join(here, '../../../public/models/landmarks')
os.makedirs(P, exist_ok=True)
sel = json.load(open(os.path.join(here, 'select.json')))
yaw = json.load(open(os.path.join(here, 'yaw.json'))) if os.path.exists(os.path.join(here, 'yaw.json')) else {}
jobs = []
for k, v in sel.items():
    j = {'src': os.path.join(C, str(v['id'])), 'out': os.path.join(P, k + '.glb'), 'heightM': v.get('heightM', S[k][5]), 'spanM': v.get('spanM', 0), 'mode': v.get('mode', 'height'), 'color': S[k][9]}
    if 'crossM' in v: j['crossM'] = v['crossM']
    if 'rotx' in v: j['rotx'] = v['rotx']
    if k in yaw: j['yaw'] = yaw[k]
    jobs.append(j)
json.dump(jobs, open(os.path.join(C, 'final-jobs.json'), 'w')); print(len(jobs))
