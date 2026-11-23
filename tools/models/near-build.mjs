// Builds the close-range ("near") models used by the detailed battle view under ~150 m:
//   public/models/near/*.glb + public/models/near/manifest.json  (kept apart from manifest.json, which make-manifest.mjs regenerates).
// Vehicles (Polyfork, CC BY 4.0) keep their SEPARATE PARTS as named nodes (turret, gun, wheels...): the game rotates the turret toward
// its target, elevates/recoils the gun and spins the wheels. Polyfork meshes only carry vertex colours, so each primitive gets a
// box-projected UV set and a tiling CC0 Poly Haven detail texture (+ normal/roughness) multiplied with the vertex colours.
// Tracked hulls: triangles of the track band get vertex alpha 0.5 = "track" mask for the scrolling-tread shader of the game.
// Soldiers: Quaternius "Toon Shooter Game Kit" (CC0): rifle run / shoot / duck / death clips, one rifle kept, 4 colourways.
// usage: node fetch-near.sh (once) && node near-build.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { copyToDocument, prune, getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../.cache/models/near'), TEX = path.join(here, '../.cache/ph-tex'), OUT = path.join(here, '../../public/models/near');
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const PF = (id) => io.read(path.join(SRC, 'polyfork', `${id}.glb`));

// ------------------------------------------------------------------ textures
async function grey(name, kind) { // 512 px greyscale bytes
  return (await sharp(path.join(TEX, `${name}_${kind}.jpg`)).resize(512, 512).greyscale().raw().toBuffer({ resolveWithObject: true }));
}
function stretch(data, lo, hi) { // percentile-normalise to [lo,hi] (0..255)
  const h = new Uint32Array(256); for (const v of data) h[v]++;
  const n = data.length; let a = 0, b = 255, c = 0;
  for (let i = 0; i < 256; i++) { c += h[i]; if (c >= n * 0.01) { a = i; break; } }
  c = 0; for (let i = 255; i >= 0; i--) { c += h[i]; if (c >= n * 0.01) { b = i; break; } }
  const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, (data[i] - a) / Math.max(1, b - a))));
  return out;
}
const rgbJpeg = (chans, w, h) => sharp(Buffer.from(chans), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 82 }).toBuffer();
async function detail(name, lo = 0.55) { // greyscale detail texture in [lo,1] (sRGB) so it only modulates the vertex colour
  const g = await grey(name, 'diff'), s = stretch(g.data, lo * 255, 255), o = new Uint8Array(s.length * 3);
  for (let i = 0; i < s.length; i++) o[i * 3] = o[i * 3 + 1] = o[i * 3 + 2] = s[i];
  return rgbJpeg(o, g.info.width, g.info.height);
}
const normal = (name) => sharp(path.join(TEX, `${name}_nor.jpg`)).resize(512, 512).jpeg({ quality: 82 }).toBuffer();
async function rough(name, lo, hi) { // glTF metallicRoughness: G = roughness, B = metal (0)
  const g = await grey(name, 'rough'), s = stretch(g.data, lo * 255, hi * 255), o = new Uint8Array(s.length * 3);
  for (let i = 0; i < s.length; i++) { o[i * 3] = 255; o[i * 3 + 1] = s[i]; o[i * 3 + 2] = 0; }
  return rgbJpeg(o, g.info.width, g.info.height);
}
const TEXS = {
  paint: { d: await detail('green_metal_rust', 0.5), n: await normal('green_metal_rust'), r: await rough('green_metal_rust', 0.55, 0.9), tile: 1.6, nstr: 0.8 },
  rubber: { d: await detail('rubber_tiles', 0.45), n: await normal('rubber_tiles'), r: await rough('rubber_tiles', 0.75, 1), tile: 0.7, nstr: 1 },
};
function materials(doc) {
  const out = {};
  for (const [k, t] of Object.entries(TEXS)) {
    const tex = (b, nm) => doc.createTexture(`${k}_${nm}`).setImage(b).setMimeType('image/jpeg');
    const m = doc.createMaterial(`near_${k}`).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1).setAlphaMode('OPAQUE').setDoubleSided(false)
      .setBaseColorTexture(tex(t.d, 'diff')).setNormalTexture(tex(t.n, 'nor')).setNormalScale(t.nstr).setMetallicRoughnessTexture(tex(t.r, 'rough'));
    out[k] = m;
  }
  return out;
}

