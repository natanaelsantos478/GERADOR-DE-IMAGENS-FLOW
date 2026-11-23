/** One z14 city tile: vector data -> (generated on demand from the style catalogs) building / bridge / infra meshes, road raster layer, instanced trees. */
import * as Cesium from 'cesium';
import { loadFromSources, openFreeMapSource, overtureSource, type VectorTileSource } from '../../data/vector/source';
import { idbStore } from '../../data/vector/tiles';
import type { VectorArea } from '../../data/vector/types';
import { cityAppearance, opacityDebug, type CityAppearance } from './appearance';
import { loadAtlas, type Atlas } from './atlas';
import { buildBuildings, polyCentroid } from './buildings';
import { projector, TZ, tileXY, type TileRef } from './geo';
import { marksFor } from './landmarks';
import { groundLevel, loadGround, type Ground } from './ground';
import { buildInfra } from './infra';
import type { Mesh } from './mesh';
import { buildBridges, drawRoads } from './roads';
import { styles as currentStyles, type Styles } from './styles';
import { TileRubble } from './rubbleTile';
import { placeTrees, TreeLayer, type TreePoint } from './trees';
import { loadVegetation, type VegMask } from './vegetation';
import { AirportPlanes, airfieldsIn } from './airplanes';
import { LIVE, PlaceMarks } from './spots';
import { loadGroundTextures } from './groundPaint';
import { mode } from '../units/common';

let sources: VectorTileSource[] | null = null;
let appearance: CityAppearance | null = null, appearanceSig = '';
/** Current shared appearance (index.ts drives its night uniform). */
export const sharedAppearance = () => appearance;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Decoded data of tiles that left the view (memory only, LRU): re-entering regenerates the 3D without a new download/decode. */
const dataCache = new Map<string, { area: VectorArea; ground: Ground; source: string }>();
const DATA_CACHE_MAX = 16;
export const cachedTiles = () => dataCache.size;

