// Builds public/icons/*.svg, manifest.json from icon-defs.mjs (lucide-static ISC + hand-drawn).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS } from './icon-defs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../public/icons');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(out, f));

const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
const lucideBody = (name) => {
  const p = path.join(here, 'node_modules/lucide-static/icons', `${name}.svg`);
  if (!fs.existsSync(p)) throw new Error(`lucide icon missing: ${name}`);
  const s = fs.readFileSync(p, 'utf8');
  return s.slice(s.indexOf('>', s.indexOf('<svg')) + 1, s.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').trim();
};
const manifest = {};
for (const [id, def] of Object.entries(ICONS)) {
  let body, lic, origin;
  if (def.startsWith('lucide:')) {
    const [name, extra] = def.slice(7).split('+');
    body = lucideBody(name) + (extra ?? '');
    lic = 'ISC';
    origin = `Lucide (lucide-static) "${name}"${extra ? ' + hand-drawn addition' : ''}`;
  } else {
    body = def; lic = 'MIT (project original)'; origin = 'hand-drawn for Meridiano';
  }
  fs.writeFileSync(path.join(out, `${id}.svg`), wrap(body));
  manifest[id] = { file: `${id}.svg`, license: lic, origin };
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const pkgVer = JSON.parse(fs.readFileSync(path.join(here, 'node_modules/lucide-static/package.json'), 'utf8')).version;
const lucide = Object.values(manifest).filter((m) => m.license === 'ISC').length;
fs.writeFileSync(path.join(out, 'LICENSES.md'), `# Icon licenses

${Object.keys(manifest).length} icons, 24x24 viewBox, stroke="currentColor". Per-icon origin in \`manifest.json\`.

- **${lucide} icons derived from Lucide** (lucide-static ${pkgVer}) - ISC License, Copyright (c) for Lucide Contributors; portions
  from Feather, Copyright (c) 2013-2023 Cole Bemis, MIT License. https://lucide.dev/license
- **${Object.keys(manifest).length - lucide} icons hand-drawn for this project** (tactical symbols, orders, formations, infrastructure, resources
  without a good stock glyph) - same MIT license as the project, no attribution required.

ISC permission notice: Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
`);
console.log(`icons: ${Object.keys(manifest).length} (lucide-derived ${lucide})`);
