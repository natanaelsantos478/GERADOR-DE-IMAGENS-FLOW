"""Animation library for the Godot soldiers: the 43 Quaternius UAL1 clips (CC0) + new rifle / prone clips made here.

  blender -b --factory-startup -P animacoes_extras.py -- <UAL1_Standard.glb> <out anims.glb> [<preview dir>]

New clips (the soldiers carry a rifle, UAL1 only has pistol poses):
  Rifle_Aim         standing, rifle shouldered, left hand on the handguard, head on the sights
  Rifle_Aim_Crouch  same on the crouched legs
  Prone_Aim         lying on the belly, on the elbows, rifle forward
  Prone_Crawl       low crawl cycle (alternate elbow / knee), ~0.6 m per cycle
Arms are solved with IK to targets placed relative to the shoulders, then baked to keys. Only the armature and
the actions are exported (no mesh): Godot adds them to every soldier, whose skeleton has the same bone names.
"""
import bpy, sys, math, os
from mathutils import Vector, Matrix, Euler

A = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(A[0]), os.path.abspath(A[1])
PREV = os.path.abspath(A[2]) if len(A) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = [o for o in bpy.data.objects if o.type == 'MESH']
scene = bpy.context.scene
scene.frame_start = 0
bpy.context.view_layer.objects.active = arm
arm.animation_data_create()
pb = arm.pose.bones


def use_action(name):
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot') and act.slots:
        arm.animation_data.action_slot = act.slots[0]
    return act


def world(bone_name, head=True):
    b = pb[bone_name]
    return arm.matrix_world @ (b.head if head else b.tail)


def forward_up():
    """Character forward / up / right in world space from the rest pose (Quaternius faces -Y in Blender)."""
    # forward = where the toes point (ball - foot); right = up x forward (Quaternius faces +Y in Blender)
    toe = world('ball_l') - world('foot_l')
    fwd = Vector((toe.x, toe.y, 0)).normalized()
    up = Vector((0, 0, 1))
    right = fwd.cross(up).normalized()
    return fwd, up, right


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    return e


def ik(bone, target, pole=None, chain=2):
    c = pb[bone].constraints.new('IK')
    c.target = target
    c.chain_count = chain
    if pole:
        c.pole_target = pole
        c.pole_angle = math.radians(-90)
    return c


def clear_constraints():
    for b in pb:
        for c in list(b.constraints):
            b.constraints.remove(c)
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o, do_unlink=True)


def bake(name, f0, f1):
    """Bakes the visual pose (constraints included) of frames f0..f1 into a new action `name`."""
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=True, visual_keying=True,
                     clear_constraints=False, use_current_action=False, bake_types={'POSE'})
    act = arm.animation_data.action
    act.name = name
    bpy.ops.object.mode_set(mode='OBJECT')
    clear_constraints()
    return act


def rifle_arms(fwd, up, right, drop=0.0):
    """IK targets: right hand at the shoulder pocket, left hand 45 cm further on the handguard, elbows down."""
    sr = world('upperarm_r')
    sl = world('upperarm_l')
    chest = (sr + sl) / 2
    hand_r = sr + fwd * 0.28 - up * (0.07 + drop) - right * 0.04
    hand_l = hand_r + fwd * 0.42 - right * 0.08 + up * 0.03
    tr, tl = empty('t_r', hand_r), empty('t_l', hand_l)
    pr = empty('p_r', sr - up * 0.5 + right * 0.3 + fwd * 0.1)
    pl = empty('p_l', sl - up * 0.5 - right * 0.2 + fwd * 0.2)
    ik('lowerarm_r', tr, pr)
    ik('lowerarm_l', tl, pl)
    # keep the right hand pointing the rifle forward: copy the pistol-aim hand orientation
    return chest


fwd, up, right = forward_up()
made = []

# --- Rifle_Aim / Rifle_Aim_Crouch: legs and spine from Idle / Crouch_Idle, arms by IK -------------------------
for name, base in (('Rifle_Aim', 'Idle_Loop'), ('Rifle_Aim_Crouch', 'Crouch_Idle_Loop')):
    use_action(base)
    scene.frame_set(0)
    bpy.context.view_layer.update()
    rifle_arms(fwd, up, right)
    act = bake(name, 0, 1)
    made.append(name)

