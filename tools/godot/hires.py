"""High-resolution satellite tiles (Esri World Imagery, z18 ~ 0.4 m/px at 50°N) fetched only where they are needed
(roofs, road markings), cached on disk outside the project (tools/.cache/godot/tiles)."""
import io, math, os, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
Z = 18


class Tiles:
    def __init__(self, cache_dir, z=Z):
        self.dir = os.path.join(cache_dir, 'tiles', str(z))
        self.z = z
        self.n = 2 ** z
        self.mem = {}

    def px(self, lat, lon):
        """Global pixel coordinates at this zoom."""
        x = (lon + 180) / 360 * self.n * 256
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * self.n * 256
        return x, y

    def m_per_px(self, lat):
        return 156543.03392 * math.cos(math.radians(lat)) / self.n

    def _path(self, tx, ty):
        return os.path.join(self.dir, str(tx), f'{ty}.jpg')

    def _download(self, key):
        tx, ty = key
        p = self._path(tx, ty)
        if os.path.exists(p):
            return
        os.makedirs(os.path.dirname(p), exist_ok=True)
        req = urllib.request.Request(URL.format(z=self.z, x=tx, y=ty), headers={'User-Agent': 'meridiano-tools'})
        try:
            data = urllib.request.urlopen(req, timeout=40).read()
        except Exception:
            return
        with open(p, 'wb') as f:
            f.write(data)

    def prefetch(self, keys, workers=8):
        todo = [k for k in set(keys) if not os.path.exists(self._path(*k))]
        if todo:
            with ThreadPoolExecutor(workers) as ex:
                list(ex.map(self._download, todo))
        return len(todo)

    def tile(self, tx, ty):
        k = (tx, ty)
        if k not in self.mem:
            p = self._path(tx, ty)
            if not os.path.exists(p):
                self._download(k)
            try:
                self.mem[k] = np.asarray(Image.open(p).convert('RGB'), np.float32) / 255
            except Exception:
                self.mem[k] = None
            if len(self.mem) > 600:  # keep memory bounded
                self.mem.pop(next(iter(self.mem)))
        return self.mem[k]

    def sample(self, gx, gy):
        """Colours at global pixel coordinates (arrays). NaN where a tile is missing."""
        gx = np.asarray(gx, np.float64)
        gy = np.asarray(gy, np.float64)
        out = np.full(gx.shape + (3,), np.nan, np.float32)
        tx, ty = (gx // 256).astype(int), (gy // 256).astype(int)
        for k in set(zip(tx.ravel().tolist(), ty.ravel().tolist())):
            t = self.tile(*k)
            if t is None:
                continue
            m = (tx == k[0]) & (ty == k[1])
            out[m] = t[(gy[m] - k[1] * 256).astype(int).clip(0, 255), (gx[m] - k[0] * 256).astype(int).clip(0, 255)]
        return out

    def keys_for_bbox(self, lat0, lon0, lat1, lon1):
        x0, y0 = self.px(max(lat0, lat1), min(lon0, lon1))
        x1, y1 = self.px(min(lat0, lat1), max(lon0, lon1))
        return [(tx, ty) for tx in range(int(x0 // 256), int(x1 // 256) + 1) for ty in range(int(y0 // 256), int(y1 // 256) + 1)]
