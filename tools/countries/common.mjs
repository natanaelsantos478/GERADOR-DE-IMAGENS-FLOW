import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(here, '..', '.cache');
export const OUT = join(here, '..', '..', 'public', 'data');

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// WB codes that differ from the Natural Earth WB_A3 spelling.
const WB_FIX = { WBG: 'PSE', KSV: 'XKX' };

/** Canonical country list from Natural Earth, with the code used to join World Bank data. */
export function loadCountries() {
  const g = readJson(join(CACHE, 'ne_countries.geojson'));
  const out = [];
  for (const f of g.features) {
    const p = f.properties;
    const ok = (v) => v && v !== '-99';
    let wb = [p.ISO_A3, p.WB_A3].find(ok) ?? null;
    // Natural Earth leaves ISO/WB codes as -99 for France/Norway (parsing quirk); their ADM0_A3 is the real ISO3.
    if (!wb && p.ADM0_A3 === p.SOV_A3 && p.TYPE === 'Sovereign country' && p.ISO_A3_EH && p.ISO_A3_EH !== '-99') wb = p.ISO_A3_EH;
    if (wb && WB_FIX[wb]) wb = WB_FIX[wb];
    out.push({
      id: p.ADM0_A3,
      wb,
      name: p.NAME,
      type: p.TYPE,
      sov: p.SOV_A3,
      subregion: p.SUBREGION || 'Unknown',
      continent: p.CONTINENT,
      neNamePop: p.POP_EST,
      neGdpMd: p.GDP_MD,
    });
  }
  // A WB code may only feed one NE unit (e.g. 'CHI' covers Jersey+Guernsey together): keep the unit that owns it, else none.
  const byCode = {};
  out.forEach((c) => c.wb && (byCode[c.wb] ??= []).push(c));
  for (const list of Object.values(byCode)) {
    if (list.length < 2) continue;
    const owner = list.find((c) => c.id === c.wb) ?? list.find((c) => c.id === c.sov);
    for (const c of list) if (c !== owner) c.wb = null;
  }
  return out;
}

/** Latest non-null World Bank value per country code for an indicator: code -> {value, year}. */
export function loadWb(ind) {
  const j = readJson(join(CACHE, `wb_${ind}.json`));
  const rows = j[1] ?? [];
  const best = {};
  for (const r of rows) {
    if (r.value == null) continue;
    const code = r.countryiso3code;
    if (!code) continue;
    const y = Number(r.date);
    if (!best[code] || y > best[code].year) best[code] = { value: r.value, year: y };
  }
  return best;
}
