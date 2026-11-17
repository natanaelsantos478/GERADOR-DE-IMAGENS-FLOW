/** Rasterise vector geometry into the compact navigation layers (surface class + building id) and the building list. */
import { COVER_SURF, INFRA_HP, ROAD_RADIUS, ROAD_SURF, USE_RULES, VEHICLE_ROADS } from '../../sim/tactical/terrainRules';
import { encodeRle, GARRISON_M2, ATTRIBUTION, SURF, type NavBuilding, type NavData, type NavInfra, type NavPoi } from './nav';
import type { VectorArea, VLine, VPoly } from './types';

export interface RasterOpts {
  sizeM?: number; cell?: number;
  /** Real terrain heights (hn*hn, row-major from the SW, metres); stored finer than the legacy 64x64 so slopes are real. */
  heights?: number[]; hn?: number;
}

const ROAD_RANK: Record<number, number> = { [SURF.STEPS]: 0, [SURF.PATH]: 0, [SURF.TRACK]: 1, [SURF.RAIL]: 2, [SURF.SERVICE]: 3, [SURF.MINOR]: 4, [SURF.TERTIARY]: 5, [SURF.SECONDARY]: 6, [SURF.PRIMARY]: 7, [SURF.RUNWAY]: 7, [SURF.MOTORWAY]: 8 };

function simplify(p: number[], tol: number): number[] {
  const n = p.length / 2;
  if (n < 5) return p;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st: [number, number][] = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop()!;
    let md = 0, mi = -1;
    const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1], L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i * 2] - p[a * 2]) * dy - (p[i * 2 + 1] - p[a * 2 + 1]) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const o: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) o.push(Math.round(p[i * 2] * 10) / 10 || 0, Math.round(p[i * 2 + 1] * 10) / 10 || 0);
  return o;
}

