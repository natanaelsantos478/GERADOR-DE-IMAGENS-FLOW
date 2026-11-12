export { tacticalSystem, setTacticalMapProvider } from './system';
export { createBattle, stepBattle, snapshotBattle as snapshot, result } from './core';
export { issueOrder } from './orders';
export { buildMapFromWorld, defaultObjectives } from './mapWorld';
export { tacticalPt } from './i18n.pt';
export { UNITS, kindFromTemplate } from './units';
export type * from './types';
