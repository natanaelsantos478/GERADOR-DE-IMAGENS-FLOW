/**
 * Minimal deterministic MLP (dense layers, tanh/relu hidden, linear output). Inference reuses preallocated buffers:
 * no allocation per call. The returned array is an internal buffer — read it before the next `forward` of the same net.
 */
export interface NetSpec {
  /** Layer widths including input and output, e.g. [26, 24, 1]. */
  sizes: number[];
  act: 'tanh' | 'relu';
  /** Per layer: weights row-major [out][in], then biases [out]. */
  w: number[];
  /** Feature normalisation baked into the file: x' = clamp((x - mean) / std, -6, 6). */
  mean?: number[];
  std?: number[];
}

export function paramCount(sizes: readonly number[]): number {
  let n = 0;
  for (let l = 0; l + 1 < sizes.length; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
  return n;
}

export class Mlp {
  readonly sizes: number[];
  readonly act: 'tanh' | 'relu';
  readonly w: Float64Array;
  readonly mean: Float64Array;
  readonly invStd: Float64Array;
  private readonly bufs: Float64Array[];
  private readonly x: Float64Array;

  constructor(spec: NetSpec) {
    if (spec.w.length !== paramCount(spec.sizes)) throw new Error(`mlp: ${spec.w.length} pesos, esperado ${paramCount(spec.sizes)}`);
    this.sizes = spec.sizes.slice();
    this.act = spec.act;
    this.w = Float64Array.from(spec.w);
    const n = spec.sizes[0];
    this.mean = new Float64Array(n);
    this.invStd = new Float64Array(n).fill(1);
    if (spec.mean) for (let i = 0; i < n; i++) this.mean[i] = spec.mean[i];
    if (spec.std) for (let i = 0; i < n; i++) this.invStd[i] = 1 / Math.max(1e-6, spec.std[i]);
    this.x = new Float64Array(n);
    this.bufs = spec.sizes.slice(1).map((s) => new Float64Array(s));
  }

  get inputSize(): number { return this.sizes[0]; }
  get outputSize(): number { return this.sizes[this.sizes.length - 1]; }

  forward(input: ArrayLike<number>): Float64Array {
    const x = this.x;
    for (let i = 0; i < x.length; i++) {
      const v = (input[i] - this.mean[i]) * this.invStd[i];
      x[i] = v > 6 ? 6 : v < -6 ? -6 : v;
    }
    let src: Float64Array = x;
    let o = 0;
    const L = this.sizes.length - 1;
    for (let l = 0; l < L; l++) {
      const nin = this.sizes[l], nout = this.sizes[l + 1];
      const dst = this.bufs[l];
      const bo = o + nin * nout;
      for (let j = 0; j < nout; j++) {
        let s = this.w[bo + j];
        const ro = o + j * nin;
        for (let i = 0; i < nin; i++) s += this.w[ro + i] * src[i];
        dst[j] = l === L - 1 ? s : this.act === 'tanh' ? Math.tanh(s) : s > 0 ? s : 0;
      }
      o = bo + nout;
      src = dst;
    }
    return src;
  }
}

/** In-place softmax with temperature (T → 0 approaches argmax). Returns the buffer. */
export function softmax(v: Float64Array, n: number, temperature = 1): Float64Array {
  const t = Math.max(1e-3, temperature);
  let m = -Infinity;
  for (let i = 0; i < n; i++) if (v[i] > m) m = v[i];
  let z = 0;
  for (let i = 0; i < n; i++) { v[i] = Math.exp((v[i] - m) / t); z += v[i]; }
  for (let i = 0; i < n; i++) v[i] /= z;
  return v;
}

/** Picks an index from scores: argmax when `temperature` <= 0 or `u` is null, else softmax sampling with uniform `u` in [0,1). */
export function chooseIndex(scores: ArrayLike<number>, n: number, temperature: number, u: number | null, scratch: Float64Array): number {
  let best = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;
  if (temperature <= 0 || u === null || n < 2) return best;
  for (let i = 0; i < n; i++) scratch[i] = scores[i];
  softmax(scratch, n, temperature);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += scratch[i]; if (u < acc) return i; }
  return best;
}
