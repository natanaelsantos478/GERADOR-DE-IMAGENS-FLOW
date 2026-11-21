/**
 * Grass tufts around the camera (detailed battle view / low flights): generated in code, only near the camera (desktop ~120 m, phone ~50 m,
 * off in the low profile), only where the ground is grass / field / park: the vector land cover decides (like the trees) and the satellite
 * photo's vegetation mask fills lawns the map does not list; buildings, roads, water, forests and the footprint of vehicles / ruins stay clear.
 * One merged mesh per tile (a glb built in memory, one draw call), blades swaying in the wind in a vertex shader. Pattern: public/data/styles/grass.json.
 */
import * as Cesium from 'cesium';
import { getQuality } from '../globe/quality';
import { projector, tileXY, TZ } from './geo';
import { widthOf } from './roads';
import { styles } from './styles';
import type { CityTile } from './tile';
import { hash3, pickRule, scatterGrass, tuftVertices, validateGrass, type GrassStyle, type Tuft } from './grassScatter';

const MASK_M = 2.5;
/** Land-cover / land-use classes that carry grass (the rule file lists which ones each rule uses). */
const BLOCK = new Set(['wood', 'water', 'rock', 'snow', 'sand', 'wetland']);

let style: GrassStyle | null = null, loading: Promise<void> | null = null, loadedAt = 0;
export async function loadGrassStyle(force = false): Promise<GrassStyle | null> {
  if (style && !force) return style;
  loading ??= fetch(new URL('data/styles/grass.json', document.baseURI)).then((r) => r.json()).then((j) => { style = validateGrass(j); loadedAt = performance.now(); }).catch((e) => console.warn('[grass] style unavailable:', (e as Error).message)).finally(() => { loading = null; });
  await loading;
  return style;
}
export const grassStyle = () => style;

/** Cover raster of a tile (cells of MASK_M): 0 nothing, 255 blocked, else 1 + index of the cover class in `covers`. */
interface Mask { n: number; g: Uint8Array; covers: string[] }
function fillPoly(g: Uint8Array, n: number, half: number, rings: number[][], v: number, only?: (cur: number) => boolean) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i += 2) { y0 = Math.min(y0, r[i]); y1 = Math.max(y1, r[i]); }
  const xs: number[] = [];
  for (let j = Math.max(0, Math.floor((y0 + half) / MASK_M)); j <= Math.min(n - 1, Math.ceil((y1 + half) / MASK_M)); j++) {
    const y = -half + (j + 0.5) * MASK_M;
    xs.length = 0;
    for (const r of rings) for (let a = 0, m = r.length / 2, b = m - 1; a < m; b = a++) {
      const ya = r[a * 2 + 1], yb = r[b * 2 + 1];
      if (ya > y !== yb > y) xs.push(r[a * 2] + ((y - ya) * (r[b * 2] - r[a * 2])) / (yb - ya));
    }
    xs.sort((p, q) => p - q);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil((xs[q] + half) / MASK_M - 0.5)); i <= Math.min(n - 1, Math.floor((xs[q + 1] + half) / MASK_M - 0.5)); i++) { const c = j * n + i; if (!only || only(g[c])) g[c] = v; }
  }
}
function buildMask(t: CityTile, st: GrassStyle): Mask {
  const half = t.ref.sizeM / 2, n = Math.ceil(t.ref.sizeM / MASK_M), g = new Uint8Array(n * n), area = t.area!;
  const covers = [...new Set(st.rules.flatMap((r) => r.match.cover ?? []))];
  const idx = new Map(covers.map((c, i) => [c, i + 1]));
  // 1) land cover / land use polygons: grass-like classes mark the cell, blocking classes (wood, water bodies, rock...) clear it
  for (const p of [...area.landcover, ...area.landuse]) { const v = idx.get(p.cls); if (v) fillPoly(g, n, half, p.rings, v, (c) => c === 0 || c < 255); }
  for (const p of [...area.landcover, ...area.landuse]) if (BLOCK.has(p.cls)) fillPoly(g, n, half, p.rings, 255);
  // 2) water, buildings (+1 m), roads, aeroways: always clear
  for (const w of area.water) fillPoly(g, n, half, w.rings, 255);
  for (const b of area.buildings) fillPoly(g, n, half, b.rings, 255);
  for (const l of [...area.roads, ...area.aeroways]) {
    const st2 = styles(), w = (st2 ? widthOf(st2, l.cls) : 6) * 0.5 + 1.2;
    if (l.cls === 'path' || l.cls === 'steps') continue;
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const x0 = l.pts[i], y0 = l.pts[i + 1], x1 = l.pts[i + 2], y1 = l.pts[i + 3], len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(len / (MASK_M * 0.7)));
      for (let k = 0; k <= steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps, y = y0 + ((y1 - y0) * k) / steps, r = Math.ceil(w / MASK_M);
        const ci = Math.floor((x + half) / MASK_M), cj = Math.floor((y + half) / MASK_M);
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i2 = ci + di, j2 = cj + dj; if (i2 >= 0 && j2 >= 0 && i2 < n && j2 < n && Math.hypot(di * MASK_M, dj * MASK_M) <= w + MASK_M * 0.5) g[j2 * n + i2] = 255; }
      }
    }
  }
  return { n, g, covers };
}
/** Class name at a point from the mask, or the generic photo-green lawn (`grass`) where the map lists nothing but the satellite is green. */
function coverAt(m: Mask, half: number, t: CityTile, x: number, y: number): string | null {
  const i = Math.floor((x + half) / MASK_M), j = Math.floor((y + half) / MASK_M);
  if (i < 0 || j < 0 || i >= m.n || j >= m.n) return null;
  const v = m.g[j * m.n + i];
  if (v === 255) return null;
  if (v > 0) return m.covers[v - 1];
  // not listed on the map: only a clearly green photo (a lawn / pasture the polygons miss) gets grass
  return t.veg && t.veg.around(x, y, 4) > 0.6 && t.veg.at(x, y) > 0.5 ? 'grass' : null;
}

