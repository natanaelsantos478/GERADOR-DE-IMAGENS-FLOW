"""world.json for the battle pack: buildings, roads, sidewalks, markings, signs and airports from OpenStreetMap,
checked and completed with the satellite photo, with every analysed value kept in the site parameter store
(site_params.py) so the next rebuild of the same place reuses it instead of analysing again.
"""
import json, math, os, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image

import hires, osm_roads, roofs, site_params

OVERPASS = osm_roads.OVERPASS
LANE_W = {'motorway': 3.6, 'trunk': 3.5, 'primary': 3.3, 'secondary': 3.1, 'tertiary': 3.0}
URBAN_SIDEWALK = {'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'primary_link',
                  'secondary_link', 'tertiary_link'}
MARKED = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link',
          'secondary_link', 'tertiary_link', 'unclassified', 'residential'}
AEROWAY_W = {'runway': 45.0, 'taxiway': 23.0, 'taxilane': 15.0, 'stopway': 45.0}


def fetch_extra(cache, s, w, n, e):
    """Nodes (signs, crossings, signals) and airport ways — not in the first query."""
    if os.path.exists(cache):
        return json.load(open(cache, encoding='utf-8'))
    q = (f'[out:json][timeout:180];('
         f'node["highway"~"^(crossing|stop|give_way|traffic_signals|street_lamp|motorway_junction)$"]({s},{w},{n},{e});'
         f'node["traffic_sign"]({s},{w},{n},{e});node["crossing"]({s},{w},{n},{e});'
         f'way["aeroway"]({s},{w},{n},{e}););out tags geom;')
    last = None
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'meridiano-tools'})
            d = json.load(urllib.request.urlopen(req, timeout=240))
            json.dump(d, open(cache, 'w', encoding='utf-8'))
            return d
        except Exception as ex:
            last = ex
    raise last


def num(v, default=None):
    try:
        return float(str(v).split()[0].replace(',', '.'))
    except (TypeError, ValueError):
        return default


def road_width(t, hw, base):
    w = num(t.get('width'))
    if w:
        return w, 'osm'
    lanes = num(t.get('lanes'))
    if lanes and hw in LANE_W:
        return lanes * LANE_W[hw] + 0.5, 'lanes'
    if lanes and hw in ('residential', 'unclassified', 'service', 'living_street'):
        return lanes * 2.9 + 0.3, 'lanes'
    if t.get('oneway') == 'yes' and hw in ('primary', 'secondary', 'tertiary', 'residential'):
        return base * 0.6, 'class'
    return base, 'class'


def markings(tiles, latlon, width):
    """Paint on a paved road from the z18 photo: centre line (solid / dashed / none) and edge lines.
    Perpendicular brightness profiles every 2 m; a paint line is a narrow strip >= 0.1 brighter than the road."""
    mpp = tiles.m_per_px(latlon[0][0])
    pts = [tiles.px(a, b) for a, b in latlon]
    centre, edge, n = [], [], 0
    step = 2.0 / mpp
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1:
            continue
        dx, dy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -dy, dx
        k = 0.5 * step
        while k < L:
            cx, cy = x0 + dx * k, y0 + dy * k
            offs = np.linspace(-width / 2, width / 2, max(7, int(width / mpp) + 1)) / mpp
            c = tiles.sample(cx + nx * offs, cy + ny * offs)
            k += step
            if np.isnan(c[:, 0]).any():
                continue
            v = c.mean(1)
            base = np.median(v)
            # OSM lines and the photo can be 1-2 m apart: look for the narrowest bright strip within +-1.6 m of the
            # centre, measured against its own neighbours 0.8 m away (local contrast, robust to shadows)
            mid = len(v) // 2
            r = max(1, int(1.6 / mpp))
            g = max(1, int(0.8 / mpp))
            best = 0.0
            for i in range(max(g, mid - r), min(len(v) - g, mid + r + 1)):
                best = max(best, v[i] - 0.5 * (v[i - g] + v[i + g]))
            centre.append(best if v[mid - r:mid + r + 1].max() - base > 0.06 else 0.0)
            edge.append(max(v[1:3].max(), v[-3:-1].max()) - base)
            n += 1
    if n < 6:
        return None
    c = np.array(centre)
    painted = (c > 0.08).mean()
    # dashed paint: on/off runs along the road; solid: on almost everywhere
    runs = int(np.abs(np.diff((c > 0.08).astype(int))).sum())
    if painted > 0.65:
        ctype = 'solid'
    elif painted > 0.2 and runs >= 3:
        ctype = 'dashed'
    else:
        ctype = 'none'
    e = (np.array(edge) > 0.1).mean()
    return {'centre': ctype, 'edge': bool(e > 0.45), 'painted': round(float(painted), 2), 'samples': n}


