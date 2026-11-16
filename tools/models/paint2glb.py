# usage: python -I paint2glb.py in.glb out.glb <scheme> [texdir]
# Paints an untextured vehicle GLB: smart-UV, procedural camo + CC0 Poly Haven detail (box-projected), bakes colour+AO / roughness / normal to
# 1024/512 px atlases and re-exports with a plain PBR material (JPEG textures, no Draco).
import sys, os, math, bpy, numpy as np
src, dst, scheme = sys.argv[1:4]
TD = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '../.cache/ph-tex')
def lin(c): return tuple(min(1.0, 1.12 * x) if False else (x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)
# scheme: tones (sRGB), thresholds for the camo ramp, camo noise scale, mud amount, dust amount, wear amount
NATO = [(0.17, 0.21, 0.11), (0.27, 0.19, 0.11), (0.05, 0.05, 0.045)]
RUS = [(0.25, 0.29, 0.15), (0.20, 0.24, 0.12), (0.30, 0.33, 0.19)]
RUS2 = [(0.25, 0.29, 0.15), (0.55, 0.47, 0.30), (0.20, 0.24, 0.12)]
OD = [(0.22, 0.25, 0.14), (0.20, 0.23, 0.13), (0.24, 0.27, 0.16)]
DES = [(0.62, 0.52, 0.34), (0.70, 0.60, 0.41), (0.52, 0.42, 0.27)]
PLA = [(0.28, 0.34, 0.20), (0.52, 0.45, 0.30), (0.17, 0.14, 0.09)]
SWE = [(0.16, 0.22, 0.12), (0.30, 0.22, 0.12), (0.05, 0.05, 0.04)]
GREY = [(0.35, 0.37, 0.36)] * 3
S = {'nato': (NATO, .5, 1, .6, .15), 'rus': (RUS, .3, 1, .65, .12), 'rus2': (RUS2, .4, 1, .6, .15), 'od': (OD, .3, 1, .6, .1),
     'des': (DES, .3, 1, .5, .3), 'des3': (DES, .35, .5, .55, .35), 'pla': (PLA, .45, 1, .6, .12), 'swe': (SWE, .9, 1, .6, .12),
     'olive': (OD, .3, 1, .6, .1)}
tones, cscale, _, mudamt, dust = S[scheme]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in bpy.data.objects if o.type == 'MESH']
for o in ms: o.select_set(True)
bpy.context.view_layer.objects.active = ms[0]
if len(ms) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
if len(ob.data.polygons) > 18000:
    m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = 15000 / len(ob.data.polygons); bpy.ops.object.modifier_apply(modifier=m.name)
me = ob.data
from mathutils import Vector
ws = [ob.matrix_world @ v.co for v in me.vertices]
mn = Vector((min(v[i] for v in ws) for i in range(3))); mx = Vector((max(v[i] for v in ws) for i in range(3)))
H = mx.z - mn.z
names = [m.name if m else '' for m in me.materials]
dark_idx = [i for i, n in enumerate(names) if n.startswith('dark')]
two = bool(dark_idx)
# --- UV
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005); bpy.ops.object.mode_set(mode='OBJECT')
try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
except Exception: bpy.ops.object.shade_smooth()
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(82), island_margin=0.002, area_weight=0.6); bpy.ops.object.mode_set(mode='OBJECT')
# --- images
def load(n, cs):
    i = bpy.data.images.load(os.path.join(TD, n)); i.colorspace_settings.name = cs; return i
IM = {k: load(f, 'Non-Color' if k.endswith(('_r', '_n')) else 'sRGB') for k, f in {
    'paint': 'green_metal_rust_diff.jpg', 'paint_r': 'green_metal_rust_rough.jpg', 'paint_n': 'green_metal_rust_nor.jpg',
    'rust': 'rusty_painted_metal_diff.jpg', 'rubber': 'rubber_tiles_diff.jpg', 'rubber_r': 'rubber_tiles_rough.jpg', 'rubber_n': 'rubber_tiles_nor.jpg',
    'steel': 'metal_plate_02_diff.jpg', 'mud': 'brown_mud_dry_diff.jpg', 'mud_n': 'brown_mud_dry_nor.jpg'}.items()}
