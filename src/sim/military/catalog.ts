/** Unit catalog (data table). `k` = 1 means: one battalion / squadron / ship / missile. */
import type { Cost, UnitTemplateId } from '../../core/contracts';
import type { MilDomain } from './types';

export interface UnitTemplate {
  id: UnitTemplateId;
  domain: MilDomain;
  modelId: string;
  iconId: string;
  /** Men (crew) per k. */
  men: number;
  /** 3D entities per k in tactical battles (infantry: squads). */
  ents: number;
  /** Firepower per hour per k against soft / hard / air / naval targets. */
  soft: number;
  hard: number;
  air: number;
  naval: number;
  /** Staying power per k. */
  def: number;
  /** 0 = unarmoured, 1 = heavy armour (how "hard" the target is). */
  hardness: number;
  /** Weapon range (km); indirect-fire units support battles within it. */
  range: number;
  /** Vision (km). */
  vis: number;
  /** Speeds in km/h: on road, off road, at sea, in the air. */
  road: number;
  off: number;
  sea: number;
  fly: number;
  /** Combat radius for aircraft (km, one way = 2×radius). Missiles: max range. */
  radius: number;
  /** Oil (kbbl) per k per day moving; munitions lots per k per day fighting. */
  fuel: number;
  ammo: number;
  cost: Cost;
  /** Military-industry points to build one k. */
  pts: number;
  /** Money upkeep per k per day (M USD). */
  upkeep: number;
  /** Carrying capacity in battalions (landing ship, transport aircraft/helis). */
  cap: number;
  /** Exposure to losses (1 = average). */
  expo: number;
  /** Research modifier key group (`mil.<group>.attack`). */
  group: 'infantry' | 'armor' | 'artillery' | 'air' | 'naval' | 'missile' | 'support';
}

type Spec = Partial<UnitTemplate> & Pick<UnitTemplate, 'id' | 'domain' | 'modelId' | 'iconId' | 'men' | 'group'>;

const base = {
  ents: 1, soft: 0, hard: 0, air: 0, naval: 0, def: 1, hardness: 0, range: 3, vis: 8, road: 0, off: 0, sea: 0, fly: 0,
  radius: 0, fuel: 0, ammo: 0, cost: {}, pts: 30, upkeep: 0.05, cap: 0, expo: 1,
};
const T = (s: Spec): UnitTemplate => ({ ...base, ...s }) as UnitTemplate;

const land = (id: string, modelId: string, iconId: string, men: number, group: UnitTemplate['group'], o: Partial<UnitTemplate>) =>
  T({ id, domain: 'land', modelId, iconId, men, group, ...o });

