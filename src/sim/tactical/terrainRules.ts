/**
 * Single data-driven table of what every terrain class MEANS for the simulation (speed, cover, concealment, line of sight,
 * mud, flammability, protection, objectives) and how each source class (Overture, OpenFreeMap) maps onto it.
 * Source classes the table does not list are reported by the adapters in `VectorArea.unmapped` (a test fails on them).
 */
import { SURF } from '../../data/vector/nav';

type Mob3 = [number, number, number]; // foot, wheeled, tracked
export interface SurfRule {
  name: string; color: [number, number, number];
  /** Speed multiplier per mobility (0 = impassable). Slope limits are applied on top (30° wheels, 38° tracks, 50° foot). */
  spd: Mob3;
  /** Cover 0..3 (3 = hard cover, only inside buildings). */
  cover: number;
  /** Obstacle height for line of sight (m). */
  obs: number;
  /** Concealment from observers 0..1 (reduces detection range). */
  conceal: number;
  /** Mud sensitivity 0..1 (rain / thaw slows wheels and tracks, a bit less infantry). */
  mud: number;
  /** Flammability 0..1 (artillery fires spread over it). */
  fire: number;
  /** Effects: tunnel hides from air and sight; bridge can be destroyed; stairs foot only. */
  tags: ('tunnel' | 'bridge' | 'stairs' | 'water' | 'road' | 'unpaved' | 'dust' | 'bog')[];
}
const R = (name: string, color: [number, number, number], spd: Mob3, cover: number, obs: number, conceal: number, mud: number, fire: number, tags: SurfRule['tags'] = []): SurfRule => ({ name, color, spd, cover, obs, conceal, mud, fire, tags });

