"""Soldier of the kit (estilos.blend, one collection) -> ONE light skinned glb for the game.
 blender -b -P exportar_soldados.py -- <estilos.blend> "<collection>" <out.glb> <near|far>
 - bone-parented accessories (helmet, rifle, pack...) become skinned (weight 1 to their bone)
 - every piece is decimated to a triangle budget (near ~11k, far ~2k)
 - camouflage tints are baked into the colours, every base-colour texture goes into ONE atlas (1 material, 1 draw call);
   flat-colour parts (rifle, helmet) use vertex colours on a white cell of the atlas
 - only the clips the game uses are exported
"""
import bpy, sys, math, json, struct, numpy as np
from mathutils import Vector, Matrix

A = sys.argv[sys.argv.index('--') + 1:]
BLEND, COLL, OUT, LOD = A[0], A[1], A[2], A[3]
NEAR = LOD == 'near'
ATLAS = 2048 if NEAR else 512
CELL = ATLAS // 4
PAD = 4 if NEAR else 2
CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Crouch_Idle_Loop', 'Death01', 'Pistol_Aim_Neutral'] if NEAR else ['Idle_Loop', 'Jog_Fwd_Loop', 'Pistol_Aim_Neutral']
BUD_NEAR = {'Camisa': 1300, 'Calca': 1000, 'Botas': 800, 'Luvas': 800, 'Colete': 900, 'Protecoes': 300, 'SuperHero_Male': 1500, 'Eyes': 200, 'Eyebrows': 0,
            'Ghillie roupa': 1200, 'Ghillie': 4500, 'Capacete': 1600, 'Balaclava': 1000, 'Chapeu': 800, 'Arma': 2400, 'Mochila': 900, 'Plate carrier': 1200}
BUD_FAR = {'Camisa': 380, 'Calca': 280, 'Botas': 220, 'Luvas': 0, 'Colete': 260, 'Protecoes': 0, 'SuperHero_Male': 350, 'Eyes': 0, 'Eyebrows': 0,
           'Ghillie roupa': 0, 'Ghillie': 1200, 'Capacete': 380, 'Balaclava': 260, 'Chapeu': 260, 'Arma': 800, 'Mochila': 250, 'Plate carrier': 300}
BUD = BUD_NEAR if NEAR else BUD_FAR
KEYS = sorted(BUD, key=len, reverse=True)

def ctx(o): return bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o])
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)

# ---------------------------------------------------------------- isolate the soldier
bpy.ops.wm.open_mainfile(filepath=BLEND)
col = bpy.data.collections[COLL]
keep = set(col.all_objects)
for o in list(bpy.data.objects):
    if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in col.all_objects if o.type == 'ARMATURE')
arm.location.x = 0
if arm.animation_data: arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

# ---------------------------------------------------------------- group name + bone of every mesh, then bake to rest world space
meshes = [o for o in col.all_objects if o.type == 'MESH']
info = {}
for o in meshes:
    p, grp, bone = o.parent, None, None
    while p is not None:
        if p.type == 'EMPTY' and grp is None: grp = p.name
        if p.parent_type == 'BONE' and bone is None: bone = p.parent_bone
        p = p.parent
    skinned = any(m.type == 'ARMATURE' for m in o.modifiers)
    info[o.name] = dict(grp=grp or o.name, bone=bone, skinned=skinned)
def key_of(name):
    for k in KEYS:
        if name.startswith(k): return k
    return None
for o in list(meshes):
    inf = info[o.name]; k = key_of(inf['grp'])
    if k is None or BUD.get(k, 1) == 0:
        bpy.data.objects.remove(o, do_unlink=True); meshes.remove(o); continue
    inf['key'] = k
for o in meshes:
    inf = info[o.name]
    for m in list(o.modifiers): o.modifiers.remove(m)
    mw = o.matrix_world.copy(); o.data.transform(mw); o.parent = None; o.matrix_world = Matrix.Identity(4)
    if not inf['skinned']:
        o.vertex_groups.clear()
        vg = o.vertex_groups.new(name=inf['bone']); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    if o.data.shape_keys: o.shape_key_clear()

# ---------------------------------------------------------------- decimate to the budget (per group, proportional)
groups = {}
for o in meshes: groups.setdefault(info[o.name]['grp'], []).append(o)
t0 = sum(tri(o) for o in meshes)
for g, objs in groups.items():
    total = sum(tri(o) for o in objs); budget = BUD[info[objs[0].name]['key']]
    if total <= budget: continue
    for o in objs:
        t = tri(o)
        if t < 40: continue
        m = o.modifiers.new('d', 'DECIMATE'); m.ratio = max(0.03, min(1.0, budget / total)); m.use_collapse_triangulate = True
        with ctx(o): bpy.ops.object.modifier_apply(modifier='d')
