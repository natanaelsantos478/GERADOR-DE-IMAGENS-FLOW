"""Builds a test battle pack (relief only) for the Godot battle, from Terrarium z14 tiles.

The real pack builder lives in the web game (docs/BATALHA_GODOT.md, F2); this one only feeds F1.
Usage: python tools/godot/test_pack.py <out_dir> <lat> <lon> [name]
Writes battle.json and height.bin (float32 LE, row-major, row 0 = north edge, +X east, +Z south).
"""
import io, json, math, os, sys, urllib.request
import numpy as np
import osm_roads
from PIL import Image

SIZE_M, BORDER_M, N, Z = 10000.0, 500.0, 2049, 14
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def tile_xy(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n
    return x, y


def color(dst, lat0, lon0, span, m_lat, m_lon, n=4096, z=15):
    """Satellite photo (ESRI World Imagery z15, ~3 m) resampled to the local grid: macro colour of fields and woods."""
    url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    half = span / 2
    t = np.linspace(-half, half, n)
    X, Zs = np.meshgrid(t, t)
    lat, lon = lat0 - Zs / m_lat, lon0 + X / m_lon
    k = 2 ** z
    px = (lon + 180) / 360 * k * 256
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * k * 256
    x0, y0 = int(px.min()) // 256, int(py.min()) // 256
    x1, y1 = int(px.max()) // 256, int(py.max()) // 256
    mos = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256, 3), np.uint8)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            req = urllib.request.Request(url.format(z=z, x=tx, y=ty), headers={'User-Agent': 'meridiano-tools'})
            mos[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = np.asarray(
                Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB'))
    u = np.clip(px - x0 * 256, 0, mos.shape[1] - 1.001)
    v = np.clip(py - y0 * 256, 0, mos.shape[0] - 1.001)
    iu, iv = u.astype(int), v.astype(int)
    fu, fv = (u - iu)[..., None], (v - iv)[..., None]
    m = mos.astype(np.float32)
    img = (m[iv, iu] * (1 - fu) * (1 - fv) + m[iv, iu + 1] * fu * (1 - fv)
           + m[iv + 1, iu] * (1 - fu) * fv + m[iv + 1, iu + 1] * fu * fv)
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(dst, quality=88)


# Ground materials, same order as godot/scripts/world/ground_materials.gd
GRASS, GRASS_DIRT, FOREST, DIRT, ROCK, GRAVEL, SAND, ASPHALT = range(8)


def blur(a, r):
    """Box blur (separable, edge-clamped) used for local means and soft masks."""
    k = 2 * r + 1
    for ax in (0, 1):
        p = np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(a.ndim)], mode='edge')
        c = np.cumsum(p, axis=ax, dtype=np.float64)
        a = ((np.take(c, range(k, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - k), axis=ax)) / k).astype(np.float32)
    return a


# Land cover read from the satellite colour (vegetation type, paved, water...). landcover.png: R class, G confidence.
LC_NAMES = ['unknown', 'meadow', 'crop_green', 'crop_dry', 'bare_soil', 'broadleaf', 'conifer', 'built_up', 'roof', 'water', 'rock', 'road']
UNKNOWN, MEADOW, CROP_GREEN, CROP_DRY, BARE, BROADLEAF, CONIFER, BUILTUP, ROOF, WATER, ROCKY, ROAD = range(len(LC_NAMES))
# class -> (base material, overlay material, mean blend, blend noise amplitude)
MATERIAL_OF = {
    UNKNOWN: (GRASS_DIRT, DIRT, 0.3, 0.6), MEADOW: (GRASS, GRASS_DIRT, 0.2, 0.8), CROP_GREEN: (GRASS, DIRT, 0.25, 0.3),
    CROP_DRY: (SAND, DIRT, 0.2, 0.4), BARE: (DIRT, FOREST, 0.2, 0.4), BROADLEAF: (FOREST, DIRT, 0.2, 0.5),
    CONIFER: (FOREST, DIRT, 0.1, 0.3), BUILTUP: (GRASS_DIRT, GRAVEL, 0.2, 0.5), ROOF: (GRAVEL, ASPHALT, 0.4, 0.4), ROAD: (ASPHALT, GRAVEL, 0.25, 0.5),
    WATER: (SAND, GRAVEL, 0.3, 0.4), ROCKY: (ROCK, DIRT, 0.25, 0.5),
}


