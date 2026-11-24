"""Learned parameters per place, saved as small data (not the rendered world) and reused on the next rebuild.

One JSON file per z14 tile (~2.4 km at 50°N) in public/data/sites/z14/<x>/<y>.json:
  {"v": analysis version, "b": {osm_id: building params}, "r": {osm_id: road params}, "n": {osm_id: node params}}
When a battle pack is built, elements already analysed (same OSM id and same geometry hash) are taken from here
and skip the satellite analysis; new or changed ones are analysed and written back.
"""
import json, math, os, zlib

VERSION = 1
Z = 14


def tile_of(lat, lon):
    n = 2 ** Z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def geom_hash(pts):
    s = ';'.join(f'{x:.1f},{z:.1f}' for x, z in pts)
    return zlib.crc32(s.encode()) & 0xffffffff


class Store:
    def __init__(self, root):
        self.root = root
        self.files = {}
        self.dirty = set()
        self.hits = 0
        self.misses = 0

    def _file(self, t):
        if t not in self.files:
            p = os.path.join(self.root, 'z14', str(t[0]), f'{t[1]}.json')
            d = None
            if os.path.exists(p):
                d = json.load(open(p, encoding='utf-8'))
                if d.get('v') != VERSION:
                    d = None
            self.files[t] = d or {'v': VERSION, 'b': {}, 'r': {}, 'n': {}}
        return self.files[t]

    def get(self, kind, osm_id, lat, lon, h):
        e = self._file(tile_of(lat, lon))[kind].get(str(osm_id))
        if e is not None and e.get('h') == h:
            self.hits += 1
            return e
        self.misses += 1
        return None

    def put(self, kind, osm_id, lat, lon, h, value):
        t = tile_of(lat, lon)
        value = dict(value, h=h)
        self._file(t)[kind][str(osm_id)] = value
        self.dirty.add(t)

    def save(self):
        for t in self.dirty:
            p = os.path.join(self.root, 'z14', str(t[0]), f'{t[1]}.json')
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(self.files[t], f, separators=(',', ':'))
        n = len(self.dirty)
        self.dirty.clear()
        return n
