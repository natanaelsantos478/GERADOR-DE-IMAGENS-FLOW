/** Training-side MLP (backprop + Adam) and helpers; produces the same NetSpec the game loads. */
import type { NetSpec } from '../../src/sim/neural/mlp';
import { paramCount } from '../../src/sim/neural/mlp';

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const gaussian = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

export function initWeights(sizes: number[], rnd: () => number, outScale = 0.1): Float64Array {
  const w = new Float64Array(paramCount(sizes));
  let o = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nin = sizes[l], nout = sizes[l + 1];
    const s = (l + 2 === sizes.length ? outScale : 1) * Math.sqrt(1 / nin);
    for (let i = 0; i < nin * nout; i++) w[o + i] = gaussian(rnd) * s;
    o += nin * nout + nout;
  }
  return w;
}

export class Trainable {
  grad: Float64Array;
  private acts: Float64Array[];
  private deltas: Float64Array[];
  constructor(readonly sizes: number[], public w: Float64Array, readonly mean: Float64Array, readonly std: Float64Array) {
    this.grad = new Float64Array(w.length);
    this.acts = sizes.map((s) => new Float64Array(s));
    this.deltas = sizes.map((s) => new Float64Array(s));
  }
  forward(x: ArrayLike<number>): Float64Array {
    const a0 = this.acts[0];
    for (let i = 0; i < a0.length; i++) a0[i] = Math.max(-6, Math.min(6, (x[i] - this.mean[i]) / this.std[i]));
    let o = 0;
    const L = this.sizes.length - 1;
    for (let l = 0; l < L; l++) {
      const nin = this.sizes[l], nout = this.sizes[l + 1], src = this.acts[l], dst = this.acts[l + 1], bo = o + nin * nout;
      for (let j = 0; j < nout; j++) {
        let s = this.w[bo + j];
        for (let i = 0; i < nin; i++) s += this.w[o + j * nin + i] * src[i];
        dst[j] = l === L - 1 ? s : Math.tanh(s);
      }
      o = bo + nout;
    }
    return this.acts[L];
  }
  /** Backprop of d(loss)/d(output) (accumulates into grad). Must follow `forward` of the same input. */
  backward(dout: ArrayLike<number>): void {
    const L = this.sizes.length - 1;
    const dl = this.deltas[L];
    for (let j = 0; j < dl.length; j++) dl[j] = dout[j];
    let o = this.w.length;
    for (let l = L - 1; l >= 0; l--) {
      const nin = this.sizes[l], nout = this.sizes[l + 1];
      o -= nin * nout + nout;
      const bo = o + nin * nout, src = this.acts[l], dnext = this.deltas[l + 1], dprev = this.deltas[l];
      dprev.fill(0);
      for (let j = 0; j < nout; j++) {
        const d = dnext[j];
        this.grad[bo + j] += d;
        for (let i = 0; i < nin; i++) { this.grad[o + j * nin + i] += d * src[i]; dprev[i] += d * this.w[o + j * nin + i]; }
      }
      if (l > 0) for (let i = 0; i < nin; i++) dprev[i] *= 1 - src[i] * src[i];
    }
  }
}

export class Adam {
  private m: Float64Array; private v: Float64Array; private t = 0;
  constructor(n: number, readonly lr = 3e-3, readonly b1 = 0.9, readonly b2 = 0.999) { this.m = new Float64Array(n); this.v = new Float64Array(n); }
  step(w: Float64Array, g: Float64Array, scale = 1): void {
    this.t++;
    const c1 = 1 - this.b1 ** this.t, c2 = 1 - this.b2 ** this.t;
    for (let i = 0; i < w.length; i++) {
      const gi = g[i] * scale;
      this.m[i] = this.b1 * this.m[i] + (1 - this.b1) * gi;
      this.v[i] = this.b2 * this.v[i] + (1 - this.b2) * gi * gi;
      w[i] += (this.lr * (this.m[i] / c1)) / (Math.sqrt(this.v[i] / c2) + 1e-8) * -1;
    }
  }
}

export const round = (v: number) => Math.round(v * 1e5) / 1e5;
export function toSpec(sizes: number[], w: ArrayLike<number>, mean: ArrayLike<number>, std: ArrayLike<number>): NetSpec {
  return { sizes, act: 'tanh', w: Array.from(w, round), mean: Array.from(mean, round), std: Array.from(std, (v) => round(Math.max(v, 1e-4))) };
}

/** Column mean/std of a row-major matrix; columns in `skip` get mean 0, std 1 (one-hot flags). */
export function columnStats(rows: Float64Array[], dim: number, skip: Set<number>): { mean: Float64Array; std: Float64Array } {
  const mean = new Float64Array(dim), m2 = new Float64Array(dim);
  let n = 0;
  for (const m of rows) for (let r = 0; r + dim <= m.length; r += dim) { n++; for (let i = 0; i < dim; i++) { mean[i] += m[r + i]; m2[i] += m[r + i] * m[r + i]; } }
  const std = new Float64Array(dim);
  for (let i = 0; i < dim; i++) {
    mean[i] /= Math.max(1, n);
    std[i] = Math.sqrt(Math.max(1e-6, m2[i] / Math.max(1, n) - mean[i] * mean[i]));
    if (skip.has(i)) { mean[i] = 0; std[i] = 1; }
    std[i] = Math.max(std[i], 0.05);
  }
  return { mean, std };
}
