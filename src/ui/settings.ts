/** Persisted user settings (localStorage; every access guarded). */
import { create } from 'zustand';
import type { LayerId } from '../render/globe';

export interface Settings {
  resolutionScale: number;
  dayNight: boolean;
  layers: Partial<Record<LayerId, boolean>>;
  volMaster: number;
  volMusic: number;
  volSfx: number;
  autosave: boolean;
}
const KEY = 'meridiano.settings.v1';
const DEFAULTS: Settings = { resolutionScale: 1, dayNight: false, layers: {}, volMaster: 0.8, volMusic: 0.5, volSfx: 0.8, autosave: true };

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS, resolutionScale: Math.min(2, window.devicePixelRatio || 1) };
}

export const useSettings = create<Settings & { set(p: Partial<Settings>): void }>()((set, get) => ({
  ...read(),
  set(p) {
    set(p);
    const { set: _s, ...rest } = get();
    try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* ignore */ }
  },
}));
export const settings = () => useSettings.getState();