/** Indexed by SURF.*. */
export const SURFACE_RULES: SurfRule[] = [];
const S = (k: number, r: SurfRule) => { SURFACE_RULES[k] = r; };
S(SURF.FIELD, R('field / crops', [206, 220, 172], [1, 0.55, 0.75], 0, 0, 0.1, 0.6, 0.35, ['unpaved']));
S(SURF.WOOD, R('dense forest', [72, 128, 70], [0.7, 0.25, 0.45], 1, 10, 0.7, 0.5, 0.8, ['unpaved']));
S(SURF.ROCK, R('rock / cliff / scree', [150, 140, 128], [0.55, 0, 0.2], 2, 0, 0.3, 0, 0, ['unpaved']));
S(SURF.SAND, R('sand / desert', [236, 222, 160], [0.75, 0.35, 0.6], 0, 0, 0.05, 0.1, 0, ['unpaved', 'dust']));
S(SURF.WETLAND, R('wetland / swamp', [126, 170, 140], [0.5, 0.15, 0.35], 0, 0, 0.3, 1, 0.1, ['unpaved', 'bog']));
S(SURF.URBAN, R('urban (dense)', [220, 206, 196], [0.9, 0.6, 0.65], 2, 0, 0.3, 0.1, 0.15));
S(SURF.BUILDING, R('building', [146, 66, 58], [0, 0, 0], 3, 0, 0.6, 0, 0.2));
S(SURF.DEEP, R('deep water', [58, 104, 186], [0, 0, 0], 0, 0, 0, 0, 0, ['water']));
S(SURF.SHALLOW, R('ford / stream', [128, 176, 224], [0.5, 0.3, 0.5], 0, 0, 0, 0.3, 0, ['water']));
S(SURF.BRIDGE, R('bridge', [255, 196, 0], [1, 1.35, 1.25], 0, 0, 0, 0, 0, ['bridge', 'road']));
S(SURF.TUNNEL, R('tunnel', [150, 100, 190], [1, 1.3, 1.2], 3, 0, 1, 0, 0, ['tunnel', 'road']));
S(SURF.PATH, R('footway / path / cycleway', [246, 246, 246], [1.1, 0.35, 0.7], 0, 0, 0.1, 0.3, 0.2, ['unpaved']));
S(SURF.MOTORWAY, R('motorway / trunk', [232, 74, 48], [0.9, 1.3, 1.3], 0, 0, 0, 0, 0, ['road']));
S(SURF.PRIMARY, R('primary road', [244, 140, 40], [1, 1.4, 1.3], 0, 0, 0, 0, 0, ['road']));
S(SURF.SECONDARY, R('secondary road', [250, 208, 70], [1, 1.37, 1.27], 0, 0, 0, 0, 0, ['road']));
S(SURF.TERTIARY, R('tertiary road', [255, 255, 255], [1.02, 1.35, 1.25], 0, 0, 0, 0, 0, ['road']));
S(SURF.MINOR, R('street', [236, 236, 236], [1.05, 1.3, 1.2], 0, 0, 0, 0, 0, ['road']));
S(SURF.SERVICE, R('service road', [200, 200, 200], [1, 1.15, 1.1], 0, 0, 0, 0.1, 0, ['road']));
S(SURF.TRACK, R('dirt track', [176, 132, 84], [1.1, 1, 1], 0, 0, 0.1, 0.8, 0.2, ['road', 'unpaved', 'dust']));
S(SURF.RAIL, R('railway', [80, 80, 80], [0.9, 0.4, 0.8], 0, 0, 0, 0, 0));
S(SURF.FOOTBRIDGE, R('footbridge', [255, 224, 140], [1.05, 0, 0], 0, 0, 0, 0, 0, ['bridge']));
S(SURF.SNOW, R('snow / ice', [240, 246, 252], [0.5, 0.3, 0.5], 0, 0, 0.1, 0.4, 0, ['unpaved']));
S(SURF.SCRUB, R('scrub / shrub', [150, 176, 110], [0.85, 0.45, 0.65], 1, 0, 0.4, 0.5, 0.7, ['unpaved']));
S(SURF.RUNWAY, R('runway / apron / helipad', [188, 188, 200], [1, 1.45, 1.3], 0, 0, 0, 0, 0, ['road']));
S(SURF.PIER, R('pier / quay', [190, 160, 120], [1, 1, 1], 0, 0, 0, 0, 0));
S(SURF.STEPS, R('steps', [255, 255, 170], [0.6, 0, 0], 0, 0, 0, 0, 0, ['stairs']));
/** Runtime-only surface class (never in the serialized raster): the rubble a destroyed building leaves. Slow for wheels, medium for tracks, good cover for infantry. */
export const SURF_RUBBLE = 26;
S(SURF_RUBBLE, R('rubble', [128, 118, 108], [0.55, 0.15, 0.4], 2, 1.5, 0.45, 0.2, 0.05, ['dust']));

/** Neutral road class -> surface. */
export const ROAD_SURF: Record<string, number> = {
  motorway: SURF.MOTORWAY, trunk: SURF.MOTORWAY, primary: SURF.PRIMARY, secondary: SURF.SECONDARY, tertiary: SURF.TERTIARY,
  minor: SURF.MINOR, service: SURF.SERVICE, track: SURF.TRACK, path: SURF.PATH, steps: SURF.STEPS, rail: SURF.RAIL, runway: SURF.RUNWAY, taxiway: SURF.RUNWAY,
};
/** Road classes a vehicle can use on a bridge (others become footbridges). */
export const VEHICLE_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'runway', 'taxiway']);
/** Half-width in metres painted per road class. */
export const ROAD_RADIUS: Record<string, number> = { motorway: 11, trunk: 10, primary: 8, secondary: 7, tertiary: 6, minor: 5, service: 4, track: 3, path: 2, steps: 2, rail: 2, runway: 25, taxiway: 8 };
/** Neutral cover class -> surface. */
export const COVER_SURF: Record<string, number> = { wood: SURF.WOOD, scrub: SURF.SCRUB, grass: SURF.FIELD, farmland: SURF.FIELD, rock: SURF.ROCK, snow: SURF.SNOW, sand: SURF.SAND, wetland: SURF.WETLAND };

