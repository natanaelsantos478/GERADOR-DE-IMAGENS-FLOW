/** Deterministic tree placement inside real wood / scrub / park polygons and instanced glb trees (one draw call per species and distance set). */
import * as Cesium from 'cesium';
import type { VectorArea, VPoly } from '../../data/vector/types';
import { widthOf } from './roads';
import { pickStyle, type Styles, type TreeRule } from './styles';
import { hash, projector, type TileRef } from './geo';
import type { Ground } from './ground';
import { instanceGlb } from './glbInstancing';
import type { VegMask } from './vegetation';

export interface TreePoint { x: number; y: number; z: number; yaw: number; s: number; /** crown widening (sparse placement of big forests: wider crowns keep the canopy closed) */ sw: number; sp: string; far: boolean }

function inRing(r: number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Even-odd over all rings: the same rule the 2D canvas uses to paint the polygon (multi-part water areas). */
export const inPolyEvenOdd = (p: VPoly, x: number, y: number) => p.rings.reduce((c, r) => (inRing(r, x, y) ? !c : c), false);
export const inPoly = (p: VPoly, x: number, y: number) => {
  if (!inRing(p.rings[0], x, y)) return false;
  for (let k = 1; k < p.rings.length; k++) if (inRing(p.rings[k], x, y)) return false;
  return true;
};

/**
 * Height of a tree base: the same ground surface the buildings stand on (the finest terrain level), sunk a little like a
 * foundation so the trunk never shows a gap on a slope: 0.4 m plus the drop of the ground within 2 m of the trunk.
 */
export function seat(ground: Ground, x: number, y: number): number {
  const z = ground(x, y);
  let drop = 0;
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) drop = Math.max(drop, z - ground(x + dx, y + dy));
  return z - 0.4 - drop;
}

/** Why candidate points of the last placement were kept or dropped (debug: `__city3d.treeDebug`). */
export interface TreeDiag { candidates: number; blocked: number; water: number; lowGreen: number; sparse: number; forest: number; park: number; notInMap: number; kept: number; k: number }
export const lastDiag = new WeakMap<TreePoint[], TreeDiag>();

/** Scanline raster of the green polygons on the placement grid: 0 none, 1 wood/scrub, 2 park (cell centres). */
function rasterPolys(polys: VPoly[], half: number, CELL: number, N: number): Uint8Array {
  const g = new Uint8Array(N * N), xs: number[] = [];
  for (const p of polys) {
    const code = p.cls === 'park' ? 2 : 1;
    let y0 = Infinity, y1 = -Infinity;
    for (const r of p.rings) for (let i = 1; i < r.length; i += 2) { y0 = Math.min(y0, r[i]); y1 = Math.max(y1, r[i]); }
    for (let j = Math.max(0, Math.floor((y0 + half) / CELL)); j <= Math.min(N - 1, Math.ceil((y1 + half) / CELL)); j++) {
      const y = -half + (j + 0.5) * CELL;
      xs.length = 0;
      for (const r of p.rings) for (let a = 0, n = r.length / 2, b = n - 1; a < n; b = a++) {
        const ya = r[a * 2 + 1], yb = r[b * 2 + 1];
        if (ya > y !== yb > y) xs.push(r[a * 2] + ((y - ya) * (r[b * 2] - r[a * 2])) / (yb - ya));
      }
      xs.sort((u, v) => u - v);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        for (let i = Math.max(0, Math.ceil((xs[q] + half) / CELL - 0.5)); i <= Math.min(N - 1, Math.floor((xs[q + 1] + half) / CELL - 0.5)); i++) if (!g[j * N + i] || code === 1) g[j * N + i] = code;
      }
    }
  }
  return g;
}

/**
 * Placement when the satellite photo is available, the same rule everywhere: every grid point takes the mean green of
 * the photo in a small area around it (~60 m) and compares it with the vector map (wood / park polygons):
 * - the vector map must mark vegetation (wood / scrub / park) AND the photo must be green around the point;
 * - density follows the photo green (a dense canopy keeps every grid point);
 * - little green (< 0.35): no tree, even inside a map polygon (land-cover rasters mark whole housing blocks as wood).
 * Buildings and roads always block. Density follows the green share; the per-tile budget widens the spacing.
 */
