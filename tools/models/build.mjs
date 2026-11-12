// usage: node build.mjs [modelId ...]   -> public/models/<id>.glb  (+ writes tools/.cache/models/build-info.json)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { Document, NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, getBounds, weld, simplify, unpartition, prune, dedup, textureCompress, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer'; import sharp from 'sharp';
import { defs } from './defs.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, '../.cache/models'); const OUT = path.join(here, '../../public/models');
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(defs);
const info = fs.existsSync(path.join(CACHE, 'build-info.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE, 'build-info.json'))) : {};

function quatEuler(rx, ry, rz) { const d = Math.PI / 180, [cx, sx, cy, sy, cz, sz] = [Math.cos(rx * d / 2), Math.sin(rx * d / 2), Math.cos(ry * d / 2), Math.sin(ry * d / 2), Math.cos(rz * d / 2), Math.sin(rz * d / 2)]; return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz]; }
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function tintVertexColors(root, mode, tint) { for (const me of root.listMeshes()) for (const p of me.listPrimitives()) { const a = p.getAttribute('COLOR_0'); if (!a) continue; const v = [0, 0, 0, 1]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); const mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]); const l = lum(v); if (mode === 'gray') { const g = Math.min(1, Math.pow(l, 0.85) * 0.95); a.setElement(i, [g, g, g * 0.98, v[3]]); } else if (mode === 'olive' && mx - mn < 0.12 && l > 0.45) { const f = Math.min(1.3, l / 0.8); a.setElement(i, [tint[0] * f, tint[1] * f, tint[2] * f, v[3]]); } } } }
const boundsOf = (scene) => getBounds(scene);
const size = (b) => b.max.map((v, i) => v - b.min[i]);

function addBox(doc, buf, scene, w, d, color, y = 0.0, h = 0.4) {
  // box with its base centred at the origin, height h (node transform set by caller)
  const hw = w / 2, hd = d / 2;
  const pos = new Float32Array([-hw,0,-hd, hw,0,-hd, hw,0,hd, -hw,0,hd, -hw,h,-hd, hw,h,-hd, hw,h,hd, -hw,h,hd]);
  const idx = new Uint16Array([4,6,5, 4,7,6, 0,1,2, 0,2,3, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0]);
  const mat = doc.createMaterial('ground').setBaseColorFactor([...color, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf)).setMaterial(mat);
  const mesh = doc.createMesh('ground').addPrimitive(prim); scene.addChild(doc.createNode('ground').setMesh(mesh).setTranslation([0, y - 0.0, 0]));
}

