/** Technology table (data only). Row: id, branch, tier 1..6, prerequisites, unlock ids, modifier multipliers. */
import type { TechId } from '../../core/contracts';
import type { Branch } from './catalog';

export interface TechDef {
  id: TechId;
  branch: Branch;
  tier: number;
  requires: TechId[];
  unlocks: string[];
  mods: Record<string, number>;
  /** Research points to complete. */
  cost: number;
}

type Row = [id: string, branch: Branch, tier: number, requires: string[], unlocks: string[], mods: Record<string, number>];

const TIER_COST = [0, 250, 450, 800, 1400, 2400, 4000];

const ROWS: Row[] = [
  // ---- army
  ['a_doctrine', 'army', 1, [], [], { 'mil.org': 1.04, 'mil.infantry.attack': 1.05 }],
  ['a_mech', 'army', 1, [], ['unit.mech_infantry', 'unit.recon'], { 'mil.speed': 1.05 }],
  ['a_artillery', 'army', 1, [], ['unit.artillery'], { 'mil.artillery.range': 1.05 }],
  ['a_engineering', 'army', 1, [], ['unit.engineer', 'build.bunker'], { 'mil.entrench': 1.1 }],
  ['a_body_armor', 'army', 2, ['a_doctrine'], [], { 'mil.infantry.defense': 1.1 }],
  ['a_armor', 'army', 2, ['a_mech'], ['unit.armor'], { 'mil.armor.attack': 1.05 }],
  ['a_logistics', 'army', 2, ['a_mech'], ['unit.logistics'], { 'mil.supply': 1.1 }],
  ['a_fortify', 'army', 2, ['a_engineering'], [], { 'mil.entrench': 1.15, 'mil.infantry.defense': 1.05 }],
  ['a_mlrs', 'army', 3, ['a_artillery'], ['unit.mlrs'], { 'mil.artillery.accuracy': 1.05 }],
  ['a_special_forces', 'army', 3, ['a_doctrine', 'a_body_armor'], ['unit.special_forces'], { 'mil.vision': 1.05 }],
  ['a_ifv_adv', 'army', 3, ['a_mech', 'a_armor'], [], { 'mil.mech.attack': 1.1 }],
  ['a_c4i', 'army', 3, ['a_logistics'], [], { 'mil.org': 1.1, 'mil.supply': 1.05 }],
  ['a_adv_armor', 'army', 4, ['a_armor', 'a_ifv_adv'], [], { 'mil.armor.defense': 1.15, 'mil.armor.attack': 1.08 }],
  ['a_smart_artillery', 'army', 4, ['a_mlrs', 'a_c4i'], [], { 'mil.artillery.accuracy': 1.2, 'mil.artillery.range': 1.1 }],
  ['a_exo_gear', 'army', 5, ['a_special_forces', 'a_adv_armor'], [], { 'mil.infantry.attack': 1.15, 'mil.infantry.defense': 1.1, 'mil.speed': 1.05 }],
  // ---- air
  ['f_jet', 'air', 1, [], ['unit.fighter'], { 'mil.air.attack': 1.03 }],
  ['f_helicopter', 'air', 1, [], ['unit.transport_heli'], {}],
  ['f_drone', 'air', 1, [], ['unit.drone'], { 'mil.drone.attack': 1.05 }],
  ['f_radar', 'air', 2, [], ['build.radar'], { 'mil.radar.range': 1.1 }],
  ['f_sam', 'air', 2, ['f_radar'], ['unit.air_defense', 'build.airDefense'], { 'mil.sam.intercept': 1.1 }],
  ['f_attack_heli', 'air', 2, ['f_helicopter'], ['unit.attack_heli'], {}],
  ['f_bomber', 'air', 2, ['f_jet'], ['unit.bomber'], { 'mil.air.range': 1.1 }],
  ['f_airlift', 'air', 2, ['f_jet'], ['unit.air_transport'], { 'mil.air.range': 1.05 }],
  ['f_gen4', 'air', 3, ['f_jet', 'f_radar'], [], { 'mil.air.attack': 1.1, 'mil.air.defense': 1.08 }],
  ['f_air_logistics', 'air', 3, ['f_airlift'], [], { 'mil.air.range': 1.15, 'mil.supply': 1.03 }],
  ['f_strike_drone', 'air', 4, ['f_drone', 'f_gen4'], [], { 'mil.drone.attack': 1.25 }],
  ['f_adv_sam', 'air', 4, ['f_sam', 'f_gen4'], [], { 'mil.sam.intercept': 1.2 }],
  ['f_awacs', 'air', 4, ['f_radar', 'f_gen4'], [], { 'mil.radar.range': 1.3, 'mil.vision': 1.1 }],
  ['f_gen5', 'air', 5, ['f_gen4', 'f_awacs'], [], { 'mil.air.attack': 1.2, 'mil.air.defense': 1.15 }],
  ['f_stealth_bomber', 'air', 5, ['f_bomber', 'f_gen4'], [], { 'mil.air.attack': 1.08, 'mil.air.range': 1.1 }],
  ['f_drone_swarm', 'air', 6, ['f_strike_drone', 'm_cyber'], [], { 'mil.drone.attack': 1.35 }],
  // ---- navy
  ['n_frigate', 'navy', 1, [], ['unit.frigate'], {}],
  ['n_destroyer', 'navy', 2, ['n_frigate'], ['unit.destroyer'], { 'mil.naval.attack': 1.05 }],
  ['n_submarine', 'navy', 2, ['n_frigate'], ['unit.submarine'], { 'mil.sub.stealth': 1.05 }],
  ['n_landing', 'navy', 2, ['n_frigate'], ['unit.landing_ship'], { 'mil.amphibious': 1.1 }],
  ['n_engines', 'navy', 2, ['n_frigate'], [], { 'mil.naval.speed': 1.1 }],
  ['n_sonar', 'navy', 3, ['n_submarine'], [], { 'mil.naval.detect': 1.2 }],
  ['n_anti_ship', 'navy', 3, ['n_destroyer', 'm_rocketry'], [], { 'mil.naval.attack': 1.15 }],
  ['n_blockade', 'navy', 3, ['n_destroyer'], [], { 'mil.blockade': 1.2 }],
  ['n_amphibious_doctrine', 'navy', 3, ['n_landing'], [], { 'mil.amphibious': 1.2 }],
  ['n_carrier', 'navy', 4, ['n_destroyer', 'f_gen4'], ['unit.carrier'], { 'mil.air.range': 1.05 }],
  ['n_aegis', 'navy', 4, ['n_destroyer', 'f_adv_sam'], [], { 'mil.naval.defense': 1.2, 'mil.sam.intercept': 1.05 }],
  ['n_quiet_subs', 'navy', 4, ['n_sonar'], [], { 'mil.sub.stealth': 1.25 }],
  ['n_nuclear_propulsion', 'navy', 5, ['n_quiet_subs', 'm_nuclear_physics'], [], { 'mil.naval.speed': 1.1, 'mil.sub.stealth': 1.1 }],
  // ---- strategic: missiles, nuclear, space, cyber
  ['m_rocketry', 'strategic', 2, [], ['unit.cruise_missile'], { 'mil.missile.range': 1.05 }],
  ['m_nuclear_physics', 'strategic', 3, [], ['fuel.nuclear'], { 'eco.nuclear': 1.1 }],
  ['m_cyber', 'strategic', 3, [], [], { 'mil.cyber': 1.15, 'eco.cyberDefense': 1.1 }],
  ['m_guidance', 'strategic', 3, ['m_rocketry'], [], { 'mil.missile.accuracy': 1.2 }],
  ['m_electronic_warfare', 'strategic', 3, ['f_radar'], [], { 'mil.ew': 1.2 }],
  ['m_ballistic', 'strategic', 4, ['m_rocketry'], ['unit.ballistic_missile'], { 'mil.missile.range': 1.2 }],
  ['m_satellites', 'strategic', 4, ['m_rocketry', 'e_electronics'], [], { 'mil.vision': 1.2 }],
  ['m_warhead', 'strategic', 5, ['m_nuclear_physics', 'm_ballistic'], ['unit.nuke', 'build.silo'], { 'mil.nuke.yield': 1.0 }],
  ['m_hypersonic', 'strategic', 5, ['m_ballistic', 'm_guidance'], [], { 'mil.missile.speed': 1.5, 'mil.missile.accuracy': 1.1 }],
  ['m_cyber_warfare', 'strategic', 5, ['m_cyber'], [], { 'mil.cyber': 1.3, 'eco.cyberDefense': 1.2 }],
  ['m_anti_ballistic', 'strategic', 5, ['f_adv_sam', 'm_satellites'], [], { 'mil.abm.intercept': 1.3 }],
  ['m_mirv', 'strategic', 6, ['m_warhead', 'm_hypersonic'], [], { 'mil.nuke.yield': 1.3 }],
  ['m_space_command', 'strategic', 6, ['m_satellites', 'm_hypersonic'], [], { 'mil.vision': 1.15, 'mil.missile.range': 1.1 }],
  // ---- economy & industry
  ['e_industry', 'economy', 1, [], [], { 'eco.industry': 1.05 }],
  ['e_agriculture', 'economy', 1, [], ['build.farm'], { 'eco.agri': 1.08 }],
  ['e_mining', 'economy', 1, [], ['build.mine'], { 'eco.mining': 1.08 }],
  ['e_banking', 'economy', 2, [], [], { 'eco.taxEfficiency': 1.05 }],
  ['e_infrastructure', 'economy', 2, [], ['build.railway'], { 'eco.buildSpeed': 1.1 }],
  ['e_refining', 'economy', 2, ['e_mining'], ['build.refinery'], { 'eco.oil': 1.1 }],
  ['e_assembly_lines', 'economy', 2, ['e_industry'], [], { 'eco.industry': 1.08, 'mil.production': 1.08 }],
  ['e_trade_networks', 'economy', 2, ['e_banking'], [], { 'eco.trade': 1.1 }],
  ['e_agri_mechanization', 'economy', 3, ['e_agriculture', 'e_assembly_lines'], [], { 'eco.agri': 1.15 }],
  ['e_electronics', 'economy', 3, ['e_assembly_lines'], [], { 'eco.electronics': 1.15 }],
  ['e_prefabrication', 'economy', 3, ['e_infrastructure', 'e_assembly_lines'], [], { 'eco.buildCost': 0.92 }],
  ['e_war_economy', 'economy', 3, ['e_assembly_lines'], [], { 'mil.production': 1.12, 'mil.upkeep': 0.95 }],
  ['e_rare_earths', 'economy', 4, ['e_mining', 'e_electronics'], [], { 'eco.rareEarth': 1.2 }],
  ['e_automation', 'economy', 4, ['e_electronics', 'e_prefabrication'], [], { 'eco.industry': 1.12, 'eco.manpower': 0.95 }],
  ['e_global_finance', 'economy', 4, ['e_banking', 'e_trade_networks'], [], { 'eco.taxEfficiency': 1.08, 'eco.trade': 1.1 }],
  ['e_artificial_intelligence', 'economy', 6, ['e_automation', 'm_cyber_warfare'], [], { 'eco.industry': 1.1, 'eco.research': 1.15 }],
  // ---- energy & society
  ['s_power_grid', 'society', 1, [], [], { 'eco.gridLoss': 0.95 }],
  ['s_public_health', 'society', 2, [], ['build.hospital'], { 'eco.health': 1.1, 'eco.popGrowth': 1.03 }],
  ['s_higher_education', 'society', 2, [], ['build.university'], { 'eco.research': 1.1 }],
  ['s_efficiency', 'society', 2, ['s_power_grid'], [], { 'eco.energyDemand': 0.95 }],
  ['s_solar', 'society', 2, ['s_power_grid'], ['fuel.solar', 'fuel.biomass'], { 'eco.solar': 1.15 }],
  ['s_wind', 'society', 2, ['s_power_grid'], ['fuel.wind'], { 'eco.wind': 1.15 }],
  ['s_geothermal', 'society', 3, ['s_power_grid', 'e_mining'], ['fuel.geothermal'], {}],
  ['s_welfare', 'society', 3, ['s_public_health'], [], { 'eco.stability': 1.05, 'eco.approval': 1.05 }],
  ['s_policing', 'society', 3, ['s_higher_education'], [], { 'eco.unrest': 0.9 }],
  ['s_media', 'society', 3, ['s_higher_education'], [], { 'eco.approval': 1.06 }],
  ['s_urban_planning', 'society', 3, ['e_infrastructure'], [], { 'eco.popGrowth': 1.05, 'eco.disasterResist': 1.1 }],
  ['s_smart_grid', 'society', 4, ['s_efficiency', 'e_electronics'], [], { 'eco.gridLoss': 0.9, 'eco.energyDemand': 0.95 }],
  ['s_research_universities', 'society', 4, ['s_higher_education', 'e_electronics'], [], { 'eco.research': 1.15 }],
  ['s_storage', 'society', 4, ['s_solar', 's_wind', 'e_electronics'], [], { 'eco.storage': 1.25, 'eco.solar': 1.1, 'eco.wind': 1.1 }],
  ['s_advanced_nuclear', 'society', 5, ['m_nuclear_physics', 's_smart_grid'], [], { 'eco.nuclear': 1.2, 'eco.energyDemand': 0.97 }],
  ['s_biotech', 'society', 5, ['s_public_health', 's_research_universities'], [], { 'eco.health': 1.2, 'eco.popGrowth': 1.05, 'eco.agri': 1.05 }],
];

export const TECHS: readonly TechDef[] = ROWS.map(([id, branch, tier, requires, unlocks, mods]) => ({
  id, branch, tier, requires, unlocks, mods, cost: TIER_COST[tier],
}));

export const TECH_BY_ID: ReadonlyMap<TechId, TechDef> = new Map(TECHS.map((t) => [t.id, t]));
export const MAX_TIER = 6;