// ---------------------------------------------------------------- glb in memory
const pad4 = (n: number) => (n + 3) & ~3;
/** Non-indexed triangle mesh (positions, vertex colour RGB + sway weight in alpha, up normals) as a glb with one double-sided material. */
export function tuftsGlb(pos: Float32Array, col: Float32Array, nor: Float32Array): Uint8Array {
  const parts = [pos, col, nor], offs: number[] = [];
  let total = 0;
  for (const p of parts) { offs.push(total); total += pad4(p.byteLength); }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  const count = pos.length / 3;
  const json = {
    asset: { version: '2.0', generator: 'meridiano grass' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1, NORMAL: 2 }, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.95 }, doubleSided: true, alphaMode: 'OPAQUE' }],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5126, count, type: 'VEC4' }, { bufferView: 2, componentType: 5126, count, type: 'VEC3' }],
    bufferViews: parts.map((p, i) => ({ buffer: 0, byteOffset: offs[i], byteLength: p.byteLength })), buffers: [{ byteLength: total }],
  };
  const j = new TextEncoder().encode(JSON.stringify(json)), jl = pad4(j.length), out = new Uint8Array(12 + 8 + jl + 8 + total), o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, jl, true); o.setUint32(16, 0x4e4f534a, true); out.set(j, 20); out.fill(0x20, 20 + j.length, 20 + jl);
  const bo = 20 + jl;
  o.setUint32(bo, total, true); o.setUint32(bo + 4, 0x004e4942, true);
  parts.forEach((p, i) => out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), bo + 8 + offs[i]));
  return out;
}

