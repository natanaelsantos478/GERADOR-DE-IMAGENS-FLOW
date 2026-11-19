// usage: node tools/military/build-garrisons.mjs   (run once; the game simulates from there)
// oob/<ISO3>.json (read from public sources) + wikidata-units.json -> public/data/military.json  `garrisons` per country:
// [[lon, lat, weight, domain]] with domain 0 land / 1 air / 2 naval and weight = estimated active personnel there.
// Each garrison is re-located by name against the game's own cities (and provinces for war-zone deployments, which stay
// region-level: the province centroid); the source's lat/lon is only the fallback. Leaf units carry the strength (a parent
// with listed sub-units counts only its HQ), then everything is scaled to the country's active personnel when known.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), DATA = path.join(here, '../../public/data');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(city|oblast|province|state|region|district|governorate|area)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// typical peacetime strength per echelon (active personnel)
const STR = { army: 40000, corps: 25000, division: 10000, brigade: 3500, regiment: 1500, battalion: 600, group: 800,
  fleet: 8000, flotilla: 1500, naval_base: 1200, ship: 200, wing: 1500, regiment_air: 1000, squadron: 250, air_base: 800, command: 400, other: 400 };
const DOM = (u) => (u.branch === 'navy' || ['fleet', 'flotilla', 'naval_base', 'ship'].includes(u.echelon) ? 2 : u.branch === 'air' || ['wing', 'regiment_air', 'squadron', 'air_base'].includes(u.echelon) ? 1 : 0);

const cities = rd(path.join(DATA, 'cities.json')).cols, provinces = rd(path.join(DATA, 'provinces.json'));
const cityIdx = new Map();
for (let i = 0; i < cities.name.length; i++) {
  const k = `${cities.iso3[i]}|${norm(cities.name[i])}`, prev = cityIdx.get(k);
  if (!prev || cities.pop[i] > prev.pop) cityIdx.set(k, { lon: cities.lon[i], lat: cities.lat[i], pop: cities.pop[i] });
}
const provIdx = new Map(provinces.map((p) => [norm(p.name), p]));
const cityOf = (c, name) => {
  if (!name) return null;
  for (const part of [name, ...String(name).split(/[,/(]/)]) { const h = cityIdx.get(`${c}|${norm(part)}`); if (h) return [h.lon, h.lat]; }
  return null;
};

const military = rd(path.join(DATA, 'military.json'));
const report = {};
// no single garrison may hold more than 15 % of a country's personnel (a mislabelled HQ would pull half the army there)
const capShare = (pts) => { const tot = pts.reduce((s, p) => s + p[2], 0), lim = Math.max(1, tot * 0.15); return pts.map((p) => [p[0], p[1], Math.min(p[2], lim), p[3]]); };
const add = (c, pts) => { if (pts.length) military[c] = { ...(military[c] ?? {}), garrisons: capShare(pts).map((p) => [p[0], p[1], Math.round(p[2]), p[3]]) }; };

// ---- countries read from public orders of battle
const done = new Set();
for (const f of fs.readdirSync(path.join(here, 'oob')).filter((f) => f.endsWith('.json'))) {
  const o = rd(path.join(here, 'oob', f)), c = o.iso3, units = o.units ?? [];
  const parents = new Set(units.map((u) => norm(u.parent)).filter(Boolean));
  const pts = []; let located = 0, region = 0;
  for (const u of units) {
    let at = null;
    if (u.deployedRegion) { const p = provIdx.get(norm(u.deployedRegion)); if (p) { at = p.centroid; region++; } }
    at ??= cityOf(c, u.garrison) ?? (typeof u.lon === 'number' && typeof u.lat === 'number' ? [u.lon, u.lat] : null);
    if (!at) continue;
    located++;
    const leaf = !parents.has(norm(u.name));
    pts.push([at[0], at[1], leaf ? (STR[u.echelon] ?? 400) : 400, DOM(u)]);
  }
  const sum = pts.reduce((s, p) => s + p[2], 0), k = o.activePersonnel && sum ? Math.min(4, Math.max(0.25, o.activePersonnel / sum)) : 1;
  add(c, pts.map((p) => [+p[0].toFixed(3), +p[1].toFixed(3), Math.round(p[2] * k), p[3]]));
  done.add(c); report[c] = { units: units.length, located, region, scale: +k.toFixed(2) };
}

// ---- other countries: Wikidata units with a headquarters (skip police, fire, schools, rebels)
const SKIP = /police|gendarm|fire|school|academy|college|universit|guerr|rebel|insurg|militia|band|museum|reserve|cadet|training/i;
const EST = [[/division/i, 'division'], [/brigade/i, 'brigade'], [/regiment/i, 'regiment'], [/battalion/i, 'battalion'], [/squadron/i, 'squadron'], [/wing/i, 'wing'], [/fleet/i, 'fleet'], [/flotilla/i, 'flotilla'], [/^(?!.*(marine|signal|medical|cadet|engineer|music|chaplain|fire)).*corps/i, 'corps'], [/air base|airbase/i, 'air_base'], [/naval base/i, 'naval_base']];
const wd = rd(path.join(here, 'wikidata-units.json')), byC = new Map();
for (const r of wd) {
  const c = r.iso?.value, label = r.label?.value ?? '', type = r.typelabel?.value ?? '';
  if (!c || done.has(c) || SKIP.test(label + ' ' + type)) continue;
  const m = /point\(([-\d.]+) ([-\d.]+)\)/i.exec(r.coord?.value ?? ''); if (!m) continue;
  const id = r.u.value; const list = byC.get(c) ?? byC.set(c, new Map()).get(c); if (list.has(id)) continue;
  const ech = (EST.find(([re]) => re.test(label + ' ' + type)) ?? [, 'other'])[1];
  list.set(id, [+(+m[1]).toFixed(3), +(+m[2]).toFixed(3), STR[ech], DOM({ echelon: ech, branch: /naval|navy/i.test(label) ? 'navy' : /air/i.test(label) ? 'air' : '' })]);
}
for (const [c, list] of byC) { add(c, [...list.values()]); report[c] = { units: list.size, located: list.size, source: 'wikidata' }; }

fs.writeFileSync(path.join(DATA, 'military.json'), JSON.stringify(military));
const oobN = Object.values(report).filter((r) => !r.source).length;
console.log('countries with garrisons:', Object.keys(report).length, `(${oobN} from orders of battle, ${Object.keys(report).length - oobN} from Wikidata)`);
for (const [c, r] of Object.entries(report).filter(([, r]) => !r.source)) console.log(c, JSON.stringify(r));
