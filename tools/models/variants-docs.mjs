// Appends/refreshes the "Real-world variants" section of public/models/LICENSES.md from variants.defs.json + manifest.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const PUB = path.join(here, '../../public/models');
const defs = JSON.parse(fs.readFileSync(path.join(here, 'variants.defs.json'))); const man = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json')));
const B = '<!-- VARIANTS:BEGIN -->', E = '<!-- VARIANTS:END -->'; let md = fs.readFileSync(path.join(PUB, 'LICENSES.md'), 'utf8');
const i = md.indexOf(B); if (i >= 0) md = md.slice(0, i).trimEnd() + '\n';
const live = defs.filter((d) => man[d.id]);
const by = (pred) => live.filter(pred);
let s = `\n${B}\n## Real-world vehicle variants (\`tools/models/variants.defs.json\`)\n\n` +
`Each model below is a real vehicle/aircraft/ship/person modelled by third-party artists, converted by \`tools/models\` (fg2glb.py, stl2glb.py, any2glb.py, variants-finish.mjs): ` +
`composition of the exterior meshes, re-orientation (nose to +Z), flat painting of untextured STL models, mesh decimation, texture downscale (<=1024 px, jpg/png), scale to real metres. Those are the changes made (CC-BY "changes indicated").\n\n` +
`**Share-alike / copyleft notice.** Entries marked SA (GPL-2.0-or-later FlightGear aircraft/ships, CC-BY-SA, GPL) carry \`"shareAlike": true\` in manifest.json. ` +
`Derived models stay under the same licence; shipping them requires publishing the converted glb and its source references (this table + \`tools/models\`) under that licence, and keeping the notices. ` +
`FlightGear aircraft are GPL (individual authors are named in each aircraft's \`-set.xml\`/README inside the upstream zip linked as source). ` +
`Model names/designations are descriptive only.\n\n` +
`| id | real name | origin | author | licence | SA | source |\n|---|---|---|---|---|---|---|\n` +
live.map((d) => `| ${d.id} | ${d.realName} | ${d.origin || '-'} | ${d.author} | ${d.license} | ${man[d.id].shareAlike ? 'SA' : ''} | ${d.source.split(' ')[0]} |`).join('\n') + `\n${E}\n`;
fs.writeFileSync(path.join(PUB, 'LICENSES.md'), md + s); console.log('LICENSES.md updated,', live.length, 'rows');
