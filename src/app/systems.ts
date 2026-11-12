/**
 * Central registration of simulation systems. Each module exports its `SimSystem` (built with
 * `defineSystem` from src/core/registry) and is added to this list; ORDER HERE DOES NOT MATTER —
 * the registry runs them as research → economy → diplomacy → military → tactical → ai.
 *
 * Where each module plugs in (import + list entry):
 *   import { researchSystem } from '../sim/research/system';   // DIP  — research + modifiers
 *   import { economySystem } from '../sim/economy/system';     // ECO
 *   import { diplomacySystem } from '../sim/diplomacy/system'; // DIP
 *   import { militarySystem } from '../sim/military/system';   // MIL
 *   import { tacticalSystem } from '../sim/tactical/system';   // TAC
 *   import { aiSystem } from '../sim/ai/system';               // IA
 */
import type { AnySimSystem } from '../core/contracts';
import { researchSystem } from '../sim/research/system';
import { economySystem } from '../sim/economy/system';
import { diplomacySystem } from '../sim/diplomacy/system';
import { militarySystem } from '../sim/military/system';
import { tacticalSystem } from '../sim/tactical/system';
import { aiSystem } from '../sim/ai/system';

export const SYSTEMS: readonly AnySimSystem[] = [
  researchSystem,
  economySystem,
  diplomacySystem,
  militarySystem,
  tacticalSystem,
  aiSystem,
] as readonly AnySimSystem[];
