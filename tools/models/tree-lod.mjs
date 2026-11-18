// usage: node tree-lod.mjs   -> public/models/nature/lod/<species>_1.glb (mid distance); the far ring uses the impostors of tree-impostor.mjs
// Lighter versions of the tree models for distance LOD (city3d/trees.ts): the bark mesh is simplified with meshoptimizer
// (it is mostly hidden inside the crown), the leaf cards are thinned deterministically and the kept cards are enlarged so the
// crown keeps its silhouette and coverage; textures shrink (the far set is a few pixels tall on screen).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, weld, prune, dedup, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const NAT = path.join(here, '../../public/models/nature'), OUT = path.join(NAT, 'lod');
const styles = JSON.parse(fs.readFileSync(path.join(here, '../../public/data/styles/trees.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** level -> bark triangle target, share of leaf cards kept, texture size */
const LEVELS = { 1: { bark: 220, keep: 0.34, leafRatio: 0.6, tex: 256 } };
/** Models already this light keep their geometry at the mid level (only the textures shrink). */
const LIGHT_TRIS = 1000;
const hash = (i, s) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2d); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const isLeaf = (prim) => prim.getMaterial()?.getAlphaMode() === 'MASK' && !/bark|trunk|wood/i.test(prim.getMaterial()?.getName() ?? '');

/**
 * Edge-collapse simplification with free borders (measured on these models: LockBorder keeps 2-3x more triangles,
 * position welding makes the mesh non-manifold and blocks collapses, and sloppy mode breaks thin trunks into pieces).
 */
function simplifyWelded(prim, targetTris, error, lock = false) {
  const P = new Float32Array(prim.getAttribute('POSITION').getArray()), I = new Uint32Array(prim.getIndices().getArray());
  if (I.length / 3 <= targetTris) return;
  prim.getIndices().setArray(new Uint32Array(MeshoptSimplifier.simplify(I, P, 3, targetTris * 3, error, lock ? ['LockBorder'] : [])[0]));
}
const simplifyBark = (prim, target) => simplifyWelded(prim, target, target > 100 ? 0.08 : 0.25);

/** Leaves: small cards (broadleaf crowns) are thinned and enlarged; big branch tiers (pines) are simplified instead. */
function reduceLeaves(prim, L, s) {
  const idx = prim.getIndices().getArray(), nv = prim.getAttribute('POSITION').getCount();
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]); parent[find(idx[t + 1])] = a; parent[find(idx[t + 2])] = a; }
  const roots = new Set(); for (let i = 0; i < idx.length; i++) roots.add(find(idx[i]));
  // only true cards (one quad each, broadleaf crowns) are thinned; pine branch tiers are a few triangles each and must all stay
  if (idx.length / 3 / roots.size <= 2.5) return thinLeaves(prim, L.keep, s);
  simplifyWelded(prim, Math.max(24, Math.round((idx.length / 3) * L.leafRatio)), 0.08);
}

/** Leaf cards = connected components; keep a share of them and grow each kept card around its centre. */
function thinLeaves(prim, keep, s) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices().getArray(), nv = pos.getCount();
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]); parent[find(idx[t + 1])] = a; parent[find(idx[t + 2])] = a; }
  const comp = new Map();
  for (let t = 0; t < idx.length; t += 3) { const r = find(idx[t]); (comp.get(r) ?? comp.set(r, []).get(r)).push(t); }
  const grow = 1 / Math.sqrt(keep) * 0.85, v = [0, 0, 0], kept = [], moved = new Set();
  let ci = 0;
  for (const [, tris] of comp) {
    if (hash(ci++, s) >= keep) continue;
    const verts = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) verts.add(idx[t + k]);
    const c = [0, 0, 0]; for (const i of verts) { pos.getElement(i, v); c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
    c[0] /= verts.size; c[1] /= verts.size; c[2] /= verts.size;
    for (const i of verts) { if (moved.has(i)) continue; moved.add(i); pos.getElement(i, v); pos.setElement(i, [c[0] + (v[0] - c[0]) * grow, c[1] + (v[1] - c[1]) * grow, c[2] + (v[2] - c[2]) * grow]); }
    for (const t of tris) kept.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (!kept.length) { const f = comp.values().next().value; for (const t of f) kept.push(idx[t], idx[t + 1], idx[t + 2]); }
  prim.getIndices().setArray(new Uint32Array(kept));
}

const species = [...new Set(Object.values(styles.species).map((s) => s.file))];
for (const sp of species) {
  for (const [lvl, L] of Object.entries(LEVELS)) {
    const doc = await io.read(path.join(NAT, `${sp}.glb`));
    await doc.transform(dequantize(), weld());
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getIndices());
    const before = prims.reduce((a, p) => a + p.getIndices().getCount() / 3, 0);
    const light = before < LIGHT_TRIS;
    let tris = 0;
    for (const p of prims) {
      if (!(light && lvl === '1')) {
        // light models (palm, fern...) at the far level: simplify everything mildly, never thin
        if (light) simplifyWelded(p, Math.max(12, Math.round((p.getIndices().getCount() / 3) * 0.45)), 0.06);
        else if (isLeaf(p)) reduceLeaves(p, L, +lvl);
        // leafless (dead) trees: the branches are the silhouette, keep their joints closed
        else if (!prims.some(isLeaf)) simplifyWelded(p, Math.round((p.getIndices().getCount() / 3) * (lvl === '1' ? 0.3 : 0.15)), 0.05, true);
        else simplifyBark(p, L.bark);
      }
      tris += p.getIndices().getCount() / 3;
    }
    for (const t of doc.getRoot().listTextures()) {
      const img = t.getImage(); if (!img) continue;
      const png = t.getMimeType() === 'image/png';
      const out = sharp(Buffer.from(img)).resize(L.tex, L.tex, { fit: 'fill' });
      t.setImage(new Uint8Array(png ? await out.png({ compressionLevel: 9 }).toBuffer() : await out.jpeg({ quality: 82 }).toBuffer()));
    }
    await doc.transform(prune(), dedup(), quantize());
    const f = path.join(OUT, `${sp}_${lvl}.glb`);
    await io.write(f, doc);
    console.log(`${sp}_${lvl}`.padEnd(18), String(Math.round(tris)).padStart(5), 'tris', (fs.statSync(f).size / 1024).toFixed(0).padStart(4), 'KB');
  }
}
