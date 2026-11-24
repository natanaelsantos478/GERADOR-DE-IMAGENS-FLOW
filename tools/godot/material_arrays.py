"""Texture arrays for buildings and roads (ambientCG, CC0, 1K): one vertical strip per map, imported by Godot
as Texture2DArray (one slice per material). The order is the layer id used by the Godot builders.

  python tools/godot/material_arrays.py <godot dir> <cache dir>
Writes godot/assets/buildings/{building,road}_{alb,nrm}.png (+ .import set to 2d_array_texture).
alb = albedo RGB x AO, A = AO; nrm = OpenGL normal RGB, A = roughness.
"""
import io, os, sys, urllib.request, zipfile
import numpy as np
from PIL import Image

BUILDING = ['Bricks075A', 'Bricks084', 'Bricks101', 'Plaster001', 'Concrete024', 'CorrugatedSteel009',   # walls 0-5
            'RoofingTiles013A', 'RoofingTiles011A', 'CorrugatedSteel009', 'Concrete034',              # roofs 6-9
            'Concrete034', 'Grass004']                                                                 # 10 white membrane, 11 green roof
ROAD = ['Asphalt026C', 'Gravel022', 'Ground054', 'Ground037',                                         # paved, gravel, dirt, grass
        'PavingStones136', 'Concrete024']                                                             # 4 sidewalk, 5 curb / runway concrete
N = 1024

IMPORT = """[remap]

importer="2d_array_texture"
type="CompressedTexture2DArray"

[deps]

source_file="res://assets/buildings/{name}"

[params]

compress/mode=2
compress/high_quality=true
compress/lossy_quality=0.7
compress/hdr_compression=1
compress/channel_pack=0
mipmaps/generate=true
mipmaps/limit=-1
slices/horizontal=1
slices/vertical={n}
"""


def fetch(asset, cache):
    d = os.path.join(cache, asset)
    if not os.path.isdir(d):
        url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'meridiano-tools'}), timeout=120).read()))
        os.makedirs(d)
        for n in z.namelist():
            if n.endswith('.jpg'):
                open(os.path.join(d, os.path.basename(n)), 'wb').write(z.read(n))
    def load(kind, mode):
        f = [x for x in os.listdir(d) if x.endswith(f'_{kind}.jpg')]
        if not f:
            return None
        return np.asarray(Image.open(os.path.join(d, f[0])).convert(mode).resize((N, N), Image.LANCZOS), np.float32)
    return load


def strip(assets, cache, out, name):
    alb, nrm = [], []
    for a in assets:
        load = fetch(a, cache)
        c = load('Color', 'RGB')
        ao = load('AmbientOcclusion', 'L')
        ao = np.full((N, N), 255.0, np.float32) if ao is None else ao
        nm = load('NormalGL', 'RGB')
        r = load('Roughness', 'L')
        r = np.full((N, N), 200.0, np.float32) if r is None else r
        alb.append(np.dstack([c * (0.6 + 0.4 * ao[..., None] / 255), ao]))
        nrm.append(np.dstack([nm, r]))
        print(name, a)
    for kind, arr in (('alb', alb), ('nrm', nrm)):
        fn = f'{name}_{kind}.png'
        Image.fromarray(np.vstack(arr).clip(0, 255).astype(np.uint8), 'RGBA').save(os.path.join(out, fn), optimize=True)
        open(os.path.join(out, fn + '.import'), 'w').write(IMPORT.format(name=fn, n=len(arr)))


if __name__ == '__main__':
    godot, cache = sys.argv[1], sys.argv[2]
    out = os.path.join(godot, 'assets', 'buildings')
    os.makedirs(out, exist_ok=True)
    os.makedirs(cache, exist_ok=True)
    strip(BUILDING, cache, out, 'building')
    strip(ROAD, cache, out, 'road')
