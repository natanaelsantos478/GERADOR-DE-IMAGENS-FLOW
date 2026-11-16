/** Behaviour cloning of the rule-based tactical AI -> initial tactical net (tools/ai-train/ckpt/tac.bc.json). */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { WorldStatic } from '../../src/core/contracts';
import { TAC_IN, TAC_S, NT } from '../../src/sim/tactical/aiNeural';
import { Adam, Trainable, columnStats, initWeights, mulberry, toSpec } from './nn';
import type { Pool } from './pool';
import { ckpt } from './paths';
import { dirname } from 'node:path';
import { locations, type Match } from './tac';

const SIZES = [TAC_IN, 32, 1];
export async function runBc(pool: Pool, world: WorldStatic, seed = 1): Promise<void> {
const rnd = mulberry(1234 + seed);
const { train } = locations(world);
const matches: Match[] = [];
for (let i = 0; i < 48; i++) matches.push({ loc: train[Math.floor(rnd() * train.length)], seed: 100 + i, neuralSide: 0, attacker: (i & 1) as 0 | 1, k0: 0.7 + rnd() * 0.7, k1: 0.7 + rnd() * 0.7, mix0: rnd(), mix1: rnd() });
const chunks = await Promise.all(Array.from({ length: 12 }, (_, i) => pool.run<number[][]>({ task: 'tacRecord', matches: matches.slice(i * 4, i * 4 + 4), every: 3, timeLimit: 600 })));
const samples = chunks.flat().map((r) => Float64Array.from(r));
console.log(`amostras: ${samples.length}`);
const skip = new Set<number>(); for (let i = 0; i < 5; i++) skip.add(i); for (let i = 0; i < NT; i++) skip.add(TAC_S + i); skip.add(13);
const { mean, std } = columnStats(samples, TAC_IN, skip);
const net = new Trainable(SIZES, initWeights(SIZES, mulberry(7)), mean, std);
const opt = new Adam(net.w.length, 2e-3);
const shuffle = mulberry(99);
const masked = new Float64Array(TAC_IN * 24);
let ema = 0;
for (let ep = 0; ep < 25; ep++) {
  const order = samples.map((_, i) => i).sort(() => shuffle() - 0.5);
  let loss = 0, acc = 0, cnt = 0;
  for (let bi = 0; bi < order.length; bi += 64) {
    net.grad.fill(0);
    const batch = order.slice(bi, bi + 64);
    for (const si of batch) {
      const m = samples[si], n = m.length / TAC_IN;
      masked.set(m);
      if (shuffle() < 0.3) for (let r = 0; r < n; r++) masked[r * TAC_IN + TAC_S] = 0; // hide the rule flag: learn from raw features too
      const z = new Float64Array(n);
      for (let r = 0; r < n; r++) z[r] = net.forward(masked.subarray(r * TAC_IN, (r + 1) * TAC_IN))[0];
      let mx = -1e9; for (let r = 0; r < n; r++) mx = Math.max(mx, z[r]);
      let Z = 0; for (let r = 0; r < n; r++) { z[r] = Math.exp(z[r] - mx); Z += z[r]; }
      loss += -Math.log(z[0] / Z + 1e-9); cnt++;
      let am = 0; for (let r = 1; r < n; r++) if (z[r] > z[am]) am = r; if (am === 0) acc++;
      for (let r = 0; r < n; r++) {
        net.forward(masked.subarray(r * TAC_IN, (r + 1) * TAC_IN));
        net.backward([z[r] / Z - (r === 0 ? 1 : 0)]);
      }
    }
    opt.step(net.w, net.grad, 1 / batch.length);
  }
  ema = loss / cnt;
  console.log(`época ${ep + 1}  loss ${ema.toFixed(4)}  acerto ${(acc / cnt * 100).toFixed(1)}%`);
}
mkdirSync(dirname(ckpt('x')), { recursive: true });
writeFileSync(ckpt('tac.bc.json'), JSON.stringify(toSpec(SIZES, net.w, mean, std)));
console.log('bc ok');
}
