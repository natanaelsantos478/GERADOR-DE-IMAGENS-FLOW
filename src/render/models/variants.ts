// Resolves a generic catalog modelId (mbt, fighter, ...) to a real-world variant by country.
import type { Manifest } from '../units/common';

interface ClassVariants { default: string; byCountry: Record<string, string[]> }
type VariantMap = Record<string, ClassVariants>;

let vmap: VariantMap = {};
let vP: Promise<VariantMap> | null = null;

/** Loads variants.json once (idempotent); resolveModel works (generic fallback) before it resolves. */
export const loadVariants = (): Promise<VariantMap> =>
  (vP ??= fetch(new URL('models/variants.json', document.baseURI)).then((r) => r.json() as Promise<VariantMap>).then((m) => (vmap = m)).catch(() => vmap));
export const setVariants = (m: VariantMap) => { vmap = m; vP = Promise.resolve(m); };

/** Generic catalog model id -> variants.json class. */
const CLASS_OF: Record<string, string> = {
  mbt: 'mbt', apc: 'apc', ifv: 'ifv', spg: 'spg', mlrs: 'mlrs', sam: 'sam', soldier: 'soldier',
  fighter: 'fighter', bomber: 'bomber', transport_plane: 'transport_plane', drone: 'drone',
  destroyer: 'destroyer', carrier: 'carrier', submarine: 'submarine', frigate: 'frigate',
  attack_heli: 'attack_heli', transport_heli: 'transport_heli',
  // civil aircraft parked at airports (city3d/airplanes.ts)
  airliner_narrow: 'airliner_narrow', airliner_wide: 'airliner_wide', airliner_regional: 'airliner_regional', bizjet: 'bizjet', light_plane: 'light_plane',
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

export interface ResolveOpts {
  /** Only models that have animations (tactical soldiers). */
  needAnim?: boolean;
  /** Manifest, used to validate that the chosen model exists. */
  mf?: Manifest;
}

/** Stable: `seed` (formation id + unit slot, or squad ref) picks among the country's models by hash. */
export function resolveModel(generic: string, countryId: string | undefined, seed: string, opts: ResolveOpts = {}): string {
  const cls = CLASS_OF[generic];
  if (!cls || !countryId || countryId === 'REB') return generic;
  const c = vmap[cls];
  if (!c) return generic;
  const ok = (id: string) => (!opts.mf || !!opts.mf[id]) && (!opts.needAnim || !!opts.mf?.[id]?.animations?.length);
  const list = (c.byCountry[countryId] ?? []).filter(ok);
  if (list.length) return list[hash(`${seed}`) % list.length];
  return ok(c.default) ? c.default : generic;
}
