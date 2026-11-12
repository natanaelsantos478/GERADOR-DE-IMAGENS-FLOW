/**
 * App host: owns the loaded WorldStatic and the current Game, as a zustand store usable from React
 * (`useAppHost`) and from plain code (`appHost.getState()`).
 */
import { createStore, useStore } from 'zustand';
import type { CountryId, Difficulty, WorldStatic } from '../core/contracts';
import { createGame, loadGame, type Game } from '../core/game';
import type { LoadProgress } from '../data/loadWorld';
import { SYSTEMS } from './systems';

export type AppPhase = 'loading' | 'ready' | 'error';

export interface NewGameRequest {
  playerCountryId: CountryId;
  difficulty?: Difficulty;
  seed?: number;
  automation?: Record<string, boolean>;
}

export interface AppHostState {
  phase: AppPhase;
  progress: LoadProgress | null;
  error: string | null;
  world: WorldStatic | null;
  game: Game | null;
  /** Bumped whenever `game` is replaced or hydrated (useful as a React key). */
  gameVersion: number;
  setProgress(p: LoadProgress): void;
  setError(message: string): void;
  setWorld(world: WorldStatic): void;
  newGame(req: NewGameRequest): Game;
  /** Replaces the game with one built from a save object (validated). */
  loadSave(save: unknown): Game;
  /** Notifies subscribers after an in-place hydrate. */
  touchGame(): void;
}

export const appHost = createStore<AppHostState>()((set, get) => ({
  phase: 'loading',
  progress: null,
  error: null,
  world: null,
  game: null,
  gameVersion: 0,
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ phase: 'error', error }),
  setWorld: (world) => set({ world, phase: 'ready' }),
  newGame(req) {
    const world = get().world;
    if (!world) throw new Error('newGame antes de carregar os dados');
    const game = createGame(world, { systems: SYSTEMS, ...req });
    set((s) => ({ game, gameVersion: s.gameVersion + 1 }));
    return game;
  },
  loadSave(save) {
    const world = get().world;
    if (!world) throw new Error('loadSave antes de carregar os dados');
    const game = loadGame(world, SYSTEMS, save);
    set((s) => ({ game, gameVersion: s.gameVersion + 1 }));
    return game;
  },
  touchGame: () => set((s) => ({ gameVersion: s.gameVersion + 1 })),
}));

export function useAppHost<T>(selector: (s: AppHostState) => T): T {
  return useStore(appHost, selector);
}
