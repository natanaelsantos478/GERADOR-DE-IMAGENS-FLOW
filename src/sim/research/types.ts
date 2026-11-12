import type { CountryId, TechId } from '../../core/contracts';
import type { Branch } from './catalog';

export interface CountryResearch {
  done: TechId[];
  current: TechId | null;
  /** Points already invested in techs that are not finished (kept when switching). */
  partial: Record<TechId, number>;
  queue: TechId[];
}
export interface TempModifier {
  key: string;
  value: number;
  /** Game hours, null = permanent. */
  until: number | null;
  source: string;
}
export interface ResearchState {
  c: Record<CountryId, CountryResearch>;
  /** Sparse: only countries with active temporary modifiers. */
  temp: Record<CountryId, TempModifier[]>;
}

export interface TechView {
  id: TechId;
  branch: Branch;
  tier: number;
  requires: TechId[];
  unlocks: string[];
  mods: Record<string, number>;
  cost: number;
  status: 'done' | 'current' | 'queued' | 'available' | 'locked';
  /** 0..1 for current/partial. */
  progress: number;
  missing: TechId[];
}

declare module '../../core/contracts' {
  interface SliceMap {
    research: ResearchState;
  }
  interface CommandMap {
    'res.queue': { tech: TechId };
    'res.unqueue': { tech: TechId };
    'res.start': { tech: TechId };
  }
  interface EventMap {
    'res.techDone': { country: CountryId; tech: TechId };
  }
  interface ResearchApi {
    /** Unit / building / fuel unlock (`unit.armor`, `build.silo`, `fuel.nuclear`); baseline ones are always true. */
    unlocked(c: CountryId, unlockId: string): boolean;
    researched(c: CountryId): readonly TechId[];
    /** Techs whose prerequisites are done and that are not done yet. */
    available(c: CountryId): TechId[];
    /** Effective cost in points for this country (diffusion discount applied). */
    cost(c: CountryId, tech: TechId): number;
    tree(c: CountryId): TechView[];
  }
}
