/** Real building footprints -> geometry generated on demand from the editable building styles (styles/buildings.json). */
import earcut from 'earcut';
import type { VPoly } from '../../data/vector/types';
import { MAJOR_AREA, MAJOR_HEIGHT } from './config';
import { hash, type TileRef } from './geo';
import type { Ground } from './ground';
import { Mesh, PAT } from './mesh';
import type { LocalMark } from './landmarks';
import { pickStyle, type BuildingStyle, type RGB, type Styles } from './styles';

const pick = <T,>(a: readonly T[], r: number): T => a[Math.min(a.length - 1, Math.floor(r * a.length))];
const shade = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const FACADE = { house: PAT.HOUSE, office: PAT.OFFICE, glass: PAT.GLASS, blank: PAT.BLANK } as const;
const DEF_FLOOR = { house: 3, office: 3.5, glass: 3.8, blank: 3 } as const, DEF_PITCH = { house: 3.2, office: 3, glass: 1.9, blank: 3 } as const;

const area2 = (r: number[]) => { let a = 0; for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1]; return a / 2; };
function ring(r: number[], ccw: boolean): number[] {
  let n = r.length / 2;
  if (n > 1 && r[0] === r[(n - 1) * 2] && r[1] === r[(n - 1) * 2 + 1]) n--;
  const out = r.slice(0, n * 2);
  if (area2(out) > 0 !== ccw) { for (let i = 0, j = n - 1; i < j; i++, j--) { [out[i * 2], out[j * 2]] = [out[j * 2], out[i * 2]]; [out[i * 2 + 1], out[j * 2 + 1]] = [out[j * 2 + 1], out[i * 2 + 1]]; } }
  return out;
}
const inRing = (r: number[], x: number, y: number) => {
  let c = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) { const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
};

export interface BuildingStats { count: number; major: number; tris: number; byStyle: Record<string, number> }
export interface BuildingMeshes { major: Mesh; minor: Mesh; stats: BuildingStats }
interface Band { z0: number; z1: number; v0: number; c: RGB; pat: number; sy: number; sx: number }

