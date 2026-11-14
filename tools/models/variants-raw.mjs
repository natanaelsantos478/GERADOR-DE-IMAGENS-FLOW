// usage: BPY=<venv python with bpy> node variants-raw.mjs [id ...]  -> tools/.cache/models/vraw/<id>.glb (raw conversions of downloaded sources)
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const C = path.join(here, '../.cache/models'); const OUT = path.join(C, 'vraw2'); fs.mkdirSync(OUT, { recursive: true });
const BPY = process.env.BPY; if (!BPY) throw new Error('set BPY');
const defs = JSON.parse(fs.readFileSync(path.join(here, 'variants.defs.json'))); const want = process.argv.slice(2);
const jobs = defs.filter((d) => !want.length || want.includes(d.id)).map((d) => {
  const out = path.join(OUT, d.id + '.glb'); const x = d.extra || [];
  if (d.src === 'fg') { const base = path.join(C, 'fga', d.fg); const inner = fs.readdirSync(base).map((n) => path.join(base, n)).find((p) => fs.statSync(p).isDirectory()); return [d.id, ['-I', path.join(here, 'fg2glb.py'), inner, out, d.front, ...(d.main ? [d.main] : []), ...x]]; }
  if (d.src === 'fgdata') return [d.id, ['-I', path.join(here, 'fg2glb.py'), path.join(C, 'fgdata/fgdata_2024_1'), out, d.front, d.fgd, ...x]];
  if (d.src === 'stl') { const spec = { ...d.spec, dir: path.join(C, 'ia-' + d.ia), front: d.front }; return [d.id, ['-I', path.join(here, 'stl2glb.py'), out, JSON.stringify(spec)]]; }
  if (d.src === 'oga') return [d.id, ['-I', path.join(here, 'any2glb.py'), path.join(C, 'oga-' + d.oga, d.blend), out]];
  return null; }).filter(Boolean);
let idx = 0, fail = [];
async function worker() { while (idx < jobs.length) { const [id, args] = jobs[idx++]; await new Promise((res) => { const p = spawn(BPY, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => o += b); p.stderr.on('data', (b) => o += b);
  p.on('close', (c) => { const ok = c === 0 && fs.existsSync(path.join(OUT, id + '.glb')); if (!ok) { fail.push(id); console.log('FAIL', id, o.split('\n').filter((l) => /Error|Traceback|NOMAIN|exit/.test(l)).slice(-2).join(' | ').slice(0, 200)); } else console.log('ok', id, (o.match(/(TRIS|OBJS) \d+( TRIS \d+)?/g) || []).join(' ')); res(); }); }); } }
await Promise.all([1, 2, 3, 4].map(worker)); console.log('failed:', fail.join(' '));