function placeByPhoto(area: VectorArea, tile: TileRef, ground: Ground, budget: number, st: Styles, veg: VegMask, polys: VPoly[], blocked: Uint8Array, CELL: number, N: number): TreePoint[] {
  const half = tile.sizeM / 2, absLat = Math.abs(tile.lat0), map = rasterPolys(polys, half, CELL, N);
  // the vector map's water (sea, bays, lakes, wide rivers) vetoes the photo: murky green water reads as vegetation
  const water = rasterPolys(area.water, half, CELL, N);
  const rules = new Map<string, TreeRule>();
  const rule = (cover: string, z: number) => { const key = `${cover}|${Math.round(z / 100)}`; let r = rules.get(key); if (!r) { r = pickStyle<TreeRule>(st.trees, { cover, absLat, elev: z }); rules.set(key, r); } return r; };
  const forest = rule('wood', ground(0, 0));
  const want = veg.cover * tile.sizeM * tile.sizeM * forest.density;
  const k = want > budget ? Math.sqrt(want / budget) : 1, step = Math.sqrt(1 / forest.density) * k;
  const d: TreeDiag = { candidates: 0, blocked: 0, water: 0, lowGreen: 0, sparse: 0, forest: 0, park: 0, notInMap: 0, kept: 0, k: Math.round(k * 100) / 100 };
  const out: TreePoint[] = [];
  for (let y = -half + step / 2; y < half; y += step) for (let x = -half + step / 2; x < half; x += step) {
    const jx = x + (hash(Math.round(x * 3), Math.round(y * 3), 31) - 0.5) * step * 0.8, jy = y + (hash(Math.round(x * 3), Math.round(y * 3), 32) - 0.5) * step * 0.8;
    if (Math.abs(jx) >= half || Math.abs(jy) >= half) continue;
    d.candidates++;
    const c = Math.floor((jy + half) / CELL) * N + Math.floor((jx + half) / CELL);
    if (blocked[c]) { d.blocked++; continue; }
    // map says water, or the ground is at sea level (the terrain flattens the sea to 0 m)
    // raster cells hold the polygon test of their centre: on a boundary cell, test the exact tree point
    const edge = (g: Uint8Array) => { const i = c % N, j = (c / N) | 0; for (let b = Math.max(0, j - 1); b <= Math.min(N - 1, j + 1); b++) for (let a2 = Math.max(0, i - 1); a2 <= Math.min(N - 1, i + 1); a2++) if (g[b * N + a2] !== g[c]) return true; return false; };
    const inWater = edge(water) ? area.water.some((w) => inPolyEvenOdd(w, jx, jy)) : !!water[c];
    if (inWater || ground(jx, jy) <= 0.3) { d.water++; continue; }
    // green share in a small (~12 m) square around the point: one tree crown, not the neighbourhood
    const a = veg.around(jx, jy, 6), here = veg.at(jx, jy), m = map[c];
    if (a < 0.35 || here < 0.2) { d.lowGreen++; continue; }
    // both maps must agree: the vector map says vegetation here (wood / scrub / park) AND the photo is green. Photo-only
    // green (airport grass, lawns, riverbanks, backyards) gets no tree; map-only vegetation without green gets none either.
    const inMap = edge(map) ? polys.some((q) => inPolyEvenOdd(q, jx, jy)) : !!m;
    if (!inMap) { d.notInMap++; continue; }
    const rnd = hash(Math.round(jx * 5), Math.round(jy * 5), 33);
    // density follows the photo: dense canopy keeps every point, a half-green area about half of them
    if (rnd > Math.min(1, (a - 0.25) / 0.5)) { d.sparse++; continue; }
    const r = rule(m === 2 ? 'park' : 'wood', ground(jx, jy));
    m === 2 ? d.park++ : d.forest++;
    const z = seat(ground, jx, jy), tw = r.mix.reduce((s, q) => s + q.weight, 0);
    let w = hash(Math.round(jx * 2), Math.round(jy * 2), 13) * tw, sp = r.mix[0].species;
    for (const q of r.mix) { if (w < q.weight) { sp = q.species; break; } w -= q.weight; }
    const [lo, hi] = r.height, hm = (lo + (hi - lo) * hash(Math.round(jx * 2), Math.round(jy * 2), 14)) * (k > 1 ? Math.min(1.15, 1 + (k - 1) * 0.05) : 1);
    out.push({ x: jx, y: jy, z, yaw: hash(Math.round(jx), Math.round(jy), 15) * Math.PI * 2, s: hm / st.species[sp].nativeHeight, sw: Math.min(1.5, (k > 1 ? Math.min(1.6, 1 + (k - 1) * 0.3) : 1) * (r.crown ?? 1)), sp, far: hash(Math.round(jx), Math.round(jy), 16) < 0.5 });
  }
  d.kept = out.length;
  lastDiag.set(out, d);
  return out;
}

