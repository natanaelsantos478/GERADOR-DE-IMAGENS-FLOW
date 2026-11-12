/** UI-only state: screen flow, open windows, selection, pick mode, toasts. */
import { create } from 'zustand';
import type { LonLat, NewsKind } from '../core/contracts';

export type Screen = 'menu' | 'newgame' | 'load' | 'settings' | 'credits' | 'game';

/** What the player clicked. `kind` selects the registered inspector. */
export interface Selection {
  kind: string;
  id?: string | number;
  /** Dataset index (city, plant, airport, port). */
  index?: number;
  province?: string | null;
  country?: string | null;
  lonLat?: LonLat | null;
  [k: string]: unknown;
}
export interface WinState { x: number; y: number; z: number }
export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'ok' }
export interface PickMode { labelKey: string; onPick(p: { lonLat: LonLat; province: string | null }): void }

interface UiState {
  screen: Screen;
  /** In-game menu overlay (Esc). */
  pauseMenu: boolean;
  /** Where `settings`/`load` return to. */
  back: Screen;
  wins: Record<string, WinState>;
  zTop: number;
  selection: Selection | null;
  pickMode: PickMode | null;
  toasts: Toast[];
  feedFilter: Record<NewsKind | 'mine', boolean>;
  go(s: Screen): void;
  setPauseMenu(v: boolean): void;
  openWin(id: string): void;
  closeWin(id: string): void;
  toggleWin(id: string): void;
  moveWin(id: string, x: number, y: number): void;
  focusWin(id: string): void;
  select(s: Selection | null): void;
  setPick(p: PickMode | null): void;
  toast(text: string, kind?: Toast['kind']): void;
  setFeed(k: NewsKind | 'mine', v: boolean): void;
}

let toastId = 1;
export const useUi = create<UiState>()((set, get) => ({
  screen: 'menu',
  pauseMenu: false,
  back: 'menu',
  wins: {},
  zTop: 10,
  selection: null,
  pickMode: null,
  toasts: [],
  feedFilter: { mine: true, economy: true, diplomacy: true, research: true, military: true, tactical: true, politics: true, world: true, disaster: true, game: true },
  go: (screen) => set((s) => ({ screen, back: screen === 'settings' || screen === 'load' ? s.screen : s.back })),
  setPauseMenu: (pauseMenu) => set({ pauseMenu }),
  openWin(id) {
    const s = get();
    if (s.wins[id]) return get().focusWin(id);
    const n = Object.keys(s.wins).length;
    set({ wins: { ...s.wins, [id]: { x: 76 + 28 * (n % 8), y: 60 + 28 * (n % 8), z: s.zTop + 1 } }, zTop: s.zTop + 1 });
  },
  closeWin(id) {
    const { [id]: _, ...rest } = get().wins;
    set({ wins: rest });
  },
  toggleWin: (id) => (get().wins[id] ? get().closeWin(id) : get().openWin(id)),
  moveWin: (id, x, y) => set((s) => (s.wins[id] ? { wins: { ...s.wins, [id]: { ...s.wins[id], x, y } } } : s)),
  focusWin(id) {
    const s = get();
    if (!s.wins[id] || s.wins[id].z === s.zTop) return;
    set({ wins: { ...s.wins, [id]: { ...s.wins[id], z: s.zTop + 1 } }, zTop: s.zTop + 1 });
  },
  select: (selection) => set({ selection }),
  setPick: (pickMode) => set({ pickMode }),
  toast(text, kind = 'info') {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), kind === 'error' ? 5000 : 3500);
  },
  setFeed: (k, v) => set((s) => ({ feedFilter: { ...s.feedFilter, [k]: v } })),
}));
export const ui = () => useUi.getState();

declare global {
  interface Window {
    /** UI store handle (e2e/debug). */
    __ui?: typeof useUi;
  }
}
if (typeof window !== 'undefined') window.__ui = useUi;
