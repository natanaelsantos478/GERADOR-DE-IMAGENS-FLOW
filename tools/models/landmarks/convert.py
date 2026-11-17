# usage (bpy venv): python -I convert.py jobs.json   jobs: [{src:dir, out:glb, heightM, spanM, color}]
# Merges every STL/OBJ in src, drops stray debris, normalises: +Z up (Blender) -> +Y up glTF, origin at base centre (bbox centre XZ, min Y = 0), scale to real metres, decimates, single stone material.
import sys, os, json, glob, bpy, bmesh
jobs = json.load(open(sys.argv[1]))
MAXTRI = 30000
def run(j):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    files = sorted(f for ext in ('stl', 'STL', 'obj', 'OBJ') for f in glob.glob(j['src'] + '/**/*.' + ext, recursive=True))
    if not files: return 'no files'
    for f in files[:12]:
        try:
            if f.lower().endswith('stl'): bpy.ops.wm.stl_import(filepath=f)
            else: bpy.ops.wm.obj_import(filepath=f)
        except Exception as e: print('imp', f, e)
    ms = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons)]
    if not ms: return 'no mesh'
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(ms) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > MAXTRI:
        m = o.modifiers.new('d', 'DECIMATE'); m.ratio = MAXTRI / tris
        bpy.ops.object.modifier_apply(modifier=m.name)
    if j.get('rotx'): o.rotation_euler[0] = j['rotx'] * 3.14159265 / 180; bpy.ops.object.transform_apply(rotation=True)
    if j.get('yaw'): o.rotation_euler[2] = j['yaw'] * 3.14159265 / 180; bpy.ops.object.transform_apply(rotation=True)
    v = [o.matrix_world @ x.co for x in o.data.vertices]
    mn = [min(c[i] for c in v) for i in range(3)]; mx = [max(c[i] for c in v) for i in range(3)]
    ext = [mx[i] - mn[i] for i in range(3)]
    mode = j.get('mode', 'height')  # height: uniform by height; span: uniform by longest plan extent; both: span horizontally + height vertically (non-uniform)
    sh = (j['spanM'] / max(ext[0], ext[1], 1e-9)) if mode in ('span', 'both') else j['heightM'] / max(ext[2], 1e-9)
    sv = j['heightM'] / max(ext[2], 1e-9) if mode == 'both' else sh
    sx = sy = sh
    if j.get('crossM'):
        if ext[0] >= ext[1]: sy = j['crossM'] / max(ext[1], 1e-9)
        else: sx = j['crossM'] / max(ext[0], 1e-9)
    for x in o.data.vertices: x.co = ((x.co.x - (mn[0] + mx[0]) / 2) * sx, (x.co.y - (mn[1] + mx[1]) / 2) * sy, (x.co.z - mn[2]) * sv)
    bpy.ops.object.shade_smooth_by_angle(angle=0.7) if hasattr(bpy.ops.object, 'shade_smooth_by_angle') else bpy.ops.object.shade_smooth()
    c = j['color']; rgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    mat = bpy.data.materials.new('stone'); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = rgb + [1]; b.inputs['Roughness'].default_value = 0.85
    o.data.materials.clear(); o.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=j['out'], export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_image_format='NONE')
    return 'ok %d tris ext %s -> %.0fx%.0fx%.0f m' % (sum(len(p.vertices) - 2 for p in o.data.polygons), [round(e) for e in ext], ext[0] * sx, ext[2] * sv, ext[1] * sy)
for j in jobs:
    try: print(os.path.basename(j['out']), run(j), flush=True)
    except Exception as e: print(os.path.basename(j['out']), 'ERR', e, flush=True)
