/** AI state (pure JSON). The AI only issues public commands; this slice holds its own memory. */
import type { CountryId, FormationId } from '../../core/contracts';

export interface Op {
  /** Goal city index. */
  ci: number;
  rally: [number, number];
  mode: 'gather' | 'attack';
  since: number;
}

export interface AiState {
  /** Active land operation per country. */
  op: Record<CountryId, Op>;
  /** `${country}:${cityIdx}` → hours until which the goal is considered unreachable. */
  bad: Record<string, number>;
  /** Victim → who nuked it and when. */
  nuked: Record<CountryId, { by: CountryId; at: number }>;
  /** Formation → hours of last retreat order. */
  retreated: Record<FormationId, number>;
  /** Formation → hours of last movement order (anti-spam: failed plans are expensive). */
  ordered: Record<FormationId, number>;
  /** Country → hours of next garrison review / peace offer. */
  nextGarrison: Record<CountryId, number>;
  /** War → hours when the AI first saw it (wars that predate the game start). */
  seen: Record<string, number>;
  nextPeace: Record<CountryId, number>;
  stats: { thinks: number; warThinks: number; orders: number; battles: number; produced: number; strikes: number; launches: number; peaceOffers: number };
}

declare module '../../core/contracts' {
  interface SliceMap {
    ai: AiState;
  }
}
