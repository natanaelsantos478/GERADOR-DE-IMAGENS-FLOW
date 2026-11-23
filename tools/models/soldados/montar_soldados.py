import bpy, math, bmesh, json, os, sys
from mathutils import Vector, Matrix

A = sys.argv[sys.argv.index('--') + 1:]
K, OUT = A[0], A[1]
ONLY = A[2] if len(A) > 2 else ''

# ---- styles: roupa (tinta), capacete, arma, colete, mochila, rosto ----
STYLES = [
    dict(id='russo', nome='Fuzileiro russo', tint=dict(h=0.03, s=1.1, v=1.0, m=(0.85, 1.0, 0.8)), helm='h_6b47', weapon='w_ak74', vest='city', pack=True, face=None),
    dict(id='otan', nome='Fuzileiro EUA', tint=dict(h=0.0, s=0.45, v=1.3, m=(1.0, 0.85, 0.62)), helm='h_tactical_headset', weapon='w_m4a1', vest='plate', pack=False, face=None),
    dict(id='deserto', nome='Metralhador OTAN deserto', tint=dict(h=0.0, s=0.3, v=1.55, m=(1.0, 0.9, 0.72)), helm='h_wz2005', helm_tint=True, weapon='w_m249', vest='city', pack=True, face=None),
    dict(id='urbano', nome='Antitanque russo urbano', tint=dict(h=0.0, s=0.0, v=1.15, m=(0.85, 0.87, 0.92)), helm='h_k63', weapon='w_rpg7', vest='city', pack=True, face=None),
    dict(id='atirador', nome='Atirador russo', tint=dict(h=0.05, s=1.2, v=0.75, m=(0.7, 0.9, 0.6)), helm=None, weapon='w_svd', vest=None, pack=False, face='c_balaclava', ghillie=True),
    dict(id='tanquista', nome='Tanquista EUA', tint=dict(h=0.02, s=0.25, v=0.6, m=(0.8, 0.85, 0.6)), helm='h_cvc_tanker', weapon='w_m4a1', vest=None, pack=False, face=None),
]
# per-model corrections found by looking at each model alone (front = -y)
FIT = {'v_plate_carrier': dict(rot=-90, w=0.44, z0=1.06, dy=-0.02), 'h_k63': dict(rot=180, w=0.275, dz=0.045)}
def fit(k, d):
    r = dict(d); r.update(FIT.get(k, {})); return r
# weapon: real length (m), grip position along the length measured from the -y end after rotation
# length (m), grip distance from the stock end (fraction), flip 180 so the muzzle points forward (-y)
WEAP = {'w_ak74': (0.94, 0.36, 180), 'w_m4a1': (0.84, 0.40, 180), 'w_m249': (1.04, 0.40, 180), 'w_rpg7': (0.95, 0.55, 0),
        'w_svd': (1.22, 0.36, 180), 'w_aks74u': (0.73, 0.40, 180), 'w_pkm': (1.17, 0.38, 180)}

def ctx(o):
    return bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o])

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.fps = 30

def imp(p, coll):
    b = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=p)
    for o in [o for o in bpy.data.objects if o not in b and o.name.startswith('Icosphere')]:
        bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in bpy.data.objects if o not in b]
    for o in new:
        for c in list(o.users_collection): c.objects.unlink(o)
        coll.objects.link(o)
    return new

def bbox(objs, filt=None):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for o in objs if o.type == 'MESH' for v in o.data.vertices]
    if filt: pts = [p for p in pts if filt(p)]
    return (Vector((min(p[i] for p in pts) for i in range(3))), Vector((max(p[i] for p in pts) for i in range(3))))