// ------------------------------------------------------------------ geometry helpers
const RUBBER = /^(wheel|tyre|idler|sprocket|track)/i;
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
/** Box-projected UVs (dominant normal axis) in the mesh's own space, so a rotating wheel carries its texture. */
function boxUV(prim, tile) {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), n = pos.getCount(), uv = new Float32Array(n * 2), p = [0, 0, 0], q = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, p); if (nor) nor.getElement(i, q); else { q[0] = 0; q[1] = 1; q[2] = 0; }
    const ax = Math.abs(q[0]), ay = Math.abs(q[1]), az = Math.abs(q[2]);
    let u, v;
    if (ay >= ax && ay >= az) { u = p[0]; v = p[2]; } else if (ax >= az) { u = p[2]; v = p[1]; } else { u = p[0]; v = p[1]; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  return uv;
}
/** Recolours the vertex colours (linear float) of light/blue/white parts to olive drab, keeps dark parts (rubber, barrels, glass). Rewrites COLOR_0 as RGBA. */
function paintVerts(doc, prim, { olive, trackBand }) {
  const col = prim.getAttribute('COLOR_0'), n = prim.getAttribute('POSITION').getCount(), pos = prim.getAttribute('POSITION'), out = new Float32Array(n * 4), c = [0, 0, 0], p = [0, 0, 0];
  const ol = [0.11, 0.15, 0.06];
  for (let i = 0; i < n; i++) {
    if (col) col.getElement(i, c); else { c[0] = c[1] = c[2] = 0.1; }
    let r = c[0], g = c[1], b = c[2];
    if (olive && lum(c) > 0.09) { const k = 0.75 + Math.min(1.2, lum(c) * 2.4); r = ol[0] * k; g = ol[1] * k; b = ol[2] * k; }
    let a = 1;
    if (trackBand) { pos.getElement(i, p); if (Math.abs(p[0]) > trackBand.minX && lum(c) < 0.07 && p[1] < trackBand.maxY) a = 0.5; }
    out.set([r, g, b, a], i * 4);
  }
  const acc = doc.createAccessor().setType('VEC4').setArray(out);
  prim.setAttribute('COLOR_0', acc);
}
function finishNode(doc, root, mats, opts = {}) {
  for (const node of root.listChildren ? [root, ...allChildren(root)] : []) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const rubber = RUBBER.test(node.getName()) || RUBBER.test(node.getParentNode?.()?.getName?.() ?? '');
    const ismain = /hull|body/i.test(node.getName());
    for (const prim of mesh.listPrimitives()) {
      paintVerts(doc, prim, { olive: !!opts.olive && !rubber, trackBand: opts.trackBand && ismain ? opts.trackBand : null });
      const m = rubber ? mats.rubber : mats.paint;
      prim.setMaterial(m).setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(boxUV(prim, (rubber ? TEXS.rubber : TEXS.paint).tile)));
    }
  }
}
function allChildren(n) { return n.listChildren().flatMap((c) => [c, ...allChildren(c)]); }
const byName = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name);
function graft(dst, srcDoc, srcName, parent, tr, sc = 1, rename) {
  const node = byName(srcDoc, srcName), map = copyToDocument(dst, srcDoc, [node]), copy = map.get(node);
  copy.getParentNode?.()?.removeChild(copy); parent.addChild(copy); copy.setTranslation(tr).setScale([sc, sc, sc]); if (rename) copy.setName(rename);
  return copy;
}
const dropNode = (n) => { if (!n) return; for (const c of n.listChildren()) dropNode(c); n.dispose(); };
function scene(doc) { return doc.getRoot().listScenes()[0]; }
function rootNode(doc) { return scene(doc).listChildren()[0]; }

// ------------------------------------------------------------------ vehicles

