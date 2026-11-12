# usage: python -I import2glb.py in.(fbx|obj) out.glb  -- converts untrusted mesh files to GLB (no scripts involved)
import sys, os, bpy
src, dst = sys.argv[1], sys.argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext == '.fbx': bpy.ops.import_scene.fbx(filepath=src)
elif ext == '.obj': bpy.ops.wm.obj_import(filepath=src)
else: raise SystemExit('unsupported '+ext)
print("IMPORTED", [(o.name, o.type) for o in bpy.data.objects][:20], "ANIMS", [a.name for a in bpy.data.actions])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_apply=True, export_yup=True)
