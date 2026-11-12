# usage: python -I blend2glb.py in.blend out.glb [--no-anim]
# Untrusted .blend: script auto-exec disabled. Legacy (Blender Internal) materials only carry
# diffuse_color, so it is copied into the Principled BSDF base colour. Helper objects
# (bone shapes, guide boxes, hidden collections, material-less meshes) are not exported.
import sys, bpy
src, dst = sys.argv[1], sys.argv[2]
anim = '--no-anim' not in sys.argv
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)

shapes = {b.custom_shape for o in bpy.data.objects if o.type == 'ARMATURE' for b in o.pose.bones if b.custom_shape}
def hidden_coll(o):
    return any(c.hide_render or c.hide_viewport for c in o.users_collection)

for m in bpy.data.materials:
    col = tuple(m.diffuse_color)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Base Color'].default_value = col
    bs.inputs['Roughness'].default_value = 0.65
    bs.inputs['Metallic'].default_value = 0.0
    nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])

keep = []
for o in bpy.data.objects:
    if o.type == 'MESH':
        has_mat = any(s.material for s in o.material_slots)
        if o in shapes or o.hide_render or o.hide_viewport or hidden_coll(o) or not has_mat:
            continue
        keep.append(o)
    elif o.type == 'ARMATURE' and anim:
        keep.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.select_set(True)
print("KEPT", len(keep), "ANIMS", [a.name for a in bpy.data.actions])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_apply=True,
    export_animations=anim, export_yup=True, export_cameras=False, export_lights=False)
