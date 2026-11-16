/** Versioned policy pack (weights JSON, outside GameState) and the registry the AIs read from. */
import { Mlp, type NetSpec } from './mlp';
import defaultPack from '../../../public/data/ai/policy.json';

export const PACK_FORMAT = 1;
/**
 * Feature-set version produced by the code. v2 fills the extension slots from the real fields (commander skill, fatigue, weather, readiness).
 * Packs without `features` (v1, trained before those mechanics existed) saw zeros there: they stay valid because the slots are zeroed for them,
 * but a v2 net must be trained fresh (--fresh). A net whose input width differs from the code's is ignored (rules take over) — never an error.
 */
export const FEATURES_VERSION = 2;
export const extLive = (): boolean => (pack.features ?? 1) >= 2;
export type NetName = 'tac' | 'opGoal' | 'opStance' | 'strat';

export interface PolicyPack {
  format: number;
  /** Human-readable version of the weights, e.g. "2026.11-r1". */
  version: string;
  seed: number;
  notes?: string;
  /** Feature-set version the weights were trained with. Absent/1 = the 4 extension slots (commander, fatigue, weather, wear) were always 0; 2 = real military-mechanics fields. */
  features?: number;
  nets: Partial<Record<NetName, NetSpec>>;
}

let pack: PolicyPack = defaultPack as unknown as PolicyPack;
let built = new Map<NetName, Mlp>();

export function validatePack(p: PolicyPack): void {
  if (p.format !== PACK_FORMAT) throw new Error(`pacote de pesos: formato ${p.format} != ${PACK_FORMAT}`);
  for (const [k, spec] of Object.entries(p.nets)) new Mlp(spec as NetSpec); // throws on size mismatch
  void built;
}

/** Replaces the active pack (training tools, tests, or a fetched file in the browser). */
export function setPolicyPack(p: PolicyPack): void {
  validatePack(p);
  pack = p;
  built = new Map();
}
export const getPolicyPack = (): PolicyPack => pack;

/** Net by name, or null when the pack has none (the AI then falls back to its rules). */
export function netOf(name: NetName, expectIn?: number): Mlp | null {
  let n = built.get(name);
  if (!n) {
    const spec = pack.nets[name];
    if (!spec) return null;
    built.set(name, (n = new Mlp(spec)));
  }
  if (expectIn !== undefined && n.sizes[0] !== expectIn) return null;
  return n;
}