export function rasterizeNav(a: VectorArea, o: RasterOpts = {}): NavData {
  const sizeM = o.sizeM ?? a.sizeM, cellM = o.cell ?? 16;
  const n = Math.ceil(sizeM / cellM), cs = sizeM / n, half = sizeM / 2;
  const surf = new Uint8Array(n * n), bld = new Uint16Array(n * n);
  const inGrid = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < n && cy < n;

  /** Even-odd scanline fill of a polygon's rings; calls cb for cells with >= thr of ss*ss samples inside. */
  function fill(rings: number[][], ss: number, thr: number, cb: (c: number) => void): number {
    let mnx = 1e18, mny = 1e18, mxx = -1e18, mxy = -1e18;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) { mnx = Math.min(mnx, r[i]); mxx = Math.max(mxx, r[i]); mny = Math.min(mny, r[i + 1]); mxy = Math.max(mxy, r[i + 1]); }
    const cx0 = Math.max(0, Math.floor((mnx + half) / cs)), cx1 = Math.min(n - 1, Math.floor((mxx + half) / cs));
    const cy0 = Math.max(0, Math.floor((mny + half) / cs)), cy1 = Math.min(n - 1, Math.floor((mxy + half) / cs));
    if (cx1 < cx0 || cy1 < cy0) return 0;
    const W = cx1 - cx0 + 1, H = cy1 - cy0 + 1, acc = new Uint8Array(W * H), sub = cs / ss;
    const ex: number[] = [];
    for (const r of rings) for (let i = 0, m = r.length / 2, j = m - 1; i < m; j = i++) if (r[j * 2 + 1] !== r[i * 2 + 1]) ex.push(r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]);
    const xs: number[] = [];
    for (let js = cy0 * ss; js < (cy1 + 1) * ss; js++) {
      const y = (js + 0.5) * sub - half;
      xs.length = 0;
      for (let k = 0; k < ex.length; k += 4) {
        const ya = ex[k + 1], yb = ex[k + 3];
        if ((ya <= y && yb > y) || (yb <= y && ya > y)) xs.push(ex[k] + ((y - ya) * (ex[k + 2] - ex[k])) / (yb - ya));
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      const row = (Math.floor(js / ss) - cy0) * W;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const s0 = Math.max(cx0 * ss, Math.ceil((xs[k] + half) / sub - 0.5)), s1 = Math.min((cx1 + 1) * ss - 1, Math.floor((xs[k + 1] + half) / sub - 0.5));
        for (let s = s0; s <= s1; s++) acc[row + Math.floor(s / ss) - cx0]++;
      }
    }
    let cnt = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (acc[j * W + i] >= thr) { cb((cy0 + j) * n + cx0 + i); cnt++; }
    return cnt;
  }
  /** Walk a polyline, calling cb for every cell within `rad` metres, keeping the line 4-connected. */
  function stroke(pts: number[], rad: number, cb: (c: number) => void): void {
    let pcx = -9, pcy = -9;
    const R = Math.ceil(rad / cs);
    const hit = (px: number, py: number) => {
      const cx = Math.floor((px + half) / cs), cy = Math.floor((py + half) / cs);
      if (pcx > -9 && cx !== pcx && cy !== pcy && inGrid(cx, pcy)) cb(pcy * n + cx);
      pcx = cx; pcy = cy;
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const X = cx + i, Y = cy + j;
        if (!inGrid(X, Y)) continue;
        if ((i === 0 && j === 0) || Math.hypot((X + 0.5) * cs - half - px, (Y + 0.5) * cs - half - py) <= rad) cb(Y * n + X);
      }
    };
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      const L = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.ceil(L / (cs * 0.35)));
      for (let q = i === 0 ? 0 : 1; q <= k; q++) hit(x0 + ((x1 - x0) * q) / k, y0 + ((y1 - y0) * q) / k);
    }
    if (pts.length === 2) hit(pts[0], pts[1]);
  }

  // 1. land cover / land use (use codes are kept as their own layer)
  const use = new Uint8Array(n * n);
  for (const p of a.landcover) { const v = COVER_SURF[p.cls]; if (v !== undefined && v !== SURF.FIELD) fill(p.rings, 1, 1, (c) => { surf[c] = v; }); else if (v === SURF.FIELD) fill(p.rings, 1, 1, (c) => { if (surf[c] !== SURF.URBAN) surf[c] = v; }); }
  for (const p of a.landuse) {
    const u = USE_RULES[p.cls];
    if (!u) continue;
    fill(p.rings, 1, 1, (c) => { use[c] = u.code; if (u.urban) surf[c] = SURF.URBAN; else if (p.cls === 'airport') surf[c] = SURF.RUNWAY; });
  }
  // 2. water
  for (const p of a.water) fill(p.rings, 1, 1, (c) => { surf[c] = SURF.DEEP; });
  const ww = (l: VLine) => l.brunnel !== 'tunnel' && l.brunnel !== 'bridge';
  for (const l of a.waterways) if (ww(l) && (l.cls === 'stream' || l.cls === 'ditch' || l.cls === 'drain')) stroke(l.pts, 0, (c) => { if (surf[c] !== SURF.DEEP) surf[c] = SURF.SHALLOW; });
  for (const l of a.waterways) if (ww(l) && (l.cls === 'river' || l.cls === 'canal')) stroke(l.pts, l.cls === 'river' ? 10 : 6, (c) => { surf[c] = SURF.DEEP; });
  // 3. buildings
  const buildings: NavBuilding[] = [];
  const cellsOf: number[][] = [[]];
  for (const p of a.buildings) {
    if (buildings.length >= 65000 || (p.minH ?? 0) >= 6) continue;
    const ring = p.rings[0];
    let ar = 0, cx = 0, cy = 0;
    for (let i = 0, m = ring.length / 2, j = m - 1; i < m; j = i++) { const f = ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1]; ar += f; cx += (ring[j * 2] + ring[i * 2]) * f; cy += (ring[j * 2 + 1] + ring[i * 2 + 1]) * f; }
    ar /= 2;
    if (Math.abs(ar) < 20) continue;
    cx = cx / (6 * ar); cy = cy / (6 * ar);
    const id = buildings.length + 1, mine: number[] = [];
    fill(p.rings, 3, 4, (c) => { if (surf[c] !== SURF.DEEP) { surf[c] = SURF.BUILDING; bld[c] = id; mine.push(c); } });
    if (!mine.length) { const c = Math.floor((cy + half) / cs) * n + Math.floor((cx + half) / cs); if (inGrid(Math.floor((cx + half) / cs), Math.floor((cy + half) / cs)) && surf[c] !== SURF.DEEP) { surf[c] = SURF.BUILDING; bld[c] = id; mine.push(c); } }
    const area = Math.abs(ar);
    buildings.push({ id, poly: simplify(ring, 1), h: Math.min(300, Math.max(3, p.h ?? 6)), minH: p.minH ?? 0, area: Math.round(area), cx: Math.round(cx * 10) / 10 || 0, cy: Math.round(cy * 10) / 10 || 0, enterable: false, kind: p.kind, cap: Math.max(1, Math.floor(area / GARRISON_M2)) });
    const ku = p.kind && USE_RULES[p.kind === 'townhall' || p.kind === 'police' || p.kind === 'fire_station' ? 'none' : p.kind];
    if (ku && ku.code) for (const c of mine) use[c] = ku.code;
    cellsOf.push(mine);
  }
  // 4. roads (low -> high class), tunnels, then bridges and piers on top
  const all = [...a.roads, ...a.aeroways].map((l) => ({ l, s: ROAD_SURF[l.cls] ?? -1 })).filter((r) => r.s >= 0 && r.l.pts.length >= 2);
  const rank = (s: number) => ROAD_RANK[s] ?? 0;
  all.sort((p, q) => rank(p.s) - rank(q.s));
  const vehRoad = (s: number) => s !== SURF.PATH && s !== SURF.RAIL && s !== SURF.STEPS;
  for (const { l, s } of all) {
    if (l.brunnel === 'bridge' || l.brunnel === 'tunnel') continue;
    const major = s !== SURF.PATH && s !== SURF.TRACK && s !== SURF.RAIL && s !== SURF.STEPS;
    stroke(l.pts, ROAD_RADIUS[l.cls] ?? 4, (c) => {
      const cur = surf[c];
      if (cur === SURF.DEEP || cur === SURF.BRIDGE || cur === SURF.FOOTBRIDGE || cur === SURF.TUNNEL || cur === SURF.PIER) return;
      if (cur === SURF.BUILDING) { if (!major) return; bld[c] = 0; }
      if (cur !== SURF.SHALLOW || vehRoad(s)) surf[c] = s;
    });
  }
  for (const { l, s } of all) if (l.brunnel === 'tunnel' && VEHICLE_ROADS.has(l.cls) && s !== SURF.TRACK) stroke(l.pts, ROAD_RADIUS[l.cls] ?? 4, (c) => { if (surf[c] !== SURF.DEEP && surf[c] !== SURF.BUILDING) surf[c] = SURF.TUNNEL; });
  for (const { l } of all) if (l.brunnel === 'bridge') { const foot = !VEHICLE_ROADS.has(l.cls); stroke(l.pts, Math.max(ROAD_RADIUS[l.cls] ?? 4, 7), (c) => { surf[c] = foot ? SURF.FOOTBRIDGE : SURF.BRIDGE; bld[c] = 0; }); }
  for (const p of a.landuse) if (p.cls === 'port') fill(p.rings, 1, 1, (c) => { surf[c] = SURF.PIER; use[c] = USE_RULES.port.code; });
  // enterable buildings: enough footprint and still on the raster after the roads
  const cnt = new Uint16Array(buildings.length + 1);
  for (let c = 0; c < bld.length; c++) if (bld[c]) cnt[bld[c]]++;
  for (const b of buildings) b.enterable = cnt[b.id] > 0 && b.area >= 80 && b.area <= 9000 && b.h <= 80;

  const infra: NavInfra[] = [], pois: NavPoi[] = [];
  for (const q of a.infra) {
    const h = INFRA_HP[q.kind];
    if (h) { if (Math.abs(q.x) <= half && Math.abs(q.y) <= half) infra.push({ id: infra.length + 1, kind: q.kind, x: Math.round(q.x), y: Math.round(q.y), hp: h.hp }); }
    else if (q.kind === 'station' || q.kind === 'helipad') pois.push({ x: Math.round(q.x), y: Math.round(q.y), kind: q.kind });
  }
  for (const q of a.pois) if (Math.abs(q.x) <= half && Math.abs(q.y) <= half) pois.push({ x: Math.round(q.x), y: Math.round(q.y), kind: q.kind });
  for (const b of buildings) if (b.kind && ['hospital', 'police', 'townhall', 'fire_station', 'station', 'hangar'].includes(b.kind) && b.area >= 150) pois.push({ x: Math.round(b.cx), y: Math.round(b.cy), kind: b.kind });
  const peaks = a.peaks.filter((q) => Math.abs(q.x) <= half && Math.abs(q.y) <= half).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y), ele: q.ele }));
  const nav: NavData = { v: 1, sizeM, n, center: [a.lon, a.lat], surf: encodeRle(surf), bld: encodeRle(bld), use: encodeRle(use), buildings, infra, pois, peaks, attribution: ATTRIBUTION };
  if (o.heights && o.hn) { nav.hn = o.hn; nav.hgt = encodeRle(Int16Array.from(o.heights, (h) => Math.round(h * 10)), true); }
  return nav;
}
export type { VPoly };
