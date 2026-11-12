import { readJson, here } from './common.mjs';
import { join } from 'node:path';

export function buildAlliances(countries) {
  const src = readJson(join(here, 'alliances-src.json'));
  const ids = new Set(countries.map((c) => c.id));
  const bad = [];
  const chk = (id, where) => { if (!ids.has(id)) bad.push(`${where}: ${id}`); return ids.has(id); };
  const alliances = src.alliances.map((a) => ({
    id: a.id, name: a.name, kind: a.kind,
    members: [...new Set(a.members)].filter((m) => chk(m, a.id)).sort(),
    note: a.obs || undefined,
  }));
  const seen = new Set();
  const rivalries = [];
  for (const r of src.rivalries) {
    const [a, b] = [r.a, r.b].sort();
    const k = `${a}|${b}`;
    if (seen.has(k) || !chk(r.a, 'rivalry') || !chk(r.b, 'rivalry')) continue;
    seen.add(k); rivalries.push({ a, b, level: r.level });
  }
  const conflicts = src.conflicts.filter((c) => chk(c.a, 'conflict') & chk(c.b, 'conflict')).map((c) => ({ a: c.a, b: c.b, note: c.obs }));
  if (bad.length) throw new Error('Invalid alliance ids:\n' + bad.join('\n'));
  return { alliances, rivalries, conflicts };
}
