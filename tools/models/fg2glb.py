# usage: python -I fg2glb.py <aircraftDir> <out.glb> <front: -x|+x|+z|-z> [mainModelXmlRelPath] [--exclude=regex] [--onlyac=regex]
# Composes a FlightGear aircraft exterior (model XML -> AC3D files, static pose) into one GLB via bpy (own AC3D parser).
# Untrusted input data is only parsed (never executed). Output: glTF Y-up, front aligned to +Z, no scaling (scaled by build-variants.mjs).
import sys, os, re, glob, math, json
import xml.etree.ElementTree as ET
import bpy, bmesh
from mathutils import Matrix, Vector

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
adir, out, front = args[0], args[1], args[2]
main_rel = args[3] if len(args) > 3 else None
EXC = re.compile(opt.get('exclude', r'(?i)interior|panel|instrument|cockpit|hud|effect|weapon|store|armament|payload|livery|liveries|light|sound|shadow|smoke|contrail|pilot|seat|wash|missile|aim-?\d|gui|gauge|mfd|rwr|chaff|flare|refuel|dialog|services|pushback|airport/|ext-?pwr|operations|catering|followme|stairs|gpu|tug|ejecta|stick|throttle|flame|afterburn|vapor|vapour|bomb|drop|fuel-?tank|tank-?ext|_ai|-ai\b|tire-?smoke|steam|cloud|glow|thumb|splash|pics?/|prop-?disc|disc|blur|interior|wake|flag'))
ONLY = re.compile(opt['onlyac']) if 'onlyac' in opt else None
root_dir = adir
name_dir = os.path.basename(os.path.normpath(adir))

def resolve(p, xml_dir):
    p = p.strip().replace('\\', '/')
    cands = [os.path.join(xml_dir, p), os.path.join(root_dir, p)]
    m = re.match(r'(?:Aircraft/)?[^/]+/(.*)$', p)
    if m: cands.append(os.path.join(root_dir, m.group(1)))
    for c in cands:
        if os.path.isfile(c): return os.path.normpath(c)
    base = os.path.basename(p)
    hit = glob.glob(os.path.join(root_dir, '**', base), recursive=True)
    return hit[0] if hit else None

def offs(el):
    o = {k: 0.0 for k in ('x-m', 'y-m', 'z-m', 'heading-deg', 'pitch-deg', 'roll-deg')}
    e = el.find('offsets') if el is not None else None
    if e is not None:
        for k in o:
            c = e.find(k)
            try:
                if c is not None and c.text and c.text.strip()[0] not in '<': o[k] = float(c.text)
            except Exception: pass
    return o

def fg_to_ac(o):  # FG body (x aft, y right, z up) offsets -> AC (x, y up, z) matrix
    t = Matrix.Translation(Vector((o['x-m'], o['z-m'], -o['y-m'])))
    r = Matrix.Rotation(math.radians(o['heading-deg']), 4, 'Y') @ Matrix.Rotation(math.radians(o['roll-deg']), 4, 'X') @ Matrix.Rotation(math.radians(-o['pitch-deg']), 4, 'Z')
    return t @ r

def collect(xml_path, parent, depth, out_list):
    if depth > 6: return
    try:
        raw = open(xml_path, errors='ignore').read()
        raw = re.sub(r'<\?xml[^>]*\?>', '', raw)
        tree = ET.fromstring(raw)
    except Exception as e:
        print('XMLERR', xml_path, e); return
    xdir = os.path.dirname(xml_path)
    # <PropertyList include="common.xml">: the included file's models belong to this one (737NG family)
    inc = tree.get('include')
    if inc:
        fi = resolve(inc, xdir)
        if fi and fi != xml_path: collect(fi, parent, depth + 1, out_list)
    pth = tree.find('path')
    if pth is not None and pth.text:
        p = pth.text.strip()
        if not EXC.search(p):
            f = resolve(p, xdir)
            if f:
                M = parent @ fg_to_ac(offs(tree))
                if f.lower().endswith('.ac'):
                    if not (ONLY and not ONLY.search(f)): out_list.append((f, M))
                elif f.lower().endswith('.xml') and f != xml_path:
                    collect(f, M, depth + 1, out_list)
    for sub in tree.findall('model'):
        sp = sub.find('path')
        if sp is None or not sp.text or EXC.search(sp.text) or EXC.search(sub.findtext('name') or ''): continue
        f = resolve(sp.text, xdir)
        if not f: continue
        M = parent @ fg_to_ac(offs(sub))
        if f.lower().endswith('.ac'):
            if not (ONLY and not ONLY.search(f)): out_list.append((f, M))
        else: collect(f, M, depth + 1, out_list)