# --- Prone: body rotated face-down around the pelvis, on the elbows -------------------------------------------
def prone_pose(frame, phase):
    """Sets a prone pose on top of the rest pose; phase 0..1 drives the crawl (alternating limbs)."""
    # every bone stays in QUATERNION mode (the glTF clips are keyed that way; Euler mode would hide them)
    from mathutils import Quaternion
    for b in pb:
        b.rotation_mode = 'QUATERNION'
        b.rotation_quaternion = (1, 0, 0, 0)
        b.location = (0, 0, 0)
    s = math.sin(phase * math.tau)

    def turn(bone, world_axis, deg):
        """Rotates a pose bone by deg around a WORLD axis (converted to the bone's rest space)."""
        p = pb[bone]
        rest = (arm.matrix_world @ p.bone.matrix_local).to_3x3()
        ax = (rest.inverted() @ world_axis).normalized()
        p.rotation_quaternion = Quaternion(ax, math.radians(deg)) @ p.rotation_quaternion
        bpy.context.view_layer.update()

    # lie down face-first: rotate the pelvis 88 deg around the right axis (the whole body follows)
    turn('pelvis', right, -88)
    # chest and head up to look forward along the ground
    turn('spine_02', right, 10)
    turn('spine_03', right, 10)
    turn('neck_01', right, 50)
    # legs apart; when crawling, one knee drawn up and out, alternating
    for side, sg in (('l', 1), ('r', -1)):
        turn(f'thigh_{side}', fwd, -12 * sg)
        k = max(0.0, s * sg)
        if k > 0:
            turn(f'thigh_{side}', up, 35 * k * sg)
            turn(f'calf_{side}', right, -60 * k)
    # drop the body onto the ground: lowest of chest/knees/feet at ~0.12 m
    low = min((arm.matrix_world @ pb[b].head).z for b in ('spine_03', 'calf_l', 'calf_r', 'pelvis', 'foot_l', 'foot_r'))
    pel = pb['pelvis']
    rest = (arm.matrix_world @ pel.bone.matrix_local).to_3x3()
    pel.location = rest.inverted() @ Vector((0, 0, 0.12 - low))
    bpy.context.view_layer.update()
    for b in pb:
        b.keyframe_insert('rotation_quaternion', frame=frame)
        b.keyframe_insert('location', frame=frame)


for name, frames in (('Prone_Aim', 2), ('Prone_Crawl', 25)):
    act = bpy.data.actions.new(name + '_src')     # keyed body; the baked result takes the real name
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_slot'):
        slot = act.slots.new(id_type='OBJECT', name=arm.name)
        arm.animation_data.action_slot = slot
    for f in range(frames):
        scene.frame_set(f)
        prone_pose(f, f / max(frames - 1, 1) if name == 'Prone_Crawl' else 0.0)
    # arms on the elbows towards the rifle (IK on top of the keyed body), baked with the body
    scene.frame_set(0)
    bpy.context.view_layer.update()
    sr, sl = world('upperarm_r'), world('upperarm_l')
    ground = 0.06
    tr = empty('t_r', Vector((sr.x, sr.y, ground + 0.2)) + fwd * 0.35)
    tl = empty('t_l', Vector((sl.x, sl.y, ground + 0.2)) + fwd * 0.7 + right * 0.15)
    pr = empty('p_r', Vector((sr.x, sr.y, ground)) + right * 0.25 + fwd * 0.1)
    pl = empty('p_l', Vector((sl.x, sl.y, ground)) - right * 0.25 + fwd * 0.2)
    ik('lowerarm_r', tr, pr)
    ik('lowerarm_l', tl, pl)
    if name == 'Prone_Crawl':
        # elbows reach forward alternately
        for f in range(frames):
            s = math.sin(f / (frames - 1) * math.tau)
            tr.location = Vector((sr.x, sr.y, ground + 0.15)) + fwd * (0.3 + 0.2 * max(0, -s))
            tl.location = Vector((sl.x, sl.y, ground + 0.15)) + fwd * (0.3 + 0.2 * max(0, s))
            tr.keyframe_insert('location', frame=f)
            tl.keyframe_insert('location', frame=f)
    src = act
    act = bake(name, 0, frames - 1)
    bpy.data.actions.remove(src)
    act.name = name
    made.append(name)

print('MADE', made)

# previews (front + side of each new clip) to check the poses
if PREV:
    os.makedirs(PREV, exist_ok=True)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 360, 360
    w = bpy.data.worlds.new('w')
    w.color = (0.8, 0.82, 0.85)
    scene.world = w
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.6
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    for name in made:
        use_action(name)
        scene.frame_set(0)
        for view, loc, rot in (('frente', fwd * 5 + Vector((0, 0, 0.9)), None), ('lado', right * 5 + Vector((0, 0, 0.9)), None)):
            cam.location = loc
            d = (Vector((0, 0, 0.9)) - loc).normalized()
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = os.path.join(PREV, f'{name}_{view}.png')
            bpy.ops.render.render(write_still=True)

# export armature + all actions, no mesh
for o in mesh:
    bpy.data.objects.remove(o, do_unlink=True)
arm.animation_data.action = None
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_force_sampling=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
