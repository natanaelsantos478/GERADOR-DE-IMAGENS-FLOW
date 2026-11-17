/** Selection state of the tactical layer (squad ids of `Battle.squads`). */
import { create } from 'zustand';

export interface TacSelectionState {
  selected: number[];
  /** Last order feedback for the HUD: reason key when rejected. */
  lastError: string | null;
  select(ids: number[], additive?: boolean): void;
  clear(): void;
  setError(e: string | null): void;
  /** UI -> layer: fly the camera to a squad (`n` changes on every request so repeating the same squad still fires). */
  focusRequest: { sq: number; n: number } | null;
  requestFocus(sq: number): void;
}
export const useTacSelection = create<TacSelectionState>((set, get) => ({
  selected: [],
  lastError: null,
  select: (ids, additive) => set({ selected: additive ? [...new Set([...get().selected, ...ids])] : [...new Set(ids)] }),
  clear: () => (get().selected.length ? set({ selected: [] }) : undefined),
  setError: (lastError) => set({ lastError }),
  focusRequest: null,
  requestFocus: (sq) => set({ focusRequest: { sq, n: (get().focusRequest?.n ?? 0) + 1 } }),
}));