for (const id of ids) {
  const def = defs[id]; if (!def) throw new Error('unknown ' + id);
  const doc = new Document(); doc.setLogger(new Logger(Logger.Verbosity.WARN)); const buf = doc.createBuffer(); const scene = doc.createScene(id); doc.getRoot().setDefaultScene?.(scene);
  const top = doc.createNode('root'); scene.addChild(top);
  for (const sl of def.slabs || []) { addBox(doc, buf, scene, sl.w, sl.d, sl.color, 0, sl.h); const g = scene.listChildren().at(-1); g.setTranslation([sl.x, sl.y || 0, sl.z]); const q = quatEuler(sl.rx || 0, sl.ry || 0, 0); g.setRotation(q); scene.removeChild(g); top.addChild(g); }
  if (false) { addBox(doc, buf, scene, def.runway.w, def.runway.d, def.runway.color || [0.30, 0.31, 0.33]); const g = scene.listChildren().at(-1); g.setTranslation([0, 0, def.runway.z]); scene.removeChild(g); top.addChild(g); }
  for (const part of def.parts) {
    const pdoc = await io.read(path.join(CACHE, part.src));
    if (!def.keepAnim) pdoc.getRoot().listAnimations().forEach((a) => a.dispose());
    const psc = pdoc.getRoot().getDefaultScene() || pdoc.getRoot().listScenes()[0];
    const b = boundsOf(psc); const sz = size(b);
    const s = part.dim ? part.dim / Math.max(...sz) : 1;
    if (part.grayVC) tintVertexColors(pdoc.getRoot(), 'gray'); if (part.oliveVC) tintVertexColors(pdoc.getRoot(), 'olive', part.oliveVC);
    const before = new Set(doc.getRoot().listScenes()); mergeDocuments(doc, pdoc);
    const added = doc.getRoot().listScenes().filter((x) => !before.has(x));
    const inner = doc.createNode('part-inner').setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
    for (const sc of added) { sc.listChildren().forEach((c) => { sc.removeChild(c); inner.addChild(c); }); sc.dispose(); }
    const yaw = (part.yaw || 0) * Math.PI / 180;
    const outer = doc.createNode('part').setScale([s, s, s]).setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]).setTranslation([part.pos?.[0] || 0, part.y || 0, part.pos?.[1] || 0]);
    if (part.rx) outer.setRotation(quatEuler(part.rx, part.yaw || 0, 0));
    if (part.attach) { const bone = doc.getRoot().listNodes().find((n) => n.getName() === part.attach); if (!bone) throw new Error('no bone ' + part.attach); inner.setTranslation([0, 0, 0]); outer.setTranslation(part.at || [0, 0, 0]).setRotation(quatEuler(...(part.rot || [0, 0, 0]))); outer.addChild(inner); bone.addChild(outer); continue; }
    outer.addChild(inner); top.addChild(outer);
  }
  // material tweaks
  const root = doc.getRoot();
  for (const m of root.listMaterials()) {
    if (def.dropMaterials?.includes(m.getName())) { root.listMeshes().forEach((me) => me.listPrimitives().forEach((p) => { if (p.getMaterial() === m) me.removePrimitive(p); })); continue; }
    if (m.getBaseColorFactor()[3] < 0.05) { m.setBaseColorFactor([...m.getBaseColorFactor().slice(0, 3), 1]); m.setAlphaMode('OPAQUE'); }
    const c = def.recolor?.[m.getName()]; if (c) m.setBaseColorFactor([...c, 1]);
    if (def.tintGray) { const f = m.getBaseColorFactor(); const mx = Math.max(f[0], f[1], f[2]), mn = Math.min(f[0], f[1], f[2]); if (mx - mn < 0.08 && mx > 0.2) { const k = Math.min(1.4, Math.max(0.35, lum(f) / 0.55)); m.setBaseColorFactor([def.tintGray[0] * k, def.tintGray[1] * k, def.tintGray[2] * k, 1]); } }
  }
  if (def.defaultMaterial) { const dm = doc.createMaterial('default').setBaseColorFactor([...def.defaultMaterial, 1]).setRoughnessFactor(0.8).setMetallicFactor(0); root.listMeshes().forEach((me) => me.listPrimitives().forEach((p) => { if (!p.getMaterial()) p.setMaterial(dm); })); }
  if (def.texture) { const t = doc.createTexture('skin').setImage(fs.readFileSync(path.join(CACHE, def.texture))).setMimeType('image/png'); root.listMaterials().forEach((m) => m.setBaseColorTexture(t).setBaseColorFactor([1, 1, 1, 1])); }
  // remove empty meshes/nodes created by dropMaterials
  await doc.transform(prune(), dedup());
  const fns = [weld()]; if (def.simplify) fns.push(simplify({ simplifier: MeshoptSimplifier, ratio: def.simplify, error: 0.01 }));
  fns.push(textureCompress({ encoder: sharp, resize: [1024, 1024], ...(def.texFormat ? { targetFormat: def.texFormat, quality: 85 } : {}) }), prune(), dedup(), unpartition());
  await doc.transform(...fns);
  // recentre: x/z centre, y floor = 0
  const fb = boundsOf(scene);
  top.setTranslation([-(fb.min[0] + fb.max[0]) / 2, -fb.min[1], -(fb.min[2] + fb.max[2]) / 2]);
  const fb2 = boundsOf(scene);
  const outFile = path.join(OUT, id + '.glb'); await io.write(outFile, doc);
  let tris = 0; root.listMeshes().forEach((me) => me.listPrimitives().forEach((p) => { tris += (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3; }));
  info[id] = { nativeSize: size(fb2).map((v) => +v.toFixed(3)), triangles: Math.round(tris), bytes: fs.statSync(outFile).size, animations: root.listAnimations().map((a) => a.getName()) };
  console.log(id.padEnd(16), info[id].nativeSize.join('x').padEnd(22), String(info[id].triangles).padStart(7), 'tris', (info[id].bytes / 1024).toFixed(0).padStart(6), 'KB');
}
fs.writeFileSync(path.join(CACHE, 'build-info.json'), JSON.stringify(info, null, 1));
