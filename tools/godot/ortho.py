"""Sharpest open aerial photo for a place: national orthophotos where they exist, Esri World Imagery otherwise.

Wallonia (Belgium): Service public de Wallonie, IMAGERIE/ORTHO_LAST (latest year, ~10 cm display, open data with
attribution "SPW"). Read through the ArcGIS 'export' endpoint in Web Mercator cells of CELL metres at RES m/px,
cached on disk outside the project (tools/.cache/godot/ortho/...).

sample(lat, lon) -> RGB 0..1 (NaN where nothing could be read). Same interface as hires.Tiles.sample, in lat/lon.
"""
import io, math, os, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

R = 6378137.0
SOURCES = {
    # name: (url template, bounding box lat0, lon0, lat1, lon1, attribution)
    'wallonia': ('https://geoservices.wallonie.be/arcgis/rest/services/IMAGERIE/ORTHO_LAST/MapServer/export',
                 (49.45, 2.80, 50.85, 6.45), 'Orthophotos © Service public de Wallonie (SPW)'),
}


def merc(lat, lon):
    x = np.radians(lon) * R
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R
    return x, y


class Ortho:
    """Mercator grid cells of CELL metres (mercator units), PX pixels each."""
    CELL = 64.0
    PX = 640

    def __init__(self, cache_dir, source='wallonia'):
        self.url, self.bbox, self.attribution = SOURCES[source]
        self.dir = os.path.join(cache_dir, 'ortho', source)
        self.mem = {}

    def covers(self, lat, lon):
        a, b, c, d = self.bbox
        return a <= lat <= c and b <= lon <= d

    def _path(self, cx, cy):
        return os.path.join(self.dir, str(cx), f'{cy}.jpg')

    def _download(self, key):
        cx, cy = key
        p = self._path(cx, cy)
        if os.path.exists(p):
            return
        os.makedirs(os.path.dirname(p), exist_ok=True)
        x0, y0 = cx * self.CELL, cy * self.CELL
        q = {'bbox': f'{x0},{y0},{x0 + self.CELL},{y0 + self.CELL}', 'bboxSR': 3857, 'imageSR': 3857,
             'size': f'{self.PX},{self.PX}', 'format': 'jpg', 'f': 'image'}
        req = urllib.request.Request(self.url + '?' + urllib.parse.urlencode(q), headers={'User-Agent': 'meridiano-tools'})
        data = None
        for attempt in range(3):          # the service drops a few requests under load
            try:
                data = urllib.request.urlopen(req, timeout=60).read()
                if len(data) > 2000:
                    break
            except Exception:
                data = None
        if not data:
            return
        with open(p, 'wb') as f:
            f.write(data)

    def keys_around(self, lat, lon, radius_m):
        x, y = merc(lat, lon)
        k = 1.0 / math.cos(math.radians(lat))   # mercator metres per ground metre
        r = radius_m * k
        return [(cx, cy) for cx in range(int((x - r) // self.CELL), int((x + r) // self.CELL) + 1)
                for cy in range(int((y - r) // self.CELL), int((y + r) // self.CELL) + 1)]

    def prefetch(self, keys, workers=12):
        todo = [k for k in set(keys) if not os.path.exists(self._path(*k))]
        if todo:
            with ThreadPoolExecutor(workers) as ex:
                list(ex.map(self._download, todo))
        return len(todo)

    def cell(self, cx, cy):
        k = (cx, cy)
        if k not in self.mem:
            p = self._path(cx, cy)
            if not os.path.exists(p):
                self._download(k)
            try:
                self.mem[k] = np.asarray(Image.open(p).convert('RGB'), np.float32) / 255
            except Exception:
                self.mem[k] = None
            if len(self.mem) > 400:
                self.mem.pop(next(iter(self.mem)))
        return self.mem[k]

    def sample(self, lat, lon):
        x, y = merc(np.asarray(lat, np.float64), np.asarray(lon, np.float64))
        cx, cy = np.floor(x / self.CELL).astype(int), np.floor(y / self.CELL).astype(int)
        # pixel inside the cell (row 0 = north edge)
        u = ((x - cx * self.CELL) / self.CELL * self.PX).astype(int).clip(0, self.PX - 1)
        v = ((1 - (y - cy * self.CELL) / self.CELL) * self.PX).astype(int).clip(0, self.PX - 1)
        out = np.full(x.shape + (3,), np.nan, np.float32)
        for k in set(zip(cx.ravel().tolist(), cy.ravel().tolist())):
            img = self.cell(*k)
            if img is None:
                continue
            m = (cx == k[0]) & (cy == k[1])
            out[m] = img[v[m], u[m]]
        return out
