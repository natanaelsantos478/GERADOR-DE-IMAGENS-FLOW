import { readFileSync } from 'node:fs';
import { Pool } from './pool';
import { loadWorldStatic } from '../../src/data/loadWorld';
import { nodeFetchJson } from '../../src/data/fetchNode';
import { tacPack, path } from './stage-tac';
import { locations, type Match } from './tac';
import { gaussian, mulberry } from './nn';
const world = await loadWorldStatic(nodeFetchJson());
const spec = JSON.parse(readFileSync(path('tac.bc.json'), 'utf8'));
const { train } = locations(world);
const pool = new Pool(4);
const ms: Match[] = Array.from({ length: 4 }, (_, i) => ({ loc: train[i * 90], seed: 5 + i, neuralSide: (i & 1) as 0 | 1, attacker: ((i >> 1) & 1) as 0 | 1, k0: 1, k1: 1, mix0: .5, mix1: .5 }));
const n = spec.w.length, last = n - 33;
for (const alpha of [1, 0.1, 0.03]) {
  const r = mulberry(3);
  const jobs = Array.from({ length: 4 }, (_, k) => { const w = Float64Array.from(spec.w); for (let i = 0; i < n; i++) w[i] += k ? 0.05 * gaussian(r) : 0; for (let i = last; i < n; i++) w[i] *= alpha; return pool.run<{ fit: number }[]>({ task: 'tac', pack: tacPack(spec, w), matches: ms, temp: 0.3, timeLimit: 600 }); });
  const res = await Promise.all(jobs);
  console.log('alpha', alpha, res.map((x) => (x.reduce((a, v) => a + v.fit, 0) / 4).toFixed(3)).join(' '));
}
await pool.close();
