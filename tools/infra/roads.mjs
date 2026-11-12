// Builds public/data/roads.json: routable graph from NE 10m roads + railroads.
import fs from 'node:fs';
import path from 'node:path';
import { RAW, haversineKm, round, simplifyIdx, writeJson } from './util.mjs';

const SNAP_KM = 1.0;
const SIMPLIFY_KM = Number(process.env.ROADS_SIMPLIFY_KM || 0.3);
const BRIDGE_KM = 25;
const MIN_COMPONENT_KM = 30;
const MAX_BYTES = 16 * 1024 * 1024;

// ---------- 1. load lines ----------
const lines = []; // {pts: number[] flat, cls, cont}
function classify(p, kind) {
  if (kind === 'rail') return /ferry/i.test(p.featurecla || '') ? 4 : 3;
  const t = p.type || '';
  if (/ferry/i.test(t) || p.featurecla === 'Ferry') return 4;
  if (t === 'Major Highway') return p.expressway === 1 ? 0 : 1;
  if (t === 'Beltway' || t === 'Bypass') return 1;
  return 2; // Secondary Highway, Road, Unknown, Track
}
function load(file, kind) {
  const g = JSON.parse(fs.readFileSync(path.join(RAW, file)));
  for (const f of g.features) {
    const cls = classify(f.properties, kind);
    const cont = String(f.properties.continent || '?').replace(/ x-fade$/, '');
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const c of parts) {
      if (c.length < 2) continue;
      const pts = [];
      for (const q of c) pts.push(q[0], q[1]);
      lines.push({ pts, cls, cont });
    }
  }
}
load('ne_10m_roads.geojson', 'road');
load('ne_10m_railroads.geojson', 'rail');
console.log('linhas:', lines.length);

// ---------- 2. leader clustering of vertices (snap ~1 km, no chaining) ----------
let N = 0;
for (const l of lines) N += l.pts.length / 2;
const X = new Float64Array(N), Y = new Float64Array(N), LN = new Int32Array(N);
const lineStart = new Int32Array(lines.length + 1);
{
  let k = 0;
  lines.forEach((l, li) => {
    lineStart[li] = k;
    for (let i = 0; i < l.pts.length; i += 2) { X[k] = l.pts[i]; Y[k] = l.pts[i + 1]; LN[k] = li; k++; }
  });
  lineStart[lines.length] = k;
}
const ROW = 0.01; // deg
const cells = new Map(); // key -> center ids
const rowStep = (r) => ROW / Math.max(0.05, Math.cos(((r + 0.5) * ROW - 90) * Math.PI / 180));
const rowOf = (lat) => Math.floor((lat + 90) / ROW);
const colOf = (lon, r) => Math.floor((lon + 180) / rowStep(r));
const key = (r, c) => r * 65536 + c;
const cX = [], cY = []; // centers
const clusterOf = new Int32Array(N).fill(-1);
function nearestCenter(x, y) {
  const r0 = rowOf(y);
  let best = -1, bd = SNAP_KM;
  const kx = 111.32 * Math.cos((y * Math.PI) / 180), ky = 110.57;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const c0 = colOf(x, r);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const arr = cells.get(key(r, c));
      if (!arr) continue;
      for (const id of arr) {
        let dx = Math.abs(cX[id] - x); if (dx > 180) dx = 360 - dx;
        const d = Math.hypot(dx * kx, (cY[id] - y) * ky);
        if (d < bd) { bd = d; best = id; }
      }
    }
  }
  return best;
}
function assign(v) {
  let id = nearestCenter(X[v], Y[v]);
  if (id < 0) {
    id = cX.length; cX.push(X[v]); cY.push(Y[v]);
    const r = rowOf(Y[v]), k = key(r, colOf(X[v], r));
    const a = cells.get(k); if (a) a.push(id); else cells.set(k, [id]);
  }
  clusterOf[v] = id;
}
// endpoints first so node positions sit on real line ends
for (let li = 0; li < lines.length; li++) { assign(lineStart[li]); assign(lineStart[li + 1] - 1); }
for (let v = 0; v < N; v++) if (clusterOf[v] < 0) assign(v);
console.log('vertices:', N, 'clusters:', cX.length);

// junction = endpoint of any line, or cluster visited by >= 2 distinct lines
const nC = cX.length;
const firstLine = new Int32Array(nC).fill(-1);
const junction = new Uint8Array(nC);
for (let v = 0; v < N; v++) {
  const c = clusterOf[v];
  if (firstLine[c] < 0) firstLine[c] = LN[v];
  else if (firstLine[c] !== LN[v]) junction[c] = 1;
}
for (let li = 0; li < lines.length; li++) { junction[clusterOf[lineStart[li]]] = 1; junction[clusterOf[lineStart[li + 1] - 1]] = 1; }

