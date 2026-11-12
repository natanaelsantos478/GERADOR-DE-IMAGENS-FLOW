// Model definitions. src paths are relative to tools/.cache/models (raw downloads, see fetch.sh / convert-raw.sh).
// Part fields: src, pos [x,z] (m), yaw (deg, composite only), dim (target max extent in metres inside the composite; omit = native scale)
const PF = (id) => `polyfork/${id}.glb`;
const KI = (n) => `kenney-industrial/Models/GLB format/${n}.glb`;
const KC = (n) => `kenney-commercial/Models/GLB format/${n}.glb`;
const CT = (n) => `raw-glb/${n}.glb`;

const A = {
  cimpletoon: { author: 'yd (Cimpletoon freeciv unit set)', license: 'CC0-1.0', source: 'https://opengameart.org/content/blender-models-for-freeciv-units' },
  sketlux: (slug) => ({ author: 'Sketlux', license: 'CC0-1.0', source: `https://opengameart.org/content/${slug}` }),
  polyfork: { author: 'Polyfork', license: 'CC-BY-4.0', source: 'https://polyfork.dev (catalog: https://github.com/lucas-martinic/polyfork-catalog)' },
  kenney: (slug) => ({ author: 'Kenney (kenney.nl)', license: 'CC0-1.0', source: `https://opengameart.org/content/${slug}` }),
};
const L = (o, extra) => ({ ...o, ...extra });


function hydroSlabs() {
  const conc = [0.66, 0.66, 0.64], dark = [0.30, 0.32, 0.34], water = [0.20, 0.45, 0.66], bank = [0.36, 0.42, 0.28];
  const out = [];
  const R = 46, cz = 40, n = 16, a0 = -38, a1 = 38;
  for (let i = 0; i < n; i++) {
    const a = (a0 + (a1 - a0) * (i + 0.5) / n) * Math.PI / 180, chord = 2 * R * Math.sin((a1 - a0) * Math.PI / 180 / n / 2) + 0.8;
    const x = R * Math.sin(a), z = cz - R * Math.cos(a), ry = -a * 180 / Math.PI;
    out.push({ w: chord, d: 11, h: 8, x, y: 0, z, ry, color: conc });
    out.push({ w: chord, d: 7.5, h: 8, x, y: 8, z: z + 1.2 * Math.cos(a), ry, color: conc });
    out.push({ w: chord, d: 4.5, h: 3, x, y: 16, z: z + 2.4 * Math.cos(a), ry, color: conc });
    if (Math.abs(a * 180 / Math.PI) < 22 && i % 2 === 0) out.push({ w: chord * 0.8, d: 1.6, h: 3.4, x: x, y: 16, z: z + 0.2, ry, color: dark });
  }
  out.push({ w: 170, d: 150, h: 0.3, x: 0, y: 0, z: 10, color: bank });
  out.push({ w: 44, d: 60, h: 21, x: -50, y: 0, z: -2, color: [0.45, 0.42, 0.36] });
  out.push({ w: 44, d: 60, h: 21, x: 50, y: 0, z: -2, color: [0.45, 0.42, 0.36] });
  out.push({ w: 56, d: 76, h: 15.6, x: 0, y: 0.3, z: -44, color: water });
  out.push({ w: 24, d: 72, h: 0.6, x: 0, y: 0.3, z: 46, color: water });
  out.push({ w: 3.2, d: 18, h: 3, x: 16, y: 0.3, z: 10, color: dark });
  return out;
}

