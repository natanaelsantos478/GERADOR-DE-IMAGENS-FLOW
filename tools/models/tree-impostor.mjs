// usage: node tree-impostor.mjs   -> public/models/nature/lod/<species>_3.glb
// Billboard impostor per tree species (the classic far-forest trick of SpeedTree / open-world games): the model is rendered
// once from the side on a transparent background and mapped on two crossed double-sided quads (4 triangles). Used by
// city3d/trees.ts for the farthest ring, where a full tree would be a few pixels tall. Needs Chrome or Playwright Chromium.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const NAT = path.join(here, '../../public/models/nature'), OUT = path.join(NAT, 'lod');
const styles = JSON.parse(fs.readFileSync(path.join(here, '../../public/data/styles/trees.json'), 'utf8'));
const W = 128, H = 256; // texture size: the impostor is at most ~40 px tall on screen
fs.mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const srv = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const root = u.startsWith('/m/') ? NAT : here, f = path.resolve(root, u.startsWith('/m/') ? u.slice(3) : u.slice(1) || 'viewer/viewer.html');
  if (!f.startsWith(path.resolve(root))) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
}).listen(0);
const port = srv.address().port;
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chrome', args }).catch(() => chromium.launch({ args }));
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/viewer/viewer.html`);
await page.waitForFunction('window.renderImpostor');

const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
for (const sp of [...new Set(Object.values(styles.species).map((s) => s.file))]) {
  const r = await page.evaluate(([u, w, h]) => window.renderImpostor(u, w, h), [`/m/${sp}.glb`, W, H]);
  // alpha-tested texture: hard edge alpha so the MASK cutoff matches the silhouette
  const png = await sharp(Buffer.from(r.png.split(',')[1], 'base64')).png({ compressionLevel: 9, palette: true }).toBuffer();
  const doc = new Document(), buf = doc.createBuffer();
  const hw = r.w / 2, y0 = r.minY, y1 = r.minY + r.h;
  // two crossed quads: X-Y plane and Z-Y plane, base on the model base
  const pos = new Float32Array([-hw, y0, 0, hw, y0, 0, hw, y1, 0, -hw, y1, 0, 0, y0, -hw, 0, y0, hw, 0, y1, hw, 0, y1, -hw]);
  const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const tex = doc.createTexture('impostor').setImage(new Uint8Array(png)).setMimeType('image/png');
  // unlit: the light is baked in the rendered image, and a forest of overlapping alpha-tested quads is fill-bound,
  // so the cheap unlit shader matters more than the 4 triangles
  const mat = doc.createMaterial('impostor').setBaseColorTexture(tex).setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true).setRoughnessFactor(1).setMetallicFactor(0)
    .setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf)).setMaterial(mat);
  doc.createScene(sp).addChild(doc.createNode(sp).setMesh(doc.createMesh(sp).addPrimitive(prim)));
  const f = path.join(OUT, `${sp}_3.glb`);
  await io.write(f, doc);
  console.log(`${sp}_3`.padEnd(16), `${r.w.toFixed(1)} x ${r.h.toFixed(1)} m`, (fs.statSync(f).size / 1024).toFixed(0).padStart(3), 'KB');
}
await browser.close(); srv.close();
