/** Graphics quality profiles + device detection. Mobile / weak GPUs get the "mobile" profile by default. */
export type QualityId = 'mobile' | 'low' | 'mid' | 'high';

export interface QualityProfile {
  id: QualityId;
  /** Upper bound for the WebGL resolution scale (also capped by devicePixelRatio). */
  resolutionScale: number;
  /** Cesium globe.maximumScreenSpaceError: higher = fewer terrain/imagery tiles. */
  maxScreenSpaceError: number;
  dayNight: boolean;
  atmosphere: boolean;
  fog: boolean;
  /** Multiplies marker/label visibility distances (< 1 = fewer markers on screen). */
  markerLod: number;
  /** Suggested caps for the units layer (3D models / particles); read via `getQuality()`. */
  maxModels: number;
  particleScale: number;
}

export const QUALITY: Record<QualityId, QualityProfile> = {
  mobile: { id: 'mobile', resolutionScale: 0.75, maxScreenSpaceError: 4, dayNight: false, atmosphere: false, fog: false, markerLod: 0.5, maxModels: 24, particleScale: 0.35 },
  low: { id: 'low', resolutionScale: 0.75, maxScreenSpaceError: 3.5, dayNight: false, atmosphere: false, fog: false, markerLod: 0.6, maxModels: 40, particleScale: 0.5 },
  mid: { id: 'mid', resolutionScale: 1, maxScreenSpaceError: 2.6, dayNight: false, atmosphere: true, fog: true, markerLod: 0.85, maxModels: 120, particleScale: 0.8 },
  high: { id: 'high', resolutionScale: 2, maxScreenSpaceError: 2.2, dayNight: true, atmosphere: true, fog: true, markerLod: 1, maxModels: 400, particleScale: 1 },
};

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return ua || coarse;
}

/** Profile used when the user never chose one. */
export function detectQuality(): QualityId {
  if (typeof navigator === 'undefined') return 'high';
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (isMobileDevice()) return 'mobile';
  if ((nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 2) return 'low';
  return 'high';
}

let current: QualityProfile = QUALITY[detectQuality()];
export const getQuality = (): QualityProfile => current;
export function setQuality(id: QualityId): QualityProfile {
  current = QUALITY[id] ?? QUALITY.high;
  return current;
}

/** Effective WebGL resolution scale: profile bound, never above the device pixel ratio cap of 1.5 on mobile. */
export function effectiveResolution(p: QualityProfile = current): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(p.resolutionScale, p.id === 'mobile' ? Math.min(dpr, 1.5) : Math.max(dpr, 1));
}
