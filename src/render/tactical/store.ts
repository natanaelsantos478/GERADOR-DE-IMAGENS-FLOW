/** Selection state of the tactical layer (squad ids of `Battle.squads`). */
import { create } from 'zustand';

export interface TacSelectionState {
  selected: number[];
  /** Last order feedback for the HUD: reason key when rejected. */
  lastError: string | null;
  select(ids: number[], additive?: boolean): void;
  clear(): void;
  setError(e: string | null): void;
}
export const useTacSelection = create<TacSelectionState>((set, get) => ({
  selected: [],
  lastError: null,
  select: (ids, additive) => set({ selected: additive ? [...new Set([...get().selected, ...ids])] : [...new Set(ids)] }),
  clear: () => (get().selected.length ? set({ selected: [] }) : undefined),
  setError: (lastError) => set({ lastError }),
}));
