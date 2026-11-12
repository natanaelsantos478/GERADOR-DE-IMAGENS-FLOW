import { readJson, here } from './common.mjs';
import { join } from 'node:path';

export const FIELDS = ['tanks', 'ifv', 'artillery', 'mlrs', 'sam', 'fighters', 'bombers', 'attackHelis', 'transports', 'drones', 'destroyers', 'frigates', 'subs', 'carriers', 'nukes'];
// Fields that the formula may estimate. bombers/carriers/destroyers/nukes are never derived: they exist only for
// countries in the known table (the real ones), because they are rare, strategic assets.
const DERIVED = ['tanks', 'ifv', 'artillery', 'mlrs', 'sam', 'fighters', 'attackHelis', 'transports', 'drones', 'frigates', 'subs'];
const NAVAL = new Set(['frigates', 'subs']);
// Landlocked states (Natural Earth ADM0_A3): no naval units are derived for them.
const LANDLOCKED = new Set('AFG ARM AUT AZE BLR BTN BOL BWA BFA BDI CAF TCD CZE SWZ ETH HUN KOS KGZ LAO LSO LIE LUX MWI MLI MDA MNG NPL NER MKD PRY RWA SRB SVK SDS TJK TKM UGA UZB VAT ZMB ZWE SMR AND'.split(' '));

// Solve OLS y = b0 + b1*x1 + b2*x2 (normal equations, Cramer-free Gaussian elimination).
function ols(rows) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const { x1, x2, y } of rows) {
    const v = [1, x1, x2];
    for (let i = 0; i < 3; i++) { b[i] += v[i] * y; for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j]; }
  }
  for (let i = 0; i < 3; i++) A[i].push(b[i]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c]; }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

const feat = (st) => ({ x1: Math.log(Math.max(st.armedForces, 1) / 1000), x2: Math.log(Math.max(st.milExpUsd, 1e7) / 1e9) });

/**
 * Inventory = known real table where available; otherwise
 *   count = exp(b0 + b1*ln(armedForces/1000) + b2*ln(milExpUsd/1e9)) - 1
 * fitted per field by OLS over the known-table countries (log1p space, so it is calibrated against them),
 * then clamped by what the force can plausibly field (ground vehicles <= 40% of personnel/10, etc.).
 */
export function buildMilitary(countries, stats) {
  const known = readJson(join(here, 'military-known.json'));
  delete known._meta;
  const coef = {}, calib = {};
  const trainSet = Object.keys(known).filter((id) => stats[id] && stats[id].armedForces > 0);
  for (const f of DERIVED) {
    const rows = trainSet.map((id) => ({ ...feat(stats[id]), y: Math.log1p(known[id][f]) }));
    coef[f] = ols(rows);
    // calibration: median of |ln((pred+1)/(actual+1))| on the training set, and R^2
    const [b0, b1, b2] = coef[f];
    const ys = rows.map((r) => r.y), my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sse = 0, sst = 0;
    for (const r of rows) { const p = b0 + b1 * r.x1 + b2 * r.x2; sse += (r.y - p) ** 2; sst += (r.y - my) ** 2; }
    calib[f] = { r2: Number((1 - sse / sst).toFixed(3)), coef: coef[f].map((v) => Number(v.toFixed(4))) };
  }
  const out = {}; const derived = [];
  for (const c of countries) {
    const st = stats[c.id];
    const inv = Object.fromEntries(FIELDS.map((f) => [f, 0]));
    if (known[c.id]) {
      for (const f of FIELDS) inv[f] = known[c.id][f];
    } else if (st.armedForces > 0) {
      derived.push(c.id);
      const x = feat(st);
      const personnel = st.armedForces;
      for (const f of DERIVED) {
        if (NAVAL.has(f) && LANDLOCKED.has(c.id)) continue;
        const [b0, b1, b2] = coef[f];
        let v = Math.expm1(b0 + b1 * x.x1 + b2 * x.x2);
        // plausibility caps, regardless of fit
        const cap = f === 'drones' ? personnel / 20 : NAVAL.has(f) ? personnel / 800 : f === 'fighters' || f === 'attackHelis' || f === 'transports' ? personnel / 150 : personnel / 25;
        v = Math.min(v, cap);
        inv[f] = v < 0.5 ? 0 : Math.round(v);
      }
    }
    out[c.id] = inv;
  }
  return { military: out, coef: calib, knownCount: Object.keys(known).length, derivedCount: derived.length, trainN: trainSet.length };
}
