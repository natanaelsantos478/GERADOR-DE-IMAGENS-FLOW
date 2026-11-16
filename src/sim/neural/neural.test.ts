import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../core/game';
import { nodeFetchJson } from '../../data/fetchNode';
import { loadWorldStatic } from '../../data/loadWorld';
import { SYSTEMS } from '../../app/systems';
import { createBattle, stepBattle } from '../tactical/core';
import { flatMap, scenarioInput } from '../tactical/scenario.test-util';
import { STRAT_IN, STRAT_OUT } from '../ai/neuralPlan';
import { GOAL_IN, STANCE_IN } from '../ai/neuralOp';
import { TAC_IN } from '../tactical/aiNeural';
import { Mlp, paramCount, type NetSpec } from './mlp';
import { PACK_FORMAT, getPolicyPack, netOf, setPolicyPack, validatePack, type PolicyPack } from './pack';

function rnd(seed: number) { let a = seed; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; }; }
const spec = (sizes: number[], seed: number, scale = 0.4): NetSpec => { const r = rnd(seed); return { sizes, act: 'tanh', w: Array.from({ length: paramCount(sizes) }, () => r() * scale) }; };
const randomPack = (seed: number, scale = 0.4): PolicyPack => ({
  format: PACK_FORMAT, version: 'test', seed, nets: {
    tac: spec([TAC_IN, 16, 1], seed, scale), strat: spec([STRAT_IN, 16, STRAT_OUT], seed + 1, scale),
    opGoal: spec([GOAL_IN, 8, 1], seed + 2, scale), opStance: spec([STANCE_IN, 8, 2], seed + 3, scale),
  },
});
const original = getPolicyPack();
afterEach(() => setPolicyPack(original));

describe('MLP', () => {
  it('inference is deterministic, reuses its buffer and matches a naive reference', () => {
    const s = spec([5, 7, 3], 1, 1);
    const a = new Mlp(s), b = new Mlp(s);
    const x = [0.3, -1.2, 0.8, 2, -0.1];
    const o1 = Array.from(a.forward(x));
    const buf = a.forward(x);
    expect(Array.from(buf)).toEqual(o1);
    expect(a.forward(x)).toBe(buf); // same buffer: no allocation per call
    expect(Array.from(b.forward(x))).toEqual(o1);
    // naive reference
    let o = 0, cur = x;
    for (let l = 0; l < 2; l++) {
      const nin = s.sizes[l], nout = s.sizes[l + 1], next: number[] = [];
      for (let j = 0; j < nout; j++) { let v = s.w[o + nin * nout + j]; for (let i = 0; i < nin; i++) v += s.w[o + j * nin + i] * cur[i]; next.push(l === 1 ? v : Math.tanh(v)); }
      o += nin * nout + nout; cur = next;
    }
    cur.forEach((v, i) => expect(o1[i]).toBeCloseTo(v, 12));
  });
  it('normalisation is applied from the weights file', () => {
    const s = spec([2, 3, 1], 4, 1);
    const plain = new Mlp(s), normed = new Mlp({ ...s, mean: [10, -4], std: [2, 5] });
    expect(normed.forward([12, 1])[0]).toBeCloseTo(plain.forward([1, 1])[0], 12);
  });
});

describe('policy pack', () => {
  it('the shipped weights load and every net has the expected input size', () => {
    const p = getPolicyPack();
    expect(p.format).toBe(PACK_FORMAT);
    expect(() => validatePack(p)).not.toThrow();
    expect(p.nets.tac?.sizes[0]).toBe(TAC_IN);
    expect(p.nets.strat?.sizes[0]).toBe(STRAT_IN);
    expect(p.nets.strat?.sizes.at(-1)).toBe(STRAT_OUT);
    expect(p.nets.opGoal?.sizes[0]).toBe(GOAL_IN);
    expect(p.nets.opStance?.sizes[0]).toBe(STANCE_IN);
  });
  it('rejects malformed weights and switches packs', () => {
    expect(() => setPolicyPack({ format: 1, version: 'x', seed: 0, nets: { tac: { sizes: [3, 2, 1], act: 'tanh', w: [1, 2] } } })).toThrow();
    expect(() => setPolicyPack({ ...randomPack(1), format: 99 })).toThrow();
    setPolicyPack(randomPack(1));
    expect(netOf('tac')).not.toBeNull();
    setPolicyPack({ format: PACK_FORMAT, version: 'e', seed: 0, nets: {} });
    expect(netOf('tac')).toBeNull();
  });
});

