// usage: node contact-sheet.mjs [out.png]  -- renders every manifest entry with its yawOffsetDeg (front -> screen right)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const pub = path.join(here, '../../public/models');
const out = process.argv[2] || path.join(here, '../../docs/assets/models-contact-sheet.png');
const man = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.json')));
const items = Object.entries(man).map(([name, m]) => ({ name, file: m.file, yawOffsetDeg: m.yawOffsetDeg }));
const tmp = path.join(here, '../.cache/models/sheet-items.json'); fs.writeFileSync(tmp, JSON.stringify(items));
execFileSync('node', [path.join(here, 'render-sheet.mjs'), tmp, out, pub, '6'], { stdio: 'inherit' });