export interface UseRule { code: number; name: string; color: [number, number, number]; protected?: boolean; urban?: boolean; coverBonus?: number; objective?: number }
/** Land-use codes (raster layer `use`). */
export const USE_RULES: Record<string, UseRule> = {
  none: { code: 0, name: 'none', color: [0, 0, 0] },
  hospital: { code: 1, name: 'hospital / medical', color: [255, 80, 80], protected: true, objective: 3 },
  school: { code: 2, name: 'school / university', color: [255, 160, 60], protected: true },
  religious: { code: 3, name: 'place of worship', color: [200, 120, 255], protected: true },
  cemetery: { code: 4, name: 'cemetery', color: [120, 120, 150], protected: true },
  military: { code: 5, name: 'military', color: [60, 90, 60], coverBonus: 1, objective: 3 },
  industrial: { code: 6, name: 'industrial', color: [170, 150, 130], urban: true, objective: 1 },
  airport: { code: 7, name: 'airport / helipad', color: [150, 170, 220], objective: 3 },
  port: { code: 8, name: 'port / pier / harbour', color: [100, 150, 170], objective: 2 },
  residential: { code: 9, name: 'residential / developed', color: [226, 210, 200], urban: true },
  commercial: { code: 10, name: 'commercial / retail', color: [240, 190, 170], urban: true, objective: 1 },
  park: { code: 11, name: 'park / recreation / pitch', color: [170, 215, 150] },
  quarry: { code: 12, name: 'quarry / construction', color: [190, 175, 150] },
  transport: { code: 13, name: 'rail yard / station / bus', color: [160, 160, 170], objective: 1 },
  agriculture: { code: 14, name: 'agriculture / horticulture', color: [214, 226, 160] },
};

/** Structures that have hit points and effects when destroyed. */
export const INFRA_HP: Record<string, { hp: number; effect: 'blackout' | 'comms' | 'flood' | 'none' }> = {
  power: { hp: 120, effect: 'blackout' }, comm: { hp: 80, effect: 'comms' }, dam: { hp: 600, effect: 'flood' }, tower: { hp: 150, effect: 'none' },
};
/** Bridge hit points (area damage accumulates; at 0 the bridge falls and navigation changes). */
export const BRIDGE_HP = 260;
/** Hospitals, schools, worship and cemeteries: hitting them raises `tac.protectedHit`. */
export const PROTECTED_BUILDING = new Set(['hospital', 'school', 'religious']);

type Rule = { to?: string; ignore?: string };
const ig = (why: string): Rule => ({ ignore: why });
const t = (to: string): Rule => ({ to });
/**
 * `src:layer:class` -> neutral class. src = ov (Overture) | omt (OpenFreeMap / OpenMapTiles); `*` is the fallback of a layer.
 * Neutral targets: road classes (ROAD_SURF), cover classes (COVER_SURF), use names (USE_RULES), water: deep|stream|river|canal,
 * infra kinds: power|comm|tower|dam|station|helipad, poi kinds.
 */
export const SOURCE_RULES: Record<string, Rule> = {};
const add = (src: string, layer: string, m: Record<string, Rule | string>) => { for (const [k, v] of Object.entries(m)) SOURCE_RULES[`${src}:${layer}:${k}`] = typeof v === 'string' ? t(v) : v; };

