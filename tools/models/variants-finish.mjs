// usage: node variants-finish.mjs [id ...]
// vraw2/<id>.glb -> public/models/<id>.glb (scaled to real metres, base at y=0, <=1.5MB, textures <=1024 jpg/png) and merges manifest.json + variants.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, weld, simplify, unpartition, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer'; import sharp from 'sharp';
const here = path.dirname(fileURLToPath(import.meta.url)); const C = path.join(here, '../.cache/models'); const RAW = path.join(C, 'vraw2'); const PUB = path.join(here, '../../public/models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS); await MeshoptSimplifier.ready;
const defs = JSON.parse(fs.readFileSync(path.join(here, 'variants.defs.json'))); const want = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json')));
const infoF = path.join(C, 'variants-info.json'); const info = fs.existsSync(infoF) ? JSON.parse(fs.readFileSync(infoF)) : {};
const MAXB = 1.45 * 1048576;
const triCount = (root) => { let t = 0; root.listMeshes().forEach((m) => m.listPrimitives().forEach((p) => { t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; })); return t; };
async function texPass(doc, maxPx, q) {
  for (const t of doc.getRoot().listTextures()) {
    const buf = Buffer.from(t.getImage()); let s = sharp(buf); const meta = await s.metadata(); let usesAlpha = false;
    if (meta.hasAlpha) { const st = await sharp(buf).stats(); usesAlpha = st.channels[3] && st.channels[3].min < 250; }
    s = sharp(buf).resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true });
    if (usesAlpha) { t.setImage(new Uint8Array(await s.png({ palette: true, quality: 80 }).toBuffer())).setMimeType('image/png'); }
    else { t.setImage(new Uint8Array(await s.removeAlpha().jpeg({ quality: q, mozjpeg: true }).toBuffer())).setMimeType('image/jpeg'); }
  }
}
for (const d of defs) {
  if (want.length && !want.includes(d.id)) continue; const src = path.join(RAW, d.id + '.glb'); if (!fs.existsSync(src)) continue;
  const target0 = d.tris || (['destroyer', 'frigate', 'carrier', 'submarine'].includes(d.cls) ? 9000 : ['fighter', 'bomber', 'transport_plane', 'attack_heli', 'transport_heli', 'drone'].includes(d.cls) ? 14000 : 12000);
  let best = null;
  for (const [tf, maxPx, q] of [[1, 1024, 82], [0.75, 1024, 70], [0.55, 768, 62], [0.4, 512, 55], [0.25, 512, 45], [0.15, 256, 40]]) {
    const doc = await io.read(src); const root = doc.getRoot(); const scene = root.getDefaultScene() || root.listScenes()[0];
    root.listAnimations().forEach((a) => a.dispose());
    for (const m of root.listMaterials()) { if (m.getBaseColorFactor()[3] < 0.05) { m.setBaseColorFactor([...m.getBaseColorFactor().slice(0, 3), 1]); m.setAlphaMode('OPAQUE'); } }
    await doc.transform(prune(), dedup(), weld());
    const tris = triCount(root); const goal = target0 * tf;
    if (tris > goal) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: goal / tris, error: 0.5, lockBorder: false }));
    await texPass(doc, maxPx, q); await doc.transform(prune(), dedup(), unpartition());
    // scale to real metres (Z extent = length) and put base at y=0, centred on x/z
    const kids = scene.listChildren(); const top = doc.createNode('model'); kids.forEach((k) => { scene.removeChild(k); top.addChild(k); }); scene.addChild(top);
    const b = getBounds(scene); const zlen = b.max[2] - b.min[2]; const s = d.lengthM / zlen;
    top.setScale([s, s, s]).setTranslation([-(b.min[0] + b.max[0]) / 2 * s, -b.min[1] * s, -(b.min[2] + b.max[2]) / 2 * s]);
    const out = path.join(PUB, d.id + '.glb'); await io.write(out, doc); const bytes = fs.statSync(out).size;
    const fb = getBounds(scene); const ns = fb.max.map((v, i) => +(v - fb.min[i]).toFixed(3));
    best = { bytes, nativeSize: ns, triangles: Math.round(triCount(root)) };
    if (bytes <= MAXB) break;
  }
  info[d.id] = best; console.log(d.id.padEnd(26), best.nativeSize.join('x').padEnd(20), String(best.triangles).padStart(6), 'tris', (best.bytes / 1024).toFixed(0).padStart(5), 'KB', best.bytes > MAXB ? 'TOO BIG' : '');
}
fs.writeFileSync(infoF, JSON.stringify(info, null, 1));
// ---- manifest ----
for (const d of defs) {
  const i = info[d.id]; if (!i || !fs.existsSync(path.join(PUB, d.id + '.glb'))) continue;
  manifest[d.id] = { file: d.id + '.glb', lengthM: +Math.max(...i.nativeSize).toFixed(2), yawOffsetDeg: 180, zOffsetM: 0, nativeSize: i.nativeSize, license: d.license, author: d.author, source: d.source, substitute: false,
    triangles: i.triangles, bytes: i.bytes, class: d.cls, realName: d.realName, origin: d.origin || undefined, realLengthM: d.lengthM, ...(d.shareAlike ? { shareAlike: true } : {}), ...(d.notes ? { notes: d.notes } : {}) };
}
fs.writeFileSync(path.join(PUB, 'manifest.json'), JSON.stringify(manifest, null, 1));
// ---- variants.json ----
const countries = new Set(JSON.parse(fs.readFileSync(path.join(here, '../../public/data/countries.json'))).map((c) => c.id));
const EURO = new Set('DEU FRA GBR SWE ITA ESP NLD'.split(' ')), RU = new Set('RUS UKR BLR'.split(' ')), CN = new Set(['CHN']);
const blocOf = (o) => EURO.has(o) ? 'euro' : o === 'USA' ? 'us' : RU.has(o) ? 'ru' : CN.has(o) ? 'cn' : 'other';
const EUROC = new Set('ALB BEL BGR HRV CZE DNK EST FIN FRA DEU GRC HUN ISL ITA LVA LTU LUX MNE NLD MKD NOR POL PRT ROU SVK SVN ESP SWE CHE AUT GBR IRL CYP MLT SRB BIH XKX'.split(' '));
const USC = new Set('USA CAN AUS NZL JPN KOR TWN ISR SAU ARE QAT KWT BHR JOR EGY MAR TUN PHL THA SGP MYS IDN COL CHL ARG BRA MEX PER ECU URY PRY DOM PAN CRI GTM HND SLV TUR GEO LBN IRQ AFG KEN NGA GHA SEN ZAF'.split(' '));
const RUC = new Set('RUS BLR KAZ KGZ TJK UZB TKM AZE ARM SYR IRN IND DZA LBY SDN SSD ETH ERI AGO MOZ ZWE CUB VEN NIC PRK VNM LAO KHM MMR YEM MDA UGA TZA ZMB COG CMR MLI BFA NER TCD CAF MNG'.split(' '));
const CNC = new Set('CHN PAK BGD LKA NPL MMR KHM'.split(' '));
const blocOfCountry = (c) => CNC.has(c) ? 'cn' : RUC.has(c) ? 'ru' : EUROC.has(c) ? 'euro' : USC.has(c) ? 'us' : null;
const variants = {}; const bad = new Set();
const live = defs.filter((d) => manifest[d.id] && info[d.id]);
for (const cls of [...new Set(live.map((d) => d.cls))]) {
  const ms = live.filter((d) => d.cls === cls); const by = {};
  for (const d of ms) for (const c of d.ops) { if (!countries.has(c)) { bad.add(c); continue; } (by[c] ||= []).push(d.id); }
  for (const c of countries) { if (by[c]) continue; const b = blocOfCountry(c); if (!b) continue;
    const pick = ms.filter((d) => blocOf(d.origin) === b); const alt = pick.length ? pick : (b === 'euro' ? ms.filter((d) => blocOf(d.origin) === 'us') : b === 'cn' ? ms.filter((d) => blocOf(d.origin) === 'ru') : b === 'us' ? ms.filter((d) => blocOf(d.origin) === 'euro') : ms.filter((d) => blocOf(d.origin) === 'cn'));
    if (alt.length) by[c] = alt.slice(0, 2).map((d) => d.id); }
  variants[cls] = { default: cls, byCountry: Object.fromEntries(Object.entries(by).sort()) };
}
// keep the classes this run did not rebuild (variants.json also holds hand-tuned classes: never drop them)
const prevF = path.join(PUB, 'variants.json'), prev = fs.existsSync(prevF) ? JSON.parse(fs.readFileSync(prevF)) : {};
fs.writeFileSync(prevF, JSON.stringify({ ...prev, ...variants }, null, 1));
console.log('manifest', Object.keys(manifest).length, 'entries; variants classes', Object.keys(variants).join(','), 'invalid ISO3 dropped:', [...bad].join(' '));
const total = fs.readdirSync(PUB).filter((f) => f.endsWith('.glb')).reduce((s, f) => s + fs.statSync(path.join(PUB, f)).size, 0); console.log('public/models glb total', (total / 1048576).toFixed(1), 'MB');
