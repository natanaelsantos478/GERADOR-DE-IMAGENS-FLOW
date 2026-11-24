"""Turns RoadNet's per-pixel classes into clean markings built to the real standard (completion included).

Input: class map of a straightened strip (rows along the road, 10 cm; columns across, 10 cm, centre = OSM axis).
Output: a few primitives per road (the saved parameters), e.g.
  {'k': 'line', 'o': -0.05, 'w': 0.15, 'y0': 0, 'y1': 25.6, 'dash': [3, 9], 'phase': 1.2}
  {'k': 'zebra', 'y0': 12.1, 'y1': 16.1, 'x0': -3.2, 'x1': 3.2, 'bar': 0.5, 'step': 1.0}
  {'k': 'area', 'cls': 'hatch', 'poly': [[x, y], ...]}
Completion: a line seen over enough of the strip is extended over the gaps (cars, shadows, worn paint) with its
dash rhythm snapped to the national set; a zebra is rebuilt bar by bar from kerb to kerb.
"""
import numpy as np

RES = 0.1
OTHER, ROAD, SOLID, DASHED, ZEBRA, STOP, SYMBOL, HATCH, RED, SIDEWALK = range(10)
# Belgian / Vienna-convention dash patterns (dash, gap) in metres
DASH_SET = [(3.0, 9.0), (3.0, 3.0), (1.0, 1.0), (5.0, 1.5), (2.0, 2.0), (1.5, 4.5), (1.0, 2.0)]


def _runs(b):
    d = np.flatnonzero(np.diff(np.concatenate([[0], b.astype(np.int8), [0]])))
    return list(zip(d[::2], d[1::2]))


def lines(cls_map):
    """Longitudinal lines: offset, width, extent and dash rhythm, completed over gaps."""
    H, W = cls_map.shape
    a = (np.arange(W) - W / 2 + 0.5) * RES
    out = []
    for kind in (SOLID, DASHED):
        m = cls_map == kind
        prof = m.mean(0)
        cols = np.flatnonzero(prof > (0.25 if kind == SOLID else 0.08))
        if len(cols) == 0:
            continue
        groups = np.split(cols, np.flatnonzero(np.diff(cols) > 2) + 1)
        for g in groups:
            band = m[:, max(0, g[0] - 1):g[-1] + 2].any(1)
            on = _runs(band)
            if not on:
                continue
            o = float(np.average(a[g], weights=prof[g]))
            w = float(np.clip(len(g) * RES, 0.1, 0.5))
            y0, y1 = on[0][0] * RES, on[-1][1] * RES
            item = {'k': 'line', 'o': round(o, 2), 'w': round(w, 2), 'y0': round(y0, 1), 'y1': round(y1, 1)}
            if kind == DASHED and len(on) >= 2:
                dashes = [(e - s) * RES for s, e in on if (e - s) * RES >= 0.4]
                starts = [s * RES for s, e in on if (e - s) * RES >= 0.4]
                if len(dashes) >= 2:
                    period = float(np.median(np.diff(starts)))
                    dash = float(np.median(dashes))
                    # snap to the national set (gaps from cars count as missing dashes: period may be a multiple)
                    best = min(DASH_SET, key=lambda p: min(abs(period / k - (p[0] + p[1])) for k in (1, 2, 3)) + abs(dash - p[0]))
                    item['dash'] = list(best)
                    item['phase'] = round(float(np.median([(s % (best[0] + best[1])) for s in starts])), 2)
                else:
                    item['dash'] = [3.0, 9.0]
                    item['phase'] = round(starts[0] if starts else 0.0, 2)
            out.append(item)
    return out


def zebras(cls_map, road_l, road_r):
    """Zebra crossings rebuilt from kerb to kerb: 50 cm bars every metre over the measured depth."""
    H, W = cls_map.shape
    m = cls_map == ZEBRA
    rows = m.mean(1) > 0.08
    out = []
    for s, e in _runs(rows):
        if (e - s) * RES < 1.5:
            continue
        out.append({'k': 'zebra', 'y0': round(s * RES, 1), 'y1': round(e * RES, 1), 'x0': round(road_r + 0.3, 2),
                    'x1': round(road_l - 0.3, 2), 'bar': 0.5, 'step': 1.0})
    return out


def areas(cls_map, kinds=(HATCH, STOP, SYMBOL, RED)):
    """Other markings keep the recognised shape, cleaned: closed, small holes filled, as row-runs (compact)."""
    H, W = cls_map.shape
    names = {HATCH: 'hatch', STOP: 'stop', SYMBOL: 'symbol', RED: 'red'}
    out = []
    for k in kinds:
        m = cls_map == k
        if m.sum() < 30:
            continue
        # close 1-pixel gaps along both axes
        m = m | (np.roll(m, 1, 0) & np.roll(m, -1, 0)) | (np.roll(m, 1, 1) & np.roll(m, -1, 1))
        runs = []
        for i in range(H):
            for s, e in _runs(m[i]):
                if e - s >= 2:
                    runs.append([i, int(s), int(e)])
        out.append({'k': 'area', 'cls': names[k], 'runs': runs})
    return out


def road_edges(cls_map):
    H, W = cls_map.shape
    a = (np.arange(W) - W / 2 + 0.5) * RES
    road = np.isin(cls_map, [ROAD, SOLID, DASHED, ZEBRA, STOP, SYMBOL, HATCH, RED]).mean(0) > 0.5
    c = W // 2
    if not road[c]:
        return 3.0, -3.0
    l = c
    while l + 1 < W and road[l + 1]:
        l += 1
    r = c
    while r - 1 >= 0 and road[r - 1]:
        r -= 1
    return float(a[l]), float(a[r])


def build(cls_map):
    el, er = road_edges(cls_map)
    side = {}
    for name, sl in (('left', slice(int(len(cls_map[0]) / 2 + el / RES) + 1, None)), ('right', slice(0, int(len(cls_map[0]) / 2 + er / RES)))):
        sw = (cls_map[:, sl] == SIDEWALK).mean(0) > 0.5
        side[name] = round(float(sw.sum() * RES), 1)
    return {'edge_l': round(el, 2), 'edge_r': round(er, 2), 'sidewalk': side,
            'marks': lines(cls_map) + zebras(cls_map, el, er) + areas(cls_map)}


def render(model, H, W):
    """Clean drawing of the primitives (what the game paints), for checking against the photo."""
    img = np.full((H, W, 3), 80, np.uint8)
    a = (np.arange(W) - W / 2 + 0.5) * RES
    y = np.arange(H) * RES
    img[:, (a > model['edge_l']) | (a < model['edge_r'])] = (150, 140, 120)
    for mk in model['marks']:
        if mk['k'] == 'line':
            cols = np.abs(a - mk['o']) <= mk['w'] / 2
            rows = (y >= mk['y0'] - 1) & (y <= mk['y1'] + 1)
            if 'dash' in mk:
                d, g = mk['dash']
                rows &= ((y - mk['phase']) % (d + g)) < d
            img[np.ix_(rows, cols)] = (240, 240, 235)
        elif mk['k'] == 'zebra':
            rows = (y >= mk['y0']) & (y <= mk['y1'])
            cols = (a >= mk['x0']) & (a <= mk['x1']) & (((a - mk['x0']) % mk['step']) < mk['bar'])
            img[np.ix_(rows, cols)] = (240, 240, 235)
        elif mk['k'] == 'area':
            c = {'hatch': (240, 240, 235), 'stop': (240, 240, 235), 'symbol': (240, 240, 235), 'red': (170, 70, 60)}[mk['cls']]
            for i, s, e in mk['runs']:
                img[i, s:e] = c
    return img
