# usage: python3 -I build_json.py -> public/data/landmarks.json + public/models/landmarks/LICENSES.md (from select.json, specs.py and the archive.org item metadata cached by fetch.py)
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
from specs import S, NOMODEL
C = os.path.join(here, '../../.cache/landmarks'); PUB = os.path.join(here, '../../../public')
ACC = {'Estatua da Liberdade': 'Estátua da Liberdade', 'Grande Piramide de Gize': 'Grande Pirâmide de Gizé', 'Opera de Sydney': 'Ópera de Sydney', 'Portao de Brandemburgo': 'Portão de Brandemburgo',
 'Capitolio dos EUA': 'Capitólio dos EUA', 'Catedral de Brasilia': 'Catedral de Brasília', 'Torre de TV de Brasilia': 'Torre de TV de Brasília', 'Pentagono': 'Pentágono', 'Congresso Nacional': 'Congresso Nacional',
 'Maracana': 'Maracanã', 'Pao de Acucar': 'Pão de Açúcar', 'Basilica de Sao Pedro': 'Basílica de São Pedro', 'Catedral de Sao Basilio': 'Catedral de São Basílio', 'Torre de Toquio': 'Torre de Tóquio', 'Esfinge de Gize': 'Esfinge de Gizé',
 'Torre de Belem': 'Torre de Belém', 'Represa de Itaipu': 'Represa de Itaipu', 'Esfinge de Gize ': 'Esfinge de Gizé', 'Cidade Proibida': 'Cidade Proibida', 'Grande Mesquita Sheikh Zayed': 'Grande Mesquita Sheikh Zayed'}
LIC = {'https://creativecommons.org/licenses/by/4.0/': 'CC-BY-4.0', 'https://creativecommons.org/licenses/by-sa/3.0/': 'CC-BY-SA-3.0', 'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0-1.0', 'https://creativecommons.org/licenses/by-sa/4.0/': 'CC-BY-SA-4.0'}
sel = json.load(open(os.path.join(here, 'select.json'))); yaw = json.load(open(os.path.join(here, 'yaw.json')))
HEADING_NOTE = {}
out = []; lic = []
for k, (n, pt, lon, lat, g, h, span, head, rad, col) in S.items():
    e = {'id': k, 'name': n, 'namePt': ACC.get(pt, pt), 'lon': lon, 'lat': lat, 'groundElevM': g, 'headingDeg': head, 'scale': 1, 'model': None, 'heightM': h, 'footprintRadiusM': rad}
    if span: e['spanM'] = span
    if k in sel:
        v = sel[k]; m = json.load(open(os.path.join(C, str(v['id']), 'meta.json'))); f = os.path.join(PUB, 'models/landmarks', k + '.glb')
        L = LIC[m['licenseurl']]
        e.update(model='models/landmarks/%s.glb' % k, heightM=v.get('heightM', h), license=L, author=m['creator'], source='https://www.thingiverse.com/thing:%s' % v['id'], mirror='https://archive.org/details/thingiverse-%s' % v['id'], sizeBytes=os.path.getsize(f))
        if 'SA' in L: e['shareAlike'] = True
        lic.append('| %s | %s | %s | %s | %s | %d |' % (k, n, m['creator'], L, e['source'], e['sizeBytes']))
    out.append(e)
for k, (n, pt, lon, lat, g, h, span, head, rad) in NOMODEL.items():
    e = {'id': k, 'name': n, 'namePt': ACC.get(pt, pt), 'lon': lon, 'lat': lat, 'groundElevM': g, 'headingDeg': head, 'scale': 1, 'model': None, 'heightM': h, 'footprintRadiusM': rad}
    if span: e['spanM'] = span
    out.append(e)
json.dump({'frontAxis': '-Z', 'note': 'glb: +Y up, origin at base centre, metres, front faces -Z; headingDeg = compass bearing (from north, clockwise) of that front. model null = no free-licence model found.', 'landmarks': out}, open(os.path.join(PUB, 'data/landmarks.json'), 'w'), indent=1, ensure_ascii=False)
open(os.path.join(PUB, 'models/landmarks/LICENSES.md'), 'w').write('# Landmark models\nSource: Thingiverse designs (mirrored on archive.org), converted to glb (merged, decimated to <=30k tris, single material, scaled to real metres). Attribution required (CC-BY); CC-BY-SA models must stay under the same licence when redistributed.\n\n| id | landmark | author | licence | source | bytes |\n|---|---|---|---|---|---|\n' + '\n'.join(lic) + '\n')
print(len(out), sum(1 for e in out if e['model']))
