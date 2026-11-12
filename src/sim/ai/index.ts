/** Public surface of the AI module: system, advisor selector and types. */
import type { AdviceItem, CountryId, Ctx } from '../../core/contracts';
import { advice } from './advice';

export { aiSystem } from './system';
export { aiPt } from './i18n.pt';
export type { AiState, Op } from './types';

export const selectAdvice = (ctx: Ctx, c: CountryId): AdviceItem[] => advice(ctx, c);
/** Active offensive operation of a country (goal city + mode), for UI overlays. */
export function selectOperation(ctx: Ctx, c: CountryId) {
  const op = ctx.state.ai.op[c];
  if (!op) return null;
  const city = ctx.world.cities[op.ci];
  return { city: op.ci, name: city.name, pos: [city.lon, city.lat] as [number, number], mode: op.mode, rally: op.rally, sinceHours: op.since };
}