export function buildBuildings(polys: VPoly[], tile: TileRef, ground: Ground, st: Styles, marks: LocalMark[] = []): BuildingMeshes {
  const major = new Mesh(tile), minor = new Mesh(tile), half = tile.sizeM / 2, absLat = Math.abs(tile.lat0);
  const stats: BuildingStats = { count: 0, major: 0, tris: 0, byStyle: {} };
  for (const poly of polys) {
    const outer = ring(poly.rings[0], true), n = outer.length / 2;
    if (n < 3) continue;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += outer[i * 2]; cy += outer[i * 2 + 1]; }
    cx /= n; cy /= n;
    if (Math.abs(cx) > half || Math.abs(cy) > half) continue; // the tile owning the centre draws it
    let kindOver: string | undefined;
    for (const mk of marks) if (Math.hypot(cx - mk.x, cy - mk.y) <= mk.r) { if (mk.hasModel) kindOver = 'hidden'; else kindOver = kindOver ?? 'landmark'; }
    if (kindOver === 'hidden') continue; // replaced by the real landmark model
    const area = Math.abs(area2(outer));
    if (area < 8) continue;
    const h = Math.min(450, Math.max(2.8, poly.h ?? (area < 80 ? 4 : area < 400 ? 7 : 12)));
    let g0 = Infinity, g1 = -Infinity;
    const step = Math.max(1, Math.floor(n / 12));
    for (let i = 0; i < n; i += step) { const g = ground(outer[i * 2], outer[i * 2 + 1]); if (g < g0) g0 = g; if (g > g1) g1 = g; }
    const gc = ground(cx, cy);
    if (gc < g0) g0 = gc; if (gc > g1) g1 = gc;
    const S = pickStyle<BuildingStyle>(st.buildings, { kind: kindOver ?? poly.kind, height: h, area, absLat });
    stats.byStyle[S.id] = (stats.byStyle[S.id] ?? 0) + 1;
    const seed = (k: number) => hash(Math.round(cx * 4), Math.round(cy * 4), k); // same building -> same look, always
    const lifted = (poly.minH ?? 0) > 0.5;
    const zBase = lifted ? g0 + (poly.minH as number) : g0 - 1.2;
    const zRoof = Math.max(g0, (g0 + g1) / 2) + h;
    const tone = 1 - (S.variation ?? 0.06) + seed(2) * (S.variation ?? 0.06) * 2;
    const wall = shade(pick(S.palette, seed(1)), tone), roofCol = shade(pick(S.roofPalette, seed(3)), 0.92 + seed(4) * 0.16);
    const fp = S.facade.pattern, fh = S.facade.floorHeight ?? DEF_FLOOR[fp], wp = S.facade.windowPitch ?? DEF_PITCH[fp];
    const bands: Band[] = [];
    const gf = S.groundFloor && h > S.groundFloor.height + 3 && !lifted ? S.groundFloor : null;
    if (gf) {
      const gp = gf.pattern, gz = g0 + gf.height;
      bands.push({ z0: zBase, z1: gz, v0: g0, c: shade(pick(gf.palette, seed(5)), tone), pat: FACADE[gp], sy: DEF_FLOOR[gp] / gf.height, sx: DEF_PITCH[gp] / wp });
      bands.push({ z0: gz, z1: zRoof, v0: gz, c: wall, pat: FACADE[fp], sy: DEF_FLOOR[fp] / fh, sx: DEF_PITCH[fp] / wp });
    } else bands.push({ z0: zBase, z1: zRoof, v0: g0, c: wall, pat: FACADE[fp], sy: DEF_FLOOR[fp] / fh, sx: DEF_PITCH[fp] / wp });
    const m = area >= MAJOR_AREA || h >= MAJOR_HEIGHT ? major : minor;
    const t0 = m.tris, holes = poly.rings.slice(1).map((r) => ring(r, false)).filter((r) => r.length >= 6);
    let shape = S.roof.shape;
    if (shape === 'gable' && !(n === 4 && !holes.length && !lifted)) shape = 'flat';
    if (shape === 'dome' && (area > (S.roof.maxArea ?? 1200) || holes.length || n < 5)) shape = 'flat';
    if (shape === 'setback' && (holes.length || area < 300 || n > 40)) shape = 'flat';
    const rise = shape === 'gable' ? gableRise(outer) : 0;
    const zTop = zRoof;
    let roofRing = outer;
    if (shape === 'setback') {
      const at = S.roof.at ?? 0.88, zs = zBase + (zRoof - zBase) * at, k = 1 - (S.roof.inset ?? 0.16);
      bands.forEach((b) => { if (b.z1 === zRoof) b.z1 = zs; });
      walls(m, outer, bands, 0);
      flatRoof(m, [outer], zs, roofCol);
      roofRing = outer.map((v, i) => (i % 2 ? cy + (v - cy) * k : cx + (v - cx) * k));
      walls(m, roofRing, [{ z0: zs, z1: zRoof, v0: zs, c: wall, pat: FACADE[fp], sy: DEF_FLOOR[fp] / fh, sx: DEF_PITCH[fp] / wp }], 0);
      flatRoof(m, [roofRing], zRoof, roofCol);
    } else {
      walls(m, outer, bands, rise);
      for (const hr of holes) walls(m, hr, bands, 0);
      if (shape === 'gable') gableRoof(m, outer, zRoof, roofCol, rise);
      else if (shape === 'dome') domeRoof(m, outer, cx, cy, zRoof, roofCol);
      else flatRoof(m, [outer, ...holes], zRoof, roofCol);
    }
    if (S.rooftop && (shape === 'flat' || shape === 'setback') && inRing(roofRing, cx, cy)) {
      const s = 1.2 + seed(6) * 1.2;
      m.frustum(cx, cy, zTop, zTop + 1.4 + seed(7) * 1.2, s, s, seed(8) * 3, shade([150, 152, 154], 0.9 + seed(9) * 0.2), PAT.BLANK);
    }
    stats.count++; if (m === major) stats.major++;
    stats.tris += m.tris - t0;
  }
  return { major, minor, stats };
}

