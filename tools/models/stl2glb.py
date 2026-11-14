# usage: python -I stl2glb.py out.glb '<json spec>'
# spec: {dir, include:[regex...], exclude:regex, color:[r,g,b], dark:regex, darkColor:[r,g,b], front:'-y|+y|+x|-x' (Blender axis the nose points to), tris:int}
# Imports printable-model STL/OBJ parts (untrusted data, parsed only), paints them (STL carries no materials), decimates, orients nose -> glTF +Z.
import sys, os, re, json, math, bpy
out = sys.argv[1]; spec = json.loads(sys.argv[2])
d = spec['dir']
_i = spec.get('include', ['.']); _i = [_i] if isinstance(_i, str) else _i; inc = [re.compile(x, re.I) for x in _i]
exc = re.compile(spec.get('exclude', r'^$'), re.I)
dark = re.compile(spec['dark'], re.I) if spec.get('dark') else None
col = spec.get('color', [0.30, 0.33, 0.20]); dcol = spec.get('darkColor', [0.07, 0.07, 0.07])
files = []
for r, _, fs in os.walk(d):
    for f in sorted(fs):
        if f.lower().endswith(('.stl', '.obj')) and any(p.search(f) for p in inc) and not exc.search(f): files.append(os.path.join(r, f))
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name, c, rough=0.7, metal=0.1):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal; return m
mb, md = mat('body', col), mat('dark', dcol, 0.9, 0.0)
objs = []
for f in files:
    before = set(bpy.data.objects)
    if f.lower().endswith('.stl'): bpy.ops.wm.stl_import(filepath=f)
    else: bpy.ops.wm.obj_import(filepath=f)
    for o in set(bpy.data.objects) - before:
        if o.type != 'MESH': continue
        o.data.materials.clear(); o.data.materials.append(md if (dark and dark.search(os.path.basename(f))) else mb); objs.append(o); o['src'] = os.path.basename(f)
print('FILES', [os.path.basename(f) for f in files], 'OBJS', len(objs))
if not objs: sys.exit(3)

def bbox(os_):
    from mathutils import Vector
    vs = [o.matrix_world @ Vector(c) for o in os_ for c in o.bound_box]
    return [min(v[i] for v in vs) for i in range(3)], [max(v[i] for v in vs) for i in range(3)]
if spec.get('assemble') == 'cad':
    # printable tank kits (CAD frame: X length, Y up, Z width): parts are scattered in print layout -> assemble by rules
    import mathutils
    def nm(o): return o['src']
    SK = [o for o in objs if re.search(r'skirt|pivot', nm(o), re.I)]
    BK = [o for o in objs if re.search(r'back', nm(o), re.I) and o not in SK]
    TRK = [o for o in objs if re.search(r'track', nm(o), re.I)]
    G = [o for o in objs if re.search(r'gun|canon|waffe', nm(o), re.I)]
    TT = [o for o in objs if re.search(r'top|turret|armor', nm(o), re.I) and o not in G + TRK + SK + BK]
    HH = [o for o in objs if o not in SK + BK + TRK + G + TT]
    for o in SK + [x for x in BK if bbox([x])[1][0] - bbox([x])[0][0] < 5]: bpy.data.objects.remove(o, do_unlink=True); objs.remove(o)
    SK = []; BK = [o for o in BK if o in objs]; HH += BK
    def mv(grp, d):
        for o in grp: o.location += d
        bpy.context.view_layer.update()
    V = lambda *a: mathutils.Vector(a[0] if len(a) == 1 else a)
    hmn, hmx = bbox(HH); hcx = (hmn[0] + hmx[0]) / 2; hcz = (hmn[2] + hmx[2]) / 2
    for o in TRK:
        mn, mx = bbox([o]); tw = mx[2] - mn[2]; left = (mn[2] + mx[2]) / 2 < (min(bbox([t])[0][2] for t in TRK) + max(bbox([t])[1][2] for t in TRK)) / 2
        zc = (hmn[2] + tw / 2) if left else (hmx[2] - tw / 2)
        mv([o], V((hcx - (mn[0] + mx[0]) / 2, hmn[1] + 0.12 * (hmx[1] - hmn[1]) - mn[1], zc - (mn[2] + mx[2]) / 2)))
    top_y = hmx[1]
    if TT:
        tmn, tmx = bbox(TT); mv(TT, V(hcx + (spec.get('turretX', 0.47) - 0.5) * (hmx[0] - hmn[0]) - (tmn[0] + tmx[0]) / 2, top_y - tmn[1] - 0.5, hcz - (tmn[2] + tmx[2]) / 2)); tmn, tmx = bbox(TT)
    else: tmn, tmx = hmn, hmx
    if G:
        gmn, gmx = bbox(G); mv(G, V(tmx[0] - spec.get('gunOverlap', 0.3) * (tmx[0] - tmn[0]) - gmn[0], (tmn[1] + 0.5 * (tmx[1] - tmn[1])) - (gmn[1] + gmx[1]) / 2, hcz - (gmn[2] + gmx[2]) / 2))
    spec['front'] = '+x'; spec['_cadrot'] = True
tot = sum(len(o.data.polygons) for o in objs); target = spec.get('tris', 14000)
for o in objs:
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    o.data.transform(o.matrix_world); o.matrix_world.identity()
    import bmesh as _bm
    _b = _bm.new(); _b.from_mesh(o.data); _bm.ops.remove_doubles(_b, verts=_b.verts, dist=1e-5 * max(o.dimensions)); _b.to_mesh(o.data); _b.free()
    n = len(o.data.polygons)
    goal = max(40, int(target * n / tot))
    for _ in range(8):
        if tot <= target or len(o.data.polygons) <= goal * 1.05: break
        m = o.modifiers.new('d', 'DECIMATE'); m.ratio = max(0.01, min(1.0, goal / len(o.data.polygons)))
        bpy.ops.object.modifier_apply(modifier=m.name)
    if len(o.data.polygons) > goal * 1.5:  # stubborn non-manifold soup: voxel remesh gives a clean closed surface, then decimate
        o.data.remesh_voxel_size = max(o.dimensions) / 220; bpy.ops.object.voxel_remesh()
        for _ in range(4):
            if len(o.data.polygons) <= goal * 1.05: break
            m = o.modifiers.new('d', 'DECIMATE'); m.ratio = max(0.01, min(1.0, goal / len(o.data.polygons))); bpy.ops.object.modifier_apply(modifier=m.name)
    o.select_set(False)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join(); ob = bpy.context.view_layer.objects.active
if spec.get('_cadrot'):
    ob.rotation_euler = (math.radians(90), 0, 0); bpy.ops.object.transform_apply(rotation=True)
ang = {'-y': 0, '+y': 180, '+x': -90, '-x': 90}[spec.get('front', '-y')]
ob.rotation_euler = (0, 0, math.radians(ang)); bpy.ops.object.transform_apply(rotation=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
try: bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
except Exception:
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    except Exception as e: print('smooth fail', e)
print('TRIS', len(ob.data.polygons))
ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False)