export interface TileStats { buildings: number; majorBuildings: number; tris: number; roads: number; bridges: number; infra: number; trees: number; loadMs: number; genMs: number; t: Record<string, number>; source: string; styles: Record<string, number>; cover: Record<string, number>; treePts: number; treeSp: Record<string, number>; /** share of the tile green on the satellite photo (-1: imagery unavailable) */ vegCover: number }
/** Bounding-box centres of the `n` tallest big buildings of the ready tiles (tests: probes for the opacity check). */
export function tallBuildings(tiles: Iterable<CityTile>, n: number): { lon: number; lat: number; h: number; area: number }[] {
  const out: { lon: number; lat: number; h: number; area: number }[] = [];
  for (const t of tiles) {
    if (t.state !== 'ready' || !t.area) continue;
    const pj = projector(t.ref);
    for (const p of t.area.buildings) {
      if ((p.h ?? 0) < 25 || (p.minH ?? 0) > 0.5) continue;
      const [cx, cy] = polyCentroid(p), r = p.rings[0];
      let a = 0; for (let i = 0, k = r.length / 2, j = k - 1; i < k; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
      a = Math.abs(a) / 2;
      if (a < 500 || Math.abs(cx) > t.ref.sizeM / 2 || Math.abs(cy) > t.ref.sizeM / 2) continue;
      const [lon, lat] = pj.lonLat(cx, cy);
      out.push({ lon, lat, h: p.h as number, area: a });
    }
  }
  return out.sort((u, v) => v.h - u.h).slice(0, n);
}
/** Debug: the `n` drawn footprints closest to lon/lat (distance m, area m2, height, offset east/north m from the point). */
export function nearBuildings(tiles: Iterable<CityTile>, lon: number, lat: number, n: number): { d: number; dx: number; dy: number; area: number; h: number; tile: string }[] {
  const out: { d: number; dx: number; dy: number; area: number; h: number; tile: string }[] = [];
  for (const t of tiles) {
    if (t.state !== 'ready' || !t.area) continue;
    const [gx, gy] = tileXY(lon, lat, TZ), px = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, py = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM;
    for (const p of t.area.buildings) {
      const [cx, cy] = polyCentroid(p), d = Math.hypot(cx - px, cy - py);
      if (d > 150) continue;
      const r = p.rings[0]; let a = 0; for (let i = 0, k = r.length / 2, j = k - 1; i < k; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
      out.push({ d: Math.round(d * 10) / 10, dx: Math.round((cx - px) * 10) / 10, dy: Math.round((cy - py) * 10) / 10, area: Math.round(Math.abs(a) / 2), h: p.h ?? 0, tile: t.ref.key });
    }
  }
  return out.sort((u, v) => u.d - v.d).slice(0, n);
}
/** Imagery provider that serves one canvas as a single image over `rect` (no PNG encode/decode round trip). */
function canvasTileProvider(canvas: HTMLCanvasElement, rect: Cesium.Rectangle): Cesium.ImageryProvider {
  const scheme = new Cesium.GeographicTilingScheme({ rectangle: rect, numberOfLevelZeroTilesX: 1, numberOfLevelZeroTilesY: 1 });
  return {
    ready: true, rectangle: rect, tileWidth: canvas.width, tileHeight: canvas.height, maximumLevel: 0, minimumLevel: 0, tilingScheme: scheme,
    tileDiscardPolicy: undefined, errorEvent: new Cesium.Event(), credit: undefined as never, proxy: undefined, hasAlphaChannel: true,
    getTileCredits: () => [], requestImage: () => Promise.resolve(canvas as never), pickFeatures: () => undefined,
  } as unknown as Cesium.ImageryProvider;
}
export class CityTile {
  state: 'loading' | 'ready' | 'failed' = 'loading';
  dead = false;
  area: VectorArea | null = null;
  ground: Ground | null = null;
  major: Cesium.Primitive | null = null;
  minor: Cesium.Primitive | null = null;
  bridges: Cesium.Primitive | null = null;
  roadLayer: Cesium.ImageryLayer | null = null;
  roadUrl = '';
  treePts: TreePoint[] | null = null;
  /** satellite vegetation mask used for the last placement (debug) */
  veg: VegMask | null = null;
  /** civil aircraft parked at this tile's airport gates */
  planes: AirportPlanes | null = null;
  /** The road raster carries the own ground (detailed battle view) instead of being transparent over the photo. */
  ownGround = false;
  /** icons over hospitals, military areas and airfields */
  marks: PlaceMarks | null = null;
  private vegRetryAt = 0;
  trees: TreeLayer | null = null;
  treeBusy = false;
  stats: TileStats = { buildings: 0, majorBuildings: 0, tris: 0, roads: 0, bridges: 0, infra: 0, trees: 0, loadMs: 0, genMs: 0, t: {}, source: '', styles: {}, cover: {}, treePts: 0, treeSp: {}, vegCover: -1 };
  lastSeen = 0;
  failedAt = 0;
  atlas: Atlas | null = null;
  /** True while `generate` runs (the destruction sync waits for it). */
  generating = false;
  readonly rub = new TileRubble(this);
  private gen = 0;
  private rebuilding = false;
  constructor(readonly ref: TileRef, readonly viewer: Cesium.Viewer, private roadPx: number, private maxTrees: number) { LIVE.add(this); }

  /** Fetch data (or reuse the memory cache) and generate the 3D with the current styles. */
  async load(st: Styles): Promise<void> {
    const t0 = performance.now(), r = this.ref;
    try {
      const hit = dataCache.get(r.key);
      if (hit) { dataCache.delete(r.key); this.area = hit.area; this.ground = hit.ground; this.stats.source = hit.source; }
      else {
        const store = idbStore();
        sources ??= [overtureSource({ store }), openFreeMapSource({ store })];
        const b = { lon: r.lon0, lat: r.lat0, sizeM: r.sizeM * 0.9 };
        let got = await loadFromSources([sources[0]], b, 70_000);
        if (!got || (!got.area.buildings.length && !got.area.roads.length)) got = (await loadFromSources([sources[1]], b, 70_000)) ?? got;
        if (this.dead) return;
        if (!got) { this.state = 'failed'; return; }
        const ground = await loadGround(r, () => !this.dead);
        if (this.dead) return;
        if (!ground) { this.state = 'failed'; return; }
        this.area = got.area; this.ground = ground; this.stats.source = got.source;
      }
      this.stats.cover = {};
      for (const p of [...this.area!.landcover, ...this.area!.landuse]) this.stats.cover[p.cls] = (this.stats.cover[p.cls] ?? 0) + 1;
      await this.generate(st);
      this.state = this.dead ? this.state : 'ready';
      this.rub.sync();
    } catch (e) {
      if (!this.dead) { this.state = 'failed'; console.warn('city3d tile', r.key, e); }
    } finally {
      this.stats.loadMs = Math.round(performance.now() - t0);
      this.viewer.scene.requestRender();
    }
  }

  /** Build every 3D object of the tile from its data + the style catalogs (called on load and when a style file changes). */
  async generate(st: Styles): Promise<void> {
    if (!this.area || !this.ground) return;
    const my = ++this.gen, scene = this.viewer.scene, r = this.ref, area = this.area, ground = this.ground, t0 = performance.now();
    const stale = () => this.dead || my !== this.gen;
    this.generating = true;
    try { await this.generateInner(st, my, scene, r, area, ground, t0, stale); } finally { if (my === this.gen) this.generating = false; }
  }
  private makePrim(m: Mesh): Cesium.Primitive | null {
    return m.empty || !appearance ? null : this.viewer.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: m.toGeometry() }), appearance: appearance.appearance, asynchronous: false,
      compressVertices: false, interleave: false, vertexCacheOptimize: false, allowPicking: false, releaseGeometryInstances: true, shadows: Cesium.ShadowMode.DISABLED, show: true,
    })) as Cesium.Primitive;
  }
  /** Rebuild only the building meshes (a building was destroyed or its rubble finished): roads, trees and the rest stay. */
  async rebuildBuildings(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      do {
        const my = this.gen, st = currentStyles();
        if (!st || !this.area || !this.ground || this.dead || this.generating || !appearance) return;
        await tick();
        if (this.dead || my !== this.gen || this.generating) return;
        const bm = buildBuildings(this.area.buildings, this.ref, this.ground, st, marksFor(this.ref), this.atlas, { hide: this.rub.hideFn() });
        const show = this.minor ? this.minor.show : true, sc = this.viewer.scene;
        const old = [this.major, this.minor];
        this.major = this.makePrim(bm.major); this.minor = this.makePrim(bm.minor);
        if (this.minor) this.minor.show = show;
        for (const p of old) if (p) sc.primitives.remove(p);
        Object.assign(this.stats, { buildings: bm.stats.count, majorBuildings: bm.stats.major, tris: bm.stats.tris, styles: bm.stats.byStyle });
        this.viewer.scene.requestRender();
      } while (this.rub.needsRebuild());
    } catch (e) { console.warn('city3d rebuildBuildings', this.ref.key, e); } finally { this.rebuilding = false; }
  }
  private async generateInner(st: Styles, my: number, scene: Cesium.Scene, r: TileRef, area: VectorArea, ground: Ground, t0: number, stale: () => boolean): Promise<void> {
    this.clearGenerated();
    await tick();
    if (stale()) return;
    const atlas = await loadAtlas(st);
    if (stale()) return;
    this.atlas = atlas;
    const sig = `${atlas?.sig ?? ''}|${opacityDebug.legacy}`;
    if (!appearance || appearanceSig !== sig) { appearance = cityAppearance(scene, atlas); appearanceSig = sig; }
    const prim = (m: Mesh) => m.empty ? null : scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: m.toGeometry() }), appearance: appearance!.appearance, asynchronous: false,
      compressVertices: false, interleave: false, vertexCacheOptimize: false, allowPicking: false, releaseGeometryInstances: true, shadows: Cesium.ShadowMode.DISABLED, show: true,
    })) as Cesium.Primitive;
    const T: Record<string, number> = {};
    let tm = performance.now();
    const lap = (k: string) => { const n = performance.now(); T[k] = Math.round(n - tm); tm = n; };
    const bm = buildBuildings(area.buildings, r, ground, st, marksFor(r), atlas, { hide: this.rub.hideFn() });
    Object.assign(this.stats, { buildings: bm.stats.count, majorBuildings: bm.stats.major, tris: bm.stats.tris, styles: bm.stats.byStyle });
    lap('bld');
    this.major = prim(bm.major); this.minor = prim(bm.minor);
    lap('prim');
    await tick();
    tm = performance.now();
    if (stale()) { this.clearGenerated(); return; }
    // detailed battle view: own ground textures instead of the satellite photo, at a finer raster
    const own = mode.tactical ? await loadGroundTextures() : null;
    if (stale()) { this.clearGenerated(); return; }
    this.ownGround = !!own;
    const rd = drawRoads(area, r, this.roadPx, st, own); // same raster size as the normal view: the close-up detail comes from the 3D grass
    this.stats.roads = rd.stats.segments;
    lap('roadRaster');
    const br = buildBridges(area.roads, r, ground, rd.stats, st), inf = buildInfra(area, r, ground, st);
    this.stats.bridges = rd.stats.bridges; this.stats.infra = inf.count;
    this.bridges = prim(br); const ip = prim(inf.mesh);
    if (ip) this.infraPrim = ip;
    lap('bridges');
    lap('bridges');
    const prov = canvasTileProvider(rd.canvas, Cesium.Rectangle.fromDegrees(r.west, r.south, r.east, r.north));
    if (stale()) { this.clearGenerated(); return; }
    this.roadLayer = this.viewer.imageryLayers.addImageryProvider(prov);
    lap('png'); this.stats.t = T;
    this.planes = new AirportPlanes(scene, r, area, ground);
    void this.planes.sync();
    this.marks = new PlaceMarks(scene, r, area, ground);
    this.stats.genMs = Math.round(performance.now() - t0);
  }
  private infraPrim: Cesium.Primitive | null = null;
  private clearGenerated() {
    const sc = this.viewer.scene;
    for (const p of [this.major, this.minor, this.bridges, this.infraPrim]) if (p) sc.primitives.remove(p);
    this.major = this.minor = this.bridges = this.infraPrim = null;
    this.rub.reset();
    if (this.roadLayer) this.viewer.imageryLayers.remove(this.roadLayer, true);
    this.roadLayer = null;
    this.dropTrees();
    this.planes?.dispose(); this.planes = null;
    this.marks?.dispose(); this.marks = null;
  }
  /** Styles changed: regenerate this tile from its cached data. */
  async regenerate(st: Styles) { if (this.state === 'ready') { await this.generate(st); this.rub.sync(); } this.viewer.scene.requestRender(); }
  /** The destroyed-buildings store changed. */
  syncRuins() { this.rub.sync(); }

  /** Terrain level whose surface the trees stand on (follows the level Cesium draws under the tile). */
  treeLevel = groundLevel();
  private levelGround = new Map<number, Promise<Ground | null>>();
  private levelBusy = false;
  private groundOf(z: number): Promise<Ground | null> {
    if (z === groundLevel() && this.ground) return Promise.resolve(this.ground);
    let p = this.levelGround.get(z);
    if (!p) { p = loadGround(this.ref, () => !this.dead, z); this.levelGround.set(z, p); }
    return p;
  }
  /** Terrain level Cesium is drawing under this tile right now (null while undecided). One z14 tile always lies inside one terrain tile. */
  private async drawnLevel(): Promise<number | null> {
    const globe = this.viewer.scene.globe, pj = projector(this.ref), q = this.ref.sizeM * 0.3;
    const pts: [number, number][] = [[0, 0], [q, q], [-q, -q], [q, -q], [-q, q]];
    const drawn = pts.map(([x, y]) => { const [lo, la] = pj.lonLat(x, y); return globe.getHeight(Cesium.Cartographic.fromDegrees(lo, la)); });
    if (drawn.some((h) => h === undefined)) return null;
    let best: number | null = null, bestErr = Infinity;
    for (const z of [this.treeLevel, ...[14, 13, 12, 11, 10].filter((l) => l !== this.treeLevel)]) {
      const g = await this.groundOf(z);
      if (!g || this.dead) continue;
      const e = pts.reduce((s, [x, y], i) => s + Math.abs(g(x, y) - (drawn[i] as number)), 0) / pts.length;
      if (e < bestErr) { bestErr = e; best = z; }
      if (e < 0.5) break;
    }
    return bestErr < 2 ? best : null;
  }
  /** Re-seat the trees when Cesium switches the terrain level under the tile (otherwise they float or sink by up to ~30 m on hills). */
  async syncTreeLevel(st: Styles): Promise<void> {
    if (this.levelBusy || this.treeBusy || !this.trees || !this.treePts) return;
    this.levelBusy = true;
    try {
      const z = await this.drawnLevel();
      if (z === null || z === this.treeLevel || this.dead || !this.trees || this.treeBusy) return;
      const g = await this.groundOf(z);
      if (!g || this.dead || !this.trees || !this.treePts) return;
      this.treeLevel = z;
      for (const p of this.treePts) p.z = g(p.x, p.y);
      this.trees.reseat(); // the cells rebuild at their level on the next LOD pass
      void st;
    } catch (e) { console.warn('city3d tree level', this.ref.key, e); } finally { this.levelBusy = false; }
  }

  /** Place the trees of the tile (once per visit); the TreeLayer then builds each cell at the level its distance asks for. */
  async ensureTrees(st: Styles): Promise<void> {
    if (this.trees || this.treeBusy || this.state !== 'ready' || !this.area || !this.ground) return;
    this.treeBusy = true;
    const my = this.gen;
    try {
      const g = (await this.groundOf(this.treeLevel)) ?? this.ground;
      if (this.dead || my !== this.gen || !this.area) return;
      if (!this.treePts) {
        if (performance.now() < this.vegRetryAt) return;
        const veg = await loadVegetation(this.ref, () => !this.dead);
        if (this.dead || my !== this.gen || !this.area) return;
        // photo source up but images missing: no trees yet, try again in a few seconds (never fall back to polygons only)
        if (veg === 'retry') { this.vegRetryAt = performance.now() + 8000; return; }
        this.veg = veg;
        this.stats.vegCover = veg ? Math.round(veg.cover * 100) / 100 : -1;
        this.treePts = placeTrees(this.area, this.ref, g, this.maxTrees, st, veg, airfieldsIn(this.ref));
      }
      this.stats.treePts = this.treePts.length;
      this.stats.treeSp = {};
      for (const q of this.treePts) this.stats.treeSp[q.sp] = (this.stats.treeSp[q.sp] ?? 0) + 1;
      await tick();
      if (this.dead || my !== this.gen) return;
      this.trees = new TreeLayer(this.viewer.scene, this.ref, this.treePts, st);
    } catch (e) { console.warn('city3d trees', this.ref.key, e); } finally { this.treeBusy = false; this.viewer.scene.requestRender(); }
  }
  dropTrees() { if (this.trees) { this.trees.dispose(); this.trees = null; } this.stats.trees = 0; this.treePts = null; }

  dispose() {
    this.dead = true;
    LIVE.delete(this);
    this.marks?.dispose(); this.marks = null;
    this.clearGenerated();
    if (this.state === 'ready' && this.area && this.ground) {
      dataCache.set(this.ref.key, { area: this.area, ground: this.ground, source: this.stats.source });
      while (dataCache.size > DATA_CACHE_MAX) dataCache.delete(dataCache.keys().next().value as string);
    }
    this.area = null; this.ground = null;
  }
}