def main_candidates():
    if main_rel: return [os.path.join(root_dir, main_rel)]
    out = []
    for s in sorted(glob.glob(os.path.join(root_dir, '*-set.xml'))) + sorted(glob.glob(os.path.join(root_dir, '*.xml'))):
        t = open(s, errors='ignore').read()
        for m in re.finditer(r'<model[^>]*>(?:(?!</model>).)*?<path>\s*([^<]+?)\s*</path>', t, re.S):
            f = resolve(m.group(1), root_dir)
            if f and f not in out: out.append(f)
    for f in sorted(glob.glob(os.path.join(root_dir, 'Models', '*.xml'))):
        if f not in out: out.append(f)
    return out
main = None; parts = []
for cand in main_candidates():
    pl = []; collect(cand, Matrix.Identity(4), 0, pl)
    if pl: main, parts = cand, pl; break
if not main: print('NOMAIN'); sys.exit(2)
# dedupe identical (file, matrix)
seen = set(); uniq = []
for f, M in parts:
    k = (f, tuple(round(v, 4) for r in M for v in r))
    if k in seen: continue
    seen.add(k); uniq.append((f, M))
parts = uniq
print('MAIN', os.path.relpath(main, root_dir), 'PARTS', [os.path.relpath(f, root_dir) for f, _ in parts][:12], len(parts))

# ---------- AC3D parser ----------
def tok(line): return re.findall(r'"[^"]*"|\S+', line)
def parse_ac(path):
    lines = open(path, errors='ignore').read().split('\n')
    if not lines[0].startswith('AC3D'): return None
    mats = []; i = 1; objs = []
    def parse_obj(i, parent_M):
        t = tok(lines[i]); i += 1
        o = {'type': t[1], 'name': '', 'tex': None, 'rot': Matrix.Identity(3), 'loc': Vector((0, 0, 0)), 'verts': [], 'surfs': [], 'kids': [], 'texrep': (1, 1)}
        while i < len(lines):
            L = lines[i].strip(); i += 1
            if not L: continue
            t = tok(L); k = t[0]
            if k == 'name': o['name'] = t[1].strip('"') if len(t) > 1 else ''
            elif k == 'texture': o['tex'] = t[1].strip('"')
            elif k == 'rot': v = list(map(float, t[1:10])); o['rot'] = Matrix([v[0:3], v[3:6], v[6:9]])
            elif k == 'loc': o['loc'] = Vector(list(map(float, t[1:4])))
            elif k == 'data': i += 1  # data len + string line
            elif k == 'numvert':
                n = int(t[1])
                for _ in range(n):
                    p = lines[i].split(); i += 1; o['verts'].append(Vector((float(p[0]), float(p[1]), float(p[2]))))
            elif k == 'numsurf':
                n = int(t[1])
                for _ in range(n):
                    flags = 0; mat = 0
                    while True:
                        s = tok(lines[i]); i += 1
                        if s[0] == 'SURF': flags = int(s[1], 0)
                        elif s[0] == 'mat': mat = int(s[1])
                        elif s[0] == 'refs':
                            r = int(s[1]); refs = []
                            for _ in range(r):
                                p = lines[i].split(); i += 1; refs.append((int(p[0]), float(p[1]), float(p[2])))
                            break
                    o['surfs'].append((flags, mat, refs))
            elif k == 'kids':
                n = int(t[1])
                for _ in range(n):
                    kid, i = parse_obj(i, None); o['kids'].append(kid)
                break
        return o, i
    while i < len(lines):
        L = lines[i].strip()
        if L.startswith('MATERIAL'):
            t = tok(L)
            def g(key, n):
                j = t.index(key); return [float(x) for x in t[j + 1:j + 1 + n]]
            mats.append({'rgb': g('rgb', 3), 'trans': g('trans', 1)[0], 'spec': g('spec', 3), 'shi': g('shi', 1)[0]}); i += 1
        elif L.startswith('OBJECT'):
            o, i = parse_obj(i, None); objs.append(o); break
        else: i += 1
    return mats, objs

