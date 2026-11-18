/**
 * Destroyed buildings seen by the city 3D: the tactical layer publishes them (footprint in lon/lat + battle time of the fall), the city tiles hide the standing
 * building, play the collapse and then keep the rubble. Decoupled by this tiny store so neither side imports the other.
 */
import type { RubbleBy, RubbleMat } from './rubble';

export interface Ruin {
  /** Unique within the store (battle id + nav building id). */
  key: string;
  id: number;
  /** Footprint outer ring, flat [lon,lat,...]. */
  ring: number[];
  lon: number; lat: number;
  fl: number; h: number; m: RubbleMat; by: RubbleBy;
  /** Battle time (s) of the fall and of the animation length. */
  t: number; dur: number;
  /** Breach point [lon,lat] (the vehicle's side): the wall falls away from it. */
  brk?: [number, number];
}
interface State { list: Ruin[]; simT: number; pin: number | null; ver: number }
const st: State = { list: [], simT: 0, pin: null, ver: 0 };
const listeners = new Set<() => void>();

/** Animation progress 0..1 (1 = finished, rubble only) at the store's clock; a pinned value (tests) overrides it. */
export const ruinProgress = (r: Ruin): number => (st.pin !== null ? st.pin : Math.min(1, Math.max(0, (st.simT - r.t) / Math.max(0.1, r.dur))));
export const ruinsNow = (): readonly Ruin[] => st.list;
export const ruinsVersion = (): number => st.ver;

/** Replace the list (same array reference = unchanged) and the battle clock. Listeners run when something visible can change. */
export function setRuins(list: Ruin[], simT: number): void {
  const listChanged = list !== st.list;
  const animating = st.list.some((r) => (st.simT - r.t) / r.dur < 1) || list.some((r) => (simT - r.t) / r.dur < 1);
  if (!listChanged && !animating) { st.simT = simT; return; }
  if (listChanged) st.ver++;
  st.list = list; st.simT = simT;
  listeners.forEach((f) => f());
}
/** Test/debug: freeze every collapse at progress p (null = follow the clock). */
export function pinRuins(p: number | null): void { st.pin = p; st.ver++; listeners.forEach((f) => f()); }
export const onRuins = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
