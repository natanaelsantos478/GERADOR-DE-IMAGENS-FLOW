/** Which AI engine drives decisions, and how noisy the neural choice is per difficulty. */
import type { Difficulty } from '../../core/contracts';

export type Engine = 'neural' | 'rules';
export const NEURAL_KEY = 'ai.engine.neural';

/** Rules are the default; `automation['ai.engine.neural'] === true` opts into the neural AI (per country: `ai.engine.neural.<ID>`). */
export const engineOf = (meta: { automation: Record<string, unknown> }): Engine => (meta.automation[NEURAL_KEY] === true ? 'neural' : 'rules');

/** Softmax temperature of the choice: harder AIs are more decisive, easier ones more erratic. */
export function temperatureOf(d: Difficulty | string): number {
  return d === 'hard' ? 0.12 : d === 'sandbox' ? 0.6 : 0.3;
}
