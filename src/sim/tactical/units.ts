import type { UnitKind } from './types';

export interface Weapon {
  /** range m */ r: number;
  /** reload s */ rf: number;
  /** damage */ d: number;
  /** penetration (mm) */ p: number;
  /** accuracy at ~500 m, 0..1 */ a: number;
  /** blast radius m (0 = direct) */ ar: number;
  /** suppression per hit */ s: number;
  /** rounds per element */ n: number;
  /** projectile speed m/s */ v: number;
  t: 'bullet' | 'shell' | 'missile' | 'rocket';
  ind?: boolean;
  air?: boolean;
  min?: number;
  /** cannot engage ground targets */ noGround?: boolean;
}
export type Mobility = 'foot' | 'wheel' | 'track' | 'air';
export interface UnitDef {
  model: string; n: number; spd: number; mob: Mobility; hp: number;
  /** armour front/side/rear (mm RHA equivalent) */ arm: [number, number, number];
  vis: number; sp: number; turn: number; threat: number; smoke: number; dig: number;
  w: Weapon[];
}

const RIFLE: Weapon = { r: 450, rf: 1.2, d: 5, p: 4, a: 0.5, ar: 0, s: 0.05, n: 600, v: 700, t: 'bullet', air: true };
const AT: Weapon = { r: 800, rf: 14, d: 75, p: 500, a: 0.6, ar: 0, s: 0.15, n: 3, v: 250, t: 'missile' };
const MG: Weapon = { r: 700, rf: 0.6, d: 3, p: 8, a: 0.45, ar: 0, s: 0.06, n: 800, v: 800, t: 'bullet' };

export const UNITS: Record<UnitKind, UnitDef> = {
  infantry: { model: 'soldier', n: 12, spd: 2.2, mob: 'foot', hp: 30, arm: [0, 0, 0], vis: 900, sp: 22, turn: 6, threat: 1.2, smoke: 1, dig: 1, w: [RIFLE, AT] },
  special: { model: 'soldier', n: 8, spd: 2.8, mob: 'foot', hp: 35, arm: [0, 0, 0], vis: 1100, sp: 26, turn: 6, threat: 1.4, smoke: 2, dig: 1, w: [{ ...RIFLE, a: 0.65, r: 550 }, AT] },
  engineer: { model: 'soldier', n: 8, spd: 2.1, mob: 'foot', hp: 30, arm: [0, 0, 0], vis: 800, sp: 22, turn: 6, threat: 0.8, smoke: 3, dig: 3, w: [RIFLE] },
  mech: { model: 'ifv', n: 10, spd: 12, mob: 'track', hp: 60, arm: [60, 30, 15], vis: 1500, sp: 40, turn: 1.2, threat: 2, smoke: 2, dig: 0.6,
    w: [{ r: 1500, rf: 0.5, d: 6, p: 60, a: 0.55, ar: 0, s: 0.1, n: 400, v: 1100, t: 'bullet', air: true }, { r: 2500, rf: 12, d: 80, p: 650, a: 0.65, ar: 0, s: 0.2, n: 4, v: 300, t: 'missile' }] },
  mbt: { model: 'mbt', n: 12, spd: 11, mob: 'track', hp: 100, arm: [900, 300, 90], vis: 1800, sp: 55, turn: 0.7, threat: 3, smoke: 2, dig: 0.5,
    w: [{ r: 2000, rf: 6, d: 60, p: 750, a: 0.8, ar: 6, s: 0.3, n: 40, v: 1100, t: 'shell' }, { ...MG, r: 700 }] },
  recon: { model: 'apc', n: 6, spd: 17, mob: 'wheel', hp: 40, arm: [20, 10, 5], vis: 2400, sp: 60, turn: 1.5, threat: 1, smoke: 1, dig: 0.3,
    w: [{ r: 1200, rf: 0.7, d: 4, p: 40, a: 0.5, ar: 0, s: 0.08, n: 300, v: 1000, t: 'bullet', air: true }] },
  artillery: { model: 'spg', n: 6, spd: 9, mob: 'track', hp: 45, arm: [12, 8, 5], vis: 900, sp: 45, turn: 0.8, threat: 1.8, smoke: 0, dig: 0.6,
    w: [{ r: 7500, rf: 11, d: 45, p: 180, a: 0.5, ar: 28, s: 0.5, n: 24, v: 320, t: 'shell', ind: true, min: 600, noGround: false }] },
  mlrs: { model: 'mlrs', n: 4, spd: 11, mob: 'wheel', hp: 40, arm: [6, 5, 4], vis: 900, sp: 55, turn: 0.8, threat: 1.8, smoke: 0, dig: 0.3,
    w: [{ r: 8000, rf: 45, d: 30, p: 120, a: 0.4, ar: 45, s: 0.7, n: 6, v: 400, t: 'rocket', ind: true, min: 1200 }] },
  sam: { model: 'sam', n: 4, spd: 10, mob: 'wheel', hp: 40, arm: [8, 6, 4], vis: 1500, sp: 55, turn: 0.8, threat: 1.5, smoke: 0, dig: 0.3,
    w: [{ r: 5000, rf: 6, d: 90, p: 120, a: 0.7, ar: 8, s: 0.2, n: 8, v: 700, t: 'missile', air: true, noGround: true }] },
  logistics: { model: 'truck', n: 5, spd: 14, mob: 'wheel', hp: 35, arm: [4, 4, 4], vis: 600, sp: 35, turn: 1.5, threat: 0.5, smoke: 0, dig: 0.2, w: [{ ...MG, n: 0, r: 1 }] },
  attackHeli: { model: 'attack_heli', n: 4, spd: 45, mob: 'air', hp: 60, arm: [20, 15, 10], vis: 3000, sp: 80, turn: 2, threat: 2.5, smoke: 0, dig: 0,
    w: [{ r: 3000, rf: 9, d: 75, p: 700, a: 0.7, ar: 0, s: 0.2, n: 8, v: 350, t: 'missile' }, { r: 1500, rf: 1.5, d: 6, p: 15, a: 0.5, ar: 12, s: 0.15, n: 120, v: 500, t: 'rocket' }] },
};