// ---------- 3. split lines into edges ----------
const edges = []; // {a,b,km,cls,cont,pts(flat, full res, ends = centers)}
const seen = new Map(); // dedupe key
for (let li = 0; li < lines.length; li++) {
  const s = lineStart[li], e = lineStart[li + 1] - 1, L = lines[li];
  let start = s;
  for (let v = s + 1; v <= e; v++) {
    const c = clusterOf[v];
    if (!(junction[c] || v === e)) continue;
    const ca = clusterOf[start];
    if (c === ca) { start = v; continue; } // collapsed loop inside snap radius
    const pts = [cX[ca], cY[ca]];
    for (let q = start + 1; q < v; q++) pts.push(X[q], Y[q]);
    pts.push(cX[c], cY[c]);
    let km = 0;
    for (let i = 2; i < pts.length; i += 2) km += haversineKm(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
    const a = ca, b = c;
    const grp = L.cls >= 3 ? L.cls : 0;
    const dk = (a < b ? a + ':' + b : b + ':' + a) + ':' + grp;
    const prev = seen.get(dk);
    if (prev !== undefined) {
      const E = edges[prev];
      if (Math.abs(E.km - km) < 0.25 * Math.max(E.km, km) + 1) { if (L.cls < E.cls) E.cls = L.cls; start = v; continue; }
    }
    seen.set(dk, edges.length);
    edges.push({ a, b, km, cls: L.cls, cont: L.cont, pts });
    start = v;
  }
}
console.log('arestas brutas:', edges.length);

// ---------- 4. components, bridge small orphans, drop tiny ----------
const parent = new Int32Array(nC);
for (let i = 0; i < nC; i++) parent[i] = i;
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; return a !== b; };
for (const E of edges) union(E.a, E.b);
const used = new Uint8Array(nC);
for (const E of edges) { used[E.a] = 1; used[E.b] = 1; }
const compKm = new Float64Array(nC), compNodes = new Int32Array(nC);
for (const E of edges) compKm[find(E.a)] += E.km;
for (let i = 0; i < nC; i++) if (used[i]) compNodes[find(i)]++;

// spatial grid over used nodes (0.25 deg)
const G = 0.25, gridKey = (x, y) => Math.floor((y + 90) / G) * 4096 + Math.floor((x + 180) / G);
const grid = new Map();
for (let i = 0; i < nC; i++) if (used[i]) { const k = gridKey(cX[i], cY[i]); const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]); }
const roots0 = [...new Set([...Array(nC).keys()].filter((i) => used[i]).map(find))].sort((a, b) => compKm[a] - compKm[b]);
const members = new Map();
for (let i = 0; i < nC; i++) if (used[i]) { const r = find(i); const a = members.get(r); if (a) a.push(i); else members.set(r, [i]); }
let bridges = 0, bridgedComps = 0;
const bridgeEdges = [];
const mainRoot = roots0[roots0.length - 1];
for (const r0 of roots0) {
  const memb = members.get(r0);
  const myRoot = () => find(r0);
  if (find(r0) === find(mainRoot)) continue;
  const myKm = () => { let t = 0; return t; };
  let best = null;
  const rr = find(r0);
  for (const n of memb) {
    const dLat = BRIDGE_KM / 110.57, dLon = BRIDGE_KM / (111.32 * Math.max(0.05, Math.cos((cY[n] * Math.PI) / 180)));
    const gy0 = Math.floor((cY[n] - dLat + 90) / G), gy1 = Math.floor((cY[n] + dLat + 90) / G);
    const gx0 = Math.floor((cX[n] - dLon + 180) / G), gx1 = Math.floor((cX[n] + dLon + 180) / G);
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const arr = grid.get(gy * 4096 + gx); if (!arr) continue;
      for (const m of arr) {
        const fm = find(m);
        if (fm === rr) continue;
        // only attach to a component at least as large (by km) as the current merged one
        if (compKm[fm] < compKm[rr]) continue;
        const d = haversineKm(cX[n], cY[n], cX[m], cY[m]);
        if (d <= BRIDGE_KM && (!best || d < best.d)) best = { d, n, m };
      }
    }
  }
  if (best) {
    const rb = find(best.m);
    parent[rr] = rb; compKm[rb] += compKm[rr] + best.d;
    bridgeEdges.push({ a: best.n, b: best.m, km: best.d, cls: 2, cont: edges.find((E) => E.a === best.n || E.b === best.n)?.cont || '?', pts: [cX[best.n], cY[best.n], cX[best.m], cY[best.m]] });
    bridges++;
  }
}
edges.push(...bridgeEdges);
// recompute comps
const compKm2 = new Float64Array(nC);
for (const E of edges) compKm2[find(E.a)] += E.km;
let kept = edges.filter((E) => compKm2[find(E.a)] >= MIN_COMPONENT_KM);
const dropped = edges.length - kept.length;
console.log(`pontes (<=${BRIDGE_KM} km): ${bridges}; arestas descartadas em comps < ${MIN_COMPONENT_KM} km: ${dropped}`);

