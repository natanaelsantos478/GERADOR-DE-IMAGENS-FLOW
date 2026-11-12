/** Process-wide handle to the live Globe, for modules that render on top of it (units, tactical, UI). */
import type { Globe } from './types';

let current: Globe | null = null;
const subs = new Set<(g: Globe | null) => void>();

export const getGlobe = () => current;
export function setGlobe(g: Globe | null) {
  current = g;
  subs.forEach((f) => f(g));
}
/** Calls `cb` now (if a globe exists) and on every change; returns unsubscribe. */
export function onGlobe(cb: (g: Globe | null) => void): () => void {
  subs.add(cb);
  if (current) cb(current);
  return () => subs.delete(cb);
}
