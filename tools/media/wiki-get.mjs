// usage: node wiki-get.mjs "File:Name.ogg"...  -> tools/.cache/media/wiki/<file> + <file>.meta.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.cache/media/wiki');
fs.mkdirSync(dir, { recursive: true });
for (const t of process.argv.slice(2)) {
  const r = await (await fetch(`https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url|extmetadata&titles=${encodeURIComponent(t)}`)).json();
  const ii = Object.values(r.query.pages)[0].imageinfo?.[0];
  if (!ii) { console.log('NOT FOUND', t); continue; }
  const m = ii.extmetadata;
  const name = t.replace(/^File:/, '').replace(/[^\w.-]+/g, '_');
  const buf = Buffer.from(await (await fetch(ii.url)).arrayBuffer());
  fs.writeFileSync(path.join(dir, name), buf);
  const meta = { title: t, license: m.LicenseShortName?.value, author: (m.Artist?.value || '').replace(/<[^>]*>/g, '').trim(), source: ii.descriptionurl };
  fs.writeFileSync(path.join(dir, name + '.meta.json'), JSON.stringify(meta, null, 1));
  console.log(name, buf.length, meta.license, meta.author);
}
