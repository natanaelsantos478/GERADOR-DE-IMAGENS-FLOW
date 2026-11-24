"""Roads and buildings for the battle pack, from OpenStreetMap, checked against the satellite photo.

Every road gets a surface: from its OSM tags when present (surface / tracktype), otherwise inferred from the
photo along its centre line (grey = paved, beige/brown = gravel or dirt, green = grass track), with a confidence.
Where the tag exists the photo is compared with it, to measure how far the photo can be trusted.
"""
import io, json, math, os, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageDraw

OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

PAVED = {'asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'concrete:plates', 'concrete:lanes', 'cobblestone', 'metal'}
GRAVEL = {'gravel', 'fine_gravel', 'compacted', 'pebblestone', 'unpaved'}
DIRT = {'ground', 'dirt', 'earth', 'mud', 'sand'}
GRASS = {'grass', 'grass_paver'}
# class -> (width m, default surface)
CLASS = {
    'motorway': (11, 'paved'), 'trunk': (9, 'paved'), 'primary': (7.5, 'paved'), 'secondary': (6.5, 'paved'),
    'tertiary': (6, 'paved'), 'motorway_link': (5, 'paved'), 'trunk_link': (5, 'paved'), 'primary_link': (5, 'paved'),
    'secondary_link': (5, 'paved'), 'tertiary_link': (5, 'paved'), 'unclassified': (4.5, None), 'residential': (5, 'paved'),
    'living_street': (4.5, 'paved'), 'service': (3.5, None), 'pedestrian': (4, 'paved'), 'track': (3, None),
    'path': (1.5, None), 'footway': (1.8, None), 'cycleway': (2, None), 'bridleway': (2, None), 'steps': (2, 'paved'),
}
SURFACES = ['paved', 'gravel', 'dirt', 'grass']


def fetch(cache, s, w, n, e):
    if os.path.exists(cache):
        return json.load(open(cache, encoding='utf-8'))
    q = f'[out:json][timeout:180];(way["highway"]({s},{w},{n},{e});way["building"]({s},{w},{n},{e}););out tags geom;'
    last = None
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'meridiano-tools'})
            d = json.load(urllib.request.urlopen(req, timeout=240))
            json.dump(d, open(cache, 'w', encoding='utf-8'))
            return d
        except Exception as ex:  # try the next mirror
            last = ex
    raise last


def tag_surface(t):
    s = t.get('surface', '')
    if s in PAVED: return 'paved'
    if s in GRAVEL: return 'gravel'
    if s in DIRT: return 'dirt'
    if s in GRASS: return 'grass'
    tt = t.get('tracktype', '')
    if tt == 'grade1': return 'paved'
    if tt == 'grade2': return 'gravel'
    if tt in ('grade3', 'grade4'): return 'dirt'
    if tt == 'grade5': return 'grass'
    return None


def photo_surface(sat, pts_px):
    """Classify the photo along a centre line. Returns (surface, confidence, samples)."""
    h, w = sat.shape[:2]
    samples = []
    for (x0, y0), (x1, y1) in zip(pts_px[:-1], pts_px[1:]):
        L = max(1, int(math.hypot(x1 - x0, y1 - y0)))
        for k in range(L + 1):
            x, y = int(x0 + (x1 - x0) * k / L), int(y0 + (y1 - y0) * k / L)
            if 0 <= x < w and 0 <= y < h:
                samples.append(sat[y, x])
    if len(samples) < 4:
        return None, 0.0, 0
    # Measured on the Bastogne tags (Esri z15, ~3 m): along paved roads the median brightness is 0.48 and the
    # saturation 0.16; along gravel/dirt/grass tracks 0.24-0.34 and 0.34-0.45 (the 3 m tracks are mostly hidden by
    # verges and trees). So the photo tells paved from unpaved, but not gravel from dirt reliably.
    a = np.array(samples, np.float32)
    v = a.max(1)
    s = (v - a.min(1)) / np.maximum(v, 1e-3)
    vm, sm = float(np.median(v)), float(np.median(s))
    gr = float(np.median(a[:, 1] - a[:, 0]))
    paved = np.clip((vm - 0.33) / 0.12, 0, 1) * np.clip((0.33 - sm) / 0.12, 0, 1)
    if paved >= 0.5:
        return 'paved', float(paved), len(a)
    if paved <= 0.2:
        if vm < 0.25 and gr > 0.085:
            return 'grass', 0.55, len(a)
        return ('gravel' if vm > 0.33 else 'dirt'), 0.5, len(a)
    return None, 0.0, len(a)