export const defs = {
  mbt: { parts: [{ src: CT('abrams') }], lengthM: 9.8, yawFix: 180, ...A.sketlux('abrams-tank'),
    recolor: { body: [0.27, 0.30, 0.16], wheels: [0.08, 0.08, 0.07] }, dropMaterials: ['guide'], simplify: 0.12,
    notes: 'Recoloured from yellow to olive drab; removed helper "guide" mesh.' },
  ifv: { parts: [{ src: CT('mechinf') }], lengthM: 7.0, yawFix: 180, ...A.cimpletoon, simplify: 0.4, tintGray: [0.30, 0.33, 0.20] },
  apc: { parts: [{ src: PF('armoured-half-track-3deded') }], lengthM: 6.5, yawFix: 180, ...A.polyfork },
  truck: { parts: [{ src: PF('military-cargo-truck-652f66') }], lengthM: 8.0, yawFix: 180, ...A.polyfork },
  spg: { composite: true, lengthM: 9.0, yawFix: 180, author: 'Polyfork', license: 'CC-BY-4.0', source: 'https://polyfork.dev',
    notes: 'Composite (self-propelled): Polyfork tracked crawler chassis + Polyfork field-howitzer gun mounted on the deck.',
    parts: [{ src: PF('tracked-crawler-a7c5ff'), pos: [0, 0], dim: 7.0, oliveVC: [0.16, 0.20, 0.09] }, { src: PF('towed-field-howitzer-bb9a08'), pos: [0, 0.2], y: 1.7, dim: 5.0, yaw: 180, oliveVC: [0.16, 0.20, 0.09] }] },
  mlrs: { parts: [{ src: CT('mobilesam') }], lengthM: 9.5, yawFix: 180, ...A.sketlux('mobile-sam'), simplify: 0.2,
    notes: 'Titled "Mobile SAM" by author but is a multi-tube rocket-launcher truck (BM-21 style); used as MLRS.' },
  sam: { composite: true, lengthM: 12.0, yawFix: 180, author: 'Polyfork (truck chassis); launcher canisters are procedural (own work, CC0)', license: 'CC-BY-4.0 / CC0-1.0', source: 'https://polyfork.dev', substitute: true,
    notes: 'Composite: Polyfork 8-wheel hauler recoloured olive + procedural tilted launch canisters (Patriot/S-300 style). Not a single downloaded SAM model.',
    parts: [{ src: PF('eight-wheel-industrial-hauler-4dc3d7'), pos: [0, 0], oliveVC: [0.16, 0.20, 0.09] }],
    slabs: [{ w: 3.4, d: 4.4, h: 0.4, x: 0, y: 3.75, z: -1.5, color: [0.25, 0.27, 0.2] }, ...[[-0.8, -2.2], [0.8, -2.2], [-0.8, -0.7], [0.8, -0.7]].map(([x, z]) => ({ w: 1.4, d: 1.4, h: 6.2, x, y: 4.1, z: z - 1.2, rx: -62, color: [0.30, 0.34, 0.22] }))] },
  radar: { composite: true, lengthM: 12.0, yawFix: 180, author: 'Polyfork', license: 'CC-BY-4.0', source: 'https://polyfork.dev',
    notes: 'Composite: Polyfork 8-wheel hauler (recoloured olive) carrying a Polyfork radar dish on the roof.',
    parts: [{ src: PF('eight-wheel-industrial-hauler-4dc3d7'), pos: [0, 0], oliveVC: [0.16, 0.20, 0.09] }, { src: PF('sensor-dish-6b1108'), pos: [0, -1.8], y: 3.8, dim: 5.5, yaw: 180 }] },
  soldier: { parts: [{ src: CT('q_sm') }, { src: CT('gun_AssaultRifle_1'), attach: 'Fist.R', dim: 1.7, at: [0, 0.1, 0.1], rot: [90, 0, 0] }], lengthM: 1.8, yawFix: 180, author: 'Quaternius (Ultimate Animated Character Pack: Soldier_Male; Ultimate Gun Pack: AssaultRifle_1)', license: 'CC0-1.0',
    source: 'https://opengameart.org/content/animated-characters-pack ; https://opengameart.org/content/low-poly-guns-pack', keepAnim: true,
    animations: { idle: 'Idle', run: 'Run', shoot: 'Shoot_OneHanded', walk: 'Walk' } },
  attack_heli: { parts: [{ src: CT('apache') }], lengthM: 17.7, yawFix: 180, ...{ author: 'Geibu3D (Cheese Animal Productions)', license: 'CC-BY-4.0', source: 'https://opengameart.org/content/attack-chopper' },
    texture: 'attackchopper/Textures/Apache_Texture_Camo_Green.png', texFormat: 'image/jpeg' },
  transport_heli: { parts: [{ src: CT('helicopter02') }], lengthM: 19.8, yawFix: 180, ...A.cimpletoon, tintGray: [0.20, 0.23, 0.17], simplify: 0.3 },
  fighter: { parts: [{ src: CT('stealthfighter') }], lengthM: 18.9, yawFix: 180, ...A.cimpletoon, recolor: { body: [0.42, 0.45, 0.48], 'tinted glass': [0.1, 0.15, 0.2] } },
  bomber: { parts: [{ src: CT('stealth_bomber1') }], lengthM: 52.0, notes: 'lengthM is the largest dimension (wingspan 52 m; fuselage length is ~21 m).', yawFix: 180, ...A.cimpletoon, tintGray: [0.30, 0.32, 0.34], simplify: 0.3 },
  transport_plane: { parts: [{ src: CT('an28') }], lengthM: 30.0, yawFix: 180, author: 'mfonasd (Antonov An-28)', license: 'CC0-1.0', source: 'https://opengameart.org/content/antonov-an-28-3d-model', tintGray: [0.20, 0.23, 0.20], simplify: 0.5, substitute: true,
    notes: 'Small twin-boom STOL transport recoloured military grey; stands in for a C-130 class airlifter.' },
  drone: { parts: [{ src: CT('glider') }], lengthM: 20.0, yawFix: 180, author: 'app4soft (Glider Flying)', license: 'CC0-1.0', source: 'https://opengameart.org/content/glider-flying', simplify: 0.1, tintGray: [0.27, 0.29, 0.31], substitute: true,
    notes: 'High-aspect-ratio glider recoloured grey as stand-in for a MALE UAV (MQ-9 class); lengthM is the wingspan (largest dimension).' },
  destroyer: { parts: [{ src: CT('destroyer1') }], lengthM: 155, yawFix: 180, ...A.cimpletoon, tintGray: [0.42, 0.47, 0.52], simplify: 0.5 },
  frigate: { parts: [{ src: CT('cruiser01') }], lengthM: 135, yawFix: 180, ...A.cimpletoon, tintGray: [0.42, 0.47, 0.52], simplify: 0.5,
    notes: 'Distinct hull from "destroyer" (Cimpletoon cruiser model, scaled to frigate length).' },
  carrier: { parts: [{ src: CT('carrier01') }], lengthM: 333, yawFix: 180, ...A.cimpletoon, tintGray: [0.40, 0.45, 0.50] },
  submarine: { parts: [{ src: CT('submarine') }], lengthM: 110, yawFix: 180, ...A.cimpletoon, tintGray: [0.26, 0.30, 0.34] },
  cargo_ship: { parts: [{ src: CT('containership') }], lengthM: 300, yawFix: 180, ...A.sketlux('container-ship-full'), simplify: 0.04 },
  missile: { parts: [{ src: CT('cruise_missile01') }], lengthM: 6.0, yawFix: 180, ...A.cimpletoon, tintGray: [0.62, 0.64, 0.62] },

  wind_turbine: { parts: [{ src: KI('windmill') }], lengthM: 90, yawFix: 180, ...A.kenney('city-kit-industrial') },
  solar_farm: { composite: true, lengthM: 120, ...A.kenney('city-kit-industrial'),
    parts: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ src: KI('solar-panel-landscape-group'), pos: [(c - 1) * 20, (r - 1) * 18], dim: 16 }))) },
  factory: { composite: true, lengthM: 90, ...A.kenney('city-kit-industrial'),
    parts: [{ src: KI('building-m'), pos: [0, 0], dim: 40 }, { src: KI('building-p'), pos: [-30, 14], dim: 26 }, { src: KI('building-a'), pos: [26, 12], dim: 28 }, { src: KI('building-d'), pos: [-6, 28], dim: 18 }] },
  plant_thermal: { composite: true, lengthM: 110, author: 'Polyfork; Kenney (kenney.nl)', license: 'CC-BY-4.0 / CC0-1.0', source: 'https://polyfork.dev ; https://opengameart.org/content/city-kit-industrial',
    parts: [{ src: PF('riveted-boiler-hall-da0c09'), pos: [0, 0], dim: 44 }, { src: PF('cowled-chimney-stack-de5055'), pos: [30, -10], dim: 55, grayVC: true }, { src: PF('cowled-chimney-stack-de5055'), pos: [30, 8], dim: 55, grayVC: true }, { src: KI('detail-tank-large'), pos: [-32, 16], dim: 16 }, { src: KI('building-a'), pos: [-2, 28], dim: 24 }] },
  refinery: { composite: true, lengthM: 110, author: 'Kenney (kenney.nl); Polyfork', license: 'CC0-1.0 / CC-BY-4.0', source: 'https://opengameart.org/content/city-kit-industrial ; https://polyfork.dev',
    parts: [{ src: KI('detail-tank-large'), pos: [-24, -14], dim: 22 }, { src: KI('detail-tank-large'), pos: [0, -14], dim: 22 }, { src: KI('detail-tank-large'), pos: [24, -14], dim: 22 }, { src: PF('horizontal-tank-6e9b8b'), pos: [-14, 14], dim: 18 }, { src: PF('horizontal-tank-6e9b8b'), pos: [10, 14], dim: 18 }, { src: PF('cowled-chimney-stack-de5055'), pos: [40, 4], dim: 50, grayVC: true }, { src: PF('pipe-run-280a0d'), pos: [-30, 4], dim: 16, yaw: 90 }] },
  plant_nuclear: { composite: true, lengthM: 140, author: 'vi1e8 (cooling tower); Polyfork (reactor block)', license: 'CC0-1.0 / CC-BY-4.0',
    source: 'https://opengameart.org/content/cooling-tower ; https://polyfork.dev',
    parts: [{ src: CT('cooling'), pos: [-34, -10], dim: 52 }, { src: CT('cooling'), pos: [34, -10], dim: 52 }, { src: PF('reactor-block-13fe72'), pos: [0, 26], dim: 36 }], defaultMaterial: [0.78, 0.78, 0.76] },
  plant_hydro: { composite: true, lengthM: 130, author: 'Kenney (kenney.nl); Polyfork; procedural dam (own work)', license: 'CC0-1.0 / CC-BY-4.0', source: 'https://opengameart.org/content/city-kit-industrial ; https://polyfork.dev', substitute: true,
    notes: 'No free hydro-dam model found: procedural stepped concrete arch dam with spillway gates, reservoir and river (own work, CC0) + Kenney industrial building as power house.',
    slabs: hydroSlabs(),
    parts: [{ src: KI('building-i'), pos: [16, 28], dim: 24, yaw: 0 }, { src: KI('building-k'), pos: [-30, 30], dim: 18 }] },
  airport: { composite: true, lengthM: 200, author: 'Polyfork', license: 'CC-BY-4.0', source: 'https://polyfork.dev',
    notes: 'Procedural runway/apron slabs (own work, CC0).',
    slabs: [{ w: 170, d: 20, h: 0.4, x: 0, z: -6, color: [0.28, 0.29, 0.31] }, { w: 170, d: 34, h: 0.3, x: 0, z: 28, color: [0.5, 0.52, 0.54] }],
    parts: [{ src: PF('airfield-control-tower-ab8d3e'), pos: [-56, 30], dim: 24 }, { src: PF('shuttle-hangar-8ff9a3'), pos: [-16, 30], dim: 34 }, { src: PF('vehicle-depot-hangar-6adb80'), pos: [24, 30], dim: 30 }, { src: PF('landing-pad-781932'), pos: [60, 30], dim: 24 }] },
  port: { composite: true, lengthM: 160, author: 'Polyfork', license: 'CC-BY-4.0', source: 'https://polyfork.dev',
    notes: 'Procedural quay/water slabs (own work, CC0).',
    slabs: [{ w: 130, d: 40, h: 0.5, x: 0, z: 10, color: [0.5, 0.52, 0.55] }, { w: 130, d: 30, h: 0.1, x: 0, z: -25, color: [0.22, 0.45, 0.62] }],
    parts: [{ src: PF('dock-cargo-crane-ccd97f'), pos: [-40, -6], dim: 34 }, { src: PF('dock-cargo-crane-ccd97f'), pos: [10, -6], dim: 34 }, { src: PF('dock-warehouse-bf0967'), pos: [-40, 24], dim: 34 }, { src: PF('cargo-container-fd73bc'), pos: [8, 16], dim: 14 }, { src: PF('cargo-container-fd73bc'), pos: [24, 16], dim: 14 }, { src: PF('cargo-container-fd73bc'), pos: [8, 28], dim: 14 }, { src: PF('cargo-container-fd73bc'), pos: [24, 28], dim: 14 }, { src: PF('cargo-container-fd73bc'), pos: [44, 22], dim: 14 }] },
  military_base: { composite: true, lengthM: 120, author: 'Polyfork', license: 'CC-BY-4.0', source: 'https://polyfork.dev',
    notes: 'Procedural ground slab (own work, CC0).',
    slabs: [{ w: 100, d: 70, h: 0.4, x: 0, z: 8, color: [0.42, 0.45, 0.36] }],
    parts: [{ src: PF('command-center-e65850'), pos: [0, 0], dim: 26 }, { src: PF('nissen-hut-dafb56'), pos: [-34, 6], dim: 22 }, { src: PF('nissen-hut-dafb56'), pos: [-34, 26], dim: 22 }, { src: PF('concrete-pillbox-ea855a'), pos: [34, -14], dim: 12 }, { src: PF('sentry-box-fc915e'), pos: [42, 8], dim: 8 }, { src: PF('landing-pad-781932'), pos: [24, 30], dim: 24 }, { src: PF('anti-aircraft-gun-93cc80'), pos: [-8, 26], dim: 10 }] },
  city_block: { composite: true, lengthM: 140, author: 'Kenney (kenney.nl)', license: 'CC0-1.0', source: 'https://opengameart.org/content/city-kit-commercial',
    notes: 'Procedural ground slab (own work, CC0).',
    slabs: [{ w: 100, d: 100, h: 0.4, x: 0, z: 0, color: [0.38, 0.4, 0.43] }],
    parts: [{ src: KC('building-skyscraper-a'), pos: [-24, -22], dim: 52 }, { src: KC('building-skyscraper-c'), pos: [24, -22], dim: 70 }, { src: KC('building-skyscraper-e'), pos: [-24, 24], dim: 60 }, { src: KC('building-a'), pos: [24, 24], dim: 30 }] },
  capital_building: { parts: [{ src: PF('civic-dome-pavilion-97ea07') }], lengthM: 60, yawFix: 180, ...A.polyfork },
};
