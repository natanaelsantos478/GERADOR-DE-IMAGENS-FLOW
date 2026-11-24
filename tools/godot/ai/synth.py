"""Synthetic training strips for the road-marking network, with exact per-pixel labels.

A strip is a straightened piece of road seen from above at 10 cm/px: rows along the road, columns across it,
like road_reader.strip_ll() produces from the real photo. Markings follow Belgian / Vienna-convention sizes
(lines 10-20 cm, dashes 3/9 m, 1/1 m, 5/1.5 m, zebra bars 50 cm, stop lines 30-50 cm, give-way teeth,
arrows ~5 m, hatching, red cycle lanes), drawn at 5 cm and reduced to 10 cm, then worn, shaded, covered by cars
and blurred like the aerial camera. Real asphalt, sidewalk and verge textures are cut from real ortho strips when
given (backgrounds), otherwise made procedurally.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RES = 0.1
CLASSES = ['other', 'road', 'solid', 'dashed', 'zebra', 'stopline', 'symbol', 'hatch', 'red', 'sidewalk']
OTHER, ROAD, SOLID, DASHED, ZEBRA, STOP, SYMBOL, HATCH, RED, SIDEWALK = range(len(CLASSES))
DASHES = [(3.0, 9.0), (1.0, 1.0), (5.0, 1.5), (3.0, 3.0), (2.0, 2.0), (1.5, 4.5)]


class Canvas:
    """Paint layer at 5 cm (2x) with a label layer; coordinates in metres (x across, y along)."""
    def __init__(self, H, W):
        self.k = 2
        self.H, self.W = H, W
        self.img = Image.new('L', (W * 2, H * 2), 0)       # paint coverage 0..255
        self.lab = Image.new('L', (W * 2, H * 2), 0)
        self.col = Image.new('RGB', (W * 2, H * 2), (0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
        self.dl = ImageDraw.Draw(self.lab)
        self.dc = ImageDraw.Draw(self.col)
        self.cx = W / 2

    def px(self, x, y):
        return ((self.cx + x / RES) * self.k, (y / RES) * self.k)

    def poly(self, pts, cls, colour=(240, 240, 235)):
        p = [self.px(x, y) for x, y in pts]
        self.d.polygon(p, fill=255)
        self.dl.polygon(p, fill=cls)
        self.dc.polygon(p, fill=colour)

    def rect(self, x0, x1, y0, y1, cls, colour=(240, 240, 235)):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], cls, colour)


def _noise(rng, H, W, scale, octaves=3):
    out = np.zeros((H, W), np.float32)
    amp = 1.0
    for o in range(octaves):
        s = max(1, int(scale / (2 ** o)))
        small = rng.random((H // s + 2, W // s + 2)).astype(np.float32)
        big = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((W + 2 * s, H + 2 * s), Image.BICUBIC), np.float32) / 255
        out += amp * big[s:s + H, s:s + W]
        amp *= 0.5
    return (out - out.min()) / (np.ptp(out) + 1e-6)


def _surface(rng, H, W, base, var, grain):
    n = _noise(rng, H, W, rng.integers(20, 80)) - 0.5
    g = rng.random((H, W)).astype(np.float32) - 0.5
    rgb = np.asarray(base, np.float32)[None, None, :] * (1 + var * n[..., None]) + grain * g[..., None]
    return rgb


def make(rng, H=256, W=160, backgrounds=None):
    """Returns (rgb float32 HxWx3 0..1, label uint8 HxW)."""
    road_w = float(rng.uniform(4.5, 13.0))
    axis = float(rng.normal(0, 0.8))                       # OSM axis error across
    slope = float(rng.normal(0, 0.03))                     # small heading error (m per m)
    lab = np.full((H, W), OTHER, np.uint8)
    a = (np.arange(W) - W / 2) * RES
    y = np.arange(H) * RES
    centre = axis + slope * (y - y.mean())
    rel = a[None, :] - centre[:, None]
    on_road = np.abs(rel) <= road_w / 2
    # --- surfaces -------------------------------------------------------------------------------------
    grey = rng.uniform(0.3, 0.62)
    asphalt = _surface(rng, H, W, (grey, grey * rng.uniform(0.98, 1.03), grey * rng.uniform(0.98, 1.06)), 0.18, 0.06)
    if backgrounds is not None and len(backgrounds) and rng.random() < 0.7:
        bg = backgrounds[rng.integers(len(backgrounds))]
        i0, j0 = rng.integers(0, bg.shape[0] - H + 1), rng.integers(0, bg.shape[1] - W + 1)
        outside = bg[i0:i0 + H, j0:j0 + W].copy()
    else:
        outside = _surface(rng, H, W, rng.choice([(0.3, 0.42, 0.22), (0.55, 0.5, 0.45), (0.4, 0.4, 0.42), (0.25, 0.3, 0.2)]), 0.4, 0.08)
    rgb = np.where(on_road[..., None], asphalt, outside)
    lab[on_road] = ROAD
    # sidewalks with a kerb line and paving joints
    for side in (1, -1):
        if rng.random() < 0.65:
            sw = rng.uniform(1.2, 4.0)
            m = (side * rel > road_w / 2) & (side * rel <= road_w / 2 + sw)
            pv = rng.uniform(0.5, 0.75)
            tile = rng.uniform(0.2, 0.6)
            joints = ((np.mod(rel, tile) < 0.02) | (np.mod(y[:, None] + 0 * rel, tile) < 0.02))
            s_rgb = _surface(rng, H, W, (pv, pv * rng.uniform(0.95, 1.0), pv * rng.uniform(0.9, 1.0)), 0.12, 0.04)
            s_rgb = np.where(joints[..., None], s_rgb * 0.85, s_rgb)
            kerb = m & (side * rel <= road_w / 2 + 0.15)
            s_rgb = np.where(kerb[..., None], s_rgb * 1.12, s_rgb)
            rgb = np.where(m[..., None], s_rgb, rgb)
            lab[m] = SIDEWALK
    # --- markings (drawn in road coordinates; straight here, the heading error is applied by rows) ---------
    cv = Canvas(H, W)
    L = H * RES
    half = road_w / 2
    lw = rng.choice([0.1, 0.12, 0.15, 0.2])
    two_way = road_w < 9 or rng.random() < 0.5
    if road_w >= 5.5 and rng.random() < 0.85:
        kind = rng.choice(['dashed', 'solid', 'double', 'dashed', 'red_white'])
        if kind == 'solid':
            cv.rect(-lw / 2, lw / 2, 0, L, SOLID)
        elif kind == 'double':
            cv.rect(-lw * 1.5 - 0.05, -lw * 0.5 - 0.05, 0, L, SOLID)
            cv.rect(lw * 0.5 + 0.05, lw * 1.5 + 0.05, 0, L, SOLID)
        elif kind == 'red_white':
            seg = rng.uniform(0.5, 1.0)
            yy = 0.0
            while yy < L:
                red = int(yy / seg) % 2 == 0
                cv.rect(-0.3, 0.3, yy, yy + seg, RED, (200, 70, 70) if red else (240, 240, 235))
                yy += seg
        else:
            dash, gap = DASHES[rng.integers(len(DASHES))]
            yy = -rng.uniform(0, dash + gap)
            while yy < L:
                cv.rect(-lw / 2, lw / 2, yy, yy + dash, DASHED)
                yy += dash + gap
    if rng.random() < 0.5:                                  # edge lines
        dashed_edge = rng.random() < 0.4
        for s in (1, -1):
            x = s * (half - rng.uniform(0.2, 0.5))
            if dashed_edge:
                yy = -rng.uniform(0, 4)
                while yy < L:
                    cv.rect(x - lw / 2, x + lw / 2, yy, yy + 1.0, DASHED)
                    yy += 2.0
            else:
                cv.rect(x - lw / 2, x + lw / 2, 0, L, SOLID)
    if rng.random() < 0.35:                                 # zebra crossing: 50 cm bars every metre
        y0 = rng.uniform(2, L - 6)
        depth = rng.uniform(3.0, 5.0)
        x = -half + rng.uniform(0.2, 0.6)
        while x + 0.5 < half - 0.2:
            cv.rect(x, x + 0.5, y0, y0 + depth, ZEBRA)
            x += rng.choice([1.0, 1.0, 0.9, 1.1])
    if rng.random() < 0.3:                                  # stop line or give-way teeth on one lane
        y0 = rng.uniform(1, L - 3)
        side = rng.choice([1, -1]) if two_way else 0
        x0, x1 = (0, half - 0.3) if side == 1 else ((-half + 0.3, 0) if side == -1 else (-half + 0.3, half - 0.3))
        if rng.random() < 0.5:
            cv.rect(min(x0, x1), max(x0, x1), y0, y0 + rng.uniform(0.3, 0.5), STOP)
        else:
            x = min(x0, x1)
            while x + 0.5 < max(x0, x1):
                cv.poly([(x, y0), (x + 0.5, y0), (x + 0.25, y0 + 0.6)], STOP)
                x += 0.75
    if rng.random() < 0.3:                                  # arrows (straight / turn) in a lane
        y0 = rng.uniform(1, L - 6)
        xc = rng.uniform(-half + 1.2, half - 1.2)
        sh = 0.15
        pts = [(xc - sh, y0), (xc + sh, y0), (xc + sh, y0 + 3.5), (xc + 0.5, y0 + 3.5), (xc, y0 + 5.0), (xc - 0.5, y0 + 3.5), (xc - sh, y0 + 3.5)]
        if rng.random() < 0.5:                              # bend to one side
            t = rng.choice([1, -1])
            pts = [(xc - sh, y0), (xc + sh, y0), (xc + sh, y0 + 2.6), (xc + t * 0.9, y0 + 2.6 + 0.2), (xc + t * 0.9, y0 + 2.0),
                   (xc + t * 1.6, y0 + 3.2), (xc + t * 0.9, y0 + 4.4), (xc + t * 0.9, y0 + 3.6), (xc - sh, y0 + 3.4)]
        cv.poly(pts, SYMBOL)
    if rng.random() < 0.2 and road_w > 7:                   # hatched area between two solid lines
        y0 = rng.uniform(0, L - 10)
        y1 = y0 + rng.uniform(6, 15)
        xa, xb = -rng.uniform(0.6, 1.5), rng.uniform(0.6, 1.5)
        cv.rect(xa - 0.1, xa, y0, y1, SOLID)
        cv.rect(xb, xb + 0.1, y0, y1, SOLID)
        yy = y0
        while yy < y1:
            cv.poly([(xa, yy), (xa, yy + 0.4), (xb, yy + 0.4 + (xb - xa)), (xb, yy + (xb - xa))], HATCH)
            yy += 1.5
    if rng.random() < 0.15:                                 # chevron band (motorway gore, island approach)
        s = rng.choice([1, -1])
        x0, x1 = sorted((s * (half - rng.uniform(1.5, 3.0)), s * (half - 0.3)))
        yy = rng.uniform(-2, 0)
        while yy < L:
            for xa, xb in ((x0, (x0 + x1) / 2), ((x0 + x1) / 2, x1)):
                up = xa == x0
                cv.poly([(xa, yy + (0 if up else 1.0)), (xb, yy + (1.0 if up else 0)), (xb, yy + (1.0 if up else 0) + 0.5),
                         (xa, yy + (0 if up else 1.0) + 0.5)], HATCH)
            yy += rng.uniform(1.5, 2.5)
    if rng.random() < 0.15 and road_w > 7:                  # wide dashed line (motorway lane / slip road), 0.3-0.5 m
        x = rng.uniform(-half + 1.5, half - 1.5)
        ww = rng.uniform(0.3, 0.5)
        dash, gap = rng.choice([(3.0, 3.0), (5.0, 1.5), (1.0, 1.0)])
        yy = -rng.uniform(0, dash + gap)
        while yy < L:
            cv.rect(x - ww / 2, x + ww / 2, yy, yy + dash, DASHED)
            yy += dash + gap
    if rng.random() < 0.15:                                 # big arrow (motorway, 7.5 m)
        y0 = rng.uniform(0, L - 8)
        xc = rng.uniform(-half + 1.5, half - 1.5)
        cv.poly([(xc - 0.25, y0), (xc + 0.25, y0), (xc + 0.25, y0 + 5.0), (xc + 0.8, y0 + 5.0), (xc, y0 + 7.5),
                 (xc - 0.8, y0 + 5.0), (xc - 0.25, y0 + 5.0)], SYMBOL)
    if rng.random() < 0.15:                                 # red cycle lane along one edge
        s = rng.choice([1, -1])
        cw = rng.uniform(1.2, 1.8)
        x0 = s * (half - cw)
        cv.rect(min(x0, s * half), max(x0, s * half), 0, L, RED, (175, 75, 65))
    # reduce 5 cm -> 10 cm, then shift rows by the heading error so marks follow the drawn road
    cover = np.array(cv.img.resize((W, H), Image.BOX), np.float32) / 255
    plab = np.array(cv.lab.resize((W, H), Image.NEAREST), np.uint8)
    pcol = np.asarray(cv.col.resize((W, H), Image.BOX), np.float32) / 255 / np.maximum(cover[..., None], 1e-3)
    shift = np.round((centre - 0.0) / RES).astype(int)
    for i in range(H):
        cover[i] = np.roll(cover[i], shift[i])
        plab[i] = np.roll(plab[i], shift[i])
        pcol[i] = np.roll(pcol[i], shift[i], axis=0)
    # wear: patchy paint loss
    wear = _noise(rng, H, W, rng.integers(5, 30))
    cover *= np.clip((wear - rng.uniform(0.0, 0.35)) * 3, 0.25, 1.0)
    cover *= on_road
    paint_rgb = np.clip(pcol, 0, 1) * rng.uniform(0.8, 1.0)
    rgb = rgb * (1 - cover[..., None]) + paint_rgb * cover[..., None]
    # the label keeps the WHOLE marking, also where the paint is worn away: the network learns to complete it
    painted = (plab > 0) & on_road
    lab[painted] = plab[painted]
    # tree canopies over the road (leafy, textured): what is under them stays in the label
    for _ in range(rng.integers(0, 3) if rng.random() < 0.45 else 0):
        cxt = rng.uniform(-half - 2, half + 2)
        cyt = rng.uniform(0, L)
        rad = rng.uniform(2.0, 5.0)
        blob = ((a[None, :] - cxt) ** 2 + (y[:, None] - cyt) ** 2) < rad ** 2 * (0.7 + 0.6 * _noise(rng, H, W, 12))
        leaf = _surface(rng, H, W, (rng.uniform(0.12, 0.25), rng.uniform(0.2, 0.35), rng.uniform(0.08, 0.18)), 0.5, 0.12)
        rgb = np.where(blob[..., None], leaf, rgb)
    # missing photo data (seams between ortho cells, clouds): flat patches
    if rng.random() < 0.1:
        i0 = rng.integers(0, H - 20)
        rgb[i0:i0 + rng.integers(10, 60)] = rng.choice([0.0, 0.5, 1.0])
    # cars (occluders): label stays what is under them (the network learns continuity)
    for _ in range(rng.integers(0, 4)):
        cx = centre[0] + rng.uniform(-half + 1, half - 1)
        cy = rng.uniform(0, L)
        cl, cwid = rng.uniform(3.8, 5.0), rng.uniform(1.7, 2.0)
        colr = rng.choice([(0.9, 0.9, 0.92), (0.1, 0.1, 0.12), (0.6, 0.6, 0.62), (0.6, 0.1, 0.1), (0.15, 0.25, 0.5)])
        car = (np.abs(a[None, :] - cx) < cwid / 2) & (np.abs(y[:, None] - cy) < cl / 2)
        win = car & (np.abs(y[:, None] - cy) < cl * 0.25) & (np.abs(a[None, :] - cx) < cwid * 0.38)
        rgb = np.where(car[..., None], np.asarray(colr, np.float32), rgb)
        rgb = np.where(win[..., None], rgb * 0.35, rgb)
    # shadows (trees, buildings): soft dark blobs
    if rng.random() < 0.6:
        sh = _noise(rng, H, W, rng.integers(30, 90)) > rng.uniform(0.55, 0.75)
        sh = np.asarray(Image.fromarray((sh * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), np.float32) / 255
        rgb = rgb * (1 - sh[..., None] * rng.uniform(0.35, 0.65))
    # camera: colour cast, contrast, blur, noise, jpeg-like quantisation
    rgb = rgb * rng.uniform(0.85, 1.15, 3)[None, None, :] * rng.uniform(0.8, 1.2) + rng.uniform(-0.05, 0.05)
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.1)))
    out = np.asarray(img, np.float32) / 255 + rng.normal(0, 0.015, (H, W, 3)).astype(np.float32)
    return np.clip(out, 0, 1), lab


PALETTE = np.array([[40, 40, 40], [90, 90, 95], [255, 255, 255], [255, 230, 0], [0, 200, 255], [255, 120, 0],
                    [200, 0, 255], [0, 255, 120], [230, 40, 40], [170, 150, 120]], np.uint8)


def colour(lab):
    return PALETTE[lab]