# triangle budget per piece, so no accessory is heavier than the clothes it goes with
CAP = {'Capacete': 4000, 'Balaclava': 3000, 'Arma': 6000, 'Plate carrier': 3000, 'Mochila': 3000, 'Luvas': 2000, 'Botas': 1600}
def tris(objs): return sum(len(f.vertices) - 2 for o in objs if o.type == 'MESH' for f in o.data.polygons)
def cap(objs, maxt):
    t = tris(objs)
    if not maxt or t <= maxt: return t, t
    for o in objs:
        if o.type != 'MESH': continue
        m = o.modifiers.new('cap', 'DECIMATE'); m.ratio = maxt / t; m.use_collapse_triangulate = True
        with ctx(o): bpy.ops.object.modifier_apply(modifier='cap')
    return t, tris(objs)

def group(objs, name, coll):
    """Bake every mesh (with its own rig / modifiers) into static world-space meshes under one empty."""
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    flat = []
    for o in objs:
        if o.type != 'MESH': continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
        me.transform(o.matrix_world)
        n = bpy.data.objects.new(o.name, me); coll.objects.link(n); flat.append(n)
    for o in objs:
        if o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    objs[:] = flat
    kind = next((k for k in CAP if name.startswith(k)), None)
    if kind:
        a, b = cap(objs, CAP[kind])
        if a != b: print("CAP", name, a, "->", b)
    r = bpy.data.objects.new(name, None); coll.objects.link(r)
    for o in objs:
        if o.parent is None: o.parent = r
    return r

# animations, once
tmp = bpy.data.collections.new('tmp'); sc.collection.children.link(tmp)
for o in imp(K + '/kit/anim_quaternius/Unreal-Godot/UAL1_Standard.glb', tmp): bpy.data.objects.remove(o, do_unlink=True)
bpy.data.collections.remove(tmp)
for a in bpy.data.actions: a.use_fake_user = True

def play(qa, name, f=1):
    ad = qa.animation_data_create(); act = bpy.data.actions[name]; ad.action = act
    if hasattr(ad, 'action_slot') and act.slots: ad.action_slot = act.slots[0]
    sc.frame_set(f); bpy.context.view_layer.update()

def tint(mat, t, tag):
    m = mat.copy(); m.name = mat.name + '_' + tag; nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf or not bsdf.inputs['Base Color'].links: return m
    src = bsdf.inputs['Base Color'].links[0].from_socket
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Hue'].default_value = 0.5 + t['h']; hsv.inputs['Saturation'].default_value = t['s']; hsv.inputs['Value'].default_value = t['v']
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
    mix.inputs[7].default_value = (*t['m'], 1)
    nt.links.new(src, hsv.inputs['Color']); nt.links.new(hsv.outputs['Color'], mix.inputs[6]); nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    if 'cover' in t:   # paint a solid colour over a pattern that does not match (80 %)
        cov = nt.nodes.new('ShaderNodeMix'); cov.data_type = 'RGBA'; cov.blend_type = 'MIX'; cov.inputs['Factor'].default_value = 0.7
        cov.inputs[7].default_value = (*t['cover'], 1)
        nt.links.new(mix.outputs[2], cov.inputs[6]); nt.links.new(cov.outputs[2], bsdf.inputs['Base Color'])
    return m

def orient(objs, root, L, F):
    """Root matrix that lays a weapon along -y/+y (long axis), tall axis up, scaled to length L."""
    mn, mx = bbox(objs); d = mx - mn; c = (mn + mx) / 2
    a = max(range(3), key=lambda i: d[i])
    R = Matrix.Identity(3)
    if a == 0: R = Matrix.Rotation(math.pi / 2, 3, 'Z')
    elif a == 2: R = Matrix.Rotation(-math.pi / 2, 3, 'X')
    d2 = Vector(abs(x) for x in (R @ d))
    if d2.x > d2.z: R = Matrix.Rotation(math.pi / 2, 3, 'Y') @ R
    R = Matrix.Rotation(math.radians(F['flip']), 3, 'Z') @ Matrix.Rotation(math.radians(F['roll']), 3, 'Y') @ R
    s = L / d[a]
    return Matrix.Translation(Vector()) @ (R.to_4x4() @ Matrix.Diagonal((s, s, s, 1))) @ Matrix.Translation(-c) @ root.matrix_world