img_cache = {}
def load_img(tex, acdir):
    cands = [os.path.join(acdir, tex), os.path.join(root_dir, tex), os.path.join(root_dir, 'Models', tex), os.path.join(root_dir, 'Textures', tex)]
    base = os.path.basename(tex)
    for c in cands:
        if os.path.isfile(c): break
    else:
        hit = glob.glob(os.path.join(root_dir, '**', base), recursive=True) or glob.glob(os.path.join(root_dir, '**', os.path.splitext(base)[0] + '.*'), recursive=True)
        hit = [h for h in hit if re.search(r'(?i)\.(png|jpg|jpeg|rgb|rgba|bmp|tga|dds)$', h)]
        c = hit[0] if hit else None
    if not c: return None
    if c in img_cache: return img_cache[c]
    try:
        im = bpy.data.images.load(c); im.name = os.path.basename(c)
        w, h = im.size
        if max(w, h) > 1024:
            s = 1024 / max(w, h); im.scale(max(1, int(w * s)), max(1, int(h * s)))
        im.pack()
    except Exception as e:
        print('IMGERR', c, e); im = None
    img_cache[c] = im; return im

mat_cache = {}
def get_mat(am, tex_img, two):
    key = (tuple(round(x, 3) for x in am['rgb']), round(am['trans'], 2), tex_img.name if tex_img else None, two)
    if key in mat_cache: return mat_cache[key]
    m = bpy.data.materials.new('m%d' % len(mat_cache)); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    bs.inputs['Roughness'].default_value = 0.6; bs.inputs['Metallic'].default_value = 0.0
    if tex_img:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = tex_img
        nt.links.new(tn.outputs['Color'], bs.inputs['Base Color'])
    else:
        bs.inputs['Base Color'].default_value = (*am['rgb'], 1)
    if am['trans'] > 0.02:
        bs.inputs['Alpha'].default_value = 1 - am['trans']
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        try: m.blend_method = 'BLEND'
        except Exception: pass
    m.use_backface_culling = not two
    mat_cache[key] = m; return m

FRONT = {'-x': lambda v: (v[2], v[1], -v[0]), '+x': lambda v: (-v[2], v[1], v[0]), '+z': lambda v: (v[0], v[1], v[2]), '-z': lambda v: (-v[0], v[1], -v[2])}[front]
default_mat = {'rgb': [0.6, 0.6, 0.62], 'trans': 0, 'spec': [0, 0, 0], 'shi': 0}
bpy.ops.wm.read_factory_settings(use_empty=True)
coll = bpy.context.scene.collection
created = []
def build(o, mats, M, acdir, fname):
    Mo = M @ Matrix.Translation(o['loc']) @ o['rot'].to_4x4()
    if o['verts'] and o['surfs']:
        img = load_img(o['tex'], acdir) if o['tex'] else None
        mesh = bpy.data.meshes.new(o['name'] or 'm'); bm = bmesh.new()
        slots = {}; uvl = bm.loops.layers.uv.new('uv'); vcache = {}
        for flags, mi, refs in o['surfs']:
            if flags & 0xF != 0 or len(refs) < 3: continue
            two = bool(flags & 0x20)
            am = mats[mi] if 0 <= mi < len(mats) else default_mat
            key = (mi, two)
            if key not in slots:
                slots[key] = len(slots); mesh.materials.append(get_mat(am, img, two))
            vs = []
            for (vi, u, v) in refs:
                if vi >= len(o['verts']): vs = None; break
                p = Mo @ o['verts'][vi]; X, Y, Z = FRONT((p.x, p.y, p.z))
                if vi not in vcache: vcache[vi] = bm.verts.new((X, -Z, Y))
                vs.append((vcache[vi], u, v))
            if not vs: continue
            for a in range(1, len(vs) - 1):
                tri = (vs[0], vs[a], vs[a + 1])
                if len({id(t[0]) for t in tri}) < 3: continue
                try: f = bm.faces.new([t[0] for t in tri])
                except ValueError: continue
                f.material_index = slots[key]
                for lp, t in zip(f.loops, tri): lp[uvl].uv = (t[1], t[2])
        if bm.faces:
            bm.to_mesh(mesh); bm.free()
            ob = bpy.data.objects.new(o['name'] or 'o', mesh); coll.objects.link(ob); created.append(ob)
        else: bm.free()
    for k in o['kids']: build(k, mats, Mo, acdir, fname)