/** Muzzle of a rig from the geometry: the node `tip` (world position) or the far end of the `gun` node's bounds; measured from the turret pivot (z forward, y up, model units). */
function muzzle(doc, turretName, tipName, gunName) {
  const tur = byName(doc, turretName).getWorldTranslation();
  let tip;
  if (tipName && byName(doc, tipName)) tip = byName(doc, tipName).getWorldTranslation();
  else { const b = getBounds(byName(doc, gunName)); tip = [0, (b.min[1] + b.max[1]) / 2, b.max[2]]; }
  return { fwd: +(tip[2] - tur[2] + 0.15).toFixed(2), up: +tip[1].toFixed(2), pivot: +tur[2].toFixed(2), node: turretName };
}
const MANI = {};
async function emit(id, doc, meta) {
  // Cesium's glTF axis convention (forward = +Z) maps +Z to the model's +X, i.e. 'heading east at 90 deg': the sources already face +Z, no turn needed (yawOffsetDeg 0)
  await doc.transform(prune());
  { const bufs = doc.getRoot().listBuffers(); for (const a of doc.getRoot().listAccessors()) a.setBuffer(bufs[0]); bufs.slice(1).forEach((b) => b.dispose()); }
  const file = `${id}.glb`; await io.write(path.join(OUT, file), doc);
  const b = getBounds(scene(doc)), size = b.max.map((v, i) => v - b.min[i]), bytes = fs.statSync(path.join(OUT, file)).size;
  let tris = 0; doc.getRoot().listMeshes().forEach((m) => m.listPrimitives().forEach((p) => { tris += (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3; }));
  const max = Math.max(...size);
  const lengthM = meta.heightM ? (meta.heightM * max) / size[1] : meta.lengthM;
  MANI[id] = { file: `near/${file}`, lengthM: +lengthM.toFixed(3), yawOffsetDeg: meta.yawOffsetDeg ?? 0, zOffsetM: meta.zOffsetM ?? 0, nativeSize: size.map((v) => +v.toFixed(3)), near: true, group: meta.group, license: meta.license, author: meta.author, source: meta.source, substitute: !!meta.substitute, triangles: Math.round(tris), bytes, notes: meta.notes, ...(meta.rig ? { rig: meta.rig } : {}), ...(meta.animationRoles ? { animationRoles: meta.animationRoles, animations: doc.getRoot().listAnimations().map((a) => a.getName()) } : {}) };
  console.log(id.padEnd(16), Math.round(tris) + 't', (bytes / 1024) | 0, 'KB', 'size', size.map((v) => v.toFixed(2)).join('x'));
}
const PFMETA = { license: 'CC-BY-4.0', author: 'Polyfork', source: 'https://polyfork.dev' };

// MBT: Medium Tank (hull + turret + gun + hatch + 5 road wheels + sprocket + idler per side)
{
  const doc = await PF('medium-tank-65da6b'), mats = materials(doc);
  finishNode(doc, rootNode(doc), mats, { trackBand: { minX: 0.95, maxY: 1.0 } });
  await emit('near_mbt', doc, { group: 'mbt', lengthM: 9.8, ...PFMETA, notes: 'Polyfork "Medium Tank" (parts kept as nodes) + CC0 Poly Haven detail textures; track triangles marked for the tread shader',
    rig: { turret: 'turret', gun: 'gun', recoil: 'gun', recoilM: 0.35, elevate: 'gun', wheels: ['wheel-l1', 'wheel-l2', 'wheel-l3', 'wheel-l4', 'wheel-l5', 'sprocket-l', 'idler-l', 'wheel-r1', 'wheel-r2', 'wheel-r3', 'wheel-r4', 'wheel-r5', 'sprocket-r', 'idler-r'], wheelR: 0.44, track: { midY: 0.5 }, muzzle: muzzle(doc, 'turret', null, 'gun'), turretY: 1.56 } });
}
// APC / recon: Armoured Half-Track (steering wheels + track drive)
{
  const doc = await PF('armoured-half-track-3deded'), mats = materials(doc);
  finishNode(doc, rootNode(doc), mats, { trackBand: { minX: 0.5, maxY: 0.7 } });
  await emit('near_apc', doc, { group: 'apc', lengthM: 6.5, ...PFMETA, notes: 'Polyfork "Armoured Half-Track" + CC0 Poly Haven detail textures',
    rig: { wheels: ['wheel-fl', 'wheel-fr', 'sprockets', 'idlers'], wheelR: 0.43, steer: ['steer-fl', 'steer-fr'], track: { midY: 0.4 } } });
}
// IFV: half-track hull with the Defense Turret grafted on the roof (turret + elevating gun)
{
  const doc = await PF('armoured-half-track-3deded'), tur = await PF('defense-turret-12ba8d'), mats = materials(doc), root = rootNode(doc);
  const t = graft(doc, tur, 'defense-turret', root, [0, 2.45, -0.2], 0.75, 'ifv-turret-base'); // pedestal + turret subtree
  finishNode(doc, root, mats, { trackBand: { minX: 0.5, maxY: 0.7 } });
  finishNode(doc, t, mats, { olive: true });
  await emit('near_ifv', doc, { group: 'ifv', lengthM: 7, ...PFMETA, notes: 'Polyfork "Armoured Half-Track" hull + "Defense Turret" on the roof (composite, own assembly)', substitute: true,
    rig: { turret: 'turret', gun: 'boom-lower', recoil: 'boom-upper', recoilM: 0.18, elevate: 'boom-lower', wheels: ['wheel-fl', 'wheel-fr', 'sprockets', 'idlers'], wheelR: 0.43, steer: ['steer-fl', 'steer-fr'], track: { midY: 0.4 }, muzzle: muzzle(doc, 'turret', 'tip-muzzle'), turretY: 3.7 } });
}
// SPG: Medium Tank hull + Towed Field Howitzer top carriage (rotating turntable, elevating boom, recoiling barrel)
{
  const doc = await PF('medium-tank-65da6b'), how = await PF('towed-field-howitzer-bb9a08'), mats = materials(doc), root = rootNode(doc);
  dropNode(byName(doc, 'turret')); dropNode(byName(doc, 'stowage'));
  const t = graft(doc, how, 'turntable', root, [0, 1.5, -0.45], 1.25, 'turret');
  finishNode(doc, root, mats, { trackBand: { minX: 0.95, maxY: 1.0 } });
  finishNode(doc, t, mats, { olive: true });
  await emit('near_spg', doc, { group: 'spg', lengthM: 9, ...PFMETA, notes: 'Polyfork "Medium Tank" hull/running gear + "Towed Field Howitzer" turntable, boom and barrel as a rotating turret (composite, own assembly)', substitute: true,
    rig: { turret: 'turret', gun: 'boom-lower', recoil: 'recoil', recoilM: 0.5, elevate: 'boom-lower', wheels: ['wheel-l1', 'wheel-l2', 'wheel-l3', 'wheel-l4', 'wheel-l5', 'sprocket-l', 'idler-l', 'wheel-r1', 'wheel-r2', 'wheel-r3', 'wheel-r4', 'wheel-r5', 'sprocket-r', 'idler-r'], wheelR: 0.44, track: { midY: 0.5 }, muzzle: muzzle(doc, 'turret', 'tip-muzzle'), turretY: 1.5 } });
}
// Truck
{
  const doc = await PF('military-cargo-truck-652f66'), mats = materials(doc);
  finishNode(doc, rootNode(doc), mats, {});
  await emit('near_truck', doc, { group: 'truck', lengthM: 8.6, ...PFMETA, notes: 'Polyfork "Military Cargo Truck" + CC0 Poly Haven detail textures',
    rig: { wheels: ['wheel-fl', 'wheel-fr', 'wheel-ml', 'wheel-mr', 'wheel-rl', 'wheel-rr'], wheelR: 0.48, steer: ['steer-fl', 'steer-fr'] } });
}
// SAM stand-in: 8-wheel hauler (olive) carrying the Anti-Aircraft Gun turntable (rotates, elevates, recoils)
{
  const doc = await PF('eight-wheel-industrial-hauler-4dc3d7'), aa = await PF('anti-aircraft-gun-93cc80'), mats = materials(doc), root = rootNode(doc);
  const t = graft(doc, aa, 'turntable', root, [0, 1.55, -2.6], 1.0, 'turret');
  finishNode(doc, root, mats, { olive: true });
  finishNode(doc, t, mats, { olive: true });
  await emit('near_sam', doc, { group: 'sam', lengthM: 12, ...PFMETA, notes: 'Polyfork "Eight-Wheel Industrial Hauler" (olive) + "Anti-Aircraft Gun" turntable: an AA gun truck stands in for a missile launcher (no free SAM launcher model with separate parts was found)', substitute: true,
    rig: { turret: 'turret', gun: 'boom-lower', recoil: 'boom-upper', recoilM: 0.3, elevate: 'boom-lower', wheels: ['wheel-1l', 'wheel-1r', 'wheel-2l', 'wheel-2r', 'wheel-3l', 'wheel-3r', 'wheel-4l', 'wheel-4r'], wheelR: 0.95, steer: ['steer-1l', 'steer-1r', 'steer-2l', 'steer-2r'], muzzle: muzzle(doc, 'turret', 'tip-muzzle'), turretY: 1.55 } });
}

// ------------------------------------------------------------------ soldiers
// The soldiers (nsoldier*, soldier_*) are no longer built here: the cartoon Toon Shooter characters were removed. The realistic ones come from the
// Blender kit (tools/models/soldados/exportar_soldados.py + quantize-soldier.mjs); keep their entries when this script rewrites the manifest.
try { const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')); for (const [k, v] of Object.entries(prev)) if (k.startsWith('nsoldier')) MANI[k] = v; } catch { /* first run */ }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(MANI, null, 1));
console.log('near manifest', Object.keys(MANI).length, 'models');
