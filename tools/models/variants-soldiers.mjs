// Re-tints the rigged Quaternius soldiers (CC0) into uniform variants and registers them in manifest.json + variants.json. Run AFTER variants-finish.mjs.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { prune, dedup } from '@gltf-transform/functions';
const here = path.dirname(fileURLToPath(import.meta.url)); const PUB = path.join(here, '../../public/models'); const C = path.join(here, '../.cache/models');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const man = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'))); const base = man.soldier;
const U = { // linear base colours for the Main / DarkGreen / Helmet materials
  nato: { name: 'NATO olive-grey fatigues', Main: [0.10, 0.11, 0.07], DarkGreen: [0.05, 0.055, 0.035], Helmet: [0.07, 0.08, 0.05] },
  ru: { name: 'Russian-bloc brown-olive fatigues', Main: [0.13, 0.10, 0.045], DarkGreen: [0.07, 0.06, 0.03], Helmet: [0.075, 0.065, 0.03] },
  cn: { name: 'Chinese-bloc bright green fatigues', Main: [0.045, 0.13, 0.05], DarkGreen: [0.025, 0.07, 0.03], Helmet: [0.04, 0.09, 0.04] },
  desert: { name: 'Desert tan fatigues', Main: [0.32, 0.23, 0.10], DarkGreen: [0.20, 0.145, 0.06], Helmet: [0.26, 0.19, 0.08] },
  urban: { name: 'Urban blue-grey fatigues', Main: [0.10, 0.115, 0.13], DarkGreen: [0.045, 0.05, 0.06], Helmet: [0.07, 0.08, 0.09] } };
const out = {};
for (const [sex, srcF] of [['m', path.join(PUB, 'soldier.glb')], ['f', path.join(C, 'raw-glb/q_sf.glb')]]) for (const [k, u] of Object.entries(U)) {
  const doc = await io.read(srcF);
  for (const m of doc.getRoot().listMaterials()) { const c = u[m.getName()]; if (c) m.setBaseColorFactor([...c, 1]); }
  await doc.transform(prune(), dedup());
  const id = `soldier_${k}${sex === 'f' ? '_f' : ''}`; await io.write(path.join(PUB, id + '.glb'), doc);
  const anims = doc.getRoot().listAnimations().map((a) => a.getName());
  out[id] = { file: id + '.glb', lengthM: base.lengthM, yawOffsetDeg: base.yawOffsetDeg, zOffsetM: 0, nativeSize: base.nativeSize, license: 'CC0-1.0', author: 'Quaternius (Ultimate Animated Character Pack), recoloured', source: 'https://opengameart.org/content/ultimate-animated-character-pack',
    substitute: false, triangles: base.triangles, bytes: fs.statSync(path.join(PUB, id + '.glb')).size, class: 'soldier', realName: `Infantry (${sex === 'f' ? 'female, ' : ''}${u.name})`, ...(anims.length ? { animations: anims, animationRoles: base.animationRoles } : {}) };
}
Object.assign(man, out); fs.writeFileSync(path.join(PUB, 'manifest.json'), JSON.stringify(man, null, 1));
const V = JSON.parse(fs.readFileSync(path.join(PUB, 'variants.json'))); const countries = JSON.parse(fs.readFileSync(path.join(here, '../../public/data/countries.json'))).map((c) => c.id);
const set = (s) => new Set(s.split(' ')); const DES = set('SAU ARE QAT KWT BHR OMN YEM JOR IRQ LBN LBY EGY DZA MAR TUN SDN SOM DJI MRT'), RU = set('RUS BLR KAZ KGZ TJK UZB TKM AZE ARM SYR IRN IND ETH ERI AGO MOZ ZWE CUB VEN NIC PRK VNM LAO MDA UGA TZA ZMB COG CMR MLI BFA NER TCD CAF MNG AFG UKR GEO SRB'), CN = set('CHN PAK BGD LKA NPL MMR KHM THA IDN MYS PHL'), URB = set('JPN KOR TWN SGP FIN SWE NOR DNK ISL EST LVA LTU');
const by = {}; for (const c of countries) { const k = DES.has(c) ? 'desert' : RU.has(c) ? 'ru' : CN.has(c) ? 'cn' : URB.has(c) ? 'urban' : 'nato'; by[c] = [`soldier_${k}`, `soldier_${k}_f`]; }
for (const c of ['USA', 'CAN', 'AUS', 'GBR', 'DEU', 'FRA']) by[c] = ['soldier_nato', 'soldier_nato_f', 'soldier_camo'];
V.soldier = { default: 'soldier', byCountry: Object.fromEntries(Object.entries(by).sort()) }; fs.writeFileSync(path.join(PUB, 'variants.json'), JSON.stringify(V, null, 1));
console.log('soldiers', Object.keys(out).length, 'registered');