for f, M in parts:
    r = parse_ac(f)
    if not r: print('BADAC', f); continue
    mats, objs = r
    for o in objs: build(o, mats, M, os.path.dirname(f), f)
print('OBJS', len(created), 'TRIS', sum(len(o.data.polygons) for o in created))
if not created: sys.exit(3)
# drop outliers (stray objects far from the polygon-weighted core) and huge thin ground planes
def bb(o):
    vs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return [min(v[i] for v in vs) for i in range(3)], [max(v[i] for v in vs) for i in range(3)]
srt = sorted(created, key=lambda o: -len(o.data.polygons)); tot = sum(len(o.data.polygons) for o in created); acc = 0; core = []
for o in srt:
    core.append(o); acc += len(o.data.polygons)
    if acc >= 0.8 * tot: break
cmn = [min(bb(o)[0][i] for o in core) for i in range(3)]; cmx = [max(bb(o)[1][i] for o in core) for i in range(3)]
pad = [0.25 * (cmx[i] - cmn[i]) for i in range(3)]; dropped = []
for o in list(created):
    mn, mx = bb(o)
    far = any(mx[i] < cmn[i] - pad[i] or mn[i] > cmx[i] + pad[i] for i in range(3))
    thin = (mx[2] - mn[2]) < 0.01 * max(cmx[0] - cmn[0], cmx[1] - cmn[1]) and (mx[0] - mn[0]) * (mx[1] - mn[1]) > 0.3 * (cmx[0] - cmn[0]) * (cmx[1] - cmn[1]) and o not in core[:1]
    if far or thin: dropped.append(o.name); bpy.data.objects.remove(o, do_unlink=True); created.remove(o)
print('DROPPED', dropped[:8], len(dropped))
bpy.ops.object.select_all(action='DESELECT')
for o in created: o.select_set(True)
bpy.context.view_layer.objects.active = created[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
# weld + decimate
TARGET = int(opt.get('tris', 14000))
nt = len(ob.data.polygons)
if nt > TARGET:
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.0002); bpy.ops.object.mode_set(mode='OBJECT')
    for _ in range(5):
        if len(ob.data.polygons) <= TARGET * 1.05: break
        md = ob.modifiers.new('d', 'DECIMATE'); md.ratio = max(0.02, TARGET / len(ob.data.polygons)); bpy.ops.object.modifier_apply(modifier=md.name)
print('FINALTRIS', len(ob.data.polygons))
# smooth
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.0005, use_unselected=False) if False else None
bpy.ops.object.mode_set(mode='OBJECT')
try: bpy.ops.object.shade_auto_smooth(angle=math.radians(50))
except Exception as e:
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    except Exception as e2: print('smooth fail', e2)
ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False, export_cameras=False, export_lights=False, export_image_format='AUTO')
print('WROTE', out)