function walls(m: Mesh, r: number[], bands: Band[], rise: number) {
  const n = r.length / 2;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = r[i * 2], ay = r[i * 2 + 1], bx = r[j * 2], by = r[j * 2 + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    const nx = dy / len, ny = -dx / len;
    for (const b of bands) {
      const v0 = (b.z0 - b.v0) * b.sy, v1 = (b.z1 - b.v0) * b.sy, u0 = u * b.sx, u1 = (u + len) * b.sx;
      const a0 = m.vert(ax, ay, b.z0, nx, ny, 0, u0, v0, b.c, b.pat), b0 = m.vert(bx, by, b.z0, nx, ny, 0, u1, v0, b.c, b.pat);
      const b1 = m.vert(bx, by, b.z1, nx, ny, 0, u1, v1, b.c, b.pat), a1 = m.vert(ax, ay, b.z1, nx, ny, 0, u0, v1, b.c, b.pat);
      m.tri(a0, b0, b1); m.tri(a0, b1, a1);
    }
    if (rise > 0 && len <= Math.hypot(r[((i + 2) % n) * 2] - bx, r[((i + 2) % n) * 2 + 1] - by)) { // gable end triangle
      const b = bands[bands.length - 1], zt = b.z1, mx = (ax + bx) / 2, my = (ay + by) / 2, v1 = (zt - b.v0) * b.sy;
      const mid = m.vert(mx, my, zt + rise, nx, ny, 0, (u + len / 2) * b.sx, v1 + rise * b.sy, b.c, b.pat);
      m.tri(m.vert(ax, ay, zt, nx, ny, 0, u * b.sx, v1, b.c, b.pat), m.vert(bx, by, zt, nx, ny, 0, (u + len) * b.sx, v1, b.c, b.pat), mid);
    }
    u += len;
  }
}
const edgeLen = (r: number[], i: number) => Math.hypot(r[((i + 1) % 4) * 2] - r[i * 2], r[((i + 1) % 4) * 2 + 1] - r[i * 2 + 1]);
const gableRise = (r: number[]) => Math.min(3.6, Math.min(edgeLen(r, 0), edgeLen(r, 1)) * 0.28);
function gableRoof(m: Mesh, r: number[], z: number, c: RGB, rise: number) {
  const s = edgeLen(r, 0) >= edgeLen(r, 1) ? 1 : 0, P = (i: number) => [r[(i % 4) * 2], r[(i % 4) * 2 + 1]];
  const a = P(s), b = P(s + 1), cc = P(s + 2), d = P(s + 3);
  const ra = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rb = [(cc[0] + d[0]) / 2, (cc[1] + d[1]) / 2];
  m.facet([[b[0], b[1], z], [cc[0], cc[1], z], [rb[0], rb[1], z + rise], [ra[0], ra[1], z + rise]], c);
  m.facet([[d[0], d[1], z], [a[0], a[1], z], [ra[0], ra[1], z + rise], [rb[0], rb[1], z + rise]], c);
}
/** Dome / hip-like cap: 3 shrinking copies of the footprint rising to an apex over the centroid. */
function domeRoof(m: Mesh, r: number[], cx: number, cy: number, z: number, c: RGB) {
  const n = r.length / 2;
  let R = 0; for (let i = 0; i < n; i++) R += Math.hypot(r[i * 2] - cx, r[i * 2 + 1] - cy);
  R /= n;
  const lv = [[1, 0], [0.82, 0.34], [0.5, 0.68], [0, 0.82]].map(([k, h]) => [k, h * R * 0.9]);
  for (let l = 0; l < lv.length - 1; l++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, [k0, h0] = lv[l], [k1, h1] = lv[l + 1];
    const p = (q: number, k: number, h: number) => [cx + (r[q * 2] - cx) * k, cy + (r[q * 2 + 1] - cy) * k, z + h];
    if (k1 === 0) m.facet([p(i, k0, h0), p(j, k0, h0), p(i, 0, h1)], c); else m.facet([p(i, k0, h0), p(j, k0, h0), p(j, k1, h1), p(i, k1, h1)], c);
  }
}
function flatRoof(m: Mesh, rings: number[][], z: number, c: RGB) {
  const flat: number[] = [], holes: number[] = [];
  for (let k = 0; k < rings.length; k++) { if (k) holes.push(flat.length / 2); flat.push(...rings[k]); }
  const tri = earcut(flat, holes.length ? holes : null, 2), base = m.verts;
  for (let i = 0; i < flat.length / 2; i++) m.vert(flat[i * 2], flat[i * 2 + 1], z, 0, 0, 1, flat[i * 2], flat[i * 2 + 1], c, PAT.ROOF);
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i + 1], d = tri[i + 2];
    const cr = (flat[b * 2] - flat[a * 2]) * (flat[d * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[d * 2] - flat[a * 2]);
    if (cr > 0) m.tri(base + a, base + b, base + d); else m.tri(base + a, base + d, base + b);
  }
}