def landcover(sat, slope, tex):
    """Per-pixel class with a confidence 0..1. Each rule scores how far inside its colour range the pixel is;
    the best score wins only if it is clear (>= 0.35) and ahead of the runner-up, otherwise UNKNOWN.
    Thresholds measured on hand-checked boxes of the Esri z15 photo (Ardennes, summer): meadow v 0.26-0.35,
    forest v 0.17-0.23 with r < 0.16, dry crop g-r < 0, town saturation < 0.2 and fine texture > 0.05.
    Green crops cannot be told from meadow by colour: left for OSM land use (F2)."""
    f = np.stack([blur(sat[..., i], 1) for i in range(3)], -1)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    v = f.max(-1)
    s = (v - f.min(-1)) / np.maximum(v, 1e-3)
    gr = g - r
    exg = (2 * g - r - b) / np.maximum(r + g + b, 1e-3)
    ramp = lambda x, a, b_: np.clip((x - a) / (b_ - a), 0, 1)
    veg = ramp(exg, 0.12, 0.22) * ramp(gr, 0.02, 0.05)
    sc = np.zeros((len(LC_NAMES),) + v.shape, np.float32)
    sc[MEADOW] = veg * ramp(v, 0.235, 0.28)
    sc[CONIFER] = veg * (1 - ramp(v, 0.185, 0.215)) * (1 - ramp(r, 0.14, 0.18))
    sc[BROADLEAF] = veg * (1 - ramp(v, 0.23, 0.265)) * ramp(v, 0.185, 0.21) * (1 - ramp(r, 0.16, 0.2))
    sc[CROP_DRY] = ramp(-gr, -0.01, 0.02) * ramp(v, 0.31, 0.37) * (1 - ramp(tex, 0.035, 0.05)) * ramp(s, 0.15, 0.22)
    sc[BARE] = ramp(r - b, 0.04, 0.08) * ramp(-gr, -0.01, 0.02) * ramp(v, 0.16, 0.2) * (1 - ramp(v, 0.31, 0.37))
    # built-up only by its fine texture (roofs, streets, cars): grey field rims are not paved; roads come from OSM
    sc[BUILTUP] = ramp(tex, 0.04, 0.06) * (1 - 0.7 * veg) * (1 - ramp(s, 0.22, 0.32))
    sc[ROOF] = ramp(r - g, 0.04, 0.08) * ramp(s, 0.25, 0.35) * ramp(tex, 0.03, 0.05)
    sc[WATER] = ramp(b - g, 0.0, 0.03) * ramp(b - r, 0.03, 0.06) * (1 - ramp(v, 0.3, 0.36)) * ramp(s, 0.28, 0.38)  # dark grey roofs are not water
    sc[ROCKY] = ramp(slope, 30, 38)
    # soft majority over ~16 m so isolated pixels follow their neighbours
    sc = np.stack([blur(x, 1) for x in sc])
    order = np.sort(sc, axis=0)
    best, second = order[-1], order[-2]
    lc = sc.argmax(0).astype(np.uint8)
    conf = np.clip(best * (0.5 + 0.5 * ramp(best - second, 0.0, 0.25)), 0, 1)
    lc[best < 0.35] = UNKNOWN
    conf[lc == UNKNOWN] = 0
    return lc, conf


