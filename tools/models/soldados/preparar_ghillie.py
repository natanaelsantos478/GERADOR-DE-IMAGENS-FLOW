"""Ghillie suit (jeandiz, CC-BY) -> T-pose, standing, fitted to the Quaternius base body, reduced. Saves <out>.blend with object 'Ghillie'."""
import bpy, sys, math
from mathutils import Vector, Matrix
A = sys.argv[sys.argv.index('--') + 1:]
GLB, QB, OUT, RATIO = A[0], A[1], A[2], float(A[3])
def ctx(o): return bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
PARTS = {'Object_11': 'Ghillie', 'Object_21': 'Ghillie roupa de baixo', 'Object_13': 'Ghillie chapeu boonie'}
parts = [bpy.data.objects[n] for n in PARTS]
for o in list(bpy.context.scene.objects):
    if o not in parts and o is not arm and o.type == 'MESH': bpy.data.objects.remove(o, do_unlink=True)
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
B = lambda n: next(b for b in arm.pose.bones if b.name.startswith('mixamorig:' + n + '_'))
W = lambda n: (arm.matrix_world @ B(n).matrix).translation.copy()
def point(pb, d):
    M = arm.matrix_world @ pb.matrix; cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(d.normalized()); p = M.translation
    pb.matrix = arm.matrix_world.inverted() @ (Matrix.Translation(p) @ q.to_matrix().to_4x4() @ Matrix.Translation(-p) @ M)
    bpy.context.view_layer.update()
# raise arms to horizontal (their frame: up = -y, so horizontal = +-x)
for side in ('Left', 'Right'):
    s = 1 if W(side + 'Arm').x > 0 else -1
    for n in ('Arm', 'ForeArm', 'Hand'): point(B(side + n), Vector((s, 0, 0)))
# landmarks in their frame (after the arm raise)
L = dict(top=W('HeadTop_End'), head=W('Head'), sh=W('LeftArm'), wr=W('LeftHand'), hip=W('Hips'), foot=W('LeftFoot'), toe=W('LeftToeBase'))
for suit in parts:
    for m in list(suit.modifiers):
        if m.type == 'ARMATURE':
            with ctx(suit): bpy.ops.object.modifier_apply(modifier=m.name)
    mw = suit.matrix_world.copy(); suit.parent = None; suit.matrix_world = mw
    with ctx(suit): bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    suit.vertex_groups.clear()
bpy.data.objects.remove(arm, do_unlink=True)
suit = parts[0]
# their frame -> ours: their up is -y
R = Matrix.Rotation(-math.pi / 2, 4, 'X')   # their front is -z (toes point there)
for o in parts: o.data.transform(R)
L = {k: (R @ v.to_4d()).to_3d() for k, v in L.items()}
# Quaternius base body landmarks (T-pose)
Q = dict(top=1.81, sh_z=1.456, sh_x=0.212, wr_x=0.706, hip=0.949, sole=0.0)
sole = min(v.co.z for v in suit.data.vertices if abs(v.co.x) < 0.2 and v.co.z < L['foot'].z + 0.05)
s_up = (Q['sh_z'] - Q['hip']) / (L['sh'].z - L['hip'].z)       # torso scale
s_lo = (Q['hip'] - Q['sole']) / (L['hip'].z - sole)              # legs scale
s_hd = (Q['top'] - Q['sh_z']) / (L['top'].z - L['sh'].z)         # neck + head scale
cy = L['hip'].y; shx = abs(L['sh'].x); wrx = abs(L['wr'].x)
print("LANDMARKS", {k: tuple(round(c, 4) for c in v) for k, v in L.items()}, "sole %.4f" % sole, "scales", round(s_lo, 3), round(s_up, 3), round(s_hd, 3))
for v in [v for o in parts for v in o.data.vertices]:
    p = v.co.copy()
    if p.z < L['hip'].z: z = Q['hip'] - (L['hip'].z - p.z) * s_lo; s = s_lo
    elif p.z < L['sh'].z: z = Q['hip'] + (p.z - L['hip'].z) * s_up; s = s_up
    else: z = Q['sh_z'] + (p.z - L['sh'].z) * s_hd; s = s_hd
    ax = abs(p.x)
    if ax > shx and p.z > L['sh'].z - (L['sh'].z - L['hip'].z) * 0.25:   # arm: shoulder->wrist mapped onto the base body arm
        x = Q['sh_x'] + (ax - shx) * (Q['wr_x'] - Q['sh_x']) / (wrx - shx)
    else: x = ax * s_up
    v.co = Vector((math.copysign(x, p.x), (p.y - cy) * s_up + 0.04, z))
tri = lambda o: sum(len(f.vertices) - 2 for f in o.data.polygons)
tris0 = {PARTS[o.name]: tri(o) for o in parts}
if RATIO < 1:
    m = suit.modifiers.new('d', 'DECIMATE'); m.ratio = RATIO; m.use_collapse_triangulate = True
    with ctx(suit): bpy.ops.object.modifier_apply(modifier='d')
for o in parts: o.name = PARTS[o.name]
tris1 = {o.name: tri(o) for o in parts}
# textures to 512 (the suit is seen from a distance in the game)
for img in bpy.data.images:
    if img.size[0] > 512: img.scale(512, 512)
    img.pack()
print("TRIS", tris0, "->", tris1)
# overlay with the base body to check the fit
bpy.ops.import_scene.gltf(filepath=QB)
for o in [o for o in bpy.data.objects if o.name.startswith('Icosphere')]: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