def build(out, sat_file, lat0, lon0, span, m_lat, m_lon, n=4096, cache_dir='.'):
    half = span / 2
    s_, n_ = lat0 - half / m_lat, lat0 + half / m_lat
    w_, e_ = lon0 - half / m_lon, lon0 + half / m_lon
    data = fetch(os.path.join(cache_dir, f'osm_{lat0:.4f}_{lon0:.4f}.json'), s_, w_, n_, e_)
    sat = np.asarray(Image.open(sat_file).convert('RGB'), np.float32) / 255
    sn = sat.shape[0]
    loc = lambda la, lo: ((lo - lon0) * m_lon, (lat0 - la) * m_lat)
    to_sat = lambda x, z: ((x / span + 0.5) * sn, (z / span + 0.5) * sn)
    roads, buildings = [], []
    agree, compared = {}, {}
    for el in data['elements']:
        t = el.get('tags', {})
        pts = [loc(p['lat'], p['lon']) for p in el.get('geometry', [])]
        if len(pts) < 2:
            continue
        if 'building' in t:
            levels = t.get('building:levels')
            try:
                lv = float(levels) if levels else None
            except ValueError:
                lv = None
            hgt = t.get('height')
            try:
                hm = float(str(hgt).split()[0]) if hgt else None
            except ValueError:
                hm = None
            buildings.append({'p': [[round(x, 1), round(z, 1)] for x, z in pts], 'kind': t['building'],
                              'levels': lv, 'height': hm, 'roof': t.get('roof:shape')})
            continue
        hw = t.get('highway')
        if hw not in CLASS:
            continue
        width, default = CLASS[hw]
        tagged = tag_surface(t)
        photo, conf, ns = photo_surface(sat, [to_sat(x, z) for x, z in pts])
        if tagged and photo:
            # agreement on what the photo can see: paved vs unpaved
            compared[tagged] = compared.get(tagged, 0) + 1
            agree[tagged] = agree.get(tagged, 0) + int((tagged == 'paved') == (photo == 'paved'))
        if tagged:
            surface, source, c = tagged, 'osm', 1.0
        elif default:
            surface, source, c = default, 'class', 0.9
        elif photo and conf >= 0.5:
            surface, source, c = photo, 'photo', conf
        else:
            surface, source, c = ('dirt' if hw in ('track', 'path', 'bridleway') else 'paved'), 'guess', 0.3
        if 'width' in t:
            try:
                width = float(str(t['width']).split()[0])
            except ValueError:
                pass
        roads.append({'p': [[round(x, 1), round(z, 1)] for x, z in pts], 'class': hw, 'width': width,
                      'surface': surface, 'source': source, 'conf': round(c, 2),
                      'bridge': t.get('bridge') == 'yes', 'tunnel': t.get('tunnel') == 'yes', 'name': t.get('name')})
    with open(os.path.join(out, 'world.json'), 'w', encoding='utf-8') as f:
        json.dump({'roads': roads, 'buildings': buildings, 'source': 'OpenStreetMap contributors (ODbL)'}, f)
    stats = {
        'roads': len(roads), 'buildings': len(buildings),
        'surface_from': {k: sum(1 for r in roads if r['source'] == k) for k in ('osm', 'class', 'photo', 'guess')},
        'surface': {k: sum(1 for r in roads if r['surface'] == k) for k in SURFACES},
        'photo_agrees_with_tag': {k: f'{agree.get(k, 0)}/{compared[k]}' for k in compared},
    }
    print('ROADS', json.dumps(stats, ensure_ascii=False))
    return roads, buildings


def rasterize(roads, buildings, span, n=4096):
    """Masks at the terrain grid: road surface id (1..4, 0 none) and building footprints."""
    sc = n / span
    px = lambda x, z: ((x + span / 2) * sc, (z + span / 2) * sc)
    road = Image.new('L', (n, n), 0)
    dr = ImageDraw.Draw(road)
    order = sorted(roads, key=lambda r: r['width'])  # wide roads drawn last, on top
    for r in order:
        if r['tunnel']:
            continue
        sid = SURFACES.index(r['surface']) + 1
        wpx = max(1, int(round(r['width'] * sc)))
        dr.line([px(x, z) for x, z in r['p']], fill=sid, width=wpx, joint='curve')
    bld = Image.new('L', (n, n), 0)
    db = ImageDraw.Draw(bld)
    for b in buildings:
        db.polygon([px(x, z) for x, z in b['p']], fill=255)
    return np.asarray(road), np.asarray(bld)


def validation_sheet(sat_file, roads, buildings, span, dst, zones):
    """Photo with the OSM roads coloured by surface and buildings outlined, for a few zones."""
    sat = Image.open(sat_file).convert('RGB')
    sn = sat.size[0]
    col = {'paved': (255, 60, 200), 'gravel': (255, 255, 255), 'dirt': (255, 140, 0), 'grass': (0, 255, 120)}
    S = 520
    sheet = Image.new('RGB', (S * 2 + 10, (S + 24) * ((len(zones) + 1) // 2) + 34), 'white')
    d0 = ImageDraw.Draw(sheet)
    for k, (name, cx, cz) in enumerate(zones):
        sx, sy = (cx / span + 0.5) * sn, (cz / span + 0.5) * sn
        box = (int(sx - S / 2), int(sy - S / 2), int(sx + S / 2), int(sy + S / 2))
        im = sat.crop(box)
        d = ImageDraw.Draw(im)
        f = lambda x, z: ((x / span + 0.5) * sn - box[0], (z / span + 0.5) * sn - box[1])
        for b in buildings:
            d.polygon([f(x, z) for x, z in b['p']], outline=(255, 40, 40))
        for r in roads:
            d.line([f(x, z) for x, z in r['p']], fill=col[r['surface']], width=2 if r['source'] != 'guess' else 1)
        x0, y0 = (k % 2) * (S + 10), (k // 2) * (S + 24)
        d0.text((x0 + 4, y0 + 4), name, fill='black')
        sheet.paste(im, (x0, y0 + 20))
    x = 4
    for lbl, c in [('asfalto/concreto', col['paved']), ('cascalho', col['gravel']), ('terra', col['dirt']), ('grama', col['grass']), ('construcao', (255, 40, 40))]:
        d0.rectangle((x, sheet.height - 26, x + 14, sheet.height - 12), fill=c, outline='black')
        d0.text((x + 18, sheet.height - 26), lbl, fill='black')
        x += 150
    sheet.save(dst)
