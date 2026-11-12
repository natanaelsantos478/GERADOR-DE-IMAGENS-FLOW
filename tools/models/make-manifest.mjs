// Writes public/models/manifest.json from defs.mjs + build-info.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { defs } from './defs.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(path.join(here, '../.cache/models/build-info.json')));
const m = {};
for (const [id, d] of Object.entries(defs)) {
  const i = info[id]; if (!i) throw new Error('not built: ' + id);
  m[id] = { file: `${id}.glb`, lengthM: d.lengthM, yawOffsetDeg: d.yawFix ?? 0, zOffsetM: 0, nativeSize: i.nativeSize,
    license: d.license, author: d.author, source: d.source, substitute: !!d.substitute, triangles: i.triangles, bytes: i.bytes,
    ...(d.composite ? { composite: true } : {}), ...(i.animations.length ? { animations: i.animations } : {}),
    ...(d.animations ? { animationRoles: d.animations } : {}), ...(d.notes ? { notes: d.notes } : {}) };
}
fs.writeFileSync(path.join(here, '../../public/models/manifest.json'), JSON.stringify(m, null, 1));
const total = Object.values(m).reduce((s, v) => s + v.bytes, 0);
console.log('manifest', Object.keys(m).length, 'models', (total / 1048576).toFixed(2), 'MB total; max', Math.max(...Object.values(m).map((v) => v.bytes)) / 1024 | 0, 'KB');