export const UNIT_LIST: UnitTemplate[] = [
  land('infantry', 'soldier', 'infantry', 800, 'infantry', {
    ents: 12, soft: 3, hard: 1, air: 0.3, def: 6, range: 2, vis: 6, road: 9, off: 3.5, fuel: 0.01, ammo: 0.3, pts: 18,
    cost: { money: 40, munitions: 4 }, upkeep: 0.04, expo: 1.1,
  }),
  land('mech_infantry', 'ifv', 'mechanized', 750, 'infantry', {
    ents: 12, soft: 5, hard: 4, air: 0.6, def: 8, hardness: 0.5, range: 3, vis: 8, road: 45, off: 15, fuel: 0.35, ammo: 0.4, pts: 38,
    cost: { money: 180, steel: 1.2, munitions: 5 }, upkeep: 0.12, expo: 1,
  }),
  land('armor', 'mbt', 'armor', 450, 'armor', {
    ents: 12, soft: 8, hard: 12, def: 12, hardness: 1, range: 4, vis: 8, road: 40, off: 14, fuel: 0.7, ammo: 0.5, pts: 60,
    cost: { money: 260, steel: 2, electronics: 3, munitions: 6 }, upkeep: 0.2, expo: 0.9,
  }),
  land('recon', 'apc', 'recon', 300, 'support', {
    ents: 6, soft: 2, hard: 1, def: 3, hardness: 0.3, vis: 25, road: 60, off: 22, fuel: 0.25, ammo: 0.1, pts: 24,
    cost: { money: 80, steel: 0.4, electronics: 1 }, upkeep: 0.07, expo: 1.1,
  }),
  land('artillery', 'spg', 'artillery', 500, 'artillery', {
    ents: 9, soft: 10, hard: 4, def: 2, hardness: 0.4, range: 30, vis: 5, road: 40, off: 11, fuel: 0.4, ammo: 0.9, pts: 40,
    cost: { money: 150, steel: 1, munitions: 8 }, upkeep: 0.11, expo: 0.8,
  }),
  land('mlrs', 'mlrs', 'mlrs', 350, 'artillery', {
    ents: 6, soft: 14, hard: 5, def: 1.5, hardness: 0.3, range: 70, vis: 5, road: 50, off: 12, fuel: 0.35, ammo: 1.4, pts: 52,
    cost: { money: 240, steel: 0.8, electronics: 2, munitions: 14 }, upkeep: 0.16, expo: 0.8,
  }),
  land('air_defense', 'sam', 'air_defense', 300, 'support', {
    ents: 6, soft: 1, air: 12, def: 2, hardness: 0.3, range: 60, vis: 40, road: 45, off: 10, fuel: 0.3, ammo: 0.5, pts: 50,
    cost: { money: 280, steel: 0.5, electronics: 4, munitions: 6 }, upkeep: 0.15, expo: 0.7,
  }),
  land('engineer', 'truck', 'engineer', 400, 'support', {
    ents: 6, soft: 1, hard: 1, def: 4, hardness: 0.1, road: 45, off: 12, fuel: 0.2, ammo: 0.1, pts: 22,
    cost: { money: 60, steel: 0.6 }, upkeep: 0.06,
  }),
  land('logistics', 'truck', 'logistics', 350, 'support', {
    ents: 8, def: 1, road: 55, off: 12, fuel: 0.3, pts: 16, cost: { money: 45, steel: 0.3 }, upkeep: 0.05, expo: 1.2, cap: 0,
  }),
  land('special_forces', 'soldier', 'special_forces', 250, 'infantry', {
    ents: 6, soft: 5, hard: 3, air: 0.5, def: 5, vis: 12, road: 12, off: 5, fuel: 0.02, ammo: 0.3, pts: 45,
    cost: { money: 120, electronics: 1, munitions: 3 }, upkeep: 0.1,
  }),
  T({
    id: 'attack_heli', domain: 'air', modelId: 'attack_heli', iconId: 'attack_heli', men: 60, group: 'air', ents: 8, soft: 8, hard: 12, air: 2,
    def: 3, hardness: 0.4, range: 8, vis: 15, fly: 250, radius: 220, fuel: 0.5, ammo: 0.5, pts: 55, expo: 1,
    cost: { money: 320, electronics: 4, steel: 0.3, munitions: 5 }, upkeep: 0.22,
  }),
  T({
    id: 'transport_heli', domain: 'air', modelId: 'transport_heli', iconId: 'transport_heli', men: 60, group: 'air', ents: 8, def: 2,
    vis: 12, fly: 230, radius: 300, fuel: 0.4, pts: 35, cost: { money: 150, electronics: 1, steel: 0.2 }, upkeep: 0.12, cap: 1,
  }),
  T({
    id: 'fighter', domain: 'air', modelId: 'fighter', iconId: 'fighter', men: 40, group: 'air', ents: 6, soft: 2, hard: 2, air: 12, naval: 2,
    def: 4, hardness: 0.3, range: 60, vis: 120, fly: 900, radius: 900, fuel: 1.2, ammo: 0.5, pts: 85,
    cost: { money: 900, electronics: 12, steel: 0.8, munitions: 6 }, upkeep: 0.5,
  }),
  T({
    id: 'bomber', domain: 'air', modelId: 'bomber', iconId: 'bomber', men: 70, group: 'air', ents: 3, soft: 15, hard: 12, air: 0, naval: 10,
    def: 5, hardness: 0.3, range: 20, vis: 60, fly: 800, radius: 3500, fuel: 2.2, ammo: 1.2, pts: 120,
    cost: { money: 1400, electronics: 14, steel: 1.5, munitions: 14 }, upkeep: 0.8, expo: 0.9,
  }),
  T({
    id: 'air_transport', domain: 'air', modelId: 'transport_plane', iconId: 'air_transport', men: 50, group: 'air', ents: 3, def: 3,
    vis: 20, fly: 700, radius: 4500, fuel: 1.6, pts: 60, cost: { money: 450, electronics: 3, steel: 1 }, upkeep: 0.3, cap: 2,
  }),
  T({
    id: 'drone', domain: 'air', modelId: 'drone', iconId: 'drone', men: 20, group: 'air', ents: 6, soft: 3, hard: 4, def: 1, hardness: 0.1,
    range: 8, vis: 40, fly: 200, radius: 1000, fuel: 0.2, ammo: 0.3, pts: 30, cost: { money: 60, electronics: 3, munitions: 2 },
    upkeep: 0.06, expo: 1.2,
  }),
  T({
    id: 'destroyer', domain: 'naval', modelId: 'destroyer', iconId: 'destroyer', men: 300, group: 'naval', ents: 1, soft: 2, hard: 2, air: 8,
    naval: 10, def: 14, hardness: 0.7, range: 40, vis: 50, sea: 55, fuel: 2, ammo: 0.6, pts: 160,
    cost: { money: 1800, steel: 8, electronics: 10, munitions: 8 }, upkeep: 0.6,
  }),
  T({
    id: 'frigate', domain: 'naval', modelId: 'frigate', iconId: 'frigate', men: 180, group: 'naval', ents: 1, soft: 1, air: 5, naval: 6, def: 8,
    hardness: 0.6, range: 30, vis: 40, sea: 50, fuel: 1.3, ammo: 0.4, pts: 100,
    cost: { money: 900, steel: 4, electronics: 5, munitions: 4 }, upkeep: 0.35,
  }),
  T({
    id: 'submarine', domain: 'naval', modelId: 'submarine', iconId: 'submarine', men: 100, group: 'naval', ents: 1, naval: 14, def: 8,
    hardness: 0.7, range: 35, vis: 25, sea: 35, fuel: 0.8, ammo: 0.4, pts: 140, cost: { money: 1300, steel: 6, electronics: 8, munitions: 6 },
    upkeep: 0.5, expo: 0.6,
  }),
  T({
    id: 'carrier', domain: 'naval', modelId: 'carrier', iconId: 'carrier', men: 3000, group: 'naval', ents: 1, soft: 3, air: 15, naval: 6,
    def: 30, hardness: 0.8, range: 60, vis: 120, sea: 55, fuel: 6, ammo: 1, pts: 600,
    cost: { money: 9000, steel: 40, electronics: 40, munitions: 20 }, upkeep: 2.5, expo: 0.7,
  }),
  T({
    id: 'landing_ship', domain: 'naval', modelId: 'cargo_ship', iconId: 'landing_ship', men: 150, group: 'naval', ents: 1, def: 6, hardness: 0.5,
    vis: 15, sea: 35, fuel: 1, pts: 70, cost: { money: 500, steel: 5 }, upkeep: 0.2, cap: 2, expo: 1.2,
  }),
  T({
    id: 'cruise_missile', domain: 'missile', modelId: 'missile', iconId: 'cruise_missile', men: 0, group: 'missile', fly: 850, radius: 2500,
    pts: 6, cost: { money: 3, electronics: 0.05, steel: 0.01, munitions: 1 }, upkeep: 0.001,
  }),
  T({
    id: 'ballistic_missile', domain: 'missile', modelId: 'missile', iconId: 'ballistic_missile', men: 0, group: 'missile', fly: 9000, radius: 12000,
    pts: 18, cost: { money: 12, electronics: 0.2, steel: 0.05, munitions: 3 }, upkeep: 0.004,
  }),
  T({
    id: 'nuke', domain: 'missile', modelId: 'missile', iconId: 'nuke', men: 0, group: 'missile', fly: 9000, radius: 12000,
    pts: 400, cost: { money: 400, electronics: 2, steel: 0.2, uranium: 0.05 }, upkeep: 0.05,
  }),
];

export const UNITS: Record<UnitTemplateId, UnitTemplate> = Object.fromEntries(UNIT_LIST.map((u) => [u.id, u]));
export const unit = (id: UnitTemplateId): UnitTemplate => UNITS[id];

/** Player-visible display order. */
export const UNIT_IDS = UNIT_LIST.map((u) => u.id);
