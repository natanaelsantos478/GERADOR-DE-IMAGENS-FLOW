/**
 * Deterministic climate model: latitude, relief, month and local hour give the mean state;
 * seeded 3-D value noise drifting eastwards gives weather fronts. Pure function of (lon, lat, hours, seed):
 * nothing is stored, so render / UI / AI can query it anywhere and saves stay identical.
 */

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'monsoon' | 'heat' | 'dust';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export interface WeatherMods {
  /** Speed multipliers (0..1+) off-road, on road, at sea; air sortie rate. */
  off: number;
  road: number;
  sea: number;
  air: number;
  /** Tactical sight range multiplier 0..1. */
  vis: number;
  /** Fatigue accumulation multiplier (≥ 1 in cold / heat extremes, adjusted by commander traits elsewhere). */
  fatigue: number;
  /** Equipment wear multiplier. */
  wear: number;
  /** Cold / heat stress parts of `fatigue`, 0..1, so traits can cancel one of them. */
  cold: number;
  heat: number;
}

export interface Weather {
  kind: WeatherKind;
  season: Season;
  tempC: number;
  /** 0..1 precipitation intensity (rain or snow). */
  precip: number;
  snow: boolean;
  /** 0..1 persistent snow depth proxy. */
  snowCover: number;
  /** 0..1 soft ground. */
  mud: number;
  cloud: number;
  /** 0..1 fog density. */
  fog: number;
  visKm: number;
  ceilingM: number;
  windMs: number;
  mods: WeatherMods;
}

export interface WeatherOpts {
  seed?: number;
  /** Province ruggedness 0..1 (default 0.3) and mean elevation in metres (default derived from ruggedness). */
  rugged?: number;
  elev?: number;
}

// Arid (a), monsoon (m) boxes: [lonMin, latMin, lonMax, latMax, strength].
const ARID: number[][] = [
  [-17, 15, 35, 31, 1], [35, 12, 60, 32, 0.9], [55, 24, 70, 38, 0.7], [75, 36, 110, 46, 0.7],
  [112, -32, 142, -20, 0.8], [-72, -30, -68, -18, 1], [-118, 23, -104, 35, 0.7], [12, -28, 24, -17, 0.8],
  [-70, -50, -66, -38, 0.5],
];
const MONSOON: number[][] = [[68, 8, 95, 28, 1], [95, 5, 125, 23, 0.9], [-16, 5, 18, 14, 0.8], [-62, -10, -45, 3, 0.4]];

const inBox = (b: number[], lon: number, lat: number) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
/** 0..1 how arid a place is (deserts 1): the detailed battle view lays sand there as the base ground. */
export const aridityAt = (lon: number, lat: number): number => boxStrength(ARID, lon, lat);

function boxStrength(boxes: number[][], lon: number, lat: number): number {
  let v = 0;
  for (const b of boxes) if (inBox(b, lon, lat)) v = Math.max(v, b[4]);
  return v;
}

