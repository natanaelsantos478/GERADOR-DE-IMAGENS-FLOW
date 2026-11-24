"""Reads paved roads in the high-resolution photo (Esri z19, ~0.19 m/px at 50°N): paint lines, carriageway edges
and sidewalks, so the 3D road is drawn where the photo shows them.

Prototype of the reader that will run at load time in the game (also on phones): only cheap image filters that map
1:1 to a GPU compute shader, no neural network. Per road:
  1. a straightened strip of the photo along the OSM axis (rows = along, 0.25 m; columns = across, 0.2 m);
  2. robust profiles across the road in 30 m stretches (median along the stretch, so cars and shadows drop out);
  3. per stretch: carriageway edges, sidewalk width and colour on each side, paint lines (offset, solid/dashed);
  4. stretches merged into one road model (median, period kept constant), with a confidence.
The result is a few numbers per road, stored in the site parameters; the strip images are only for checking.
"""
import math
import numpy as np

ALONG = 0.25      # m per strip row
ACROSS = 0.2      # m per strip column
MARGIN = 6.0      # m read beyond the OSM carriageway on each side
STRETCH = 30.0    # m per robust stretch


def strip(tiles, pts, width, to_latlon):
    """pts: [(x, z)] local metres. Returns (rgb[H, W, 3], offsets[W], along[H])."""
    p = np.asarray(pts, np.float64)
    seg = np.diff(p, axis=0)
    L = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0], np.cumsum(L)])
    s = np.arange(0, cum[-1], ALONG)
    if len(s) < 8:
        return None, None, None
    x = np.interp(s, cum, p[:, 0])
    z = np.interp(s, cum, p[:, 1])
    # smoothed direction (over ~6 m) so the strip does not kink at OSM vertices
    k = max(1, int(3.0 / ALONG))
    dx = np.gradient(np.convolve(x, np.ones(2 * k + 1) / (2 * k + 1), mode='same'))
    dz = np.gradient(np.convolve(z, np.ones(2 * k + 1) / (2 * k + 1), mode='same'))
    dx[:k], dz[:k] = dx[k], dz[k]
    dx[-k:], dz[-k:] = dx[-k - 1], dz[-k - 1]
    n = np.hypot(dx, dz) + 1e-9
    nx, nz = -dz / n, dx / n                     # left normal
    half = width / 2 + MARGIN
    a = np.arange(-half, half + 1e-6, ACROSS)
    X = x[:, None] + nx[:, None] * a[None, :]
    Z = z[:, None] + nz[:, None] * a[None, :]
    lat, lon = to_latlon(X, Z)
    gx = (lon + 180) / 360 * tiles.n * 256
    gy = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * tiles.n * 256
    rgb = tiles.sample(gx, gy)
    return rgb, a, s


def strip_ll(sample, pts, width, to_latlon, res=0.1, margin=MARGIN):
    """Like strip(), for a lat/lon sampler (ortho.Ortho.sample) at res metres per pixel in both directions."""
    p = np.asarray(pts, np.float64)
    seg = np.diff(p, axis=0)
    cum = np.concatenate([[0], np.cumsum(np.hypot(seg[:, 0], seg[:, 1]))])
    s = np.arange(0, cum[-1], res)
    if len(s) < 8:
        return None, None, None
    x = np.interp(s, cum, p[:, 0])
    z = np.interp(s, cum, p[:, 1])
    k = max(1, int(3.0 / res))
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    xs = np.convolve(np.pad(x, k, mode='edge'), ker, mode='valid')
    zs = np.convolve(np.pad(z, k, mode='edge'), ker, mode='valid')
    dx, dz = np.gradient(xs), np.gradient(zs)
    n = np.hypot(dx, dz) + 1e-9
    nx, nz = -dz / n, dx / n
    half = width / 2 + margin
    a = np.arange(-half, half + 1e-6, res)
    X = x[:, None] + nx[:, None] * a[None, :]
    Z = z[:, None] + nz[:, None] * a[None, :]
    lat, lon = to_latlon(X, Z)
    return sample(lat, lon), a, s


def _minmax(img, k, fn):
    """Separable min/max filter with a k x k square (k odd), edges clamped."""
    from numpy.lib.stride_tricks import sliding_window_view as sw
    r = k // 2
    out = fn(sw(np.pad(img, ((0, 0), (r, r)), mode='edge'), k, axis=1), axis=-1)
    return fn(sw(np.pad(out, ((r, r), (0, 0)), mode='edge'), k, axis=0), axis=-1)