/** Armour factor: penetration vs armour -> 0.03..1.3 of nominal damage. */
export function penFactor(pen: number, armor: number): number {
  if (armor <= 5) return 1;
  const r = pen / armor;
  if (r >= 1.2) return r > 2 ? 1.3 : 1;
  if (r <= 0.5) return 0.03;
  return 0.03 + ((r - 0.5) / 0.7) * 0.97;
}

/** Heuristic mapping of a strategic template id (MIL) to a tactical kind; null = not a ground element. */
export function kindFromTemplate(template: string): UnitKind | null {
  const s = template.toLowerCase();
  const has = (...k: string[]) => k.some((x) => s.includes(x));
  if (has('fighter', 'bomber', 'transport_plane', 'destroyer', 'frigate', 'sub', 'carrier', 'missile', 'nuke', 'warhead', 'landing', 'transport')) return null;
  if (has('attack_heli', 'attackheli', 'heli_attack', 'gunship')) return 'attackHeli';
  if (has('mlrs', 'rocket')) return 'mlrs';
  if (has('art', 'howitzer', 'spg')) return 'artillery';
  if (has('sam', 'aa', 'antiair', 'air_def')) return 'sam';
  if (has('mbt', 'tank', 'armor', 'armour', 'blind')) return 'mbt';
  if (has('mech', 'ifv', 'apc')) return 'mech';
  if (has('recon', 'scout')) return 'recon';
  if (has('engineer', 'sapper')) return 'engineer';
  if (has('logist', 'supply', 'truck')) return 'logistics';
  if (has('special', 'commando', 'sof')) return 'special';
  if (has('inf', 'para', 'marine', 'light', 'militia')) return 'infantry';
  return 'infantry';
}