RES = 1024
tgt = bpy.data.images.new('bake', RES, RES)
def build(mat, darkmode):
    mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear(); N = nt.nodes; L = nt.links
    def node(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n
    def inp(n, i, v):
        if isinstance(v, (int, float, tuple)): n.inputs[i].default_value = v
        else: L.new(v, n.inputs[i])
    pos = node('ShaderNodeNewGeometry').outputs['Position']
    def mapped(sc, off=0.0):
        m = node('ShaderNodeMapping'); L.new(pos, m.inputs[0]); m.inputs[3].default_value = (sc, sc, sc); m.inputs[1].default_value = (off,) * 3; return m.outputs[0]
    def tex(k, sc, off=0.0):
        t = node('ShaderNodeTexImage', image=IM[k], projection='BOX', projection_blend=0.25, interpolation='Linear'); L.new(mapped(sc, off), t.inputs[0]); return t.outputs[0]
    def noise(sc, det=3, rough=.5, dist=0.0, off=0.0):
        n = node('ShaderNodeTexNoise'); L.new(mapped(1.0, off), n.inputs[0]); inp(n, 'Scale', sc); inp(n, 'Detail', det); inp(n, 'Roughness', rough); inp(n, 'Distortion', dist); return n.outputs['Fac']
    def mix(fac, a, b, blend='MIX'):
        m = node('ShaderNodeMix', data_type='RGBA', blend_type=blend); inp(m, 0, fac)
        ci = [s for s in m.inputs if s.type == 'RGBA']
        for s, v in zip(ci, (a, b)):
            if isinstance(v, tuple): s.default_value = v
            else: L.new(v, s)
        return [s for s in m.outputs if s.type == 'RGBA'][0]
    def mr(v, a, b, c, d, clamp=True):
        m = node('ShaderNodeMapRange'); m.clamp = clamp; inp(m, 0, v)
        for i, x in zip((1, 2, 3, 4), (a, b, c, d)): m.inputs[i].default_value = x
        return m.outputs[0]
    def tobw(c):
        n = node('ShaderNodeRGBToBW'); L.new(c, n.inputs[0]); return n.outputs[0]
    sep = node('ShaderNodeSeparateXYZ'); L.new(pos, sep.inputs[0]); z = sep.outputs[2]
    zr = mr(z, mn.z, mx.z, 0.0, 1.0)
    nz = noise(5, 4, .6)
    # mud/dust band from the ground up
    add = node('ShaderNodeMath', operation='ADD'); L.new(zr, add.inputs[0]); sub = node('ShaderNodeMath', operation='SUBTRACT'); L.new(nz, sub.inputs[0]); sub.inputs[1].default_value = 0.5
    mulz = node('ShaderNodeMath', operation='MULTIPLY'); L.new(sub.outputs[0], mulz.inputs[0]); mulz.inputs[1].default_value = 0.35; L.new(mulz.outputs[0], add.inputs[1])
    band = mr(add.outputs[0], 0.0, 0.34 if not darkmode else 0.5, 1.0, 0.0)
    mudc = tex('mud', 0.5)
    mudk = node('ShaderNodeMath', operation='MULTIPLY'); L.new(band, mudk.inputs[0]); mudk.inputs[1].default_value = mudamt * (1.0 if not darkmode else 1.3)
    mudf = node('ShaderNodeMath', operation='MULTIPLY', use_clamp=True); L.new(mudk.outputs[0], mudf.inputs[0]); L.new(mr(noise(9, 4, .6, off=7.0), 0.3, 0.7, 0.55, 1.0), mudf.inputs[1])
    if not darkmode:
        # camouflage
        cn = noise(cscale, 3, .55, 0.5, off=3.0)
        ramp = node('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'; L.new(cn, ramp.inputs[0])
        e = ramp.color_ramp.elements; e[0].position = 0.0; e[0].color = (*lin(tones[0]), 1); e[1].position = 0.47; e[1].color = (*lin(tones[1]), 1)
        e2 = e.new(0.58); e2.color = (*lin(tones[2]), 1)
        base = ramp.outputs[0]
        lum = tobw(tex('paint', 0.55))
        paint = mix(0.7, base, mix(1.0, (0.5, 0.5, 0.5, 1), lum), 'OVERLAY')
        # paint wear: patches of rusty bare metal + steel scratches
        w = mr(noise(2.5, 8, .65, off=11.0), 0.60, 0.72, 0.0, 1.0)
        w2 = mr(noise(14, 6, .7, off=21.0), 0.64, 0.72, 0.0, 1.0)
        wm = node('ShaderNodeMath', operation='MULTIPLY'); L.new(w, wm.inputs[0]); wm.inputs[1].default_value = 0.8
        paint = mix(wm.outputs[0], paint, mix(0.5, tex('rust', 0.8), (0.12, 0.1, 0.09, 1)))
        w2m = node('ShaderNodeMath', operation='MULTIPLY'); L.new(w2, w2m.inputs[0]); w2m.inputs[1].default_value = 0.5
        paint = mix(w2m.outputs[0], paint, tex('steel', 0.9))
        dustc = (0.58, 0.5, 0.38, 1)
        paint = mix(dust * 0.5, paint, mix(0.7, mudc, dustc))
        col = mix(mudf.outputs[0], paint, mudc)
        rough_sock = mr(tex('paint_r', 0.55), 0, 1, 0.5, 0.9)
        rf = node('ShaderNodeMath', operation='MAXIMUM'); L.new(rough_sock, rf.inputs[0]); L.new(mudf.outputs[0], rf.inputs[1])
        rough = mr(rf.outputs[0], 0, 1, 0, 1)
        nrm = node('ShaderNodeNormalMap'); nrm.inputs[0].default_value = 0.9; L.new(tex('paint_n', 0.55), nrm.inputs[1])
    else:
        rub = mix(0.5, tex('rubber', 0.7), (0.045, 0.045, 0.045, 1), 'MULTIPLY')
        met = mix(0.5, tex('steel', 0.9), (0.18, 0.17, 0.16, 1), 'MULTIPLY')
        col = mix(mr(noise(6, 3, .5, off=5.0), 0.4, 0.6, 0, 1), rub, met)
        col = mix(mudf.outputs[0], col, mudc)
        rough = mr(tex('rubber_r', 0.7), 0, 1, 0.75, 1.0)
        nrm = node('ShaderNodeNormalMap'); nrm.inputs[0].default_value = 1.0; L.new(tex('rubber_n', 0.7), nrm.inputs[1])
    b = node('ShaderNodeBsdfPrincipled'); L.new(col, b.inputs['Base Color']); L.new(rough, b.inputs['Roughness']); L.new(nrm.outputs[0], b.inputs['Normal']); b.inputs['Metallic'].default_value = 0.0
    out = node('ShaderNodeOutputMaterial'); L.new(b.outputs[0], out.inputs[0])
    t = node('ShaderNodeTexImage', image=tgt); t.select = True; N.active = t
    return mat
mats = []
if two:
    for i, n in enumerate(names): mats.append(build(bpy.data.materials.new(f'm{i}'), i in dark_idx))
    me.materials.clear()
    for m in mats: me.materials.append(m)
else:
    me.materials.clear(); me.materials.append(build(bpy.data.materials.new('m0'), False)); me.materials.append(build(bpy.data.materials.new('m1'), True))
    # low band (wheels / running gear) -> dark material: faces whose centre lies in the lowest part of the body
    lim = mn.z + 0.17 * H; mw = ob.matrix_world
    for p in me.polygons: p.material_index = 1 if (mw @ p.center).z < lim and p.normal.z < 0.55 else 0
# --- bake
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = False
w = bpy.data.worlds.new('w'); sc.world = w; w.light_settings.distance = 1.0
for o in bpy.data.objects: o.select_set(False)
ob.select_set(True); bpy.context.view_layer.objects.active = ob
def bake(kind, cs, **kw):
    tgt.colorspace_settings.name = cs; tgt.generated_color = (0, 0, 0, 1) if kind != 'NORMAL' else (0.5, 0.5, 1, 1)
    sc.cycles.samples = 24 if kind == 'AO' else 1
    bpy.ops.object.bake(type=kind, margin=10, margin_type='EXTEND', use_clear=True, **kw)
    a = np.empty(RES * RES * 4, dtype=np.float32); tgt.pixels.foreach_get(a); return a.reshape(RES, RES, 4).copy()
col = bake('DIFFUSE', 'sRGB', pass_filter={'COLOR'}); rou = bake('ROUGHNESS', 'Non-Color'); nor = bake('NORMAL', 'Non-Color', normal_space='TANGENT'); ao = bake('AO', 'Non-Color')
# AO baked into colour (kept subtle) -- values are in image colour space (sRGB for colour, linear AO): convert AO to display-ish gamma
aoc = np.clip(ao[..., :1], 0, 1) ** (1 / 2.2)
col[..., :3] = col[..., :3] * (0.45 + 0.55 * aoc)
def mk(name, arr, size, cs):
    im = bpy.data.images.new(name, RES, RES, alpha=False); im.colorspace_settings.name = cs
    arr = arr.copy(); arr[..., 3] = 1; im.pixels.foreach_set(arr.reshape(-1)); im.update()
    if size != RES: im.scale(size, size)
    im.pack(); return im
ic = mk('color', col, RES, 'sRGB'); ir = mk('rough', rou, 512, 'Non-Color'); inn = mk('normal', nor, 512, 'Non-Color')
# --- final plain PBR material
fm = bpy.data.materials.new('painted'); fm.use_nodes = True; nt = fm.node_tree; N = nt.nodes; L = nt.links; N.clear()
def tn(im): n = N.new('ShaderNodeTexImage'); n.image = im; return n
b = N.new('ShaderNodeBsdfPrincipled'); b.inputs['Metallic'].default_value = 0.0; o = N.new('ShaderNodeOutputMaterial'); L.new(b.outputs[0], o.inputs[0])
L.new(tn(ic).outputs[0], b.inputs['Base Color'])
sp = N.new('ShaderNodeSeparateColor'); L.new(tn(ir).outputs[0], sp.inputs[0]); L.new(sp.outputs[1], b.inputs['Roughness'])
nm = N.new('ShaderNodeNormalMap'); L.new(tn(inn).outputs[0], nm.inputs[1]); L.new(nm.outputs[0], b.inputs['Normal'])
me.materials.clear(); me.materials.append(fm)
for p in me.polygons: p.material_index = 0
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=86, export_draco_mesh_compression_enable=False,
                          export_apply=False, export_animations=False, export_cameras=False, export_lights=False)
print('DONE', dst, os.path.getsize(dst))
