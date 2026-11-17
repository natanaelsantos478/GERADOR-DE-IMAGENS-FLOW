# usage: python3 -I mkjobs.py -> writes tools/.cache/landmarks/jobs.json (all candidates)
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from specs import S
here = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(here, '../../.cache/landmarks')
cand = json.load(open(os.path.join(here, ''+(sys.argv[1] if len(sys.argv)>1 else 'candidates.json')+'')))
os.makedirs(os.path.join(C, 'out'), exist_ok=True)
jobs = [{'src': os.path.join(C, str(i)), 'out': os.path.join(C, 'out', '%s_%s.glb' % (k, i)), 'heightM': S[k][5], 'spanM': 0, 'color': S[k][9]} for k, ids in cand.items() for i in ids]
json.dump(jobs, open(os.path.join(C, 'jobs.json'), 'w'))
print(len(jobs))