def materials(out, lc, road, bld, m=4096):
    """cover.png at the terrain resolution (m x m): base material, overlay material, blend.
    Inside a class: its own two materials with noise. At class borders the neighbour's material is blended in
    over ~6 m with a noisy edge, so borders are soft and irregular instead of 5 m pixel steps."""
    rng = np.random.default_rng(7)
    noise = blur(rng.random((m, m), np.float32), 8)
    noise = (noise - noise.min()) / (np.ptp(noise) + 1e-6)
    fine = blur(rng.random((m, m), np.float32), 2)
    fine = (fine - fine.min()) / (np.ptp(fine) + 1e-6)
    big = np.asarray(Image.fromarray(lc).resize((m, m), Image.NEAREST))
    mat_of = np.zeros(256, np.uint8)
    for c, (b0, _o, _k, _b) in MATERIAL_OF.items():
        mat_of[c] = b0
    base_mat = mat_of[big]
    ids = np.unique(base_mat)
    w = np.zeros((len(ids), m, m), np.float16)
    for i, k in enumerate(ids):
        w[i] = blur(blur((base_mat == k).astype(np.float32), 2), 2) + 0.35 * (fine - 0.5) * (base_mat == k)
    order = np.argsort(w, axis=0)
    i1, i2 = order[-1], order[-2]
    w1 = np.take_along_axis(w, i1[None], 0)[0].astype(np.float32)
    w2 = np.take_along_axis(w, i2[None], 0)[0].astype(np.float32)
    del w, order
    base = ids[i1]
    edge_over = ids[i2]
    edge = np.clip(w2 / np.maximum(w1 + w2, 1e-3), 0, 0.5)
    over = np.zeros((m, m), np.uint8)
    blend = np.zeros((m, m), np.float32)
    for c, (b0, o0, k, b1) in MATERIAL_OF.items():
        sel = big == c
        over[sel] = o0
        blend[sel] = np.clip(k + b1 * (noise[sel] - 0.5), 0, 1)
    at_edge = edge > 0.08
    over[at_edge] = edge_over[at_edge]
    blend[at_edge] = edge[at_edge] * 2 * 0.5 + 0.0
    base = base.astype(np.uint8)
    # OSM roads by surface, building footprints (3D houses arrive in F3)
    surf_mat = np.array([0, ASPHALT, GRAVEL, DIRT, GRASS_DIRT], np.uint8)
    on = road > 0
    over[on], blend[on] = base[on], 0.12
    base[on] = surf_mat[road[on]]
    on = bld > 0
    base[on], over[on], blend[on] = GRAVEL, ASPHALT, 0.5
    rgb = np.dstack([base, over, (blend * 255).astype(np.uint8)])
    Image.fromarray(rgb, 'RGB').save(os.path.join(out, 'cover.png'), optimize=True)


def cover(out, sat_file, H, span, road, bld, n=2048):
    """F1 only: ground class from the satellite colour + slope (F2 takes the classes from OSM land use).
    cover.png: R base material, G overlay material, B overlay blend 0..255. tint.png: colour map (<= 1, alpha = roughness)."""
    full = Image.open(sat_file).convert('RGB')
    fv = np.asarray(full, np.float32).mean(-1) / 255
    tex = np.sqrt(np.maximum(blur(fv * fv, 2) - blur(fv, 2) ** 2, 0))  # fine texture (~3 m): roofs, streets, cars
    tex = np.asarray(Image.fromarray(tex).resize((n, n), Image.BOX), np.float32)
    sat = np.asarray(full.resize((n, n), Image.BOX), np.float32) / 255
    h = np.asarray(Image.fromarray(H).resize((n, n), Image.BILINEAR), np.float32)
    gy, gx = np.gradient(h, span / (n - 1))
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    lc, conf = landcover(sat, slope, tex)
    k = road.shape[0] // n
    road_n = road.reshape(n, k, n, k).max(axis=(1, 3))
    bld_n = bld.reshape(n, k, n, k).max(axis=(1, 3))
    lc[road_n > 0], conf[road_n > 0] = ROAD, 1.0
    lc[bld_n > 0], conf[bld_n > 0] = ROOF, 1.0
    Image.fromarray(np.dstack([lc, (conf * 255).astype(np.uint8), np.zeros_like(lc)]), 'RGB').save(
        os.path.join(out, 'landcover.png'), optimize=True)
    materials(out, lc, road, bld)
    # colour map: satellite relative to its local mean, mild, never brighter than 1
    lum = sat.mean(-1, keepdims=True)
    rel = sat / np.maximum(blur(lum[..., 0], 40)[..., None], 0.02)
    tint = np.clip(0.93 * (1 + 0.35 * (rel - 1)), 0.6, 1.0)
    # alpha 128 = neutral roughness in Terrain3D's colour map
    rgba = np.dstack([(tint * 255).astype(np.uint8), np.full((n, n), 128, np.uint8)])
    Image.fromarray(rgba, 'RGBA').save(os.path.join(out, 'tint.png'), optimize=True)
    counts = np.bincount(lc.ravel(), minlength=len(LC_NAMES)) / lc.size
    print('landcover', {k: round(float(c), 3) for k, c in zip(LC_NAMES, counts)}, 'sure', round(float((conf > 0.6).mean()), 3))
    return lc, conf


