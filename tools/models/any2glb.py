# usage: python -I any2glb.py in.(blend|fbx|obj|stl|dae|3ds) out.glb [--anim] [--drop=regex]
# Generic converter keeping the source materials/textures (untrusted file: script auto-exec disabled). Textures downscaled to <=1024.
import sys, re, os, bpy
src, dst = sys.argv[1], sys.argv[2]
anim = '--anim' in sys.argv
drop = re.compile(next((a[7:] for a in sys.argv if a.startswith('--drop=')), r'^$'))
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
ext = os.path.splitext(src)[1].lower()
if ext == '.blend': bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == '.fbx': bpy.ops.import_scene.fbx(filepath=src)
    elif ext == '.obj': bpy.ops.wm.obj_import(filepath=src)
    elif ext == '.stl': bpy.ops.wm.stl_import(filepath=src)
    elif ext == '.dae': bpy.ops.wm.collada_import(filepath=src)
    else: raise SystemExit('unsupported')
for im in bpy.data.images:
    try:
        if im.size[0] and max(im.size) > 1024:
            s = 1024 / max(im.size); im.scale(max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s)))
        if im.source == 'FILE' and not im.packed_file and im.size[0]: im.pack()
    except Exception as e: print('img', im.name, e)
for o in bpy.data.objects:
    try: o.select_set(False)
    except Exception: pass
n = 0
for o in bpy.data.objects:
    ok = o.type == 'MESH' or (o.type == 'ARMATURE' and anim)
    if ok and not o.hide_render and not o.hide_viewport and not drop.search(o.name) and not any(c.hide_render or c.hide_viewport for c in o.users_collection):
        if o.type == 'MESH' and not o.data.polygons: continue
        try: o.select_set(True); n += 1
        except Exception: pass
print('KEPT', n, 'ANIMS', [a.name for a in bpy.data.actions][:8])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_apply=True, export_animations=anim, export_yup=True, export_cameras=False, export_lights=False, export_image_format='AUTO')
