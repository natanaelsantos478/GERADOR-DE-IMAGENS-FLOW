"""Cuts real straightened road strips (10 cm) from the sharpest ortho of the test pack, in 256-row chunks.

  python real_strips.py <pack dir> <cache dir> <out dir> [radius m]
Every 5th road goes to <out>/test (never used in training), the rest to <out>/bg (training surroundings).
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ortho, road_reader as rr

CLASSES = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'trunk',
           'primary_link', 'secondary_link', 'tertiary_link'}


def main(pack, cache, out, radius=1500.0):
    meta = json.load(open(os.path.join(pack, 'battle.json'), encoding='utf-8'))
    lat0, lon0 = meta['lat'], meta['lon']
    m_lat = 111132.954 - 559.822 * math.cos(2 * math.radians(lat0))
    m_lon = 111412.84 * math.cos(math.radians(lat0))
    to_ll = lambda X, Z: (lat0 - np.asarray(Z) / m_lat, lon0 + np.asarray(X) / m_lon)
    src = ortho.Ortho(cache)
    w = json.load(open(os.path.join(pack, 'world.json'), encoding='utf-8'))
    roads = [r for r in w['roads'] if r['surface'] == 'paved' and r['class'] in CLASSES
             and min(math.hypot(x, z) for x, z in r['p']) < radius]
    # prefetch every ortho cell the strips need, in parallel
    keys = set()
    for r in roads:
        for x, z in r['p']:
            la, lo = to_ll(x, z)
            keys.update(src.keys_around(float(la), float(lo), 25))
    print('cells', len(keys), 'downloaded', src.prefetch(keys, workers=12), flush=True)
    for sub in ('bg', 'test'):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
    n = 0
    for i, r in enumerate(roads):
        rgb, a, s = rr.strip_ll(src.sample, r['p'], r['width'], to_ll, res=0.1, margin=4.0)
        if rgb is None or np.isnan(rgb).mean() > 0.05:
            continue
        # fixed width 160 columns (16 m) centred on the axis, as the network expects
        c = rgb.shape[1] // 2
        if rgb.shape[1] < 160:
            pad = (160 - rgb.shape[1]) // 2
            rgb = np.pad(rgb, ((0, 0), (pad, 160 - rgb.shape[1] - pad), (0, 0)), mode='edge')
        else:
            rgb = rgb[:, c - 80:c + 80]
        img = (np.nan_to_num(rgb).clip(0, 1) * 255).astype(np.uint8)
        sub = 'test' if i % 5 == 0 else 'bg'
        for k in range(0, img.shape[0] - 255, 256):
            np.save(os.path.join(out, sub, f'{r["id"]}_{k // 256}.npy'), img[k:k + 256])
            n += 1
    print('chunks', n)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 1500.0)