def _box(img, k):
    from numpy.lib.stride_tricks import sliding_window_view as sw
    r = k // 2
    out = sw(np.pad(img, ((0, 0), (r, r)), mode='edge'), k, axis=1).mean(-1)
    return sw(np.pad(out, ((r, r), (0, 0)), mode='edge'), k, axis=0).mean(-1)


PAINT_NONE, PAINT_WHITE, PAINT_RED, PAINT_YELLOW = 0, 1, 2, 3


def carriageway(rgb, a, width, res=0.1):
    """Carriageway edges in a sharp strip: the asphalt band around the axis, bounded by the strongest brightness
    steps (kerbs) near the OSM edges. Returns (left offset, right offset)."""
    lum = np.nanmean(rgb, -1)
    prof = np.nanmedian(lum, 0)
    prof = np.convolve(np.pad(prof, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    g = np.abs(np.gradient(prof))
    col = lambda o: int(np.clip(round((o - a[0]) / res), 0, len(a) - 1))
    out = []
    for sign in (1, -1):
        lo, hi = sorted((col(sign * max(width / 2 - 2.0, 1.0)), col(sign * (width / 2 + 3.0))))
        seg = g[lo:hi + 1]
        out.append(float(a[lo + int(np.argmax(seg))]) if len(seg) and seg.max() > 0.01 else sign * width / 2)
    return out[0], out[1]


def paint_mask(rgb, a, width, res=0.1):
    """Road paint copied from the photo at its real size: white (lines, arrows, zebras, hatching, bays),
    red surfaces (cycle lanes, red asphalt), yellow paint. Cars and roofs drop out: a white top-hat with a 1.2 m
    square only keeps bright marks narrower than 1.2 m, and red/yellow must be flat (low texture) areas.
    Returns uint8 mask (same rows/cols as the strip)."""
    ok = ~np.isnan(rgb[..., 0])
    rgb = np.where(ok[..., None], rgb, 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    k = int(round(1.2 / res)) | 1
    opening = _minmax(_minmax(lum, k, np.min), k, np.max)
    tophat = lum - opening
    # only the carriageway (kerb lines, sidewalk joints and parked cars outside it are not road paint)
    el, er = carriageway(rgb, a, width, res)
    inside = ((a >= er + 0.15) & (a <= el - 0.15))[None, :]
    road = np.median(lum[:, (a > er + 0.5) & (a < el - 0.5)]) if (el - er) > 1.5 else np.median(lum)
    # paint: near-white, clearly above the local asphalt, narrower than 1.2 m (top-hat), and flat (no car glare)
    paint = (tophat > 0.1) & (lum > road + 0.16) & (sat < 0.3) & inside & ok
    paint &= _box(paint.astype(np.float32), 3) > 0.45        # drop isolated speckles
    redness = r - np.maximum(g, b)
    # colour of the paint itself: red/white bands blur to pink (redness 0.06-0.1 at 10 cm), yellow lines
    red_paint = paint & (redness > 0.055)
    yellow = paint & (r > 0.45) & (g > 0.38) & (b < 0.65 * g) & ~red_paint
    white = paint & (sat < 0.16) & ~red_paint & ~yellow
    tex = np.sqrt(np.maximum(_box(lum * lum, 5) - _box(lum, 5) ** 2, 0))
    red = (redness > 0.035) & (sat > 0.1) & (sat < 0.45) & (tex < 0.05) & inside & ok
    # red surfaces run along the road for many metres (cycle lanes, red asphalt); a red car is 4-5 m
    red = _box(red.astype(np.float32), 5) > 0.6
    from numpy.lib.stride_tricks import sliding_window_view as sw
    L = int(8.0 / res) | 1
    run = sw(np.pad(red.astype(np.float32), ((L // 2, L // 2), (0, 0)), mode='edge'), L, axis=0).mean(-1)
    red = (red & (run > 0.75)) | red_paint
    m = np.zeros(lum.shape, np.uint8)
    m[red] = PAINT_RED
    m[white] = PAINT_WHITE
    m[yellow] = PAINT_YELLOW
    return m


def paint_preview(rgb, m):
    """Left: photo. Right: what the game draws from the mask alone (grey asphalt + paint)."""
    photo = (np.nan_to_num(rgb).clip(0, 1) * 255).astype(np.uint8)
    game = np.full(photo.shape, (70, 70, 72), np.uint8)
    game[m == PAINT_WHITE] = (235, 235, 230)
    game[m == PAINT_RED] = (160, 60, 50)
    game[m == PAINT_YELLOW] = (230, 190, 40)
    return photo, game


def _runs(b):
    """Lengths of consecutive True / False runs of a boolean array."""
    if len(b) == 0:
        return [], []
    d = np.flatnonzero(np.diff(b.astype(np.int8))) + 1
    edges = np.concatenate([[0], d, [len(b)]])
    lens = np.diff(edges)
    vals = b[edges[:-1]]
    return lens[vals], lens[~vals]


def analyse(rgb, a, width):
    """Reads one strip. Returns the road model dict (offsets in metres, + = left of the OSM direction)."""
    ok = ~np.isnan(rgb[..., 0])
    if ok.mean() < 0.6:
        return None
    rgb = np.where(ok[..., None], rgb, np.nanmedian(rgb, axis=(0, 1)))
    lum = rgb.mean(-1)
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    green = rgb[..., 1] - rgb[..., 0]
    H, W = lum.shape
    # --- paint: thin bright low-saturation lines (white top-hat across, 0.6 m wide opening) ---
    r = max(1, int(0.3 / ACROSS))
    pad = np.pad(lum, ((0, 0), (r, r)), mode='edge')
    opened = np.min(np.stack([pad[:, i:i + W] for i in range(2 * r + 1)]), 0)
    tophat = lum - opened
    # threshold adapted to each road: paint stands ~0.06-0.15 above worn asphalt in the z19 photo
    core = tophat[:, W // 2 - int(2 / ACROSS):W // 2 + int(2 / ACROSS)]
    med = float(np.median(core))
    mad = float(np.median(np.abs(core - med))) + 1e-4
    thr = max(0.045, med + 4.0 * mad)
    paint = (tophat > thr) & (sat < 0.28) & (lum > 0.3)
    # --- per stretch robust profiles ---
    rows = max(8, int(STRETCH / ALONG))
    models = []
    for s0 in range(0, H, rows):
        sl = slice(s0, min(H, s0 + rows))
        if sl.stop - sl.start < rows // 3:
            continue
        lp = np.median(lum[sl], 0)
        sp = np.median(sat[sl], 0)
        gp = np.median(green[sl], 0)
        pp = paint[sl].mean(0)
        models.append(_stretch(lp, sp, gp, pp, paint[sl], a, width))
    models = [m for m in models if m]
    if not models:
        return None
    return _merge(models, width)


def _stretch(lp, sp, gp, pp, paint, a, width):
    c = len(a) // 2
    col = lambda o: int(np.clip(round((o - a[0]) / ACROSS), 0, len(a) - 1))
    # asphalt: dark, grey, not green
    road_lum = np.median(lp[max(0, c - 5):c + 6])
    asphalt = (np.abs(lp - road_lum) < 0.07) & (sp < 0.3) & (gp < 0.04)
    asphalt |= pp > 0.05                     # paint lies on the road
    if not asphalt[c]:
        return None
    # carriageway edge = the strongest brightness step (kerb, verge) in a band around the OSM edge,
    # not the end of grey: parking bays and sidewalks are grey too
    g = np.abs(np.gradient(np.convolve(lp, np.ones(3) / 3, mode='same')))
    def edge(sign):
        lo, hi = sorted((col(sign * max(width / 2 - 2.0, 1.0)), col(sign * (width / 2 + 3.0))))
        seg = g[lo:hi + 1]
        if len(seg) == 0 or seg.max() < 0.015:
            return sign * width / 2, False
        return float(a[lo + int(np.argmax(seg))]), True
    edge_l, ok_l = edge(1)
    edge_r, ok_r = edge(-1)
    left, right = col(edge_l), col(edge_r)
    # sidewalk: a lighter, grey, not green band right after the carriageway edge, 1-5 m wide
    side = {}
    for name, i0, step in (('left', left + 1, 1), ('right', right - 1, -1)):
        j = i0
        band = []
        while 0 <= j < len(a) and abs(a[j] - a[i0]) < 5.0:
            pav = (lp[j] > road_lum + 0.05) and (sp[j] < 0.25) and (gp[j] < 0.03)
            if not pav:
                break
            band.append(j)
            j += step
        w = len(band) * ACROSS
        if w >= 1.0:
            side[name] = {'w': round(w, 2), 'lum': round(float(np.mean(lp[band])), 3)}
    # paint lines: columns where paint occurs, inside the carriageway
    lines = []
    cols = np.flatnonzero(pp > 0.08)
    groups = np.split(cols, np.flatnonzero(np.diff(cols) > 1) + 1) if len(cols) else []
    for grp in groups:
        if len(grp) * ACROSS > 1.0:          # 10-30 cm paint blurs to <= ~0.8 m in the photo; wider = car, patch
            continue
        peak = grp[int(np.argmax(pp[grp]))]
        grp = grp[np.abs(grp - peak) <= 1]
        off = float(a[peak])
        if not (edge_r - 0.3 <= off <= edge_l + 0.3):
            continue
        along = paint[:, grp].any(1)
        # close gaps shorter than 0.5 m (worn paint, compression)
        on_idx = np.flatnonzero(along)
        if len(on_idx) > 1:
            for i0, i1 in zip(on_idx[:-1], on_idx[1:]):
                if 1 < i1 - i0 <= int(0.5 / ALONG) + 1:
                    along[i0:i1] = True
        on, off_runs = _runs(along)
        ratio = along.mean()
        dash_m = float(np.median(on) * ALONG) if len(on) else 0.0
        if ratio > 0.75:
            kind = 'solid'
        elif ratio > 0.15 and len(on) >= 2 and 1.0 <= dash_m <= 6.5:
            kind = 'dashed'                  # Belgian dashes: 1-6 m (3 m on 50 km/h roads)
        else:
            continue
        period = float((np.median(on) + np.median(off_runs)) * ALONG) if len(on) and len(off_runs) else 0.0
        dash = float(np.median(on) * ALONG) if len(on) else 0.0
        lines.append({'o': round(off, 2), 'k': kind, 'p': round(period, 1), 'd': round(dash, 1), 'r': round(float(ratio), 2)})
    return {'edge_l': edge_l, 'edge_r': edge_r, 'side': side, 'lines': lines, 'road_lum': road_lum}


def _merge(models, width):
    """Stretches -> one road model: medians, line types by vote, positions clustered across stretches."""
    el = float(np.median([m['edge_l'] for m in models]))
    er = float(np.median([m['edge_r'] for m in models]))
    out = {'w': round(el - er, 2), 'axis': round((el + er) / 2, 2), 'stretches': len(models), 'side': {}, 'lines': []}
    for name in ('left', 'right'):
        ws = [m['side'][name]['w'] for m in models if name in m['side']]
        if len(ws) >= max(1, len(models) // 2):
            out['side'][name] = {'w': round(float(np.median(ws)), 2),
                                 'lum': round(float(np.median([m['side'][name]['lum'] for m in models if name in m['side']])), 3)}
    allines = [l for m in models for l in m['lines']]
    allines.sort(key=lambda l: l['o'])
    clusters = []
    for l in allines:
        if clusters and abs(clusters[-1][-1]['o'] - l['o']) < 0.5:
            clusters[-1].append(l)
        else:
            clusters.append([l])
    for c in clusters:
        if len(c) < max(2, int(np.ceil(len(models) * 0.5))):
            continue   # seen in less than half the stretches: a car, a patch, a shadow edge
        kinds = [l['k'] for l in c]
        kind = max(set(kinds), key=kinds.count)
        same = [l for l in c if l['k'] == kind]
        out['lines'].append({'o': round(float(np.median([l['o'] for l in c])), 2), 'k': kind,
                             'p': round(float(np.median([l['p'] for l in same])), 1),
                             'd': round(float(np.median([l['d'] for l in same])), 1),
                             'seen': round(len(c) / len(models), 2)})
    out['conf'] = round(min(1.0, len(models) / 3) * (0.5 + 0.5 * (abs(out['w'] - width) < 3)), 2)
    return out


def overlay(rgb, a, s, model, width):
    """Strip with the model drawn on top: red = carriageway edges, yellow = paint lines, cyan = sidewalk outer edge,
    magenta = OSM axis/width. Rows are along the road. Returns uint8 image (W x H rotated so the road runs left-right)."""
    img = (np.nan_to_num(rgb, nan=0.0).clip(0, 1) * 255).astype(np.uint8).copy()
    col = lambda o: int(round((o - a[0]) / ACROSS))
    def vline(o, c, dash=None):
        j = col(o)
        if 0 <= j < img.shape[1]:
            for i in range(img.shape[0]):
                if dash is None or (i * ALONG) % dash[0] < dash[1]:
                    img[i, max(0, j - 1):j + 1] = c
    for o in (width / 2, -width / 2):
        vline(o, (255, 0, 255), dash=(2.0, 0.5))
    if model:
        vline(model['axis'] + model['w'] / 2, (255, 40, 40))
        vline(model['axis'] - model['w'] / 2, (255, 40, 40))
        for name, sign in (('left', 1), ('right', -1)):
            if name in model['side']:
                edge = model['axis'] + sign * (model['w'] / 2 + model['side'][name]['w'])
                vline(edge, (0, 230, 255))
        for l in model['lines']:
            vline(l['o'], (255, 230, 0), dash=None if l['k'] == 'solid' else (max(l['p'], 1.0), max(l['d'], 0.3)))
    return np.ascontiguousarray(np.rot90(img))
