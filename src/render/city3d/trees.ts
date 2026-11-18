/** Deterministic tree placement inside real wood / scrub / park polygons and instanced glb trees (one draw call per species and distance set). */
import * as Cesium from 'cesium';
import type { VectorArea, VPoly } from '../../data/vector/types';
import { widthOf } from './roads';
import { pickStyle, type Styles, type TreeRule } from './styles';
import { hash, projector, type TileRef } from './geo';
import type { Ground } from './ground';
import { instanceGlb } from './glbInstancing';

export interface TreePoint { x: number; y: number; z: number; yaw: number; s: number; /** crown widening (sparse placement of big forests: wider crowns keep the canopy closed) */ sw: number; sp: string; far: boolean }

function inRing(r: number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inPoly = (p: VPoly, x: number, y: number) => {
  if (!inRing(p.rings[0], x, y)) return false;
  for (let k = 1; k < p.rings.length; k++) if (inRing(p.rings[k], x, y)) return false;
  return true;
};

/** Trees for a tile: at most `budget`, spacing widened automatically for big forests. */
export function placeTrees(area: VectorArea, tile: TileRef, ground: Ground, budget: number, st: Styles): TreePoint[] {
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
  const polys = [...area.landcover.filter((p) => p.cls === 'wood' || p.cls === 'scrub'), ...area.landuse.filter((p) => p.cls === 'park')];
  const bbox = polys.map((p) => { const r = p.rings[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return [Math.max(x0, -half), Math.max(y0, -half), Math.min(x1, half), Math.min(y1, half)]; });
  const absLat = Math.abs(tile.lat0);
  const ruleOf = polys.map((p, i) => { const b = bbox[i], z = ground((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); return pickStyle<TreeRule>(st.trees, { cover: p.cls, absLat, elev: z }); });
  const dens = (p: VPoly) => ruleOf[polys.indexOf(p)].density; // trees per m²
  let want = 0;
  polys.forEach((p, i) => { const b = bbox[i]; if (b[2] > b[0] && b[3] > b[1]) want += (b[2] - b[0]) * (b[3] - b[1]) * 0.55 * dens(p); }); // upper bound: bbox x fill ratio
  const k = want > budget ? Math.sqrt(want / budget) : 1;
  const out: TreePoint[] = [], cap = budget * 4;
  polys.forEach((p, i) => {
    const b = bbox[i];
    if (b[2] <= b[0] || b[3] <= b[1]) return;
    const step = Math.sqrt(1 / dens(p)) * k, ps = hash(i, 7, 3) * step;
    for (let y = b[1] + ps; y < b[3] && out.length < cap; y += step) for (let x = b[0] + ps; x < b[2]; x += step) {
      const jx = x + (hash(Math.round(x * 3), Math.round(y * 3), 11) - 0.5) * step * 0.8, jy = y + (hash(Math.round(x * 3), Math.round(y * 3), 12) - 0.5) * step * 0.8;
      if (Math.abs(jx) >= half || Math.abs(jy) >= half || blocked[Math.floor((jy + half) / CELL) * N + Math.floor((jx + half) / CELL)] || !inPoly(p, jx, jy)) continue;
      const z = ground(jx, jy), rule = ruleOf[i], tw = rule.mix.reduce((a, q) => a + q.weight, 0);
      let r = hash(Math.round(jx * 2), Math.round(jy * 2), 13) * tw, sp = rule.mix[0].species;
      for (const q of rule.mix) { if (r < q.weight) { sp = q.species; break; } r -= q.weight; }
      const [lo, hi] = rule.height, hm = (lo + (hi - lo) * hash(Math.round(jx * 2), Math.round(jy * 2), 14)) * (k > 1 ? Math.min(1.15, 1 + (k - 1) * 0.05) : 1);
      out.push({ x: jx, y: jy, z, yaw: hash(Math.round(jx), Math.round(jy), 15) * Math.PI * 2, s: hm / st.species[sp].nativeHeight, sw: k > 1 ? Math.min(1.6, 1 + (k - 1) * 0.3) : 1, sp, far: hash(Math.round(jx), Math.round(jy), 16) < 0.5 });
      if (out.length >= cap) break;
    }
  });
  // too many candidates (the bbox estimate is an upper bound): thin them uniformly over the whole tile instead of letting the first polygons eat the budget
  if (out.length > budget) {
    const r = budget / out.length;
    const kept = out.filter((p) => hash(Math.round(p.x * 3), Math.round(p.y * 3), 21) < r);
    for (const p of kept) p.sw = Math.min(1.6, Math.max(p.sw, 1 + (1 / Math.sqrt(r) - 1) * 0.3));
    return kept;
  }
  return out;
}

const glbCache = new Map<string, Promise<ArrayBuffer>>();
const glb = (sp: string) => {
  let p = glbCache.get(sp);
  if (!p) { p = fetch(new URL(`models/nature/${sp}.glb`, document.baseURI)).then((r) => { if (!r.ok) throw new Error(`${sp}.glb ${r.status}`); return r.arrayBuffer(); }); glbCache.set(sp, p); p.catch(() => glbCache.delete(sp)); }
  return p;
};

export interface TreeModels { models: { sp: string; far: boolean; model: Cesium.Model; url: string }[]; count: number }
/** One instanced Model per species x distance set (far=true: the set that stays visible up to the full tree distance). */
export async function createTreeModels(scene: Cesium.Scene, tile: TileRef, pts: TreePoint[], st: Styles): Promise<TreeModels> {
  const out: TreeModels = { models: [], count: 0 };
  const proj = projector(tile);
  const groups = new Map<string, TreePoint[]>();
  for (const p of pts) { const k = `${p.sp}|${p.far ? 1 : 0}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  await Promise.all([...groups].map(async ([k, list]) => {
    const [sp, far] = k.split('|') as [string, string];
    const T = new Float32Array(list.length * 3), Rq = new Float32Array(list.length * 4), S = new Float32Array(list.length * 3), v = new Cesium.Cartesian3();
    list.forEach((p, i) => {
      proj.local(p.x, p.y, p.z - 0.15, v); // ENU (e,n,u) -> glTF Y-up (e,u,-n)
      T.set([v.x, v.z, -v.y], i * 3);
      Rq.set([0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)], i * 4);
      S.set([p.s * p.sw, p.s, p.s * p.sw], i * 3);
    });
    const bytes = instanceGlb(await glb(st.species[sp].file), T, Rq, S);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }));
    const model = await Cesium.Model.fromGltfAsync({ url, modelMatrix: tile.enu, show: false, allowPicking: false, shadows: Cesium.ShadowMode.DISABLED, incrementallyLoadTextures: false });
    // the leaf textures are dark: lift them toward a fresh green so a forest reads against the dark satellite canopy
    model.color = Cesium.Color.fromCssColorString('#a6d96a'); model.colorBlendMode = Cesium.ColorBlendMode.MIX; model.colorBlendAmount = 0.28;
    scene.primitives.add(model);
    out.models.push({ sp, far: far === '1', model, url });
    out.count += list.length;
  }));
  return out;
}
export function disposeTreeModels(scene: Cesium.Scene, t: TreeModels) {
  for (const m of t.models) { scene.primitives.remove(m.model); URL.revokeObjectURL(m.url); }
  t.models.length = 0;
}