SF = '_base_soldier1'
def point(arm, pb, d):
    M = arm.matrix_world @ pb.matrix; cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(d.normalized()); p = M.translation
    pb.matrix = arm.matrix_world.inverted() @ (Matrix.Translation(p) @ q.to_matrix().to_4x4() @ Matrix.Translation(-p) @ M)
    bpy.context.view_layer.update()

def build(st, x0):
    tag = st['id']; coll = bpy.data.collections.new('Soldado ' + st['nome']); sc.collection.children.link(coll)
    # 1. city clothes, arms raised to the T-pose of the base body
    city = imp(K + '/review/soldier_city.glb', coll); ca = [o for o in city if o.type == 'ARMATURE'][0]
    ca.animation_data.action = None
    for pb in ca.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for s, ch in ((1, ['Bone.013', 'Bone.014', 'Bone.015']), (-1, ['Bone.036', 'Bone.037', 'Bone.038'])):
        for n in ch: point(ca, ca.pose.bones[n + SF], Vector((s, 0, 0)))
    KEEP = {'shir war1 low_0': 'Camisa', 'sh war1 low_0': 'Calca', 'boot war1_0': 'Botas', 'hand war1 low_0': 'Luvas',
            'bproof war1 low_0': 'Colete', 'body add war1 low_0': 'Protecoes'}
    if st['vest'] != 'city': KEEP.pop('bproof war1 low_0')
    if st.get('ghillie'):   # the ghillie suit replaces shirt, trousers and pads; boots and gloves stay
        KEEP = {'boot war1_0': 'Botas', 'hand war1 low_0': 'Luvas'}
    clothes = []
    for o in city:
        if o.type == 'MESH' and o.name in KEEP:
            for m in list(o.modifiers):
                if m.type == 'ARMATURE':
                    with ctx(o): bpy.ops.object.modifier_apply(modifier=m.name)
            mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
            with ctx(o): bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            o.vertex_groups.clear(); o.name = KEEP[o.name] + ' ' + tag; clothes.append(o)
    for o in city:
        if o not in clothes and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    for o in clothes:
        kind = next((k for k in CAP if o.name.startswith(k)), None)
        if kind:
            a, b = cap([o], CAP[kind])
            if a != b: print("CAP", o.name, a, "->", b)
        for v in o.data.vertices:
            c = v.co * 1.02; ax = abs(c.x)
            if ax > 0.213 and c.z > 1.2: c.x = math.copysign(0.213 + (ax - 0.213) * 0.494 / (0.55 * 1.02), c.x)
            v.co = c
        if not o.name.startswith(('Botas', 'Luvas')):
            for ms in o.material_slots:
                if ms.material:
                    mat = ms.material; ms.link = 'OBJECT'; ms.material = tint(mat, st['tint'], tag)
    hat = None
    if st.get('ghillie'):   # prepared by preparar_ghillie.py: already in T-pose, fitted to the base body, reduced
        with bpy.data.libraries.load(K + '/kit/ghillie_preparado.blend', link=False) as (src, dst):
            dst.objects = ['Ghillie', 'Ghillie roupa de baixo', 'Ghillie chapeu boonie']
        for o in dst.objects:
            coll.objects.link(o); o.name = o.name + ' ' + tag
        g_suit, g_under, hat = dst.objects
        for ms in g_under.material_slots:
            if ms.material: ms.material = tint(ms.material, st['tint'], tag)
        clothes += [g_suit, g_under]
    # 2. base body + weights copied to the clothes
    q = imp(K + '/kit/base_quaternius/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf', coll)
    qa = [o for o in q if o.type == 'ARMATURE'][0]; qa.name = 'Soldado ' + st['nome']
    body = [o for o in q if o.name.startswith('SuperHero_Male')][0]
    for o in clothes:
        dt = o.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = body; dt.use_vert_data = True
        dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
        dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
        with ctx(o):
            bpy.ops.object.datalayout_transfer(modifier='dt'); bpy.ops.object.modifier_apply(modifier='dt')
        o.parent = qa; o.matrix_parent_inverse = qa.matrix_world.inverted()
        m = o.modifiers.new('Armature', 'ARMATURE'); m.object = qa
    bm = bmesh.new(); bm.from_mesh(body.data)
    kill = [v for v in bm.verts if not ((body.matrix_world @ v.co).z > 1.53 and abs((body.matrix_world @ v.co).x) < 0.16)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(body.data); bm.free()

    def bone_parent(o, bone):
        bpy.context.view_layer.update(); mw = o.matrix_world.copy()
        o.parent = qa; o.parent_type = 'BONE'; o.parent_bone = bone; o.matrix_world = mw

    def on_head(fn, label, d, tinted=False):
        f = imp(K + '/kit/sketchfab/' + fn + '.glb', coll); r = group(f, label + ' ' + tag, coll)
        F = fit(fn, d)
        mn, mx = bbox(f); hgt = mx.z - mn.z
        for o in list(f):
            omn, omx = bbox([o])
            if omx.z < mn.z + 0.4 * hgt: f.remove(o); bpy.data.objects.remove(o, do_unlink=True)
        if tinted:
            ht = dict(st['tint']); ht['cover'] = (0.36, 0.28, 0.17)
            for o in f:
                for ms in o.material_slots:
                    if ms.material: ms.material = tint(ms.material, ht, tag)
        r.rotation_euler.z = math.radians(F['rot']); bpy.context.view_layer.update()
        mn, mx = bbox(f); s = F['w'] / (mx.x - mn.x); r.scale = (s, s, s); mn, mx = bbox(f)
        r.location += Vector((0, -0.005 + F['dy'], 1.81 + F['dz'])) - Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z))
        bone_parent(r, 'Head')

    torso = [o for o in clothes if o.name.startswith(('Colete', 'Camisa'))]
    if st['helm']: on_head(st['helm'], 'Capacete', dict(w=0.25, rot=0, dz=0.03, dy=0.0), st.get('helm_tint', False))
    if st['face']: on_head(st['face'], 'Balaclava', dict(w=0.215, rot=0, dz=0.012, dy=0.0))
    if hat:   # boonie: brim 0.34 m wide, crown resting on the head (over the balaclava)
        hr = group([hat], 'Chapeu boonie ' + tag, coll); hat = [o for o in coll.objects if o.parent == hr]
        mn, mx = bbox(hat); s = 0.34 / (mx.x - mn.x); hr.scale = (s, s, s); mn, mx = bbox(hat)
        hr.location += Vector((0, -0.005, 1.81 + 0.05)) - Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z))
        mn, mx = bbox(hat); print("HAT", tag, "z %.3f..%.3f width %.3f" % (mn.z, mx.z, mx.x - mn.x))
        bone_parent(hr, 'Head')
    # plate carrier fitted to the torso
    if st['vest'] == 'plate':
        p = imp(K + '/kit/sketchfab/v_plate_carrier.glb', coll); pr = group(p, 'Plate carrier ' + tag, coll)
        F = fit('v_plate_carrier', dict(rot=0, w=0.46, z0=1.02, dy=0.0))
        pr.rotation_euler.z = math.radians(F['rot']); bpy.context.view_layer.update()
        ct = dict(st['tint']); ct['cover'] = (0.17, 0.12, 0.07)   # coyote carrier over the coyote uniform
        for o in p:
            for ms in o.material_slots:
                if ms.material: ms.material = tint(ms.material, ct, tag)
        tmn, tmx = bbox(torso, lambda v: 1.05 < v.z < 1.45 and abs(v.x) < 0.2)
        mn, mx = bbox(p); s = F['w'] / (mx.x - mn.x)
        sy = ((tmx.y - tmn.y) + 0.12) / (mx.y - mn.y)   # wraps the torso with ~6 cm each side
        pr.scale = (s, sy, s); mn, mx = bbox(p)
        pr.location += Vector((0, (tmn.y + tmx.y) / 2 + F['dy'], F['z0'])) - Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
        mn, mx = bbox(p); print("PLATE", tag, "torso y %.3f..%.3f carrier y %.3f..%.3f z %.2f..%.2f" % (tmn.y, tmx.y, mn.y, mx.y, mn.z, mx.z))
        bone_parent(pr, 'spine_03')
    # backpack: back panel against the torso, straps squeezed to the torso depth
    if st['pack']:
        b = imp(K + '/kit/sketchfab/v_backpack.glb', coll); br = group(b, 'Mochila ' + tag, coll)
        bag = [o for o in b if o.type == 'MESH' and 'Material #10' in o.name][0]
        straps = [o for o in b if o.type == 'MESH' and 'Material #12' in o.name][0]
        br.rotation_euler.z = math.pi; bpy.context.view_layer.update()
        mn, mx = bbox(b); s = 0.46 / (mx.z - mn.z); br.scale = (s, s, s); bpy.context.view_layer.update()
        back = torso + [c for c in clothes if c.name.startswith('Protecoes')]
        tmn, tmx = bbox(back, lambda v: 1.05 < v.z < 1.42 and abs(v.x) < 0.16)
        bmn, bmx = bbox([bag]); amn, amx = bbox(b)
        br.location += Vector((0, tmx.y + 0.004 - bmn.y, 1.40 - amx.z)); bpy.context.view_layer.update()
        bmn, bmx = bbox([bag]); smn, smx = bbox([straps]); depth = bmn.y - smn.y; want = (tmx.y - tmn.y) * 0.85
        if depth > want:
            k = want / depth; Mw = straps.matrix_world.copy(); inv = Mw.inverted()
            for v in straps.data.vertices:
                w = Mw @ v.co; w.y = bmn.y - (bmn.y - w.y) * k; v.co = inv @ w
        bone_parent(br, 'spine_03')
        bmn, bmx = bbox([bag]); print("PACK", tag, "torso back y %.3f bag panel y %.3f gap %.3f" % (tmx.y, bmn.y, bmn.y - tmx.y))
    # weapon placed in the aim pose so it points forward
    play(qa, 'Pistol_Aim_Neutral', 10)
    L, gf, fl = WEAP[st['weapon']]; F = fit(st['weapon'], dict(flip=fl, roll=0, grip=gf, down=0.07))
    g = imp(K + '/kit/sketchfab/' + st['weapon'] + '.glb', coll); gr = group(g, 'Arma ' + tag, coll)
    gr.matrix_world = orient(g, gr, L, F)
    mn, mx = bbox(g); gy = mx.y - (mx.y - mn.y) * F['grip']
    HM = qa.matrix_world @ qa.pose.bones['hand_r'].matrix; palm = HM @ Vector((0, 0.06, 0))
    gr.location += palm - Vector(((mn.x + mx.x) / 2, gy, mx.z - F['down'])); bone_parent(gr, 'hand_r')
    play(qa, 'Idle_Loop', 1); qa.location.x = x0
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = st['nome']; cu.size = 0.11; cu.align_x = 'CENTER'
    t = bpy.data.objects.new('Etiqueta ' + st['nome'], cu); t.location = (x0, -0.6, 0); coll.objects.link(t)
    parts = [o for o in coll.objects if o.type == 'MESH']
    print("BUILT", tag, "triangles", tris(parts), {o.name: tris([o]) for o in parts})

for i, st in enumerate(STYLES):
    if ONLY and st['id'] not in ONLY.split(','): continue
    build(st, i * 1.3)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("SAVED")
