/** Selection state of the strategic layer (UI reads it with `useUnitSelection`). */
import { create } from 'zustand';
import type { FormationId } from '../../core/contracts';

export interface UnitSelectionState {
  /** Selected formation ids (own first when mixed). */
  selected: FormationId[];
  hovered: FormationId | null;
  select(ids: FormationId[], additive?: boolean): void;
  toggle(id: FormationId): void;
  clear(): void;
  setHovered(id: FormationId | null): void;
}
export const useUnitSelection = create<UnitSelectionState>((set, get) => ({
  selected: [],
  hovered: null,
  select: (ids, additive) => set({ selected: additive ? [...new Set([...get().selected, ...ids])] : [...new Set(ids)] }),
  toggle: (id) => set({ selected: get().selected.includes(id) ? get().selected.filter((x) => x !== id) : [...get().selected, id] }),
  clear: () => (get().selected.length ? set({ selected: [] }) : undefined),
  setHovered: (hovered) => (get().hovered !== hovered ? set({ hovered }) : undefined),
}));
