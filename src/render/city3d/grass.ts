/**
 * 3D grass of the detailed battle view: tufts (public/models/nature/grass_tuft.glb, 6 triangles) only within RADIUS of
 * the point the camera looks at, on ground the vector map calls grass / scrub / farmland / forest floor (or the climate's
 * grass base), never on roads, buildings or water. One GPU-instanced model per city tile; rebuilt when the camera
 * focus moves STEP metres.
 */
import * as Cesium from 'cesium';
import type { VectorArea, VPoly } from '../../data/vector/types';
import { baseGround, type GroundKind } from './groundPaint';
import { projector, tileXY, TZ, type TileRef } from './geo';
import type { Ground } from './ground';
import { instanceGlb } from './glbInstancing';

const RADIUS = 140, STEP = 35, SPACING = 1.5;
const cg = new Cesium.Cartographic();
/** Tufts per candidate point by ground kind. */
const DENSITY: Partial<Record<GroundKind, number>> = { grass: 0.85, scrub: 0.55, farmland: 0.45, forest: 0.35, mud: 0.25 };
const USE_GRASS: Record<string, GroundKind> = { park: 'grass', cemetery: 'grass', recreation: 'grass', agriculture: 'farmland', airport: 'grass' };
const USE_BARE = new Set(['residential', 'commercial', 'school', 'hospital', 'religious', 'transport', 'port', 'industrial', 'quarry', 'military']);
const COVER: Record<string, GroundKind> = { wood: 'forest', grass: 'grass', scrub: 'scrub', farmland: 'farmland', wetland: 'mud', rock: 'rock', sand: 'sand', snow: 'snow', residential: 'pavement' };

