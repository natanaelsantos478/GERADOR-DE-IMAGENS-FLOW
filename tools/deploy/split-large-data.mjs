#!/usr/bin/env node
/**
 * Cloudflare Pages caps each file at 25 MiB. After `vite build`, split every dist/data/*.json larger than
 * 20 MiB into byte parts <= 10 MiB (NAME.json.p0.json, .p1.json, ...) and write dist/data/_parts.json
 * ({ "roads.json": [parts...] }). The browser loader (src/data/loadWorld.ts) concatenates the bytes back.
 * Usage: node tools/deploy/split-large-data.mjs [distDir]
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MiB = 1024 * 1024;
const SPLIT_ABOVE = 20 * MiB;
const PART = 10 * MiB;
const HARD_LIMIT = 25 * MiB;

const dist = resolve(process.argv[2] ?? 'dist');
const dataDir = join(dist, 'data');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

try {
  statSync(dataDir);
} catch {
  console.error(`split-large-data: ${dataDir} não existe — rode o build antes.`);
  process.exit(1);
}

const manifest = {};
for (const name of readdirSync(dataDir)) {
  const file = join(dataDir, name);
  if (!name.endsWith('.json') || name === '_parts.json' || !statSync(file).isFile()) continue;
  const size = statSync(file).size;
  if (size <= SPLIT_ABOVE) continue;
  const buf = readFileSync(file);
  const parts = [];
  for (let off = 0, i = 0; off < buf.length; off += PART, i++) {
    const pname = `${name}.p${i}.json`;
    writeFileSync(join(dataDir, pname), buf.subarray(off, off + PART));
    parts.push(pname);
  }
  rmSync(file);
  manifest[name] = parts;
  console.log(`split ${name} (${(size / MiB).toFixed(1)} MiB) -> ${parts.length} partes`);
}
writeFileSync(join(dataDir, '_parts.json'), JSON.stringify(manifest));

const tooBig = walk(dist).map((p) => [p, statSync(p).size]).filter(([, s]) => s > HARD_LIMIT);
if (tooBig.length) {
  for (const [p, s] of tooBig) console.error(`ERRO: ${p} tem ${(s / MiB).toFixed(1)} MiB (> 25 MiB, limite do Cloudflare Pages)`);
  process.exit(1);
}
console.log('ok: nenhum arquivo em dist/ acima de 25 MiB');
