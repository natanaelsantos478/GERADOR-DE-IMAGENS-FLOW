import { loadWb } from './common.mjs';

const FIELDS = {
  pop: 'SP.POP.TOTL', gdpUsd: 'NY.GDP.MKTP.CD', gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  milExpUsd: 'MS.MIL.XPND.CD', armedForces: 'MS.MIL.TOTL.P1',
  electricityKwhPc: 'EG.USE.ELEC.KH.PC', urbanPct: 'SP.URB.TOTL.IN.ZS', lifeExp: 'SP.DYN.LE00.IN',
};

// Public values for sovereign states the World Bank does not report (approximate; flagged `estimated`).
// armedForces: IISS Military Balance 2024 active personnel; milExpUsd: SIPRI/MND budget figures, rounded.
export const SUPPLEMENT = {
  TWN: { milExpUsd: 16.6e9, armedForces: 169000, gdpGrowth: 4.3, electricityKwhPc: 10800, urbanPct: 80, lifeExp: 80.9, src: 'Taiwan MND / IISS 2024; DGBAS' },
  PRK: { milExpUsd: 4.0e9, armedForces: 1280000, urbanPct: 63, lifeExp: 73.6, electricityKwhPc: 740, src: 'IISS 2024; expenditure is a low-confidence public estimate' },
  ERI: { armedForces: 202000, src: 'IISS 2024' },
  CUB: { armedForces: 49000, milExpUsd: 0.6e9, src: 'IISS 2024' },
  SYR: { armedForces: 100000, src: 'IISS 2024 (pre-2025 transition figure, rough)' },
  SOM: { armedForces: 20000, src: 'IISS 2024' },
  KOS: { armedForces: 5000, milExpUsd: 0.1e9, src: 'IISS 2024' },
};

const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function buildStats(countries) {
  const wb = Object.fromEntries(Object.entries(FIELDS).map(([k, ind]) => [k, loadWb(ind)]));
  const stats = {};
  const gaps = [];
  for (const c of countries) {
    const s = { estimated: [], years: {} };
    for (const k of Object.keys(FIELDS)) {
      const r = c.wb && wb[k][c.wb];
      if (r) { s[k] = r.value; s.years[k] = r.year; }
    }
    if (s.pop == null && c.neNamePop != null && c.neNamePop >= 0) { s.pop = c.neNamePop; s.estimated.push('pop'); }
    if (s.gdpUsd == null && c.neGdpMd > 0) { s.gdpUsd = c.neGdpMd * 1e6; s.estimated.push('gdpUsd'); }
    const sup = SUPPLEMENT[c.id];
    if (sup) for (const [k, v] of Object.entries(sup)) if (k !== 'src' && s[k] == null) { s[k] = v; s.estimated.push(k); }
    stats[c.id] = s;
  }
  // Sub-region fills (population-weighted for rates; medians for ratios).
  const bySub = {};
  countries.forEach((c) => (bySub[c.subregion] ??= []).push(c));
  const wmean = (list, k) => {
    let n = 0, d = 0;
    for (const c of list) { const s = stats[c.id]; if (!s.estimated.includes(k) && s[k] != null && s.pop > 0) { n += s[k] * s.pop; d += s.pop; } }
    return d ? n / d : null;
  };
  const ratioMedian = (list, num, den) => median(list.map((c) => { const s = stats[c.id]; return !s.estimated.includes(num) && s[num] != null && s[den] > 0 ? s[num] / s[den] : NaN; }));
  const world = countries;
  const sovereign = (c) => c.id === c.sov;
  for (const c of countries) {
    const s = stats[c.id];
    const sub = bySub[c.subregion];
    for (const k of ['gdpGrowth', 'electricityKwhPc', 'urbanPct', 'lifeExp']) {
      if (s[k] == null) { s[k] = wmean(sub, k) ?? wmean(world, k); s.estimated.push(k); }
    }
    if (s.gdpUsd == null) {
      const pc = ratioMedian(sub, 'gdpUsd', 'pop') ?? ratioMedian(world, 'gdpUsd', 'pop');
      s.gdpUsd = s.pop * pc; s.estimated.push('gdpUsd');
    }
    // Territories/dependencies have no armed forces of their own (defence is provided by the sovereign).
    const dependent = !sovereign(c) || ['Dependency', 'Lease', 'Indeterminate'].includes(c.type);
    if (s.armedForces == null) {
      if (dependent) s.armedForces = 0;
      else s.armedForces = Math.round(s.pop * (ratioMedian(sub, 'armedForces', 'pop') ?? ratioMedian(world, 'armedForces', 'pop')));
      s.estimated.push('armedForces');
    }
    if (s.milExpUsd == null) {
      if (dependent) s.milExpUsd = 0;
      else s.milExpUsd = s.gdpUsd * (ratioMedian(sub, 'milExpUsd', 'gdpUsd') ?? ratioMedian(world, 'milExpUsd', 'gdpUsd'));
      s.estimated.push('milExpUsd');
    }
    s.year = s.years.pop ?? s.years.gdpUsd ?? 2024;
    for (const k of ['pop', 'gdpUsd', 'milExpUsd', 'armedForces', 'electricityKwhPc']) s[k] = Math.round(s[k]);
    for (const k of ['gdpGrowth', 'urbanPct', 'lifeExp']) s[k] = Math.round(s[k] * 100) / 100;
    s.estimated = [...new Set(s.estimated)];
  }
  return stats;
}