def main(out, lat0, lon0, name):
    span = SIZE_M + 2 * BORDER_M
    half = span / 2
    m_lat = 111132.954 - 559.822 * math.cos(2 * math.radians(lat0))
    m_lon = 111412.84 * math.cos(math.radians(lat0))
    # local grid -> lat/lon -> fractional tile pixel
    t = np.linspace(-half, half, N)
    X, Zs = np.meshgrid(t, t)
    lat = lat0 - Zs / m_lat
    lon = lon0 + X / m_lon
    tx, ty = tile_xy(lat, lon)
    px, py = tx * 256 - 0.5, ty * 256 - 0.5
    x0, y0 = int(np.floor(px.min())) - 2, int(np.floor(py.min())) - 2
    x1, y1 = int(np.ceil(px.max())) + 3, int(np.ceil(py.max())) + 3
    mosaic = np.zeros((y1 - y0, x1 - x0), np.float32)
    for ty_ in range(y0 // 256, y1 // 256 + 1):
        for tx_ in range(x0 // 256, x1 // 256 + 1):
            req = urllib.request.Request(URL.format(z=Z, x=tx_, y=ty_), headers={'User-Agent': 'meridiano-tools'})
            a = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB'), np.float32)
            h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            sx, sy = tx_ * 256 - x0, ty_ * 256 - y0
            dx0, dy0 = max(sx, 0), max(sy, 0)
            dx1, dy1 = min(sx + 256, mosaic.shape[1]), min(sy + 256, mosaic.shape[0])
            if dx1 > dx0 and dy1 > dy0:
                mosaic[dy0:dy1, dx0:dx1] = h[dy0 - sy:dy1 - sy, dx0 - sx:dx1 - sx]
    # Terrarium has corrupt rows (e.g. two rows ~125 m too low at exactly 50°N, z14 tile 8452/5556):
    # replace pixels far from their 5x5 median.
    p = np.pad(mosaic, 2, mode='edge')
    med = np.median(np.stack([p[j:j + mosaic.shape[0], i:i + mosaic.shape[1]] for j in range(5) for i in range(5)]), axis=0)
    bad = np.abs(mosaic - med) > 25
    mosaic[bad] = med[bad]
    print('despiked', int(bad.sum()), 'px')
    # Catmull-Rom bicubic sampling
    u, v = px - x0, py - y0
    iu, iv = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - iu, v - iv

    def w(f):
        return [((-f + 2) * f - 1) * f / 2, ((3 * f - 5) * f * f + 2) / 2, ((-3 * f + 4) * f + 1) * f / 2, (f - 1) * f * f / 2]
    wu, wv = w(fu), w(fv)
    H = np.zeros_like(u, dtype=np.float32)
    for j in range(4):
        row = np.zeros_like(H)
        for i in range(4):
            row += wu[i] * mosaic[iv + j - 1, iu + i - 1]
        H += wv[j] * row
    os.makedirs(out, exist_ok=True)
    H.astype('<f4').tofile(os.path.join(out, 'height.bin'))
    # the raw satellite mosaic is only an intermediate: cached outside the pack
    sat = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.cache', 'godot', f'sat_{lat0:.4f}_{lon0:.4f}.jpg')
    if not os.path.exists(sat):
        os.makedirs(os.path.dirname(sat), exist_ok=True)
        color(sat, lat0, lon0, span, m_lat, m_lon)
    roads, buildings = osm_roads.build(out, sat, lat0, lon0, span, m_lat, m_lon, cache_dir=os.path.dirname(sat))
    road, bld = osm_roads.rasterize(roads, buildings, span)
    cover(out, sat, H, span, road, bld)
    meta = {
        'version': 1, 'name': name, 'lat': lat0, 'lon': lon0, 'sizeM': SIZE_M, 'borderM': BORDER_M,
        'height': {'file': 'height.bin', 'n': N, 'spanM': span, 'min': float(H.min()), 'max': float(H.max())},
        'time': {'hour': 15.5, 'dayOfYear': 250}, 'weather': {'cloud': 0.35, 'fog': 0.15},
        'cover': {'file': 'cover.png', 'n': 4096}, 'landcover': {'file': 'landcover.png', 'n': 2048}, 'tint': {'file': 'tint.png', 'n': 2048},
        'sources': ['Terrarium / Mapzen elevation on AWS Open Data (z14)', 'Esri World Imagery (z15)'],
    }
    with open(os.path.join(out, 'battle.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    print(name, 'height', round(float(H.min()), 1), '..', round(float(H.max()), 1), 'm')


if __name__ == '__main__':
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4] if len(sys.argv) > 4 else 'test')