print("DECIMATE", t0, "->", sum(tri(o) for o in meshes))

# ---------------------------------------------------------------- colours: bake the tint chain, atlas
def s2l(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def l2s(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
def rgb2hsv(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    mx = c.max(-1); mn = c.min(-1); d = mx - mn; h = np.zeros_like(mx)
    m = d > 1e-9
    rc = np.where(m & (mx == r), ((g - b) / np.where(m, d, 1)) % 6, 0)
    gc = np.where(m & (mx == g) & (mx != r), (b - r) / np.where(m, d, 1) + 2, 0)
    bc = np.where(m & (mx == b) & (mx != r) & (mx != g), (r - g) / np.where(m, d, 1) + 4, 0)
    h = ((rc + gc + bc) / 6) % 1
    s = np.where(mx > 1e-9, d / np.where(mx > 1e-9, mx, 1), 0)
    return np.stack([h, s, mx], -1)
def hsv2rgb(c):
    h, s, v = c[..., 0], c[..., 1], c[..., 2]
    i = np.floor(h * 6).astype(int) % 6; f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)

def chain_of(mat):
    """(texture image or None, flat colour rgba, ops innermost-first) of a material's base colour."""
    nt = mat.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'); sock = b.inputs['Base Color']
    if not sock.links: return None, tuple(sock.default_value), []
    ops, n = [], sock.links[0].from_node
    while n.type in ('MIX', 'HUE_SAT', 'MIX_RGB'):
        if n.type == 'HUE_SAT':
            ops.append(('hsv', n.inputs['Hue'].default_value, n.inputs['Saturation'].default_value, n.inputs['Value'].default_value))
            n = n.inputs['Color'].links[0].from_node
        else:
            if n.inputs[7].links or not n.inputs[6].links:      # original vertex-colour mix: pass-through to the texture
                n = (n.inputs[6].links[0].from_node if n.inputs[6].links else None)
                if n is None: break
                continue
            ops.append(('mix', n.blend_type, n.inputs['Factor'].default_value, tuple(n.inputs[7].default_value[:3])))
            n = n.inputs[6].links[0].from_node
    if n is not None and n.type == 'TEX_IMAGE' and n.image: return n.image, None, list(reversed(ops))
    return None, tuple(sock.default_value), []

def image_array(img, size, ops):
    im = img.copy(); im.scale(size, size)
    buf = np.empty(size * size * 4, np.float32); im.pixels.foreach_get(buf); bpy.data.images.remove(im)
    a = buf.reshape(size, size, 4); rgb = s2l(a[..., :3])
    for op in ops:
        if op[0] == 'hsv':
            hsv = rgb2hsv(rgb); hsv[..., 0] = (hsv[..., 0] + op[1] - 0.5) % 1; hsv[..., 1] = np.clip(hsv[..., 1] * op[2], 0, 1); hsv[..., 2] = hsv[..., 2] * op[3]
            rgb = hsv2rgb(hsv)
        else:
            f, col = op[2], np.array(op[3], np.float32)
            rgb = rgb * (1 - f) + (rgb * col if op[1] == 'MULTIPLY' else col) * f
    out = a.copy(); out[..., :3] = l2s(rgb); return out

atlas = np.ones((ATLAS, ATLAS, 4), np.float32)          # white everywhere: the flat-colour cell stays white
cells, next_cell = {}, 0                                 # key -> (cx, cy)
inner = CELL - 2 * PAD
# cell 15 is a palette of 32 x 32 solid swatches: flat-colour parts (rifle, helmet...) point their UVs at a swatch, so no vertex colours are needed
PAL_CELL = (3, 3); SW = CELL // 32; palette = {}
def swatch(lin):
    key = tuple(int(round(float(v) * 255)) for v in l2s(np.array(lin[:3], np.float32)))
    if key not in palette:
        i = len(palette)
        if i >= 1024: raise RuntimeError('palette full')
        palette[key] = i
        x0, y0 = PAL_CELL[0] * CELL + (i % 32) * SW, PAL_CELL[1] * CELL + (i // 32) * SW
        atlas[y0:y0 + SW, x0:x0 + SW, :3] = np.array(key, np.float32) / 255; atlas[y0:y0 + SW, x0:x0 + SW, 3] = 1
    i = palette[key]
    return (PAL_CELL[0] * CELL + (i % 32) * SW + SW / 2) / ATLAS, (PAL_CELL[1] * CELL + (i // 32) * SW + SW / 2) / ATLAS
def cell_for(key, make):
    global next_cell
    if key in cells: return cells[key]
    if next_cell >= 15: raise RuntimeError('atlas full')
    cx, cy = next_cell % 4, next_cell // 4; next_cell += 1
    arr = make()
    arr = np.pad(arr, ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
    atlas[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL] = arr
    cells[key] = (cx, cy); return cx, cy

jobs, bad_uv = [], 0
for o in list(meshes):
    me = o.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    while len(me.uv_layers) > 1: me.uv_layers.remove(me.uv_layers[-1])
    me.uv_layers[0].name = 'UVMap'
    for n in list(me.color_attributes.keys()): me.color_attributes.remove(me.color_attributes[n])
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    nloops = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', nloops)
    pmat = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', pmat)
    lmat = np.repeat(pmat, nloops)
    for si in np.unique(lmat):
        mat = o.material_slots[si].material if si < len(o.material_slots) else None
        idx = lmat == si
        if mat is None: img, flat, ops = None, (0.5, 0.5, 0.5, 1), []
        else: img, flat, ops = chain_of(mat)
        if img is not None:
            key = (img.name, tuple(map(tuple, ops)))
            cx, cy = cell_for(key, lambda: image_array(img, inner, ops))
            u, v = uv[idx, 0], uv[idx, 1]
            bad_uv += int(((u < -0.02) | (u > 1.02) | (v < -0.02) | (v > 1.02)).sum())
            u = np.clip(u, 0, 1); v = np.clip(v, 0, 1)
            uv[idx, 0] = (cx * CELL + PAD + u * inner) / ATLAS; uv[idx, 1] = (cy * CELL + PAD + v * inner) / ATLAS
        else:
            uv[idx, 0], uv[idx, 1] = swatch(flat)
    me.uv_layers[0].data.foreach_set('uv', uv.reshape(-1))
    me.materials.clear(); me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))
print("ATLAS cells used", next_cell, "bad uv loops", bad_uv)
aimg = bpy.data.images.new('atlas', ATLAS, ATLAS, alpha=False)
aimg.pixels.foreach_set(atlas.reshape(-1)); aimg.pack(); aimg.colorspace_settings.name = 'sRGB'
mat = bpy.data.materials.new('Soldado'); mat.use_nodes = True
nt = mat.node_tree; bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = aimg; tex.interpolation = 'Linear'; nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.85; bsdf.inputs['Metallic'].default_value = 0.0
for o in meshes: o.data.materials.append(mat)

# ---------------------------------------------------------------- join into one skinned mesh
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active; body.name = 'Soldado_Mesh'
with ctx(body): bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4); bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
body.parent = arm; body.matrix_parent_inverse = arm.matrix_world.inverted()
m = body.modifiers.new('Armature', 'ARMATURE'); m.object = arm
for o in list(bpy.data.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
print("FINAL tris", tri(body), "verts", len(body.data.vertices))

# ---------------------------------------------------------------- clips (NLA tracks -> one glTF animation each)
ad = arm.animation_data_create(); ad.action = None
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
for name in CLIPS:
    act = bpy.data.actions[name]; tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, int(act.frame_range[0]), act); st.name = name
    if hasattr(st, 'action_slot') and act.slots: st.action_slot = act.slots[0]
for a in list(bpy.data.actions):
    if a.name not in CLIPS: bpy.data.actions.remove(a)
arm.location = (0, 0, 0)
bpy.ops.object.select_all(action='SELECT')
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
kw = dict(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=80 if NEAR else 75, export_yup=True, export_apply=False, use_selection=False,
          export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_frame_step=2 if NEAR else 3, export_optimize_animation_size=True,
          export_cameras=False, export_lights=False, export_normals=True, export_tangents=False, export_materials='EXPORT', export_vertex_color='NONE', export_extras=False,
          export_def_bones=False)
bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})
# report
b = open(OUT, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n])
pos = next(a for a in j['accessors'] if a.get('type') == 'VEC3' and 'min' in a and a['count'] == len(body.data.vertices)) if j.get('accessors') else None
print("GLB", OUT.split('/')[-1], len(b) // 1024, "KB", "anims", [a['name'] for a in j.get('animations', [])], "meshes", len(j['meshes']), "materials", len(j['materials']), "native", [round(x, 3) for x in ([pos['max'][i] - pos['min'][i] for i in range(3)] if pos else [])])
