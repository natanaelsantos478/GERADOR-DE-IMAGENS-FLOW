/** OpenAI-ES (antithetic sampling, centred-rank shaping, Adam, weight decay) with checkpoints, resume and a wall-clock budget. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Adam, gaussian, mulberry } from './nn';

export interface EsOptions {
  name: string;
  init: Float64Array;
  /** Evaluates every parameter vector (same scenario set for all: common random numbers). Returns one fitness per vector and the generation's mean "baseline" fitness extras. */
  evaluate: (params: Float64Array[], gen: number) => Promise<number[]>;
  /** Evaluates the unperturbed mean (for the learning curve / best-checkpoint choice). */
  evaluateMean: (params: Float64Array, gen: number) => Promise<number>;
  pairs?: number; sigma?: number; lr?: number; decay?: number;
  deadlineMs: number;
  maxGens?: number;
  ckptFile: string; logFile: string;
  seed: number;
  onBest?: (w: Float64Array, fit: number, gen: number) => void;
}

interface Ckpt { gen: number; w: number[]; best: number[]; bestFit: number; elapsedMs: number }

export async function runEs(o: EsOptions): Promise<{ best: Float64Array; bestFit: number; gens: number }> {
  const P = o.pairs ?? 12, sigma = o.sigma ?? 0.06, lr = o.lr ?? 0.02, decay = o.decay ?? 0.005;
  mkdirSync(dirname(o.ckptFile), { recursive: true });
  mkdirSync(dirname(o.logFile), { recursive: true });
  let w = Float64Array.from(o.init), best = Float64Array.from(o.init), bestFit = -Infinity, gen = 0, elapsed = 0;
  if (existsSync(o.ckptFile)) {
    const c = JSON.parse(readFileSync(o.ckptFile, 'utf8')) as Ckpt;
    if (c.w.length === w.length) { w = Float64Array.from(c.w); best = Float64Array.from(c.best); bestFit = c.bestFit; gen = c.gen; elapsed = c.elapsedMs; console.log(`[${o.name}] retomando da geração ${gen}`); }
  }
  const opt = new Adam(w.length, lr);
  const t0 = Date.now() - elapsed;
  const startMs = Date.now();
  while (Date.now() < o.deadlineMs && (o.maxGens === undefined || gen < o.maxGens)) {
    const rnd = mulberry(o.seed * 7919 + gen);
    const eps: Float64Array[] = [];
    const cands: Float64Array[] = [];
    for (let i = 0; i < P; i++) {
      const e = new Float64Array(w.length);
      for (let k = 0; k < e.length; k++) e[k] = gaussian(rnd);
      eps.push(e);
      cands.push(w.map((v, k) => v + sigma * e[k]), w.map((v, k) => v - sigma * e[k]));
    }
    const fit = await o.evaluate(cands, gen);
    // centred ranks in [-0.5, 0.5]
    const idx = fit.map((_, i) => i).sort((a, b) => fit[a] - fit[b]);
    const rank = new Float64Array(fit.length);
    idx.forEach((ix, r) => { rank[ix] = r / (fit.length - 1) - 0.5; });
    const g = new Float64Array(w.length);
    for (let i = 0; i < P; i++) { const d = rank[2 * i] - rank[2 * i + 1]; for (let k = 0; k < g.length; k++) g[k] -= (d * eps[i][k]) / (2 * P * sigma); }
    for (let k = 0; k < g.length; k++) g[k] += decay * w[k];
    opt.step(w, g);
    const mf = await o.evaluateMean(w, gen);
    if (mf > bestFit) { bestFit = mf; best = Float64Array.from(w); o.onBest?.(best, bestFit, gen); }
    gen++;
    const mean = fit.reduce((a, v) => a + v, 0) / fit.length;
    const line = `${gen},${((Date.now() - t0) / 1000).toFixed(0)},${mean.toFixed(4)},${Math.max(...fit).toFixed(4)},${mf.toFixed(4)},${bestFit.toFixed(4)}\n`;
    if (!existsSync(o.logFile)) writeFileSync(o.logFile, 'gen,seconds,pop_mean,pop_max,center,best_center\n');
    appendFileSync(o.logFile, line);
    console.log(`[${o.name}] gen ${gen} pop ${mean.toFixed(3)} max ${Math.max(...fit).toFixed(3)} centro ${mf.toFixed(3)} melhor ${bestFit.toFixed(3)} (${((Date.now() - startMs) / 60000).toFixed(1)} min)`);
    writeFileSync(o.ckptFile, JSON.stringify({ gen, w: Array.from(w), best: Array.from(best), bestFit, elapsedMs: Date.now() - t0 } satisfies Ckpt));
  }
  return { best, bestFit, gens: gen };
}