/** Per-tile classification raster (4 m cells): density 0..255 of grass at each cell (0 = none). */
interface Raster { n: number; k: number; half: number; d: Uint8Array }
const rasters = new WeakMap<VectorArea, Raster>();
function raster(area: VectorArea, tile: TileRef): Raster {
  let r = rasters.get(area);
  if (r) return r;
  const n = Math.min(700, Math.ceil(tile.sizeM / 4)), half = tile.sizeM / 2, k = n / tile.sizeM;
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  const dens = (kind: GroundKind | null) => Math.round((kind ? DENSITY[kind] ?? 0 : 0) * 255);
  const fill = (p: VPoly, v: number) => {
    g.fillStyle = `rgb(${v},0,0)`; g.beginPath();
    for (const ring of p.rings) for (let i = 0; i < ring.length / 2; i++) { const X = (ring[i * 2] + half) * k, Y = (half - ring[i * 2 + 1]) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.fill('evenodd');
  };
  g.fillStyle = `rgb(${dens(baseGround(tile.lon0, tile.lat0))},0,0)`; g.fillRect(0, 0, n, n);
  for (const p of area.landcover) if (p.cls === 'residential') fill(p, 0);
  for (const p of area.landuse) { if (USE_BARE.has(p.cls)) fill(p, 0); else if (USE_GRASS[p.cls]) fill(p, dens(USE_GRASS[p.cls])); }
  for (const p of area.landcover) { const kind = COVER[p.cls]; if (kind && p.cls !== 'residential') fill(p, dens(kind)); }
  for (const p of area.water) fill(p, 0);
  for (const p of area.buildings) fill(p, 0);
  // roads and paths: no grass on the carriageway / sidewalk
  g.strokeStyle = 'rgb(0,0,0)'; g.lineCap = 'round';
  for (const l of [...area.roads, ...area.aeroways]) {
    if (l.pts.length < 4) continue;
    g.lineWidth = Math.max(2, (/motorway|trunk|primary|runway/.test(l.cls) ? 22 : /secondary|tertiary|taxi/.test(l.cls) ? 14 : /path|foot|track/.test(l.cls) ? 3 : 9) * k);
    g.beginPath();
    for (let i = 0; i < l.pts.length / 2; i++) { const X = (l.pts[i * 2] + half) * k, Y = (half - l.pts[i * 2 + 1]) * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
  }
  const img = g.getImageData(0, 0, n, n).data, d = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = img[i * 4];
  r = { n, k, half, d };
  rasters.set(area, r);
  return r;
}

const hash = (x: number, y: number, s: number) => {
  let h = Math.imul(x ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(y + 0x165667b1, 0xc2b2ae35) ^ s;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

let glbP: Promise<ArrayBuffer> | null = null;
const tuft = () => (glbP ??= fetch(new URL('models/nature/grass_tuft.glb', document.baseURI)).then((r) => r.arrayBuffer()));

export interface GrassTile { ref: TileRef; area: VectorArea | null; ground: Ground | null; state: string }

export class GrassLayer {
  private models = new Map<string, { model: Cesium.Model; url: string }>();
  private center: [number, number] | null = null;
  private sig = '';
  private lastBuild = 0;
  private busy = false;
  count = 0;
  /** Debug: last rebuild (tiles near the focus, candidate cells, tufts). */
  dbg = { calls: 0, tiles: 0, cand: 0, pts: 0, first: [0, 0, 0] as number[] };
  constructor(private scene: Cesium.Scene) {}

  /** Rebuild around lon/lat when the focus moved far enough. */
  async update(lon: number, lat: number, tiles: Iterable<GrassTile>): Promise<void> {
    this.dbg.calls++;
    if (this.busy || performance.now() - this.lastBuild < 1500) return;
    const k = Math.cos((lat * Math.PI) / 180) * 111_320;
    // only the tiles the grass circle touches: a far tile finishing its load must not trigger a rebuild
    const [gx, gy] = tileXY(lon, lat, TZ);
    const touches = (t: GrassTile) => { const h = t.ref.sizeM / 2, px = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, py = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM; return Math.abs(px) <= h + RADIUS && Math.abs(py) <= h + RADIUS; };
    const list = [...tiles].filter((t) => t.state === 'ready' && t.area && t.ground && touches(t)), sig = list.map((t) => t.ref.key).sort().join();
    // same place and same loaded tiles: nothing to do (a tile that finishes loading later triggers a rebuild)
    if (this.center && sig === this.sig && Math.hypot((lon - this.center[0]) * k, (lat - this.center[1]) * 111_320) < STEP) return;
    this.busy = true; this.lastBuild = performance.now();
    try {
      const src = await tuft();
      const next = new Map<string, { model: Cesium.Model; url: string }>();
      let total = 0;
      for (const t of list) {
        if (!t.area || !t.ground) continue;
        const half = t.ref.sizeM / 2;
        const px = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, py = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM;
        if (Math.abs(px) > half + RADIUS || Math.abs(py) > half + RADIUS) continue;
        const r = raster(t.area, t.ref), proj = projector(t.ref), pts: number[] = [];
        this.dbg.tiles++;
        for (let x = Math.ceil((px - RADIUS) / SPACING) * SPACING; x <= px + RADIUS; x += SPACING) {
          for (let y = Math.ceil((py - RADIUS) / SPACING) * SPACING; y <= py + RADIUS; y += SPACING) {
            const ix = Math.round(x / SPACING), iy = Math.round(y / SPACING);
            const jx = x + (hash(ix, iy, 1) - 0.5) * SPACING, jy = y + (hash(ix, iy, 2) - 0.5) * SPACING;
            if (Math.abs(jx) > half || Math.abs(jy) > half) continue;
            const dd = Math.hypot(jx - px, jy - py);
            if (dd > RADIUS) continue;
            this.dbg.cand++;
            const cx = Math.floor((jx + half) * r.k), cy = Math.floor((half - jy) * r.k);
            const dens = r.d[cy * r.n + cx] / 255 * (dd > RADIUS * 0.7 ? 1 - (dd - RADIUS * 0.7) / (RADIUS * 0.3) : 1);
            if (hash(ix, iy, 3) >= dens) continue;
            // the surface Cesium really draws (a few dm off the sampled grid would bury a 45 cm tuft)
            const [lo, la] = proj.lonLat(jx, jy);
            const drawn = this.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lo, la, 0, cg));
            pts.push(jx, jy, drawn !== undefined && Number.isFinite(drawn) ? drawn : t.ground(jx, jy), hash(ix, iy, 4));
            if (pts.length === 4) this.dbg.first = [lo, la, pts[2], t.ground(jx, jy)];
          }
        }
        const n = pts.length / 4;
        if (!n) continue;
        const T = new Float32Array(n * 3), R = new Float32Array(n * 4), S = new Float32Array(n * 3), v = new Cesium.Cartesian3();
        // frame anchored on the ground at the grass centre: instance heights stay near 0 (Cesium's bounding sphere of
        // instanced models mixes the up axis with the horizontal ones; with a tile frame at sea level the sphere
        // lands hundreds of metres away and the grass is culled)
        const [clo, cla] = proj.lonLat(px, py), h0 = t.ground(px, py);
        const frame = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(clo, cla, h0)), inv = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4());
        for (let i = 0; i < n; i++) {
          const x = pts[i * 4], y = pts[i * 4 + 1], h = pts[i * 4 + 2], s = pts[i * 4 + 3];
          Cesium.Matrix4.multiplyByPoint(inv, proj.ecef(x, y, h + 0.02, v), v);
          // measured (three test instances seen from above): instance X lands north, Z east, Y down in this frame
          T.set([v.y, -v.z, v.x], i * 3);
          const yaw = s * Math.PI * 2; R.set([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], i * 4); // yaw about glTF up (Y)
          const sc = 0.7 + s * 0.8; S.set([sc, sc * (0.8 + s * 0.5), sc], i * 3);
        }
        const url = URL.createObjectURL(new Blob([instanceGlb(src, T, R, S) as BlobPart], { type: 'model/gltf-binary' }));
        const model = await Cesium.Model.fromGltfAsync({ url, modelMatrix: frame, allowPicking: false, shadows: Cesium.ShadowMode.DISABLED, incrementallyLoadTextures: false });
        // the blade texture is bright: settle it toward the ground's own tone
        model.color = Cesium.Color.fromCssColorString('#b9c98f'); model.colorBlendMode = Cesium.ColorBlendMode.MIX; model.colorBlendAmount = 0.15;
        this.scene.primitives.add(model);
        next.set(t.ref.key, { model, url });
        total += n;
      }
      // swap only once the new models are drawable (a model is invisible until loaded: rebuilding often must not blink)
      for (let i = 0; i < 100 && [...next.values()].some((m) => !m.model.ready); i++) await new Promise((r) => setTimeout(r, 50));
      this.clear();
      this.models = next; this.count = total; this.center = [lon, lat]; this.sig = sig; this.dbg.pts = total;
      this.scene.requestRender();
    } finally { this.busy = false; }
  }
  clear() { for (const m of this.models.values()) { this.scene.primitives.remove(m.model); URL.revokeObjectURL(m.url); } this.models.clear(); this.count = 0; this.center = null; }
}
