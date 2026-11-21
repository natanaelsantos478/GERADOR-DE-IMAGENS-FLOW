/**
 * Close-range level of detail of the detailed battle view (pure logic, no Cesium: unit-tested).
 * - which units swap to the detailed models under `nearRange()` metres (with hysteresis, so a camera hovering at the limit does not flicker);
 * - which near model stands for a given far model / unit kind;
 * - soldier state -> animation clip role, and the cap of simultaneously animated skeletons;
 * - vehicle rig maths (turret slew toward its target, gun elevation and recoil, wheel rolling, tread scroll, steering).
 */
import type { UnitKind } from '../../sim/tactical/types';

/** Camera distance (m) under which a unit uses the detailed model (configurable: `window.__nearLodM`, or `setNearRange`). */
export const NEAR_DEFAULT_M = 150;
let nearM = NEAR_DEFAULT_M;
export const setNearRange = (m: number) => { nearM = Math.max(0, m); };
export const nearRange = (): number => {
  const w = (globalThis as { __nearLodM?: number }).__nearLodM;
  return typeof w === 'number' && w >= 0 ? w : nearM;
};
/** The detailed models are heavier: the low graphic profiles use a smaller radius and fewer instances. */
export interface NearBudget { rangeScale: number; maxVehicles: number; maxSoldiers: number; maxAnimated: number; swapsPerFrame: number }
export const NEAR_BUDGET: Record<string, NearBudget> = {
  mobile: { rangeScale: 0.6, maxVehicles: 10, maxSoldiers: 40, maxAnimated: 40, swapsPerFrame: 2 },
  low: { rangeScale: 0.75, maxVehicles: 14, maxSoldiers: 70, maxAnimated: 70, swapsPerFrame: 3 },
  mid: { rangeScale: 1, maxVehicles: 24, maxSoldiers: 120, maxAnimated: 120, swapsPerFrame: 4 },
  high: { rangeScale: 1, maxVehicles: 40, maxSoldiers: 200, maxAnimated: 150, swapsPerFrame: 6 },
};
export const budgetFor = (q: string): NearBudget => NEAR_BUDGET[q] ?? NEAR_BUDGET.mid;

export type Lod = 'near' | 'far';
/** Hysteresis: enter near under `range`, leave it only past `range * (1 + hyst)`. */
export function selectLod(dist: number, current: Lod | undefined, range = nearRange(), hyst = 0.2): Lod {
  if (range <= 0) return 'far';
  if (current === 'near') return dist > range * (1 + hyst) ? 'far' : 'near';
  return dist < range ? 'near' : 'far';
}

/**
 * Near model standing for a far model id of the manifest (`mbt_t72` -> `near_mbt`, `soldier_ru` -> `nsoldier_ru`, ...). Null: no near model for that class
 * (the far model stays). `has` tells whether the near manifest holds an id.
 */
export function nearModelFor(farId: string, has: (id: string) => boolean = () => true): string | null {
  let id: string | null = null;
  if (/^soldier/.test(farId)) id = /_ru|_cn/.test(farId) ? 'nsoldier_ru' : /desert/.test(farId) ? 'nsoldier_des' : /urban/.test(farId) ? 'nsoldier_urb' : 'nsoldier';
  else if (/^mbt/.test(farId)) id = 'near_mbt';
  else if (/^ifv/.test(farId)) id = 'near_ifv';
  else if (/^apc/.test(farId)) id = 'near_apc';
  else if (/^spg/.test(farId)) id = 'near_spg';
  else if (/^truck/.test(farId)) id = 'near_truck';
  else if (/^sam/.test(farId)) id = 'near_sam';
  return id && has(id) ? id : null;
}
export const isSoldierKind = (k: UnitKind | string) => k === 'infantry' || k === 'special' || k === 'engineer';

export interface LodCand { id: number; dist: number; near: boolean; soldier: boolean; /** has a near model */ can: boolean }
/**
 * Decides who is near this frame: nearest first, within the budget per class; at most `swaps` changes of level per call (the models take a few
 * frames to load, and a camera jump must not stall the game). Returns id -> level for the ones that change.
 */
export function planLod(c: LodCand[], b: NearBudget, range = nearRange() * b.rangeScale, swaps = b.swapsPerFrame): Map<number, Lod> {
  const out = new Map<number, Lod>();
  const sorted = [...c].sort((x, y) => x.dist - y.dist);
  let nv = 0, ns = 0, n = 0;
  for (const u of sorted) {
    const want: Lod = u.can ? selectLod(u.dist, u.near ? 'near' : 'far', range) : 'far';
    // budget: the nearest ones win; a unit already near keeps its slot only while within the cap
    let lod = want;
    if (lod === 'near') { if (u.soldier ? ns >= b.maxSoldiers : nv >= b.maxVehicles) lod = 'far'; else if (u.soldier) ns++; else nv++; }
    if (lod !== (u.near ? 'near' : 'far') && n < swaps) { out.set(u.id, lod); n++; }
  }
  return out;
}

/** The `max` nearest candidates keep their animation; the rest are frozen (no skeleton update). Deterministic: ties broken by id. */
export function chooseAnimated(c: { id: number; dist: number }[], max: number): Set<number> {
  const s = [...c].sort((a, b) => a.dist - b.dist || a.id - b.id).slice(0, Math.max(0, max));
  return new Set(s.map((q) => q.id));
}

