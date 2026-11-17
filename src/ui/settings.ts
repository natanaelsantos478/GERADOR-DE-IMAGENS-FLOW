/** Persisted user settings (localStorage; every access guarded). */
import { create } from 'zustand';
import type { LayerId } from '../render/globe';
import { detectQuality, setQuality, type QualityId } from '../render/globe/quality';

export interface Settings {
  resolutionScale: number;
  dayNight: boolean;
  layers: Partial<Record<LayerId, boolean>>;
  volMaster: number;
  volMusic: number;
  volSfx: number;
  autosave: boolean;
  /** Graphics profile; defaults to the one detected for this device. */
  quality: QualityId;
  showFps: boolean;
}
const KEY = 'meridiano.settings.v1';
const DEFAULTS: Settings = { resolutionScale: 1, dayNight: false, layers: {}, volMaster: 0.8, volMusic: 0.5, volSfx: 0.8, autosave: true, quality: 'high', showFps: false };

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      const s = { ...DEFAULTS, quality: detectQuality(), ...saved };
      setQuality(s.quality);
      return s;
    }
  } catch { /* storage unavailable */ }
  const quality = detectQuality();
  setQuality(quality);
  return { ...DEFAULTS, quality, resolutionScale: Math.min(quality === 'mobile' ? 0.75 : 2, window.devicePixelRatio || 1) };
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
