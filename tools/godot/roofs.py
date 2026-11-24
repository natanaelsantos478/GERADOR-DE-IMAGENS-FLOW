"""Roof analysis from the high-resolution photo (z18, ~0.4 m/px) inside each OSM footprint.

Material from the roof colour: white membrane, green roof, red tiles, dark slate, light metal, grey gravel/bitumen.
Shape from the light pattern: a pitched roof is split in two halves of different brightness along its ridge (sun on one
side); a barrel roof brightens smoothly towards one side; a sawtooth roof repeats bright/dark bands every 5-20 m; a flat
roof is even. An OSM roof:shape tag always wins.
"""
import math
import numpy as np
from PIL import Image, ImageDraw

MATERIALS = ['slate', 'tiles', 'metal', 'flat_grey', 'white', 'green']
SHAPES = {'gabled': 'gable', 'hipped': 'hip', 'half-hipped': 'hip', 'pyramidal': 'pyramid', 'flat': 'flat',
          'skillion': 'shed', 'lean_to': 'shed', 'gambrel': 'mansard', 'mansard': 'mansard', 'round': 'barrel',
          'dome': 'dome', 'onion': 'dome', 'saltbox': 'gable', 'butterfly': 'butterfly', 'sawtooth': 'sawtooth',
          'quadruple_saltbox': 'hip', 'cone': 'pyramid'}


def analyse(tiles, latlon):
    """latlon: [(lat, lon), ...]. Returns dict(material, shape, conf, color) or None if not enough pixels."""
    gp = [tiles.px(la, lo) for la, lo in latlon]
    xs = [p[0] for p in gp]
    ys = [p[1] for p in gp]
    x0, y0 = int(min(xs)) - 1, int(min(ys)) - 1
    w, h = int(max(xs)) - x0 + 2, int(max(ys)) - y0 + 2
    if w * h > 600 * 600 or w < 3 or h < 3:
        return None
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).polygon([(x - x0, y - y0) for x, y in gp], fill=1)
    mask = np.asarray(m, bool)
    # erode one pixel: walls, gutters and the shadow line at the footprint edge are not roof
    er = mask.copy()
    er[1:, :] &= mask[:-1, :]
    er[:-1, :] &= mask[1:, :]
    er[:, 1:] &= mask[:, :-1]
    er[:, :-1] &= mask[:, 1:]
    if er.sum() >= 12:
        mask = er
    yy, xx = np.nonzero(mask)
    if len(xx) < 8:
        return None
    c = tiles.sample(xx + x0 + 0.5, yy + y0 + 0.5)
    ok = ~np.isnan(c[:, 0])
    if ok.sum() < 8:
        return None
    c, xx, yy = c[ok], xx[ok].astype(np.float32), yy[ok].astype(np.float32)
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    v = c.max(1)
    s = (v - c.min(1)) / np.maximum(v, 1e-3)
    med = np.median(c, 0)
    vm, sm = float(np.median(v)), float(np.median(s))
    vstd = float(np.std(v))   # tree crowns over a roof are rough; real roofs are even
    # material
    rg = float(np.median(r - g))
    gr = float(np.median(g - r))
    if vm > 0.72 and sm < 0.14:
        mat, mc = 'white', min(1.0, (vm - 0.72) * 8 + 0.5)
    elif gr > 0.04 and sm > 0.2 and vstd < 0.06 and len(v) > 300:
        mat, mc = 'green', min(1.0, gr * 12)
    elif gr > 0.02:
        mat, mc = 'occluded', 0.0   # covered by trees: the photo cannot see this roof
    elif rg > 0.05 and sm > 0.22:
        mat, mc = 'tiles', min(1.0, rg * 8)
    elif vm < 0.34 and sm < 0.25:
        mat, mc = 'slate', min(1.0, (0.36 - vm) * 6 + 0.4)
    elif vm > 0.52 and sm < 0.14:
        mat, mc = 'metal', 0.6
    else:
        mat, mc = 'flat_grey', 0.5
    # shape: principal axis of the footprint pixels
    px = np.stack([xx - xx.mean(), yy - yy.mean()], 1)
    cov = px.T @ px / len(px)
    evals, evecs = np.linalg.eigh(cov)
    long_ax, short_ax = evecs[:, 1], evecs[:, 0]
    across = px @ short_ax          # distance from the ridge line
    along = px @ long_ax
    vv = v
    left, right = vv[across < -0.5], vv[across > 0.5]
    split = abs(float(left.mean() - right.mean())) / max(float(vv.mean()), 0.05) if len(left) > 3 and len(right) > 3 else 0.0
    # smooth curvature across the short side (barrel) vs a step (gable)
    curv = 0.0
    if len(across) > 30 and np.ptp(across) > 4:
        k = np.polyfit(across / max(np.ptp(across), 1e-3), vv, 2)
        curv = abs(float(k[0]))
    # periodic bands along the long side (sawtooth / corrugated sheds)
    period = 0.0
    if np.ptp(along) > 30:
        bins = np.linspace(along.min(), along.max(), int(np.ptp(along)) + 1)
        idx = np.clip(np.digitize(along, bins) - 1, 0, len(bins) - 1)
        prof = np.bincount(idx, vv, len(bins)) / np.maximum(np.bincount(idx, None, len(bins)), 1)
        prof = prof - prof.mean()
        f = np.abs(np.fft.rfft(prof))
        if len(f) > 4:
            k = int(np.argmax(f[2:]) + 2)
            strength = float(f[k] / (f[1:].mean() + 1e-6))
            if strength > 3.0:
                period = len(prof) / k
    return {'material': mat, 'mconf': round(mc, 2), 'split': round(split, 3), 'curv': round(curv, 3),
            'period_px': round(period, 1), 'vstd': round(vstd, 3), 'color': [round(float(x), 3) for x in med], 'n': int(len(v))}


def decide(an, tag_shape, area, rect, kind, m_per_px):
    """Roof shape and material from the analysis + OSM + size. Returns (shape, material, source)."""
    if tag_shape and tag_shape in SHAPES:
        shape, src = SHAPES[tag_shape], 'osm'
    else:
        shape, src = None, 'rule'
    mat = an['material'] if an and an['material'] != 'occluded' else None
    if shape is None and an and an['material'] != 'occluded':
        period_m = an['period_px'] * m_per_px
        if area > 600 and 5.0 <= period_m <= 20.0 and mat in ('metal', 'flat_grey', 'white'):
            shape, src = 'sawtooth', 'photo'
        elif area > 250 and an['curv'] > 0.12 and an['split'] < 0.12 and mat in ('metal', 'flat_grey'):
            shape, src = 'barrel', 'photo'
        elif mat in ('white', 'green'):
            shape, src = 'flat', 'photo'
        elif an['split'] > 0.12 and area < 600:
            shape, src = ('gable' if rect > 0.85 else 'hip'), 'photo'
        elif area >= 600 or mat == 'flat_grey':
            shape, src = 'flat', 'photo'
    if shape is None:
        shape = 'gable' if rect > 0.85 and area < 400 else ('hip' if area < 300 else 'flat')
    if mat is None:
        mat = 'slate' if shape in ('gable', 'hip', 'pyramid', 'mansard') else 'flat_grey'
    if shape in ('gable', 'hip', 'pyramid', 'mansard') and mat in ('white', 'green', 'flat_grey'):
        mat = 'slate'          # a pitched roof seen as grey in a shadow is still slate here
    return shape, mat, src