function h3(seed: number, x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (t: number) => t * t * (3 - 2 * t);
function noise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => h3(seed, xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Weather at a point and time (`hours` = game hours since 2026-01-01 00:00 UTC). */
export function weatherAt(lon: number, lat: number, hours: number, opts: WeatherOpts = {}): Weather {
  const seed = opts.seed ?? 0;
  const rugged = opts.rugged ?? 0.3;
  const elev = opts.elev ?? 250 + 1800 * rugged * rugged;
  const a = Math.abs(lat), north = lat >= 0;
  const doy = (((hours / 24) % 365.25) + 365.25) % 365.25;
  // Seasonal phase: +1 at the local midsummer, −1 at midwinter (peak 1 Jul in the north, thermal lag included).
  const ph = Math.cos((2 * Math.PI * (doy - 197)) / 365.25) * (north ? 1 : -1);
  const season: Season = ph > 0.55 ? 'summer' : ph < -0.55 ? 'winter' : ((north ? doy < 197 : doy >= 197) ? 'spring' : 'autumn');
  const arid = boxStrength(ARID, lon, lat);
  const mons = boxStrength(MONSOON, lon, lat);
  const monsoon = mons * clamp((ph + 0.2) * 1.2, 0, 1) * (a < 30 ? 1 : 0.5);
  const localHour = (((hours + lon / 15) % 24) + 24) % 24;

  // Temperature: annual mean by latitude, seasonal swing growing with latitude (and dryness), lapse rate, diurnal cycle.
  const mean = 27 - 0.0074 * a * a + (arid ? 3 * arid : 0);
  const swing = Math.min(19, 0.27 * a + 3 * arid) * (mons > 0 ? 0.5 : 1);
  const diurnal = (4 + 7 * arid) * Math.cos((2 * Math.PI * (localHour - 15)) / 24);
  const base = mean + swing * ph - 6.5 * (elev / 1000) + diurnal;

  // Fronts: eastward-drifting smooth noise (2 octaves) + slow evolution.
  const drift = 0.22 * hours;
  const f1 = noise3(seed, (lon - drift) / 17, lat / 11, hours / 70);
  const f2 = noise3(seed + 7, (lon - drift * 0.6) / 6, lat / 4.5, hours / 24);
  const front = 0.65 * f1 + 0.35 * f2;
  const dTemp = (front - 0.5) * 7;
  const tempC = base + dTemp;

  // Wet probability by zone: tropics wet, subtropical belts dry, mid-latitudes frontal, polar dry-ish.
  let wet = a < 8 ? 0.5 : a < 20 ? 0.34 : a < 35 ? 0.22 : a < 62 ? 0.38 : 0.26;
  wet = wet * (1 - 0.9 * arid) + monsoon * 0.55 + (season === 'winter' && a >= 30 && a < 62 ? 0.06 : 0);
  wet += 0.1 * Math.min(1, rugged * 1.2);
  const precip = clamp((front - (1 - wet)) / Math.max(0.08, wet), 0, 1);
  const snow = tempC < 0.5 && precip > 0.04;
  const cloud = clamp(0.2 + 0.75 * front + 0.2 * (monsoon + (arid ? -0.3 * arid : 0)), 0, 1);

  // Fog: cool, humid early hours.
  const fogN = noise3(seed + 31, lon / 3, lat / 3, Math.floor(hours / 24));
  const fog = tempC > -3 && tempC < 14 && precip < 0.35 && arid < 0.5 && (localHour < 9.5 || localHour > 22) && fogN > 0.58 ? clamp((fogN - 0.58) * 3.2, 0, 1) : 0;
  const windMs = 2.5 + 11 * noise3(seed + 53, (lon - drift * 1.3) / 8, lat / 6, hours / 20) + 6 * precip;
  const dust = arid > 0.5 && windMs > 10 ? clamp((windMs - 10) / 5, 0, 1) : 0;

  // Persistent snow cover / frozen ground from the seasonal temperature (no history needed).
  const dayMean = base - diurnal;
  const snowCover = clamp((-dayMean + 1) / 9, 0, 1) * (a > 28 || elev > 1500 ? 1 : 0);
  // Mud: thaw and autumn rains in the mid-latitudes, monsoon in the tropics, heavy rain anywhere on flat ground.
  const thaw = (season === 'spring' || season === 'autumn') && a > 33 && dayMean > -2 && dayMean < 9 ? 0.45 : 0;
  const lowland = 1 - 0.6 * rugged;
  const mud = clamp(((thaw + 0.55 * precip * (snow ? 0.4 : 1) + 0.8 * monsoon * (0.5 + precip)) * lowland + (tempC > 0 ? 0.25 * snowCover * (dayMean > -1 ? 1 : 0) : 0)) * (1 - 0.85 * arid), 0, 1);

  const visKm = Math.max(0.3, 20 * (1 - 0.7 * precip) * (1 - 0.85 * fog) * (1 - 0.8 * dust) * (snow ? 0.75 : 1));
  const ceilingM = Math.round(clamp(6500 * (1 - 0.88 * cloud) - 3200 * precip - 3000 * fog, 60, 8000));

  const cold = clamp((-4 - tempC) / 26, 0, 1);
  const heat = clamp((tempC - 31) / 14, 0, 1);
  const storm = clamp((windMs - 14) / 6, 0, 1) * (precip > 0.2 ? 1 : 0.4);
  const mods: WeatherMods = {
    off: clamp(1 - 0.5 * mud - 0.32 * snowCover - 0.1 * precip - 0.1 * heat, 0.2, 1),
    road: clamp(1 - 0.12 * mud - 0.2 * snowCover - 0.06 * precip - 0.05 * fog, 0.4, 1),
    sea: clamp(1 - 0.4 * storm - 0.1 * fog, 0.45, 1),
    air: clamp(Math.min(1, ceilingM / 1500) * Math.min(1, visKm / 6) * (1 - 0.5 * storm) * (snow ? 0.85 : 1), 0.05, 1),
    vis: clamp(visKm / 20, 0.07, 1),
    fatigue: 1 + 0.9 * cold + 0.9 * heat + 0.25 * mud + 0.15 * precip,
    wear: 1 + 0.5 * mud + 0.6 * dust + 0.25 * cold + 0.2 * heat,
    cold, heat,
  };
  const kind: WeatherKind = dust > 0.3 ? 'dust' : fog > 0.4 ? 'fog' : storm > 0.5 ? 'storm' : precip > 0.2 ? (snow ? 'snow' : monsoon > 0.3 ? 'monsoon' : 'rain') : heat > 0.5 ? 'heat' : cloud > 0.6 ? 'cloudy' : 'clear';
  return {
    kind, season, tempC: r2(tempC), precip: r2(precip), snow, snowCover: r2(snowCover), mud: r2(mud), cloud: r2(cloud), fog: r2(fog),
    visKm: r2(visKm), ceilingM, windMs: r2(windMs),
    mods: { off: r2(mods.off), road: r2(mods.road), sea: r2(mods.sea), air: r2(mods.air), vis: r2(mods.vis), fatigue: r2(mods.fatigue), wear: r2(mods.wear), cold: r2(cold), heat: r2(heat) },
  };
}