describe('tactical neural policy', () => {
  const play = (engine: ['neural' | 'rules', 'neural' | 'rules'], seconds: number, onStep?: (b: ReturnType<typeof createBattle>) => void) => {
    const b = createBattle({ ...scenarioInput(flatMap(), 'n'), engine, aiTemp: 0.3 }, 3);
    for (let t = 0; t < seconds * 20 && b.phase !== 'ended'; t++) { stepBattle(b, 0.05); if (t % 40 === 0) onStep?.(b); }
    return b;
  };
  it('is deterministic for a fixed seed and differs from the rule AI', () => {
    setPolicyPack(randomPack(5));
    const a = JSON.stringify(play(['neural', 'neural'], 120)), b = JSON.stringify(play(['neural', 'neural'], 120));
    expect(a).toBe(b);
    expect(a).not.toBe(JSON.stringify(play(['rules', 'rules'], 120)));
  });
  it('respects the traps: healthy, confident squads are never sent to retreat by the net', () => {
    setPolicyPack(randomPack(9, 3));
    const worst = new Map<number, { frac: number; morale: number }>();
    play(['neural', 'neural'], 150, (b) => {
      for (const s of b.squads) {
        const n = b.ents.filter((e) => e.sq === s.id && e.alive && !e.gone).length;
        const w = worst.get(s.id) ?? { frac: 1, morale: 1 };
        w.frac = Math.min(w.frac, n / s.n0); w.morale = Math.min(w.morale, s.morale); worst.set(s.id, w);
        if (s.order === 'retreat' && !['artillery', 'mlrs', 'sam', 'logistics'].includes(s.kind)) expect(w.frac < 0.5 || w.morale < 0.45).toBe(true);
      }
    });
  });
  it('rules engine ignores the pack entirely', () => {
    setPolicyPack(randomPack(5));
    const withPack = JSON.stringify(play(['rules', 'rules'], 60));
    setPolicyPack({ format: PACK_FORMAT, version: 'e', seed: 0, nets: {} });
    expect(withPack).toBe(JSON.stringify(play(['rules', 'rules'], 60)));
  });
});

describe('strategic neural policy (whole world)', () => {
  it('is deterministic, keeps spending inside the trap bounds and the rules key switches it off', async () => {
    const world = await loadWorldStatic(nodeFetchJson());
    const run = (rules: boolean, days: number) => {
      const g = createGame(world, { systems: SYSTEMS, playerCountryId: 'BRA', seed: 11, difficulty: 'normal', automation: { 'ai.controlsPlayer': true, 'ai.engine.neural': !rules } });
      for (let d = 0; d < days; d++) g.advanceHours(24);
      return g;
    };
    setPolicyPack(randomPack(21, 1));
    const a = run(false, 30), b = run(false, 30);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    for (const e of Object.values(a.state.economy.c)) for (const p of ['defense', 'research', 'security'] as const) { expect(e.spend[p]).toBeGreaterThanOrEqual(0.6); expect(e.spend[p]).toBeLessThanOrEqual(1.55); }
    const r1 = JSON.stringify(run(true, 20).state);
    setPolicyPack({ format: PACK_FORMAT, version: 'e', seed: 0, nets: {} });
    expect(JSON.stringify(run(true, 20).state)).toBe(r1);
  }, 300_000);
});
