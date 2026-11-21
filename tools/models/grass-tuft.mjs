// usage: node tools/models/grass-tuft.mjs  -> public/models/nature/grass_tuft.glb
// A grass tuft for the detailed battle view: 3 crossed alpha-masked cards (6 triangles), drawn by the thousand with
// GPU instancing near the camera (city3d/grass.ts). The blade texture is drawn here (own work, CC0).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '../../public/models/nature/grass_tuft.glb');
// deterministic blades: curved strokes from the bottom, varied greens / dry tips
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const W = 256, H = 256; let blades = '';
for (let i = 0; i < 70; i++) {
  const x0 = 20 + rnd() * 216, h = 120 + rnd() * 130, lean = (rnd() - 0.5) * 70, w = 3 + rnd() * 4;
  const g = 90 + Math.round(rnd() * 70), r = 40 + Math.round(rnd() * 50), b = 20 + Math.round(rnd() * 25);
  const tip = rnd() < 0.25 ? `rgb(${150 + Math.round(rnd() * 40)},${140 + Math.round(rnd() * 30)},70)` : `rgb(${r + 20},${g + 30},${b})`;
  blades += `<defs><linearGradient id="g${i}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="rgb(${r - 15},${g - 30},${b})"/><stop offset="1" stop-color="${tip}"/></linearGradient></defs>`;
  blades += `<path d="M ${x0 - w} ${H} Q ${x0 + lean * 0.4} ${H - h * 0.55} ${x0 + lean} ${H - h} Q ${x0 + lean * 0.4 + w * 0.6} ${H - h * 0.55} ${x0 + w} ${H} Z" fill="url(#g${i})"/>`;
}
const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${blades}</svg>`)).png().toBuffer();
const doc = new Document(); const buf = doc.createBuffer();
const tex = doc.createTexture('blades').setImage(new Uint8Array(png)).setMimeType('image/png');
const mat = doc.createMaterial('grass').setBaseColorTexture(tex).setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true).setRoughnessFactor(1).setMetallicFactor(0);
const P = [], N = [], UV = [], I = [];
const w = 0.32, h = 0.45; // half width, height (m); glTF Y-up
for (let c = 0; c < 3; c++) {
  const a = (c * Math.PI) / 3, dx = Math.cos(a) * w, dz = Math.sin(a) * w, n0 = P.length / 3;
  P.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz);
  for (let k = 0; k < 4; k++) N.push(0, 1, 0); // normals up: the tuft lights like the ground under it
  UV.push(0, 1, 1, 1, 1, 0.03, 0, 0.03); // not the top texel row (bleeds the bottom of the next repeat)
  I.push(n0, n0 + 1, n0 + 2, n0, n0 + 2, n0 + 3);
}
const acc = (arr, type) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const prim = doc.createPrimitive().setAttribute('POSITION', acc(new Float32Array(P), 'VEC3')).setAttribute('NORMAL', acc(new Float32Array(N), 'VEC3'))
  .setAttribute('TEXCOORD_0', acc(new Float32Array(UV), 'VEC2')).setIndices(acc(new Uint16Array(I), 'SCALAR')).setMaterial(mat);
doc.createScene().addChild(doc.createNode('grass').setMesh(doc.createMesh('grass').addPrimitive(prim)));
await new NodeIO().write(OUT, doc);
console.log(OUT, (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
