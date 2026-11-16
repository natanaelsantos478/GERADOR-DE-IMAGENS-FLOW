/** Stage 2: strategic + operational nets by ES on forced regional wars (neural side vs rule-based side). */
import { readFileSync, writeFileSync } from 'node:fs';
import type { WorldStatic } from '../../src/core/contracts';
import { paramCount, type NetSpec } from '../../src/sim/neural/mlp';
import { PACK_FORMAT, type PolicyPack } from '../../src/sim/neural/pack';
import { STRAT_IN, STRAT_OUT } from '../../src/sim/ai/neuralPlan';
import { GOAL_IN, STANCE_IN } from '../../src/sim/ai/neuralOp';
import { runEs } from './es';
import { initWeights, mulberry, round } from './nn';
import { ckpt, logs } from './paths';
import type { Pool } from './pool';
import { listPairs, type WarOutcome, type WarScenario } from './war';

export const WAR_SIZES = { strat: [STRAT_IN, 32, STRAT_OUT], opGoal: [GOAL_IN, 16, 1], opStance: [STANCE_IN, 12, 2] } as const;
const NAMES = ['strat', 'opGoal', 'opStance'] as const;

export function splitPairs(world: WorldStatic) {
  const all = listPairs(world);
  const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; };
  return { train: all.filter((p) => h(p.a + p.b) % 4 !== 0), test: all.filter((p) => h(p.a + p.b) % 4 === 0) };
}

export function initWar(seed: number): Float64Array {
  const r = mulberry(seed);
  const parts = NAMES.map((n) => initWeights([...WAR_SIZES[n]], r, 0.05));
  const out = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function warNets(w: ArrayLike<number>): PolicyPack['nets'] {
  const nets: PolicyPack['nets'] = {};
  let o = 0;
  for (const n of NAMES) {
    const k = paramCount([...WAR_SIZES[n]]);
    nets[n] = { sizes: [...WAR_SIZES[n]], act: 'tanh', w: Array.from({ length: k }, (_, i) => round(w[o + i])) } satisfies NetSpec;
    o += k;
  }
  return nets;
}

export async function stageWar(pool: Pool, world: WorldStatic, deadlineMs: number, workers: number, seed: number, tac: NetSpec | null, days = 90): Promise<Float64Array> {
  const { train } = splitPairs(world);
  const mk = (w: ArrayLike<number>): PolicyPack => ({ format: PACK_FORMAT, version: 'train', seed, nets: { ...warNets(w), ...(tac ? { tac } : {}) } });
  const batch = (gen: number, n: number, off = 0): WarScenario[] => {
    const r = mulberry(seed * 131 + gen * 17 + off);
    return Array.from({ length: n }, (_, i) => { const p = train[Math.floor(r() * train.length)]; return { ...p, seed: 1 + Math.floor(r() * 1e6), neuralIs: (i & 1 ? 'a' : 'b') as 'a' | 'b' }; });
  };
  const job = (w: Float64Array, sc: WarScenario[]) => pool.run<WarOutcome[]>({ task: 'war', kind: 'war', pack: mk(w), scenarios: sc, days }).then((r) => r.reduce((a, x) => a + x.fit, 0) / r.length);
  const res = await runEs({
    name: 'war', init: initWar(seed), pairs: Math.max(workers * 2, 8), sigma: 0.1, lr: 0.03, deadlineMs, seed,
    ckptFile: ckpt('war.es.json'), logFile: logs('war.csv'),
    evaluate: (cands, gen) => { const sc = batch(gen, 2); return Promise.all(cands.map((w) => job(w, sc))); },
    evaluateMean: (w, gen) => job(w, batch(gen, 4, 999)),
    onBest: (w) => writeFileSync(ckpt('war.best.json'), JSON.stringify(Array.from(w, round))),
  });
  void readFileSync;
  return res.best;
}