add('ov', 'road', { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', residential: 'minor', living_street: 'minor', unclassified: 'minor', service: 'service', track: 'track', pedestrian: 'path', footway: 'path', cycleway: 'path', path: 'path', bridleway: 'track', steps: 'steps', unknown: ig('unclassified geometry'), water: ig('ferry route: not land') });
add('ov', 'rail', { rail: 'rail', standard_gauge: 'rail', narrow_gauge: 'rail', light_rail: 'rail', funicular: 'rail', tram: ig('street tram: on the road surface'), subway: ig('underground'), unknown: ig('unknown rail') });
add('ov', 'land_cover', { forest: 'wood', shrub: 'scrub', crop: 'farmland', grass: 'grass', moss: 'grass', barren: 'rock', snow: 'snow', wetland: 'wetland', mangrove: 'wetland', urban: 'residential' });
add('ov', 'land', { forest: 'wood', wood: 'wood', scrub: 'scrub', shrub: 'scrub', shrubbery: 'scrub', heath: 'scrub', grass: 'grass', grassland: 'grass', fell: 'grass', bare_rock: 'rock', rock: 'rock', scree: 'rock', cliff: 'rock', stone: ig('single stone'), shingle: 'sand', beach: 'sand', sand: 'sand', wetland: 'wetland', glacier: 'snow',
  tree_row: ig('line of trees: below raster resolution'), land: ig('generic land'), islet: ig('island polygon, ground already field'), mountain_range: ig('named range: relief comes from heights'), peak: 'peak', saddle: ig('relief point'), cave_entrance: ig('point feature'), volcano: 'peak', tree: ig('single tree'), valley: ig('relief point: heights decide'), hill: ig('relief point'), ridge: ig('relief line'), plateau: ig('relief area'), crater: ig('relief point'), dune: 'sand', reef: ig('underwater'), glacier2: 'snow' });
add('ov', 'land_use', { residential: 'residential', developed: 'residential', commercial: 'commercial', industrial: 'industrial', education: 'school', medical: 'hospital', religious: 'religious', cemetery: 'cemetery', military: 'military', transportation: 'transport', construction: 'quarry', resource_extraction: 'quarry', agriculture: 'agriculture', horticulture: 'agriculture', park: 'park', recreation: 'park', managed: 'park', protected: 'park', campground: 'park', entertainment: 'park', pedestrian: ig('pedestrian zone: ground already paved'), winter_sports: ig('ski area: ground cover decides') });
add('ov', 'water', { water: 'deep', lake: 'deep', river: 'deep', ocean: 'deep', bay: 'deep', lagoon: 'deep', reservoir: 'deep', pond: 'deep', fishpond: 'deep', basin: 'deep', canal: 'deep', stream: 'stream', ditch: 'stream', drain: 'stream', swimming_pool: ig('swimming pool: irrelevant'), wastewater: ig('treatment tank: irrelevant'), fairway: ig('navigation lane'), waterfall: ig('point feature') });
add('ov', 'infra', { power_tower: 'power', substation: 'power', plant: 'power', generator: 'power', transformer: 'power', portal: ig('cable portal'), catenary_mast: ig('pole: too small'), power_pole: ig('pole: too small'), utility_pole: ig('pole: too small'), lighting: ig('lamp post'), communication_tower: 'comm', mobile_phone_tower: 'comm', bell_tower: 'tower', defensive: 'tower', water_tower: 'tower', weir: 'dam', breakwater: 'dam', storage_tank: ig('tank: no effect'), silo: ig('silo: no effect'),
  bus_station: 'station', railway_station: 'station', railway_halt: 'station', subway_station: 'station', ferry_terminal: 'station', helipad: 'helipad', apron: 'helipad', bicycle_parking: ig('street furniture'), bicycle_rental: ig('street furniture'), motorcycle_parking: ig('street furniture'), parking: ig('parking lot: ground already paved'), parking_entrance: ig('detail'), parking_space: ig('detail'), platform: ig('platform: ground already paved'), stop_position: ig('bus stop'), bus_stop: ig('bus stop'), drinking_water: ig('fountain'), fountain: ig('fountain'), fire_hydrant: ig('hydrant'), cable: ig('power line: below raster resolution'), minor_line: ig('power line'), power_line: ig('power line'), pipeline: ig('pipeline') });
add('ov', 'building', { '*': t('building') });

add('omt', 'road', { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'minor', service: 'service', track: 'track', path: 'path', busway: 'secondary', rail: 'rail', ferry: ig('ferry route: not land'), pier: 'pier', aerialway: ig('cable car / lift: aerial'), transit: ig('subway/tram/light rail: underground or on road'), path_construction: ig('under construction'), service_construction: ig('under construction'), tertiary_construction: ig('under construction'), bridge: ig('bridge area polygon: bridge lines carry the deck') });
add('omt', 'landcover', { wood: 'wood', grass: 'grass', farmland: 'farmland', rock: 'rock', sand: 'sand', wetland: 'wetland', ice: 'snow' });
add('omt', 'landuse', { residential: 'residential', suburb: 'residential', neighbourhood: 'residential', quarter: 'residential', commercial: 'commercial', retail: 'commercial', industrial: 'industrial', hospital: 'hospital', school: 'school', kindergarten: 'school', college: 'school', university: 'school', education: 'school', library: 'school', cemetery: 'cemetery', military: 'military', railway: 'transport', bus_station: 'transport', quarry: 'quarry', pitch: 'park', playground: 'park', stadium: 'park', track: 'park', zoo: 'park' });
add('omt', 'water', { lake: 'deep', river: 'deep', ocean: 'deep', pond: 'deep', swimming_pool: ig('swimming pool: irrelevant') });
add('omt', 'waterway', { river: 'river', canal: 'canal', stream: 'stream', ditch: 'stream', drain: 'stream' });
add('omt', 'aeroway', { apron: 'helipad', helipad: 'helipad', runway: 'runway', taxiway: 'taxiway' });
add('omt', 'peak', { peak: 'peak', cliff: ig('cliff line: below raster resolution') });
add('omt', 'poi', { hospital: 'hospital', clinic: 'hospital', police: 'police', fire_station: 'fire_station', school: 'school', kindergarten: 'school', college: 'school', university: 'school', place_of_worship: 'religious', cemetery: 'cemetery', grave_yard: 'cemetery', museum: 'museum', library: 'museum', books: ig('bookshop'), castle: 'castle', ruins: 'castle', townhall: 'townhall', courthouse: 'townhall', prison: 'prison', stadium: 'stadium', marina: 'harbor', harbor: 'harbor', station: 'station', halt: 'station', subway: ig('underground entrance'), tram_stop: ig('stop'), bus_station: 'station', bus_stop: ig('stop'), christian: 'religious', jewish: 'religious', muslim: 'religious', buddhist: 'religious', positivist: 'religious', spiritualist: 'religious', office: ig('office') });
/** Overture building class/subtype -> function (kind). */
add('ov', 'bkind', { hospital: 'hospital', medical: 'hospital', school: 'school', kindergarten: 'school', college: 'school', university: 'school', education: 'school', church: 'religious', cathedral: 'religious', chapel: 'religious', temple: 'religious', religious: 'religious', presbytery: 'religious', fire_station: 'fire_station', government: 'townhall', civic: 'townhall', public: 'townhall', guardhouse: 'police', train_station: 'station', hangar: 'hangar' });

/** Resolve a source class; `undefined` = unknown (reported as unmapped). */
export function classify(src: 'ov' | 'omt', layer: string, cls: string): Rule | undefined {
  return SOURCE_RULES[`${src}:${layer}:${cls}`] ?? SOURCE_RULES[`${src}:${layer}:*`];
}

/** POI kinds that make good objectives (weight) and which are protected sites. */
export const POI_OBJECTIVE: Record<string, number> = { hospital: 3, police: 3, fire_station: 2, townhall: 3, prison: 3, castle: 2, harbor: 2, station: 2, hangar: 2, military: 3, bridge: 3, peak: 2, power: 1 };
export const PROTECTED_POI = new Set(['hospital', 'school', 'religious', 'cemetery', 'museum']);

/** Speed multiplier for rain/thaw mud (0..1 wx.mud) on a surface rule for a mobility index (0 foot, 1 wheel, 2 track). */
export const mudMult = (r: SurfRule, mud: number, g: number): number => 1 - mud * r.mud * (g === 0 ? 0.3 : 0.55);

// ---------------------------------------------------------------- destructible buildings (all data-driven)
export type Material = 'light' | 'brick' | 'concrete' | 'reinforced';
/** `k`: hit points per unit of footprint^0.7 x (1 + height/12); `min`: weakest material a function can have. */
export const MATERIALS: Record<Material, { k: number; rank: number }> = {
  light: { k: 3, rank: 0 }, brick: { k: 5, rank: 1 }, concrete: { k: 7, rank: 2 }, reinforced: { k: 12, rank: 3 },
};
/** Material by height when the function says nothing: shed < 4.5 m, houses/blocks up to 14 m, towers up to 40 m, above that reinforced. */
export const MATERIAL_BY_HEIGHT: [maxH: number, mat: Material][] = [[4.5, 'light'], [14, 'brick'], [40, 'concrete'], [1e9, 'reinforced']];
/** Per function: minimum material, civilian (destroying it hurts the population) and protected site (heavier penalty). */
export const BUILDING_KIND_RULES: Record<string, { min?: Material; civil: boolean; prot?: boolean }> = {
  hospital: { min: 'concrete', civil: true, prot: true }, school: { min: 'brick', civil: true, prot: true }, religious: { min: 'brick', civil: true, prot: true },
  townhall: { min: 'concrete', civil: true }, fire_station: { min: 'brick', civil: true }, police: { min: 'concrete', civil: false },
  station: { min: 'brick', civil: true }, hangar: { civil: false }, military: { min: 'reinforced', civil: false },
};
/** Floor height (m) used to derive `floors` from the building height. */
export const FLOOR_M = 3;
/** Rubble penalty weights: score of a destroyed civil building = (1 + floors x FLOOR_W) x (protected ? PROT_W : 1). */
export const CIVIL_FLOOR_W = 0.15, CIVIL_PROT_W = 6;
/** Collateral (0..1, TacticalResult.collateral) added per unit of that weight. */
export const COLLATERAL_PER_WEIGHT = 0.02;
/** Hit points a destroyed floor's worth of occupants lose when the roof comes down. */
export const COLLAPSE_DMG = { base: 25, perFloor: 10 };
/** Damage a projectile kind deals to buildings relative to its listed damage (bullets do nothing; a bomb penetrates). */
export const BUILDING_DMG_K: Record<string, number> = { shell: 1, rocket: 0.8, bomb: 2.2, missile: 1.2, bullet: 0 };
/** Only blasts with at least this radius (m) hurt buildings. */
export const BUILDING_MIN_AREA = 4;
/** Breach (tanks driving through small buildings). */
export const BREACH = {
  /** Largest footprint (m2) and floors of a building a vehicle can demolish; protected sites and reinforced material never. */
  maxArea: 220, maxFloors: 2,
  /** Speed multiplier the A* sees on those cells for a breaching tracked vehicle (cost = cs / (f * sqrt f)). */
  astarSpd: 0.15,
  /** Hit points per second dealt to the building by a squad of that unit kind while breaching. */
  dps: { mbt: 45, mech: 25, artillery: 15 } as Record<string, number>,
  /** Fraction of its max hit points each vehicle of the squad loses per second while demolishing, and when the wall gives way. */
  selfDps: 0.006, selfDone: 0.04,
};
export interface BuildingInfo { floors: number; mat: Material; hp: number; civil: boolean; prot: boolean; small: boolean }
export interface BuildingLike { h: number; area: number; kind?: string }
export function buildingInfo(b: BuildingLike): BuildingInfo {
  const kr = b.kind ? BUILDING_KIND_RULES[b.kind] : undefined;
  let mat = MATERIAL_BY_HEIGHT.find((r) => b.h < r[0])![1];
  if (kr?.min && MATERIALS[mat].rank < MATERIALS[kr.min].rank) mat = kr.min;
  const floors = Math.max(1, Math.round(b.h / FLOOR_M));
  const hp = Math.round(MATERIALS[mat].k * Math.pow(Math.max(b.area, 20), 0.7) * (1 + b.h / 12));
  const prot = !!kr?.prot, civil = kr ? kr.civil : true;
  return { floors, mat, hp, civil, prot, small: !prot && mat !== 'reinforced' && b.area <= BREACH.maxArea && floors <= BREACH.maxFloors };
}
/** Penalty weight of destroying a building (0 when not civil). */
export const civilWeight = (i: BuildingInfo): number => (i.civil ? (1 + i.floors * CIVIL_FLOOR_W) * (i.prot ? CIVIL_PROT_W : 1) : 0);
