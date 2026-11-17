/** Real roads: asphalt raster draped on the terrain (real metre widths per class) + elevated bridge decks with piers. */
import type { VectorArea, VLine } from '../../data/vector/types';
import { pickStyle, roadWidth, type RoadProfile, type Styles } from './styles';
import type { TileRef } from './geo';
import type { Ground } from './ground';
import { Mesh, PAT } from './mesh';

const ORDER = ['path', 'steps', 'track', 'service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'taxiway', 'runway', 'rail'];
const profile = (st: Styles, cls: string): RoadProfile => st.roads.classes[cls] ?? st.roads.default;
export const widthOf = (st: Styles, cls: string): number => roadWidth(profile(st, cls));

export interface RoadStats { segments: number; bridges: number }

/** Vector raster of the tile: water tint + road profiles (real metre widths), north up. Bridges/tunnels are skipped (bridges are meshes). */
export function drawRoads(area: VectorArea, tile: TileRef, px: number, st: Styles): { canvas: HTMLCanvasElement; stats: RoadStats } {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const k = px / tile.sizeM, half = tile.sizeM / 2;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const stats: RoadStats = { segments: 0, bridges: 0 };
  const path = (pts: number[], close = false) => {
    g.beginPath();
    for (let i = 0; i < pts.length / 2; i++) { const X = (pts[i * 2] + half) * k, Y = (half - pts[i * 2 + 1]) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    if (close) g.closePath();
  };
  for (const p of area.water) {
    const a = st.water.areas[p.cls] ?? st.water.areas.deep;
    if (!a) continue;
    g.fillStyle = a.color; g.beginPath();
    for (const r of p.rings) for (let i = 0; i < r.length / 2; i++) { const X = (r[i * 2] + half) * k, Y = (half - r[i * 2 + 1]) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.fill('evenodd');
  }
  for (const l of area.waterways) {
    const w = st.water.waterways[l.cls];
    if (!w || l.brunnel === 'tunnel' || l.pts.length < 4) continue;
    g.strokeStyle = w.color; g.lineWidth = w.width * k; path(l.pts); g.stroke();
  }
  const vis = area.roads.filter((l) => l.brunnel !== 'bridge' && l.brunnel !== 'tunnel' && l.pts.length >= 4);
  for (const cls of ORDER) {
    const group = vis.filter((l) => l.cls === cls);
    if (!group.length) continue;
    const P = profile(st, cls), w = roadWidth(P);
    stats.segments += group.length;
    const strokeAll = (style: string, width: number, dash: number[] = []) => { g.strokeStyle = style; g.lineWidth = Math.max(width * k, 0.8); g.setLineDash(dash.map((d) => d * k)); for (const l of group) { path(l.pts); g.stroke(); } g.setLineDash([]); };
    if (P.sidewalk) strokeAll(P.sidewalk.color, w + P.sidewalk.width * 2);
    if (P.casing && !P.unpaved) strokeAll(P.casing, w + 1.1);
    strokeAll(P.fill, w);
    if (P.rails) strokeAll('rgba(190,190,190,0.7)', 0.4);
    if (P.marking === 'dashed') strokeAll('rgba(240,240,232,0.55)', 0.18, [3.2, 5.5]);
  }
  return { canvas: c, stats };
}

/** Elevated decks (girder + asphalt top + parapets) and piers; style by length/class; deck height follows the end-point ground heights. */
export function buildBridges(lines: VLine[], tile: TileRef, ground: Ground, stats: RoadStats, st: Styles): Mesh {
  const m = new Mesh(tile), half = tile.sizeM / 2;
  for (const l of lines) {
    if (l.brunnel !== 'bridge' || l.pts.length < 4) continue;
    const pts = l.pts, n = pts.length / 2;
    let len = 0; const cum = [0];
    for (let i = 1; i < n; i++) { len += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]); cum.push(len); }
    if (len < 6 || Math.abs(pts[0]) > half * 1.2 || Math.abs(pts[1]) > half * 1.2) continue;
    const S = pickStyle(st.bridges, { cls: l.cls, length: len }), DECK = S.deck, CONCRETE = S.concrete;
    const w = widthOf(st, l.cls) + S.margin * 2, g0 = ground(pts[0], pts[1]), g1 = ground(pts[n * 2 - 2], pts[n * 2 - 1]);
    const L: { x: number; y: number; z: number; nx: number; ny: number; d: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = pts[b * 2] - pts[a * 2], dy = pts[b * 2 + 1] - pts[a * 2 + 1];
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const t = len ? cum[i] / len : 0, x = pts[i * 2], y = pts[i * 2 + 1];
      L.push({ x, y, z: Math.max(g0 + (g1 - g0) * t, ground(x, y)) + 0.6, nx: -dy, ny: dx, d: cum[i] });
    }
    stats.bridges++;
    const T = S.girder, PA = S.parapet;
    const side = (i: number, s: number) => ({ x: L[i].x + L[i].nx * w * 0.5 * s, y: L[i].y + L[i].ny * w * 0.5 * s });
    for (let i = 0; i < n - 1; i++) {
      const j = i + 1, a0 = side(i, -1), a1 = side(i, 1), b0 = side(j, -1), b1 = side(j, 1), ua = L[i].d, ub = L[j].d;
      m.quad(m.vert(a0.x, a0.y, L[i].z, 0, 0, 1, ua, 0, DECK, PAT.BLANK), m.vert(a1.x, a1.y, L[i].z, 0, 0, 1, ua, w, DECK, PAT.BLANK), m.vert(b1.x, b1.y, L[j].z, 0, 0, 1, ub, w, DECK, PAT.BLANK), m.vert(b0.x, b0.y, L[j].z, 0, 0, 1, ub, 0, DECK, PAT.BLANK));
      for (const s of [-1, 1] as const) { // girders + parapets
        const p = s < 0 ? a0 : a1, q = s < 0 ? b0 : b1, nx = L[i].nx * s, ny = L[i].ny * s;
        const v0 = m.vert(p.x, p.y, L[i].z - T, nx, ny, 0, ua, 0, CONCRETE, PAT.BLANK), v1 = m.vert(q.x, q.y, L[j].z - T, nx, ny, 0, ub, 0, CONCRETE, PAT.BLANK);
        const v2 = m.vert(q.x, q.y, L[j].z + PA, nx, ny, 0, ub, T + PA, CONCRETE, PAT.BLANK), v3 = m.vert(p.x, p.y, L[i].z + PA, nx, ny, 0, ua, T + PA, CONCRETE, PAT.BLANK);
        if (s > 0) m.quad(v0, v1, v2, v3); else m.quad(v0, v3, v2, v1);
      }
      const q0 = m.vert(a0.x, a0.y, L[i].z - T, 0, 0, -1, ua, 0, CONCRETE, PAT.BLANK), q1 = m.vert(a1.x, a1.y, L[i].z - T, 0, 0, -1, ua, 0, CONCRETE, PAT.BLANK);
      const q2 = m.vert(b1.x, b1.y, L[j].z - T, 0, 0, -1, ub, 0, CONCRETE, PAT.BLANK), q3 = m.vert(b0.x, b0.y, L[j].z - T, 0, 0, -1, ub, 0, CONCRETE, PAT.BLANK);
      m.quad(q0, q3, q2, q1);
    }
    for (let d = S.pierSpacing * 0.6; d < len - 8; d += S.pierSpacing) { // piers where the deck is clearly above the ground
      let i = 1; while (i < n - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), x = pts[i * 2 - 2] + (pts[i * 2] - pts[i * 2 - 2]) * t, y = pts[i * 2 - 1] + (pts[i * 2 + 1] - pts[i * 2 - 1]) * t;
      const zd = L[i - 1].z + (L[i].z - L[i - 1].z) * t - T, gz = ground(x, y);
      if (zd - gz < 3) continue;
      m.frustum(x, y, gz - 1, zd, Math.max(0.7, w * S.pierWidth), Math.max(0.7, w * S.pierWidth), Math.atan2(L[i].ny, L[i].nx), CONCRETE, PAT.BLANK);
    }
  }
  return m;
}