/**
 * Trees for a tile: at most `budget`, spacing widened automatically for big forests. With the satellite photo the
 * placement is `placeByPhoto` (photo green x vector map); without it, only the wood / scrub / park polygons.
 */
export function placeTrees(area: VectorArea, tile: TileRef, ground: Ground, budget: number, st: Styles, veg: VegMask | null = null): TreePoint[] {
  const half = tile.sizeM / 2, CELL = 4, N = Math.ceil(tile.sizeM / CELL);
  const blocked = new Uint8Array(N * N);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let j = Math.max(0, Math.floor((y0 + half) / CELL)); j <= Math.min(N - 1, Math.floor((y1 + half) / CELL)); j++) for (let i = Math.max(0, Math.floor((x0 + half) / CELL)); i <= Math.min(N - 1, Math.floor((x1 + half) / CELL)); i++) blocked[j * N + i] = 1;
  };
  for (const b of area.buildings) {
    const r = b.rings[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    mark(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  }
  for (const l of area.roads) {
    const w = widthOf(st, l.cls) * 0.5 + 1.5;
    if (l.cls === 'path' || l.cls === 'steps') continue;
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const dx = l.pts[i + 2] - l.pts[i], dy = l.pts[i + 3] - l.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
      for (let s = 0; s <= n; s++) { const x = l.pts[i] + (dx * s) / n, y = l.pts[i + 1] + (dy * s) / n; mark(x - w, y - w, x + w, y + w); }
    }
  }
  // airports and ports never get trees (their grass reads green on the photo and land-cover rasters may call it scrub):
  // the whole airport / port area plus runways (~60 m wide) and taxiways (~25 m) are blocked
  const noTree = rasterPolys(area.landuse.filter((p) => p.cls === 'airport' || p.cls === 'port' || p.cls === 'transport'), half, CELL, N);
  for (let i = 0; i < noTree.length; i++) if (noTree[i]) blocked[i] = 1;
  for (const l of area.aeroways) {
    const w = l.cls === 'runway' ? 32 : l.cls === 'taxiway' ? 14 : 8;
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const dx = l.pts[i + 2] - l.pts[i], dy = l.pts[i + 3] - l.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
      for (let s = 0; s <= n; s++) { const x = l.pts[i] + (dx * s) / n, y = l.pts[i + 1] + (dy * s) / n; mark(x - w, y - w, x + w, y + w); }
    }
  }
  const polys = [...area.landcover.filter((p) => p.cls === 'wood' || p.cls === 'scrub'), ...area.landuse.filter((p) => p.cls === 'park')];
  if (veg) return placeByPhoto(area, tile, ground, budget, st, veg, polys, blocked, CELL, N);
  const bbox = polys.map((p) => { const r = p.rings[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return [Math.max(x0, -half), Math.max(y0, -half), Math.min(x1, half), Math.min(y1, half)]; });
  const absLat = Math.abs(tile.lat0);
  const ruleOf = polys.map((p, i) => { const b = bbox[i], z = ground((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); return pickStyle<TreeRule>(st.trees, { cover: p.cls, absLat, elev: z }); });
  const dens = (p: VPoly) => ruleOf[polys.indexOf(p)].density; // trees per m²
  let want = 0;
  polys.forEach((p, i) => { const b = bbox[i]; if (b[2] > b[0] && b[3] > b[1]) want += (b[2] - b[0]) * (b[3] - b[1]) * 0.55 * dens(p); }); // upper bound: bbox x fill ratio
  const k = want > budget ? Math.sqrt(want / budget) : 1;
  const out: TreePoint[] = [], cap = budget * 4;
  // no photo: the map's water and sea-level ground still veto (land-cover polygons may spill over bays and shores)
  const water = rasterPolys(area.water, half, CELL, N);
  const push = (jx: number, jy: number, rule: TreeRule) => {
    const z = seat(ground, jx, jy), tw = rule.mix.reduce((a, q) => a + q.weight, 0);
    let r = hash(Math.round(jx * 2), Math.round(jy * 2), 13) * tw, sp = rule.mix[0].species;
    for (const q of rule.mix) { if (r < q.weight) { sp = q.species; break; } r -= q.weight; }
    const [lo, hi] = rule.height, hm = (lo + (hi - lo) * hash(Math.round(jx * 2), Math.round(jy * 2), 14)) * (k > 1 ? Math.min(1.15, 1 + (k - 1) * 0.05) : 1);
    out.push({ x: jx, y: jy, z, yaw: hash(Math.round(jx), Math.round(jy), 15) * Math.PI * 2, s: hm / st.species[sp].nativeHeight, sw: Math.min(1.5, (k > 1 ? Math.min(1.6, 1 + (k - 1) * 0.3) : 1) * (rule.crown ?? 1)), sp, far: hash(Math.round(jx), Math.round(jy), 16) < 0.5 });
  };
  polys.forEach((p, i) => {
    const b = bbox[i];
    if (b[2] <= b[0] || b[3] <= b[1]) return;
    const step = Math.sqrt(1 / dens(p)) * k, ps = hash(i, 7, 3) * step;
    for (let y = b[1] + ps; y < b[3] && out.length < cap; y += step) for (let x = b[0] + ps; x < b[2]; x += step) {
      const jx = x + (hash(Math.round(x * 3), Math.round(y * 3), 11) - 0.5) * step * 0.8, jy = y + (hash(Math.round(x * 3), Math.round(y * 3), 12) - 0.5) * step * 0.8;
      if (Math.abs(jx) >= half || Math.abs(jy) >= half) continue;
      const c = Math.floor((jy + half) / CELL) * N + Math.floor((jx + half) / CELL);
      if (blocked[c] || water[c] || !inPoly(p, jx, jy) || ground(jx, jy) <= 0.3) continue;
      push(jx, jy, ruleOf[i]);
      if (out.length >= cap) break;
    }
  });
  // too many candidates (the bbox estimate is an upper bound): thin them uniformly over the whole tile instead of letting the first polygons eat the budget
  if (out.length > budget) {
    const r = budget / out.length;
    const kept = out.filter((p) => hash(Math.round(p.x * 3), Math.round(p.y * 3), 21) < r);
    for (const p of kept) p.sw = Math.max(p.sw, Math.min(1.6, 1 + (1 / Math.sqrt(r) - 1) * 0.3));
    return kept;
  }
  return out;
}

/**
 * Detail levels of the tree models: 0 = original (3-6k triangles), 1 = mid distance (tools/models/tree-lod.mjs: bark
 * simplified, ~1/3 of the leaf cards enlarged, 256 px textures, ~1k), 3 = far: billboard impostor (tools/models/
 * tree-impostor.mjs: the tree rendered once on two crossed quads, 4 triangles).
 */
export type TreeLod = 0 | 1 | 3;
const glbCache = new Map<string, Promise<{ bytes: ArrayBuffer; tris: number }>>();
const glbPath = (file: string, lod: TreeLod) => (lod ? `models/nature/lod/${file}_${lod}.glb` : `models/nature/${file}.glb`);
/** Triangles of one copy of a glb (sum of its indexed primitives), read from the JSON chunk. */
function glbTris(buf: ArrayBuffer): number {
  const dv = new DataView(buf), len = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  let t = 0;
  for (const m of json.meshes ?? []) for (const p of m.primitives ?? []) t += (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3;
  return t;
}
const glb = (file: string, lod: TreeLod) => {
  const key = glbPath(file, lod);
  let p = glbCache.get(key);
  if (!p) {
    p = fetch(new URL(key, document.baseURI)).then(async (r) => { if (!r.ok) throw new Error(`${key} ${r.status}`); const bytes = await r.arrayBuffer(); return { bytes, tris: glbTris(bytes) }; });
    glbCache.set(key, p); p.catch(() => glbCache.delete(key));
  }
  return p;
};

interface TreeModel { sp: string; model: Cesium.Model; url: string; n: number; tris: number }
/** One instanced Model per species for a set of trees at one detail level. */
async function buildModels(scene: Cesium.Scene, tile: TileRef, pts: TreePoint[], st: Styles, lod: TreeLod): Promise<TreeModel[]> {
  const proj = projector(tile);
  const groups = new Map<string, TreePoint[]>();
  for (const p of pts) (groups.get(p.sp) ?? groups.set(p.sp, []).get(p.sp)!).push(p);
  return Promise.all([...groups].map(async ([sp, list]) => {
    const T = new Float32Array(list.length * 3), Rq = new Float32Array(list.length * 4), S = new Float32Array(list.length * 3), v = new Cesium.Cartesian3();
    list.forEach((p, i) => {
      proj.local(p.x, p.y, p.z - 0.15, v); // ENU (e,n,u) -> glTF Y-up (e,u,-n)
      T.set([v.x, v.z, -v.y], i * 3);
      Rq.set([0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)], i * 4);
      S.set([p.s * p.sw, p.s, p.s * p.sw], i * 3);
    });
    const src = await glb(st.species[sp].file, lod);
    const bytes = instanceGlb(src.bytes, T, Rq, S);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }));
    const model = await Cesium.Model.fromGltfAsync({ url, modelMatrix: tile.enu, show: false, allowPicking: false, shadows: Cesium.ShadowMode.DISABLED, incrementallyLoadTextures: false });
    if (lod === 3) {
      // unlit impostors carry the studio light of their render: multiply them down to the satellite canopy tone
      model.color = Cesium.Color.fromCssColorString('#7d9a6a'); model.colorBlendMode = Cesium.ColorBlendMode.HIGHLIGHT;
    } else {
      // the leaf textures are dark: lift them toward a fresh green so a forest reads against the dark satellite canopy
      model.color = Cesium.Color.fromCssColorString('#a6d96a'); model.colorBlendMode = Cesium.ColorBlendMode.MIX; model.colorBlendAmount = 0.28;
    }
    scene.primitives.add(model);
    return { sp, model, url, n: list.length, tris: src.tris * list.length };
  }));
}
function disposeModels(scene: Cesium.Scene, ms: TreeModel[]) { for (const m of ms) { scene.primitives.remove(m.model); URL.revokeObjectURL(m.url); } }