// ------------------------------------------------------------------ soldier animation
export type SoldierRole = 'idle' | 'walk' | 'run' | 'shoot' | 'runShoot' | 'walkShoot' | 'crouch' | 'death';
export interface SoldierState {
  alive: boolean; moving: boolean;
  /** the squad's order moves it quickly (move / retreat / occupy / routed) */ hurry: boolean;
  /** fired within the last ~0.45 s */ firing: boolean;
  /** dug in / digging / suppressed and still: takes cover */ cover: boolean;
}
/** Simulation state -> clip role of the near soldier (the model maps roles to its clips: manifest `animationRoles`). */
export function soldierRole(s: SoldierState): SoldierRole {
  if (!s.alive) return 'death';
  if (s.firing) return s.moving ? (s.hurry ? 'runShoot' : 'walkShoot') : 'shoot';
  if (s.moving) return s.hurry ? 'run' : 'walk';
  return s.cover ? 'crouch' : 'idle';
}
/** Squad order -> does it move in a hurry? (amove = patrol pace; move / retreat / occupy = run). */
export const hurryOrder = (order: string, routed: boolean) => routed || order === 'move' || order === 'retreat' || order === 'occupy';

/** Deterministic per-entity animation phase (seconds into the clip) and speed factor so a squad never steps in sync. */
export function animPhase(id: number): { phase: number; speed: number } {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0; h ^= h >>> 15;
  const a = (h >>> 0) / 4294967296, b = ((Math.imul(h, 0x45d9f3b) >>> 0) % 1000) / 1000;
  return { phase: a * 2, speed: 0.9 + b * 0.2 };
}

// ------------------------------------------------------------------ vehicle rig
export interface RigGroup { slewDegS: number; maxElevRad: number; rangeFull: number; recoilS: number }
export const RIG_GROUPS: Record<string, RigGroup> = {
  mbt: { slewDegS: 40, maxElevRad: 0.12, rangeFull: 2000, recoilS: 0.55 },
  ifv: { slewDegS: 70, maxElevRad: 0.4, rangeFull: 1500, recoilS: 0.4 },
  spg: { slewDegS: 25, maxElevRad: 0.9, rangeFull: 7500, recoilS: 0.9 },
  sam: { slewDegS: 60, maxElevRad: 1.1, rangeFull: 5000, recoilS: 0.4 },
  apc: { slewDegS: 0, maxElevRad: 0, rangeFull: 1, recoilS: 0.1 },
  truck: { slewDegS: 0, maxElevRad: 0, rangeFull: 1, recoilS: 0.1 },
};
export interface RigState { turret: number; elev: number; wheel: number; scroll: number; steer: number }
export const newRig = (): RigState => ({ turret: 0, elev: 0, wheel: 0, scroll: 0, steer: 0 });
export interface RigIn {
  group: string; dt: number;
  /** hull heading and bearing to the current target (radians, clockwise from north); target undefined: no target */
  hull: number; bearing?: number; range?: number;
  /** seconds since the last shot (large = none); seconds since the target was last seen (turret returns to front after a while) */
  shotAge: number; idleS: number;
  /** signed forward speed (m/s) and yaw rate (rad/s), wheel radius (m) */
  speed: number; yawRate: number; wheelR: number;
}
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** Advances the rig one frame: turret turns toward the target at its slew rate (shortest way), the gun elevates with range, wheels roll, tread scrolls. */
export function stepRig(s: RigState, i: RigIn): RigState {
  const g = RIG_GROUPS[i.group] ?? RIG_GROUPS.apc;
  // turret angle is relative to the hull, positive = clockwise (to the right); no target for a while: back to the front
  const want = i.bearing !== undefined ? wrap(i.bearing - i.hull) : i.idleS > 5 ? 0 : s.turret;
  const maxStep = (g.slewDegS * Math.PI) / 180 * i.dt;
  const d = wrap(want - s.turret);
  let turret = g.slewDegS > 0 ? s.turret + Math.max(-maxStep, Math.min(maxStep, d)) : 0;
  // keep the turret angle relative to the hull while the hull turns: the target stays under the gun
  turret = g.slewDegS > 0 ? wrap(turret) : 0;
  const el = i.bearing !== undefined && i.range !== undefined ? g.maxElevRad * Math.pow(Math.min(1, Math.max(0, i.range / g.rangeFull)), 0.7) : s.elev * 0.98;
  const elev = s.elev + (el - s.elev) * Math.min(1, i.dt * 4);
  const wheel = s.wheel + (i.speed * i.dt) / Math.max(0.05, i.wheelR);
  const scroll = s.scroll + i.speed * i.dt;
  const steerT = Math.max(-0.5, Math.min(0.5, i.yawRate * 1.2)), steer = s.steer + (steerT - s.steer) * Math.min(1, i.dt * 6);
  return { turret, elev, wheel: wheel % (Math.PI * 2 * 1000), scroll: scroll % 1000, steer };
}
/** Barrel recoil (m, along the gun axis, backward): fast kick back, slow return. */
export function recoilAt(ageS: number, recoilM: number, returnS: number): number {
  if (ageS < 0 || ageS > returnS + 0.06) return 0;
  if (ageS < 0.06) return (recoilM * ageS) / 0.06;
  const k = 1 - (ageS - 0.06) / returnS;
  return recoilM * k * k;
}
/** True while the muzzle flash of a shot of age `ageS` should be on screen. */
export const flashOn = (ageS: number) => ageS >= 0 && ageS < 0.09;
