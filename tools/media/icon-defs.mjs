// Icon definitions. "lucide:<name>" copies from lucide-static (ISC); anything else is hand-drawn (24x24, currentColor).
const F = '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/>'; // land-unit frame
const dots = (pts, r = 1.9) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`).join('');
const speed = (n) => {
  const w = n * 4 - 1, x0 = (24 - w) / 2;
  return Array.from({ length: n }, (_, i) => `<path d="M${x0 + i * 4} 7l3 5-3 5"/>`).join('');
};
const cart = (ox) => `<path d="M${ox} 21v-9c0-2.2 1.2-4.2 2.5-5 1.3.8 2.5 2.8 2.5 5v9z"/><path d="M${ox} 17h5"/>`;
const missile = (wings) =>
  `<path d="M12 2c1.8 2 2.5 5 2.5 8.5V17h-5v-6.5C9.5 7 10.2 4 12 2z"/><path d="M9.5 15l-3 4v2h3M14.5 15l3 4v2h-3"/>${wings ? '<path d="M9.5 10H4M14.5 10H20"/>' : '<path d="M11 19.5c0 1.5.5 2.5 1 2.5s1-1 1-2.5"/>'}`;

export const L = (n) => `lucide:${n}`;
export const ICONS = {
  // resources
  money: L('coins'), energy: L('zap'), oil: L('droplet'), food: L('wheat'),
  steel: '<path d="M2.5 18l3-5.5h13l3 5.5z"/><path d="M7 12.5L8.5 8h7l1.5 4.5"/><path d="M10 8l.8-3h2.4l.8 3"/>',
  electronics: L('cpu'), rare_earth: L('gem'), uranium: L('radiation'),
  munitions: cart(3) + cart(9.5) + cart(16), consumer_goods: L('shopping-bag'), manpower: L('users'),
  research: L('flask-conical'), stability: L('scale'), approval: L('thumbs-up'), population: L('users-round'),
  // UI folders
  economy: L('trending-up'), budget: L('wallet'), construction: L('hammer'), trade: L('arrow-left-right'),
  diplomacy: L('handshake'), forces: L('shield'), production: L('factory'), intelligence: L('eye'),
  encyclopedia: L('book-open'), settings: L('settings'), save: L('save'), load: L('folder-open'),
  news: L('newspaper'), alert: L('bell-ring'),
  // power plant fuels
  coal: '<path d="M4 15l2-6 5-3.5 6 2 3 5-2 5.5H8z"/><path d="M11 5.5L9 12l5 1 3-5.5M9 12l-1 7M14 13l1 5.5"/>',
  gas: L('flame'), oil_plant: '<path d="M8 21l3-17h2l3 17"/><path d="M9.2 15h5.6M10.2 9.5h3.6M6 21h12"/><path d="M12 4V2"/>',
  nuclear: L('atom'), hydro: L('waves'), wind: L('wind'), solar: L('sun'), biomass: L('leaf'),
  geothermal: '<path d="M2 21h20"/><path d="M5.5 21l3.5-9h6l3.5 9"/><path d="M10 9c-1.2-1.6 1.2-2.4 0-4.2M14 9c-1.2-1.6 1.2-2.4 0-4.2"/>',
  // infrastructure
  city: L('building-2'), capital: L('landmark'), airport: L('plane-takeoff'), port: L('anchor'), road: L('route'),
  rail: L('train-front'), factory: L('factory'),
  mil_factory: `lucide:cog+<path d="M12 9.3l.8 1.8 1.9.2-1.4 1.3.4 1.9-1.7-1-1.7 1 .4-1.9-1.4-1.3 1.9-.2z" fill="currentColor"/>`,
  refinery: '<path d="M3 21h18"/><path d="M5 21V9h5v12M14 21v-8h5v8"/><path d="M7.5 9V3"/><path d="M16.5 13c-1.6-1.4 0-3 0-4.5 1.6 1.4 3 3.1 0 4.5z"/>',
  mine: L('pickaxe'), farm: L('tractor'), hospital: L('hospital'), university: L('graduation-cap'),
  base: '<path d="M3 21h18M3 21L12 8l9 13"/><path d="M12 21v-6"/><path d="M12 8V3l4 1.5L12 6"/>',
  sam_site: '<path d="M3 21h18"/><path d="M6 21v-3h12v3"/><path d="M9 17L6 6M15 17l3-11"/><path d="M5 8.5L6 4.5l2 .8M19 8.5L18 4.5l-2 .8"/>',
  radar: L('radar'),
  silo: '<path d="M3 21h18"/><path d="M7 21V12M17 21V12"/><path d="M7 12a5 1.8 0 0 1 10 0"/><path d="M12 17V4"/><path d="M12 4l-1.8 3.5M12 4l1.8 3.5"/>',
  bunker: '<path d="M3 20a9 8 0 0 1 18 0z"/><path d="M9 15h6"/>',
  // tactical formation symbols
  infantry: F + '<path d="M2.5 6l19 12M21.5 6l-19 12"/>',
  mechanized: F + '<ellipse cx="12" cy="12" rx="5" ry="3"/><path d="M2.5 6l5 4M21.5 6l-5 4M2.5 18l5-4M21.5 18l-5-4"/>',
  armor: F + '<ellipse cx="12" cy="12" rx="5.5" ry="3.2"/>',
  recon: F + '<path d="M2.5 18l19-12"/>',
  artillery: F + '<circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  mlrs: F + '<path d="M8.5 8.5v5M12 8.5v5M15.5 8.5v5M7 15.5h10"/>',
  air_defense: F + '<path d="M7 16v-1a5 5 0 0 1 10 0v1z"/>',
  engineer: F + '<path d="M7 16v-3a5 5 0 0 1 10 0v3"/>',
  logistics: F + '<path d="M6.5 12h11M14 8.5l3.5 3.5-3.5 3.5"/>',
  special_forces: F + '<path d="M13 7.5l-4 5h6l-4 5"/>',
  attack_heli: '<path d="M3 5.5h16M11 5.5v3"/><ellipse cx="11" cy="12.5" rx="5.5" ry="3.5"/><path d="M16 11.5l5-3M5.5 12.5H2.5"/><path d="M4 19h12M8 16v3M14 16v3"/>',
  transport_heli: '<path d="M2 5h8M14 5h8M6 5v3M18 5v3"/><rect x="3" y="8" width="18" height="7" rx="3"/><path d="M5 19h14M8 15v4M16 15v4"/>',
  fighter: '<path d="M12 2.5l1.8 6 7.7 6v2.5l-7.7-2.5-.5 4.5 2 1.5V22H8.7v-.5l2-1.5-.5-4.5L2.5 17v-2.5l7.7-6z"/>',
  bomber: '<path d="M12 2c1 0 1.5 1.5 1.5 3.5V9L22 13v2.5L13.5 14v5l2.5 1.5V22H8v-1.5l2.5-1.5v-5L2 15.5V13l8.5-4V5.5C10.5 3.5 11 2 12 2z"/>',
  air_transport: '<path d="M12 2.5c1 0 1.5 1 1.5 2.5v5l8 1.5v2.5l-8-.5v4.5l2.5 1.5V22H8v-2l2.5-1.5V14l-8 .5V12l8-1.5V5c0-1.5.5-2.5 1.5-2.5z"/><path d="M6.5 12v2.5M17.5 12v2.5"/>',
  drone: '<path d="M12 4v13"/><path d="M2.5 10.5h19"/><path d="M9 20l3-2.5 3 2.5"/><circle cx="12" cy="7" r="1.6"/>',
  destroyer: '<path d="M2 14h20l-3.5 5h-13z"/><path d="M7 14v-3h7v3"/><path d="M10 11V7"/><path d="M16 14v-2.5l4-1.5"/>',
  frigate: '<path d="M2 14h20l-3.5 5h-13z"/><path d="M6.5 14v-2.5h8V14"/><path d="M10.5 11.5V6.5M8.5 8.5h4"/>',
  submarine: '<ellipse cx="11.5" cy="14.5" rx="9" ry="3.8"/><path d="M9.5 10.8V8h4v2.8M12 8V5h3"/><path d="M20.5 12.5l2-1.5M20.5 16.5l2 1.5"/>',
  carrier: '<path d="M2 11.5h20v3H2z"/><path d="M4 14.5l2 4.5h12l2-4.5"/><path d="M15 11.5V8h3v3.5"/><path d="M5 13h7"/>',
  landing_ship: '<path d="M2 14h20l-3.5 5h-13z"/><path d="M6 14v-3.5h4V14M10 14v-3.5h4V14"/><path d="M20 14l2.4-2.8"/>',
  cruise_missile: missile(true),
  ballistic_missile: missile(false),
  nuke: '<path d="M7 21h10M12 21v-7"/><path d="M5 10.5A4 4 0 0 1 9 6.6a4 4 0 0 1 6 0 4 4 0 0 1 4 3.9c0 2-2 3.5-4 3.5H9c-2 0-4-1.5-4-3.5z"/>',
  // orders
  move: L('navigation'), attack: L('crosshair'),
  attack_move: '<path d="M2 12h8.5M7.5 8.5L11 12l-3.5 3.5"/><circle cx="17.5" cy="12" r="3.5"/><path d="M17.5 6.5v2M17.5 15.5v2M12 12h0"/>',
  hold: L('hand'), retreat: L('undo-2'),
  entrench: '<path d="M2 9h5v8h10V9h5"/><path d="M2 21h20"/>',
  smoke: L('cloud-fog'),
  call_artillery: '<path d="M3 19C5.5 7 13 4 18.5 14"/><path d="M15 14.5l3.5-.5 1 3.5"/><path d="M2 21.5h20"/>',
  call_airstrike: '<path d="M12 1.5l1.4 3.5v2l5.6 3.5v2l-5.6-1.5v3l1.6 1.2v1.3L12 15.5l-3 1v-1.3l1.6-1.2v-3L5 12.5v-2L10.6 7V5z"/><path d="M8 19.5v2M12 19v3M16 19.5v2"/>',
  formation_line: dots([[3.5, 12], [7.75, 12], [12, 12], [16.25, 12], [20.5, 12]]),
  formation_column: dots([[12, 3.5], [12, 7.75], [12, 12], [12, 16.25], [12, 20.5]]),
  formation_wedge: dots([[12, 5], [8.5, 10], [15.5, 10], [5, 15], [19, 15]]),
  formation_spread: dots([[5, 6], [12, 4.5], [19, 7], [7.5, 13], [16, 12.5], [11, 19], [20, 18], [4, 19]]),
  cease_fire: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M10 9v6M14 9v6"/>',
  fire_at_will: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  // controls
  pause: L('pause'), play: L('play'),
  speed_1: speed(1), speed_2: speed(2), speed_3: speed(3), speed_4: speed(4), speed_5: speed(5),
  zoom_in: L('zoom-in'), zoom_out: L('zoom-out'), locate: L('locate'), close: L('x'), check: L('check'),
  warning: L('triangle-alert'), lock: L('lock'),
  peace: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v19M12 12l-6.7 6.7M12 12l6.7 6.7"/>',
  war: L('swords'), alliance: L('handshake'), embargo: L('package-x'), treaty: L('scroll-text'),
};