const VS = `
void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
  float w = vsInput.attributes.color_0.a;
  vec3 p = vsInput.attributes.positionMC;
  float ph = dot(p.xz, vec2(0.21, 0.13)) * u_scale + u_time * u_speed;
  float g = sin(ph) + 0.5 * sin(ph * 2.3 + 1.7);
  vsOutput.positionMC.x += u_amp * w * g;
  vsOutput.positionMC.z += u_amp * w * 0.6 * cos(ph * 0.8);
}`;
const FS = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  // vertex colours are authored in sRGB-ish values; keep them lively under the scene light
  material.diffuse = pow(material.diffuse, vec3(0.8));
}`;
const sh = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

interface Patch { model: Cesium.Model | null; url: string; cx: number; cy: number; key: string; obs: string; at: number; tufts: number; busy: boolean; shader: Cesium.CustomShader }
export interface GrassStats { active: boolean; radius: number; patches: number; tufts: number; /** last patch: JS placement + mesh time / until the model was loaded (ms) */ genMs: number; buildMs: number; tris: number }
export interface Obstacle { lon: number; lat: number; r: number }

export class GrassField {
  private patches = new Map<string, Patch>();
  private masks = new WeakMap<CityTile, { m: Mask; styleAt: number; veg: boolean }>();
  private obstacles: Obstacle[] = [];
  private obsSig = '';
  private t0 = performance.now();
  private off: () => void;
  private lastBuildMs = 0;
  private lastGenMs = 0;
  private enabled = true;
  constructor(private viewer: Cesium.Viewer, private tiles: () => Iterable<CityTile>) {
    void loadGrassStyle();
    this.off = viewer.scene.preRender.addEventListener(() => {
      const t = (performance.now() - this.t0) / 1000;
      for (const p of this.patches.values()) p.shader.setUniform('u_time', t);
    });
  }
  /** Debug / tests: turn the grass off and on. */
  setEnabled(v: boolean) { this.enabled = v; if (!v) this.clear(); }
  /** Footprints (vehicles, ruins) where the grass is left out; the patches rebuild when the set changes. */
  setObstacles(o: Obstacle[]) {
    const sig = o.map((q) => `${Math.round(q.lon * 2e5)},${Math.round(q.lat * 2e5)},${Math.round(q.r)}`).join('|');
    if (sig === this.obsSig) return;
    this.obsSig = sig; this.obstacles = o;
  }
  stats(): GrassStats {
    let tufts = 0; for (const p of this.patches.values()) tufts += p.tufts;
    const st = style, prof = st?.profiles[getQuality().id];
    return { active: this.enabled && !!prof && prof.radius > 0, radius: prof?.radius ?? 0, patches: this.patches.size, tufts, genMs: Math.round(this.lastGenMs), buildMs: Math.round(this.lastBuildMs), tris: tufts * (style?.rules[0]?.blades ?? 0) };
  }
  /** Test/debug: what the grass mask says around a point (tile, cover class there, share of cells by state, photo green). */
  probe(lon: number, lat: number) {
    const st = style; if (!st) return { error: 'no style' };
    const [gx, gy] = tileXY(lon, lat, TZ);
    for (const t of this.tiles()) {
      if (t.ref.x !== Math.floor(gx) || t.ref.y !== Math.floor(gy) || !t.area || !t.ground) continue;
      const mk = this.masks.get(t) ?? { m: buildMask(t, st), styleAt: loadedAt, veg: !!t.veg };
      const x = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, y = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM, half = t.ref.sizeM / 2;
      const cnt = { none: 0, blocked: 0, grass: 0 }; for (const v of mk.m.g) { if (v === 0) cnt.none++; else if (v === 255) cnt.blocked++; else cnt.grass++; }
      return { tile: t.ref.key, x: Math.round(x), y: Math.round(y), cover: coverAt(mk.m, half, t, x, y), photo: !!t.veg, greenHere: t.veg ? +t.veg.at(x, y).toFixed(2) : null, cells: cnt, covers: mk.m.covers, ground: Math.round(t.ground(x, y)), patch: this.patches.get(t.ref.key)?.tufts };
    }
    return { error: 'no tile' };
  }
  /** Test/debug: up to `n` spots (lon/lat) of the loaded tiles that are open grass (a 15 m square of grass cells), nearest to `near` first. */
  findGrass(n = 5, near?: { lon: number; lat: number }): { lon: number; lat: number; cover: string }[] {
    const st = style; if (!st) return [];
    const out: { lon: number; lat: number; cover: string; d: number }[] = [];
    for (const t of this.tiles()) {
      if (t.state !== 'ready' || !t.area || !t.ground) continue;
      const mk = this.masks.get(t) ?? { m: buildMask(t, st), styleAt: loadedAt, veg: !!t.veg };
      this.masks.set(t, mk);
      const { m } = mk, half = t.ref.sizeM / 2, pj = projector(t.ref), r = 3;
      for (let j = r; j < m.n - r; j += 6) for (let i = r; i < m.n - r; i += 6) {
        let ok = true; const v0 = m.g[j * m.n + i];
        if (!v0 || v0 === 255) continue;
        for (let dj = -r; dj <= r && ok; dj++) for (let di = -r; di <= r; di++) { const v = m.g[(j + dj) * m.n + i + di]; if (!v || v === 255) { ok = false; break; } }
        if (!ok) continue;
        const [lo, la] = pj.lonLat(-half + (i + 0.5) * MASK_M, -half + (j + 0.5) * MASK_M);
        out.push({ lon: lo, lat: la, cover: m.covers[v0 - 1], d: near ? Math.hypot(lo - near.lon, la - near.lat) : 0 });
      }
    }
    return out.sort((a, b) => a.d - b.d).slice(0, n).map(({ d, ...q }) => { void d; return q; });
  }
  clear() { for (const [k, p] of this.patches) { this.drop(p); this.patches.delete(k); } }
  private drop(p: Patch) { if (p.model) { this.viewer.scene.primitives.remove(p.model); p.model = null; } URL.revokeObjectURL(p.url); }

  /** Re-evaluated whenever the camera moves (city3d `applyLod`): builds / refreshes the patches of the tiles under the camera disc. */
  update() {
    const st = style, q = getQuality().id, prof = st?.profiles[q];
    const cam = this.viewer.camera, cp = Cesium.Cartographic.fromCartesian(cam.positionWC);
    if (!st || !this.enabled || !prof || prof.radius <= 0 || !cp) { if (this.patches.size) this.clear(); return; }
    const lon = Cesium.Math.toDegrees(cp.longitude), lat = Cesium.Math.toDegrees(cp.latitude), R = prof.radius;
    // camera far above the ground: no grass (the disc would be a speck)
    const [gx, gy] = tileXY(lon, lat, TZ);
    const want = new Set<string>();
    const live = [...this.tiles()].filter((t) => t.state === 'ready' && t.area && t.ground);
    let inReach = 0;
    for (const t of live) { const half = t.ref.sizeM / 2, x = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, y = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM; if (Math.hypot(Math.max(0, Math.abs(x) - half), Math.max(0, Math.abs(y) - half)) <= R) inReach++; }
    const budget = Math.floor(prof.maxTufts / Math.max(1, inReach)); // the tuft budget is shared by the tiles the disc touches
    for (const t of live) {
      if (t.state !== 'ready' || !t.area || !t.ground) continue;
      const x = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, y = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM, half = t.ref.sizeM / 2;
      const dx = Math.max(0, Math.abs(x) - half), dy = Math.max(0, Math.abs(y) - half), floor = t.ground(Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, y)));
      const agl = cp.height - floor;
      if (Math.hypot(dx, dy) > R || agl > R * 1.6) continue;
      want.add(t.ref.key);
      const pt = this.patches.get(t.ref.key), now = performance.now();
      const sig = `${style === st ? loadedAt : 0}|${t.veg ? 1 : 0}|${q}|${budget}`;
      if (pt?.busy) continue;
      const moved = pt ? Math.hypot(pt.cx - x, pt.cy - y) : Infinity;
      // rebuild when the camera moved 30 % of the radius, the style / photo mask / profile changed, or (at most every 2.5 s) the obstacle set changed
      const fresh = pt && pt.key === sig && moved <= R * 0.3 && (pt.obs === this.obsSig || now - pt.at < 2500);
      if (fresh) continue;
      void this.build(t, st, budget, R, x, y, sig, pt);
    }
    for (const [k, p] of this.patches) if (!want.has(k)) { this.drop(p); this.patches.delete(k); }
  }

  private async build(t: CityTile, st: GrassStyle, maxTufts: number, R: number, cx: number, cy: number, sig: string, old?: Patch) {
    const t0 = performance.now(), half = t.ref.sizeM / 2;
    let mk = this.masks.get(t);
    if (!mk || mk.styleAt !== loadedAt || mk.veg !== !!t.veg) { mk = { m: buildMask(t, st), styleAt: loadedAt, veg: !!t.veg }; this.masks.set(t, mk); }
    const m = mk.m, absLat = Math.abs(t.ref.lat0), ground = t.ground!;
    const pj = projector(t.ref);
    // obstacles in tile-local metres
    const ob = this.obstacles.map((o) => { const [ox, oy] = tileXY(o.lon, o.lat, TZ); return { x: (ox - (t.ref.x + 0.5)) * t.ref.sizeM, y: -(oy - (t.ref.y + 0.5)) * t.ref.sizeM, r: o.r }; }).filter((o) => Math.hypot(o.x - cx, o.y - cy) < R + o.r);
    const seed = (t.ref.x * 73856093) ^ (t.ref.y * 19349663);
    const accept = (x: number, y: number) => {
      for (const o of ob) if (Math.hypot(x - o.x, y - o.y) < o.r) return -1;
      const c = coverAt(m, half, t, x, y);
      if (!c) return -1;
      const z = ground(x, y);
      if (z <= 0.3) return -1;
      return pickRule(st.rules, { cover: c, absLat, elev: z });
    };
    const tufts: Tuft[] = scatterGrass({ cx, cy, radius: R, half, seed, maxTufts, fadeFrom: st.fadeFrom, rules: st.rules, accept });
    const entry: Patch = old ?? { model: null, url: '', cx, cy, key: sig, obs: '', at: 0, tufts: 0, busy: true, shader: new Cesium.CustomShader({
      uniforms: { u_time: { type: Cesium.UniformType.FLOAT, value: 0 }, u_amp: { type: Cesium.UniformType.FLOAT, value: st.wind.amp }, u_speed: { type: Cesium.UniformType.FLOAT, value: st.wind.speed }, u_scale: { type: Cesium.UniformType.FLOAT, value: st.wind.scale } },
      vertexShaderText: VS, fragmentShaderText: FS,
    }) };
    entry.busy = true; entry.obs = this.obsSig; entry.at = performance.now(); this.patches.set(t.ref.key, entry);
    entry.shader.setUniform('u_amp', st.wind.amp); entry.shader.setUniform('u_speed', st.wind.speed); entry.shader.setUniform('u_scale', st.wind.scale);
    if (!tufts.length) { this.drop(entry); entry.model = null; entry.tufts = 0; entry.cx = cx; entry.cy = cy; entry.key = sig; entry.busy = false; return; }
    const P: number[] = [], Cc: number[] = [], N: number[] = [];
    for (const f of tufts) {
      const z = ground(f.x, f.y), l = pj.local(f.x, f.y, z), rule = st.rules[f.rule];
      const jit = (n: number) => hash3(Math.round(f.x * 10) + n * 7, Math.round(f.y * 10), seed + 3) * 2 - 1;
      const v = tuftVertices({ ...f, x: l.x, y: l.y }, rule.tip, l.z, jit);
      // ENU (x east, y north, z up) -> glTF axes as Cesium reads them (forward +Z = east, +X = north, +Y = up)
      for (let i = 0; i < v.p.length; i += 3) { P.push(v.p[i + 1], v.p[i + 2], v.p[i]); N.push(0, 1, 0); }
      for (let i = 0; i < v.w.length; i++) Cc.push(sh(v.c[i * 3]), sh(v.c[i * 3 + 1]), sh(v.c[i * 3 + 2]), v.w[i]);
    }
    const glb = tuftsGlb(new Float32Array(P), new Float32Array(Cc), new Float32Array(N));
    this.lastGenMs = performance.now() - t0; // placement + mesh in JS (the glTF load that follows is asynchronous)
    const url = URL.createObjectURL(new Blob([glb.buffer as ArrayBuffer], { type: 'model/gltf-binary' }));
    try {
      const model = await Cesium.Model.fromGltfAsync({ url, modelMatrix: t.ref.enu, customShader: entry.shader, show: true, allowPicking: false, shadows: Cesium.ShadowMode.DISABLED, incrementallyLoadTextures: false });
      model.lightColor = new Cesium.Cartesian3(2.6, 2.6, 2.6);
      this.viewer.scene.primitives.add(model);
      // the previous patch stays until the new one can be drawn (no flash of bare ground)
      const prev = entry.model, prevUrl = entry.url, done = () => { if (prev) this.viewer.scene.primitives.remove(prev); if (prevUrl) URL.revokeObjectURL(prevUrl); this.viewer.scene.requestRender(); };
      if (model.ready) done(); else model.readyEvent.addEventListener(done);
      entry.model = model; entry.url = url;
    } catch (e) { console.warn('[grass] model failed', (e as Error).message); URL.revokeObjectURL(url); }
    entry.tufts = tufts.length; entry.cx = cx; entry.cy = cy; entry.key = sig; entry.busy = false;
    this.lastBuildMs = performance.now() - t0;
  }
  destroy() { this.off(); this.clear(); }
}