/** Distance thresholds (m, camera to the nearest edge of a cell). */
export interface TreeLodDist { near: number; mid: number; far: number }
let forcedLod: TreeLod | null = null;
/** Test/debug: draw every visible tree at one detail level (null = by distance), e.g. to compare with the full models. */
export const forceTreeLod = (l: TreeLod | null) => { forcedLod = l; };
/** Cells per tile side: the level is chosen per cell (a z14 tile is ~2.4 km across, too coarse for a ~300 m full-detail ring). */
const GRID = 3;
interface Cell { cx: number; cy: number; z: number; r: number; pts: TreePoint[]; key: number; models: TreeModel[]; busy: boolean }

/**
 * The trees of one tile, split in GRID x GRID cells; each cell shows one detail level by camera distance
 * (beyond 55 % of the tree distance only the `far` half of the instances, as before).
 */
export class TreeLayer {
  private cells: Cell[] = [];
  private gen = 0;
  private dead = false;
  private hidden = false;
  constructor(private scene: Cesium.Scene, private tile: TileRef, private pts: TreePoint[], private st: Styles) { this.split(); }
  private split() {
    const half = this.tile.sizeM / 2, w = this.tile.sizeM / GRID;
    const cells: Cell[] = [];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) cells.push({ cx: -half + (i + 0.5) * w, cy: -half + (j + 0.5) * w, z: 0, r: w * 0.71, pts: [], key: -1, models: [], busy: false });
    for (const p of this.pts) cells[Math.min(GRID - 1, Math.max(0, Math.floor((p.y + half) / w))) * GRID + Math.min(GRID - 1, Math.max(0, Math.floor((p.x + half) / w)))].pts.push(p);
    for (const c of cells) c.z = c.pts.length ? c.pts.reduce((a, p) => a + p.z, 0) / c.pts.length : 0;
    this.cells = cells.filter((c) => c.pts.length);
  }
  /**
   * Impostor ring: the cells at level 3 are drawn together, one model per species for the whole tile (a per-cell
   * split there only multiplied draw calls: 4-triangle instances are not worth culling finely).
   */
  private imp: TreeModel[] = [];
  private impSig = '';
  private impBusy = false;
  /** Previous model sets waiting for their replacement to become drawable; disposed by `retire` or on dispose/reseat. */
  private pending = new Set<TreeModel[]>();

  /** Pick the level of every cell for this camera; rebuilds the cells whose level changed (old models stay until the new ones are ready). */
  update(cam: Cesium.Cartesian3, d: TreeLodDist, hide: boolean) {
    if (this.dead) return;
    const proj = projector(this.tile), c3 = new Cesium.Cartesian3();
    this.hidden = hide;
    const impCells: Cell[] = [];
    for (const c of this.cells) {
      const dist = Math.max(0, Cesium.Cartesian3.distance(cam, proj.ecef(c.cx, c.cy, c.z, c3)) - c.r);
      // key = detail level; -1 = no trees. 10 % hysteresis so a camera on a boundary does not rebuild every frame
      const lims = [d.near, d.mid, d.far], keys = [0, 1, 3, -1];
      let b = lims.findIndex((l) => dist < l); if (b < 0) b = 3;
      const cur = keys.indexOf(c.key);
      if (cur >= 0 && Math.abs(cur - b) === 1) { const lim = lims[Math.min(cur, b)]; if (Math.abs(dist - lim) < lim * 0.1) b = cur; }
      const want = forcedLod === null ? keys[b] : b === 3 ? -1 : forcedLod;
      if (want === 3) impCells.push(c);
      else if (want !== c.key && !c.busy) void this.rebuild(c, want);
      for (const m of c.models) m.model.show = !hide;
    }
    for (const m of this.imp) m.model.show = !hide;
    const sig = impCells.map((c) => this.cells.indexOf(c)).join(',');
    if (sig !== this.impSig && !this.impBusy) void this.rebuildImpostors(impCells, sig);
  }
  /** cell rebuilds / terrain re-seats since creation (debug: a camera at rest must not keep rebuilding) */
  rebuilds = 0; reseats = 0;
  /** Show `next`, then dispose `old` once every model of `next` is drawable (no blinking hole); 5 s cap if one never loads. */
  private retire(old: TreeModel[], next: TreeModel[]) {
    if (!old.length) return;
    this.pending.add(old);
    let left = next.length, done = false;
    const go = () => { if (done) return; done = true; this.pending.delete(old); disposeModels(this.scene, old); this.scene.requestRender(); };
    if (!left) { go(); return; }
    for (const m of next) m.model.readyEvent.addEventListener(() => { if (--left <= 0) go(); });
    setTimeout(go, 5000);
  }
  private async rebuild(c: Cell, key: number) {
    c.busy = true; this.rebuilds++;
    const gen = this.gen;
    try {
      const next = key < 0 ? [] : await buildModels(this.scene, this.tile, c.pts, this.st, key as TreeLod);
      if (this.dead || gen !== this.gen) { disposeModels(this.scene, next); return; }
      const old = c.models;
      c.models = next; c.key = key;
      for (const m of next) m.model.show = !this.hidden;
      this.retire(old, next);
    } catch (e) { console.warn('city3d tree cell', this.tile.key, e); } finally { c.busy = false; this.scene.requestRender(); }
  }
  private async rebuildImpostors(cells: Cell[], sig: string) {
    this.impBusy = true; this.rebuilds++;
    const gen = this.gen;
    try {
      const pts = cells.flatMap((c) => c.pts);
      const next = pts.length ? await buildModels(this.scene, this.tile, pts, this.st, 3) : [];
      if (this.dead || gen !== this.gen) { disposeModels(this.scene, next); return; }
      for (const m of next) m.model.show = !this.hidden;
      // cells now in the impostor ring drop their own (nearer-level) models once the ring is drawable
      const leaving: TreeModel[] = [];
      for (const c of cells) if (c.key !== 3) { leaving.push(...c.models); c.models = []; c.key = 3; }
      for (const c of this.cells) if (!cells.includes(c) && c.key === 3) c.key = -2; // left the ring: the next update rebuilds it
      this.retire([...this.imp, ...leaving], next);
      this.imp = next; this.impSig = sig;
    } catch (e) { console.warn('city3d tree impostors', this.tile.key, e); } finally { this.impBusy = false; this.scene.requestRender(); }
  }
  private disposeAll() {
    for (const c of this.cells) { disposeModels(this.scene, c.models); c.models = []; c.key = -1; c.busy = false; }
    disposeModels(this.scene, this.imp); this.imp = []; this.impSig = ''; this.impBusy = false;
    for (const p of this.pending) disposeModels(this.scene, p);
    this.pending.clear();
  }
  /** Ground under the trees changed (terrain level switch): every cell is rebuilt with the new heights. */
  reseat() {
    this.gen++; this.reseats++;
    this.disposeAll();
    this.split();
  }
  get ready(): boolean { return !this.impBusy && this.cells.every((c) => !c.busy); }
  stats() {
    let n = 0, tris = 0, models = 0; const lods = [0, 0, 0];
    for (const c of this.cells) { for (const m of c.models) { n += m.n; tris += m.tris; models++; } if (c.key >= 0) lods[c.key === 3 ? 2 : c.key]++; }
    for (const m of this.imp) { n += m.n; tris += m.tris; models++; }
    for (const p of this.pending) models += p.length;
    return { trees: n, tris, models, lods, rebuilds: this.rebuilds, reseats: this.reseats };
  }
  dispose() { this.dead = true; this.gen++; this.disposeAll(); this.cells = []; }
}
