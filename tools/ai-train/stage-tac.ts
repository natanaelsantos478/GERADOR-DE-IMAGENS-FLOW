/** Stage 1: tactical net by ES self-play against the rule AI on real training maps. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PACK_FORMAT, type PolicyPack } from '../../src/sim/neural/pack';
import type { NetSpec } from '../../src/sim/neural/mlp';
import type { WorldStatic } from '../../src/core/contracts';
import { runEs } from './es';
import { mulberry } from './nn';
import type { Pool } from './pool';
import { locations, type Match } from './tac';

import { ckpt as path, logs as logPath } from './paths';
export { path, logPath };

export function tacPack(spec: NetSpec, w: ArrayLike<number>): PolicyPack {
  return { format: PACK_FORMAT, version: 'train', seed: 0, nets: { tac: { ...spec, w: Array.from(w) } } };
}

export async function stageTac(pool: Pool, world: WorldStatic, deadlineMs: number, workers: number, seed: number): Promise<NetSpec> {
  const spec = JSON.parse(readFileSync(path('tac.bc.json'), 'utf8')) as NetSpec;
  // The cloned net is saturated (huge margins): shrink the output layer so perturbations can change decisions.
  for (let i = spec.w.length - 33; i < spec.w.length; i++) spec.w[i] *= 0.04;
  const { train } = locations(world);
  const batch = (gen: number, n: number, off = 0): Match[] => {
    const r = mulberry(seed * 31 + gen * 1000 + off);
    return Array.from({ length: n }, (_, i) => ({
      loc: train[Math.floor(r() * train.length)], seed: Math.floor(r() * 1e9), neuralSide: (i & 1) as 0 | 1, attacker: ((i >> 1) & 1) as 0 | 1,
      k0: 0.7 + r() * 0.7, k1: 0.7 + r() * 0.7, mix0: r(), mix1: r(),
    })).map((m) => ({ ...m, k1: m.k0 * (0.85 + r() * 0.3), mix1: m.mix0 }));
  };
  const M = 4;
  const job = async (ws: Float64Array[], ms: Match[]) => Promise.all(ws.map((w) => pool.run<{ fit: number }[]>({ task: 'tac', pack: tacPack(spec, w), matches: ms, temp: 0.15, timeLimit: 600 }).then((r) => r.reduce((a, x) => a + x.fit, 0) / r.length)));
  const res = await runEs({
    name: 'tac', init: Float64Array.from(spec.w), pairs: Math.max(workers * 2, 8), sigma: 0.08, lr: 0.02, deadlineMs, seed,
    ckptFile: path('tac.es.json'), logFile: logPath('tac.csv'),
    evaluate: (cands, gen) => job(cands, batch(gen, M)),
    evaluateMean: async (w, gen) => (await job([w], batch(gen, 8, 777)))[0],
    onBest: (w) => writeFileSync(path('tac.best.json'), JSON.stringify({ ...spec, w: Array.from(w, (v) => Math.round(v * 1e5) / 1e5) })),
  });
  void existsSync;
  return { ...spec, w: Array.from(res.best, (v) => Math.round(v * 1e5) / 1e5) };
}