def build(out, sat_file, lat0, lon0, span, m_lat, m_lon, cache_dir, store_dir, analyse=True):
    half = span / 2
    s_, n_ = lat0 - half / m_lat, lat0 + half / m_lat
    w_, e_ = lon0 - half / m_lon, lon0 + half / m_lon
    data = osm_roads.fetch(os.path.join(cache_dir, f'osm_{lat0:.4f}_{lon0:.4f}.json'), s_, w_, n_, e_)
    extra = fetch_extra(os.path.join(cache_dir, f'osm_extra_{lat0:.4f}_{lon0:.4f}.json'), s_, w_, n_, e_)
    sat = np.asarray(Image.open(sat_file).convert('RGB'), np.float32) / 255
    sn = sat.shape[0]
    tiles = hires.Tiles(cache_dir)
    store = site_params.Store(store_dir)
    loc = lambda la, lo: ((lo - lon0) * m_lon, (lat0 - la) * m_lat)
    to_sat = lambda x, z: ((x / span + 0.5) * sn, (z / span + 0.5) * sn)
    rnd = lambda pts: [[round(x, 2), round(z, 2)] for x, z in pts]
    t0 = time.time()

    # z18 tiles only where buildings and marked roads are (prefetched in parallel)
    if analyse:
        keys = set()
        for el in data['elements']:
            t = el.get('tags', {})
            if 'building' in t or t.get('highway') in MARKED:
                for p in el.get('geometry', [])[::3]:
                    keys.add((int(tiles.px(p['lat'], p['lon'])[0] // 256), int(tiles.px(p['lat'], p['lon'])[1] // 256)))
        got = tiles.prefetch(keys)
        print(f'HIRES tiles {len(keys)} (downloaded {got}) {time.time() - t0:.0f}s')

    buildings, roads = [], []
    stat = {'roof_src': {}, 'roof_shape': {}, 'roof_mat': {}, 'marking': {}, 'sidewalk': 0}
    bump = lambda k, v: stat[k].__setitem__(v, stat[k].get(v, 0) + 1)
    # buildings ---------------------------------------------------------------
    centres = []
    for el in data['elements']:
        t = el.get('tags', {})
        if 'building' not in t or len(el.get('geometry', [])) < 3:
            continue
        ll = [(p['lat'], p['lon']) for p in el['geometry']]
        pts = [loc(a, b) for a, b in ll]
        h = site_params.geom_hash(pts)
        cla, clo = ll[0]
        prm = store.get('b', el['id'], cla, clo, h)
        if prm is None:
            area = abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2
            an = roofs.analyse(tiles, ll) if analyse and area >= 25 else None
            rect = rectangularity(pts)
            shape, mat, src = roofs.decide(an, t.get('roof:shape'), area, rect, t['building'], tiles.m_per_px(cla))
            if t.get('roof:colour') in ('white', '#ffffff'):
                mat = 'white'
            prm = {'roof': shape, 'mat': mat, 'src': src, 'col': an['color'] if an else None}
            store.put('b', el['id'], cla, clo, h, prm)
        bump('roof_src', prm['src']); bump('roof_shape', prm['roof']); bump('roof_mat', prm['mat'])
        buildings.append({'id': el['id'], 'p': rnd(pts), 'kind': t['building'], 'levels': num(t.get('building:levels')),
                          'height': num(t.get('height')), 'min_level': num(t.get('building:min_level')),
                          'roof': prm['roof'], 'roof_mat': prm['mat'], 'roof_col': prm['col'], 'roof_src': prm['src'],
                          'roof_levels': num(t.get('roof:levels')), 'roof_dir': t.get('roof:orientation')})
        centres.append(np.mean(pts, 0))
    centres = np.array(centres) if centres else np.zeros((0, 2))
    grid = {}
    for i, c in enumerate(centres):
        grid.setdefault((int(c[0] // 50), int(c[1] // 50)), []).append(i)

    def built_up(x, z):
        n = 0
        for gx in (-1, 0, 1):
            for gz in (-1, 0, 1):
                n += len(grid.get((int(x // 50) + gx, int(z // 50) + gz), []))
        return n >= 6

    # roads -------------------------------------------------------------------
    for el in data['elements']:
        t = el.get('tags', {})
        hw = t.get('highway')
        if hw not in osm_roads.CLASS or len(el.get('geometry', [])) < 2:
            continue
        ll = [(p['lat'], p['lon']) for p in el['geometry']]
        pts = [loc(a, b) for a, b in ll]
        h = site_params.geom_hash(pts)
        base_w, default = osm_roads.CLASS[hw]
        prm = store.get('r', el['id'], ll[0][0], ll[0][1], h)
        if prm is None:
            tagged = osm_roads.tag_surface(t)
            photo, conf, _ = osm_roads.photo_surface(sat, [to_sat(x, z) for x, z in pts])
            if tagged:
                surface, src = tagged, 'osm'
            elif default:
                surface, src = default, 'class'
            elif photo and conf >= 0.5:
                surface, src = photo, 'photo'
            else:
                surface, src = ('dirt' if hw in ('track', 'path', 'bridleway') else 'paved'), 'guess'
            width, wsrc = road_width(t, hw, base_w)
            mk = None
            if analyse and surface == 'paved' and hw in MARKED and width >= 4.5:
                mk = markings(tiles, ll, width)
            prm = {'surface': surface, 'src': src, 'w': round(width, 2), 'wsrc': wsrc, 'mk': mk}
            store.put('r', el['id'], ll[0][0], ll[0][1], h, prm)
        # sidewalks: OSM tag, otherwise urban streets in built-up areas
        sw = t.get('sidewalk') or t.get('sidewalk:both')
        mid = pts[len(pts) // 2]
        if sw in ('both', 'left', 'right', 'no', 'none', 'separate'):
            side = {'both': 'both', 'left': 'left', 'right': 'right'}.get(sw, 'none')
        elif hw in URBAN_SIDEWALK and prm['surface'] == 'paved' and built_up(*mid):
            side = 'both'
        else:
            side = 'none'
        if side != 'none':
            stat['sidewalk'] += 1
        mk = prm['mk']
        centre = mk['centre'] if mk else ('dashed' if hw in ('primary', 'secondary', 'tertiary', 'trunk') and t.get('oneway') != 'yes' else 'none')
        if hw in ('motorway', 'trunk') and centre == 'none':
            centre = 'dashed'   # lane divider on every carriageway (Belgian code); paint too thin for the z18 photo
        bump('marking', (mk['centre'] if mk else 'rule:' + centre))
        roads.append({'id': el['id'], 'p': rnd(pts), 'class': hw, 'width': prm['w'], 'surface': prm['surface'],
                      'source': prm['src'], 'lanes': num(t.get('lanes')), 'oneway': t.get('oneway') == 'yes',
                      'sidewalk': side, 'sidewalk_w': num(t.get('sidewalk:width'), 1.8), 'centre': centre,
                      'edge': (bool(mk['edge']) if mk else False) or hw in ('motorway', 'trunk', 'motorway_link', 'trunk_link'),
                      'maxspeed': num(t.get('maxspeed')), 'bridge': t.get('bridge') == 'yes',
                      'tunnel': t.get('tunnel') == 'yes', 'name': t.get('name')})

    # nodes: crossings, signals, signs ------------------------------------------
    nodes = []
    for el in extra['elements']:
        if el['type'] != 'node':
            continue
        t = el.get('tags', {})
        x, z = loc(el['lat'], el['lon'])
        kind = None
        if t.get('highway') == 'crossing' or 'crossing' in t:
            c = t.get('crossing', 'marked')
            kind = 'zebra' if c in ('zebra', 'marked', 'uncontrolled', 'traffic_signals') or t.get('crossing_ref') == 'zebra' else None
            if c == 'traffic_signals':
                nodes.append({'k': 'signals', 'p': [round(x, 2), round(z, 2)]})
        elif t.get('highway') in ('stop', 'give_way', 'traffic_signals', 'street_lamp'):
            kind = {'traffic_signals': 'signals', 'street_lamp': 'lamp'}.get(t['highway'], t['highway'])
        elif 'traffic_sign' in t:
            kind = 'sign:' + t['traffic_sign']
        if kind:
            nodes.append({'k': kind, 'p': [round(x, 2), round(z, 2)], 'dir': t.get('direction')})

    # airports ----------------------------------------------------------------
    aero = []
    for el in extra['elements']:
        t = el.get('tags', {})
        a = t.get('aeroway')
        if el['type'] != 'way' or not a or len(el.get('geometry', [])) < 2:
            continue
        pts = [loc(p['lat'], p['lon']) for p in el['geometry']]
        aero.append({'k': a, 'p': rnd(pts), 'width': num(t.get('width'), AEROWAY_W.get(a, 20.0)), 'ref': t.get('ref'),
                     'surface': t.get('surface', 'asphalt')})

    with open(os.path.join(out, 'world.json'), 'w', encoding='utf-8') as f:
        json.dump({'roads': roads, 'buildings': buildings, 'nodes': nodes, 'aeroways': aero,
                   'source': 'OpenStreetMap contributors (ODbL); roof and marking analysis on Esri World Imagery'}, f)
    saved = store.save()
    print('WORLD', json.dumps({'buildings': len(buildings), 'roads': len(roads), 'nodes': len(nodes), 'aeroways': len(aero),
                               'params_reused': store.hits, 'params_new': store.misses, 'param_files_written': saved,
                               **stat, 'seconds': round(time.time() - t0)}, ensure_ascii=False))
    return roads, buildings


def rectangularity(pts):
    p = np.array(pts)
    area = abs(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])) / 2
    best = math.inf
    for i in range(len(p)):
        d = p[(i + 1) % len(p)] - p[i]
        L = np.hypot(*d)
        if L < 1e-3:
            continue
        d = d / L
        n = np.array([-d[1], d[0]])
        a, b = p @ d, p @ n
        best = min(best, np.ptp(a) * np.ptp(b))
    return float(area / best) if best > 0 else 0.0