// ---------- 4b. merge degree-2 nodes joining same-class edges (keeps km/geometry, fewer edges) ----------
{
  const adj = new Map(); // node -> Set(edge idx)
  const add = (n, i) => { let s = adj.get(n); if (!s) adj.set(n, (s = new Set())); s.add(i); };
  kept.forEach((E, i) => { add(E.a, i); add(E.b, i); });
  const grpOf = (E) => (E.cls >= 3 ? E.cls : 0);
  const dead = new Set();
  const orient = (E, startNode) => {
    if (E.a === startNode) return E.pts;
    const r = []; for (let i = E.pts.length - 2; i >= 0; i -= 2) r.push(E.pts[i], E.pts[i + 1]); return r;
  };
  let merged = 0;
  for (const [n, set] of adj) {
    if (set.size !== 2) continue;
    const [i1, i2] = [...set];
    const E1 = kept[i1], E2 = kept[i2];
    if (grpOf(E1) !== grpOf(E2)) continue;
    const o1 = E1.a === n ? E1.b : E1.a, o2 = E2.a === n ? E2.b : E2.a;
    if (o1 === o2 || o1 === n || o2 === n) continue;
    const pts = orient(E1, o1).concat(orient(E2, n).slice(2));
    const ni = kept.length;
    kept.push({ a: o1, b: o2, km: E1.km + E2.km, cls: Math.min(E1.cls, E2.cls), cont: E1.cont, pts });
    dead.add(i1); dead.add(i2);
    adj.get(o1).delete(i1); adj.get(o1).add(ni);
    adj.get(o2).delete(i2); adj.get(o2).add(ni);
    set.clear(); merged++;
  }
  kept = kept.filter((_, i) => !dead.has(i));
  console.log('merges de nos de grau 2:', merged, '-> arestas:', kept.length);
}
// ---------- 5. serialize ----------
function build(tol) {
  const nodeIdx = new Int32Array(nC).fill(-1);
  const nodes = { lon: [], lat: [] };
  const eo = { a: [], b: [], km: [], cls: [], geomStart: [], geomLen: [] };
  const geom = [];
  let gp = 0;
  const useNode = (c) => { if (nodeIdx[c] < 0) { nodeIdx[c] = nodes.lon.length; nodes.lon.push(round(cX[c], 4)); nodes.lat.push(round(cY[c], 4)); } return nodeIdx[c]; };
  for (const E of kept) {
    eo.a.push(useNode(E.a)); eo.b.push(useNode(E.b));
    eo.km.push(round(E.km, 2)); eo.cls.push(E.cls);
    const n = E.pts.length / 2;
    const idx = simplifyIdx(E.pts, n, tol);
    eo.geomStart.push(gp); eo.geomLen.push(idx.length);
    for (const i of idx) geom.push(round(E.pts[2 * i], 3), round(E.pts[2 * i + 1], 3));
    gp += idx.length;
  }
  return { nodes, edges: eo, geom };
}
let tol = SIMPLIFY_KM, out, json;
for (;;) {
  out = build(tol); json = JSON.stringify(out);
  if (Buffer.byteLength(json) <= MAX_BYTES || tol > 5) break;
  tol *= 1.5; console.log('> 16 MB, aumentando simplificacao para', tol.toFixed(2), 'km');
}
const size = writeJson('roads.json', out);
// side file for validate (continent per kept edge) - cache only
fs.writeFileSync(path.resolve(RAW, '../roads.edge-continent.json'), JSON.stringify(kept.map((E) => E.cont)));
console.log(`roads.json: ${out.nodes.lon.length} nos, ${out.edges.a.length} arestas, ${out.geom.length / 2} pontos de geom, simplificacao ${tol.toFixed(2)} km, ${(size / 1e6).toFixed(2)} MB`);
