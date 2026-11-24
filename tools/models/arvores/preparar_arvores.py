"""Trees for the Godot battle: one trees.glb (shared textures) + one far-view impostor PNG per tree.

Sources (CC-BY, credits in godot/assets/trees/LICENSE.md), downloaded from Sketchfab:
  pack.glb  "Low Poly Forest Tree Pack" by 99.Miles
  pine.glb  "Pine Tree [Game-ready]" by Wenedi
  beech.glb "Beech tree" by evolveduk
Usage: blender -b --factory-startup -P preparar_arvores.py -- <dir with the 3 glb> <godot/assets/trees>
Autumn leaves of the pack are shifted to summer green (only orange/yellow pixels, conifers untouched).
"""
import bpy, sys, math, json, os, colorsys
import mathutils
import numpy as np

A = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(A[0]), os.path.abspath(A[1])  # render paths must be absolute
os.makedirs(os.path.join(OUT, 'impostors'), exist_ok=True)

# name, source, object name prefixes, species, target height (m)
TREES = [
    ('c_spruce_a', 'pack', ['Background_Tree_Atlas_Background'], 'conifer', 26.0),
    ('c_spruce_b', 'pack', ['Background_Tree_Atlas.003'], 'conifer', 25.0),
    ('c_spruce_c', 'pack', ['Background_Tree_Atlas.007'], 'conifer', 24.0),
    ('c_spruce_thin', 'pack', ['Background_Tree_Atlas.006'], 'conifer', 23.0),
    ('c_pine_tall', 'pack', ['Background_Tree_Atlas.005'], 'conifer', 29.0),
    ('c_spruce_young', 'pack', ['Background_Tree_Atlas.002'], 'conifer', 15.0),
    ('c_pine_hero', 'pine', ['Trunk', 'Branches'], 'conifer', 27.0),
    ('b_birch', 'pack', ['Tree_Trunk_02', 'Tree_Branches_02'], 'broadleaf', 17.0),
    ('b_poplar', 'pack', ['Background_Tree_Atlas.001'], 'broadleaf', 24.0),
    ('b_round', 'pack', ['Background_Tree_Atlas.004'], 'broadleaf', 19.0),
    ('b_beech', 'beech', ['Tree_0', 'Tree_1'], 'broadleaf', 22.0),
    ('u_bush', 'pack', ['Background_Tree_Atlas.010'], 'under', 2.2),
    ('u_shrub', 'pack', ['Background_Tree_Atlas.012'], 'under', 2.6),
    ('u_sapling', 'pack', ['Background_Tree_Atlas.009'], 'under', 5.0),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
src_objs = {}
for key in ('pack', 'pine', 'beech'):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, key + '.glb'))
    src_objs[key] = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']


def summer(img):
    """Orange/yellow leaf pixels -> summer green, keeping brightness and alpha."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    p = px.reshape(-1, 4)
    r, g, b = p[:, 0], p[:, 1], p[:, 2]
    mx, mn = p[:, :3].max(1), p[:, :3].min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    autumn = (r > g * 1.02) & (g > b * 1.15) & (sat > 0.25) & (p[:, 3] > 0.05)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    k = lum[autumn] / 0.45
    p[autumn, 0] = np.clip(0.22 * k, 0, 1)
    p[autumn, 1] = np.clip(0.42 * k, 0, 1)
    p[autumn, 2] = np.clip(0.12 * k, 0, 1)
    img.pixels.foreach_set(p.ravel())
    img.update()
    return int(autumn.sum())


for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and ('Tree_Atlas' in mat.name or 'Branches_02' in mat.name):
            if not n.image.get('summer'):
                changed = summer(n.image)
                n.image['summer'] = 1
                print('SUMMER', n.image.name, changed)
for img in bpy.data.images:
    if max(img.size) > 1024:
        img.scale(img.size[0] // 2, img.size[1] // 2)

scene = bpy.context.scene
meta = {}
export_objs = []
for name, key, prefixes, species, height in TREES:
    parts = [o for o in src_objs[key] if any(o.name.startswith(p) for p in prefixes)]
    if not parts:
        print('MISSING', name)
        continue
    copies = []
    for o in parts:
        c = o.copy()
        c.data = o.data.copy()
        scene.collection.objects.link(c)
        c.parent = None                       # unparent first, then keep the full world transform
        c.matrix_world = o.matrix_world.copy()
        copies.append(c)
    bpy.ops.object.select_all(action='DESELECT')
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(copies) > 1:
        bpy.ops.object.join()
    t = bpy.context.view_layer.objects.active
    t.name = name
    vs = [v.co for v in t.data.vertices]
    mn = mathutils.Vector([min(v[i] for v in vs) for i in range(3)])
    mx = mathutils.Vector([max(v[i] for v in vs) for i in range(3)])
    s = height / (mx.z - mn.z)
    base = mathutils.Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    for v in t.data.vertices:
        v.co = (v.co - base) * s
    t.location = (0, 0, 0)
    tris = sum(len(p.vertices) - 2 for p in t.data.polygons)
    meta[name] = {'species': species, 'height': height, 'width': round(max(mx.x - mn.x, mx.y - mn.y) * s, 2), 'tris': tris}
    export_objs.append(t)
    print('TREE', name, tris, 'tris', meta[name]['width'], 'm wide')

# drop the sources, keep only the prepared trees
for objs in src_objs.values():
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

# trees side by side for export, each its own root node
for i, t in enumerate(export_objs):
    t.location = (i * 40.0, 0, 0)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'trees.glb'), use_selection=True, export_format='GLB',
                          export_image_format='AUTO', export_apply=True)
for t in export_objs:
    t.location = (0, 0, 0)

# impostors: orthographic side view, transparent, 256 x 512
scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = 256, 512
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
w = bpy.data.worlds.new('w')
w.color = (0.55, 0.6, 0.65)
scene.world = w
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.clip_end = 500
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(55), 0, math.radians(20))
scene.collection.objects.link(sun)
for t in export_objs:
    for o in export_objs:
        o.hide_render = o is not t
    m = meta[t.name]
    span = max(m['width'], m['height'] / 2.0) * 1.02
    cam.data.ortho_scale = span * 2.0          # frame is 1:2, ortho_scale = larger side
    cam.location = (0, -200, span)             # frame bottom at the ground
    m['imp_w'] = span
    m['imp_h'] = span * 2.0
    scene.render.filepath = os.path.join(OUT, 'impostors', t.name + '.png')
    bpy.ops.render.render(write_still=True)
    # crown seen from above, same width as the side picture, for high cameras
    scene.render.resolution_x, scene.render.resolution_y = 256, 256
    cam.data.ortho_scale = span
    cam.location = (0, 0, m['height'] + 50)
    cam.rotation_euler = (0, 0, 0)
    scene.render.filepath = os.path.join(OUT, 'impostors', t.name + '_top.png')
    bpy.ops.render.render(write_still=True)
    m['top_y'] = round(min(0.62 * m['height'], m['height'] - 2.0) / m['imp_h'], 3)
    scene.render.resolution_x, scene.render.resolution_y = 256, 512
    cam.rotation_euler = (math.radians(90), 0, 0)
with open(os.path.join(OUT, 'trees.json'), 'w') as f:
    json.dump(meta, f, indent=1)
print('DONE', len(export_objs))
