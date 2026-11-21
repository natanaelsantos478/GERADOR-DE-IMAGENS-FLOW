/** City 3D by visible area: real buildings (extruded footprints), roads draped on the terrain and instanced trees, loaded per z14 tile around the camera focus. */
import * as Cesium from 'cesium';
import { getQuality } from '../globe/quality';
import type { Globe } from '../globe/types';
import { mode } from '../units/common';
import { ATTRIBUTION, CITY_CONFIG } from './config';
import { projector, tileRef, tileXY, TZ } from './geo';
import { landmarks, LandmarkLayer, loadLandmarks } from './landmarks';
import { onRuins, pinRuins } from './ruins';
import { loadStyles, onStylesChange, reloadStyles, styles } from './styles';
import { opacityDebug } from './appearance';
import { cachedTiles, CityTile, sharedAppearance, tallBuildings, nearBuildings } from './tile';
import { forceTreeLod, inPolyEvenOdd, lastDiag } from './trees';
import { setVegetationImagery } from './vegetation';
import { GrassField } from './grass';

export interface City3DStats {
  active: boolean; agl: number; tiles: number; ready: number; loading: number; failed: number;
  buildings: number; trees: number; treeModels: number; /** triangles of the drawn tree instances */ treeTris: number; /** cells per tree detail level [full, mid, impostor] */ treeLods: number[]; /** green share of each tile on the satellite photo */ vegCover: number[]; /** civil aircraft parked at airport gates */ planes: number; /** trees standing at 0 m (sea / water): must stay 0 */ treesAtSeaLevel: number; /** per tile: cell rebuilds / terrain re-seats */ treeRebuilds: string[];
  /** median / p90 frame time (ms) over the last ~120 rendered frames */ frameMs: { med: number; p90: number }; roadSegments: number; bridges: number; tris: number;
  cover: Record<string, number>; treePts: number; treeSp: Record<string, number>; landmarks: number; loadMs: number[]; genMs: number[]; source: string[]; cachedTiles: number; timings: Record<string, number>[]; styleUse: Record<string, number>; stylesLoaded: boolean;
}
export interface City3D {
  active(): boolean;
  stats(): City3DStats;
  /** Resolves when no tile is loading or being built (tests). */
  idle(timeoutMs?: number): Promise<boolean>;
  /** Re-evaluate the visible area now. */
  update(): void;
  /** Re-read public/data/styles/*.json now and regenerate the visible tiles (also automatic in dev when a file changes). */
  reloadStyles(force?: boolean): Promise<boolean>;
  /** Test/debug: freeze every building collapse at progress p (0..1); null follows the battle clock. */
  pinRuins(p: number | null): void;
  /** Destruction state of the visible tiles: buildings hidden, ruins finished, collapses playing, rubble triangles. */
  ruinStats(): { hidden: number; done: number; animating: number; tris: number; matched: number; nearest: number };
  /** Test/debug: per tile, what its ruin hiding did (tile key, ruins touching it, matched buildings, nearest centroid to the first ruin, tile state). */
  ruinTiles(): { tile: string; state: string; stats: unknown }[];
  /** Test/debug: the tallest big buildings of the loaded tiles (lon/lat of the footprint centre). */
  tall(n?: number): { lon: number; lat: number; h: number; area: number }[];
  /** Test/debug: rebuild the material as it was before the opacity fix (legacy = true) or as shipped, regenerating the visible tiles. */
  legacyBlend(legacy: boolean): Promise<void>;
  /** Test/debug: hide a magenta box inside the building at lon/lat (lower than its walls) and frame its facade from outside. */
  hiddenProbe(t: { lon: number; lat: number; h: number; area: number }): void;
  /** Test/debug: footprints of the loaded tiles closest to a point. */
  near(lon: number, lat: number, n?: number): ReturnType<typeof nearBuildings>;
  /** Test/debug: tree base vs the terrain Cesium draws (m; positive = floating), over up to `n` trees per tile. */
  /** Test/debug: at a point, the photo green (here / ~60 m around), trees planted within `r` m and why the tile's candidates were dropped. */
  treeDebug(lon: number, lat: number, r?: number): unknown;
  /** Test/debug: every visible tree at one detail level (0 full, 1 mid, 3 impostor) or by distance (null). */
  forceTreeLod(l: 0 | 1 | 3 | null): void;
  treeFit(n?: number): { tiles: { key: string; level: number; trees: number }[]; samples: number; floatP90: number; floatMax: number; sinkP90: number };
  /** Grass tufts around the camera (pattern: public/data/styles/grass.json); `setObstacles` keeps the footprint of vehicles / ruins clear. */
  grass: GrassField;
  destroy(): void;
}

let current: City3D | null = null;
/** The running 3D city (null before the globe mounts): the detailed battle view waits on it while loading. */
export const currentCity3D = () => current;

export function attachCity3D(globe: Globe): City3D {
  const viewer = globe.viewer, scene = viewer.scene, cam = viewer.camera;
  setVegetationImagery(() => globe.imageryProvider());
  const tiles = new Map<string, CityTile>();
  const grass = new GrassField(viewer, () => tiles.values());
  const credit = new Cesium.Credit(ATTRIBUTION, true);
  let ready = false, on = false, offSince = 0, destroyed = false, hidRoads = false, agl = Infinity, running = 0;
  const loadMs: number[] = [];
  const queue: CityTile[] = [];
  const lm = new LandmarkLayer(viewer, (lo, la) => globe.heightAt(lo, la));
  const cfg = () => CITY_CONFIG[getQuality().id];
  const c2 = new Cesium.Cartesian2(), cg = new Cesium.Cartographic();

  function focus(): { lon: number; lat: number; dist: number } | null {
    c2.x = scene.canvas.clientWidth / 2; c2.y = scene.canvas.clientHeight / 2;
    const ray = cam.getPickRay(c2);
    const hit = (ray && scene.globe.pick(ray, scene)) || (ray && cam.pickEllipsoid(c2, scene.globe.ellipsoid)) || undefined;
    const p = cam.positionCartographic;
    if (!p) return null;
    if (hit) { const q = Cesium.Cartographic.fromCartesian(hit, undefined, cg); return { lon: Cesium.Math.toDegrees(q.longitude), lat: Cesium.Math.toDegrees(q.latitude), dist: Cesium.Cartesian3.distance(cam.positionWC, hit) }; }
    return { lon: Cesium.Math.toDegrees(p.longitude), lat: Cesium.Math.toDegrees(p.latitude), dist: p.height };
  }

  function setActive(v: boolean) {
    if (v === on) return;
    on = v;
    if (v) {
      viewer.creditDisplay.addStaticCredit(credit);
      // the stylised globe road layer would draw wide misaligned stripes under the real roads
      if (globe.isLayerVisible('roads')) { globe.setLayerVisible('roads', false); hidRoads = true; }
    } else {
      viewer.creditDisplay.removeStaticCredit(credit);
      if (hidRoads) { globe.setLayerVisible('roads', true); hidRoads = false; }
      for (const t of tiles.values()) t.dispose();
      tiles.clear(); queue.length = 0; grass.clear();
    }
    scene.requestRender();
  }

  function pump() {
    const c = cfg();
    const st = styles();
    while (st && running < c.concurrency && queue.length) {
      const t = queue.shift()!;
      if (t.dead) continue;
      running++;
      void t.load(st).then(() => { running--; if (t.state === 'ready') loadMs.push(t.stats.loadMs); applyLod(); pump(); });
    }
  }

  function update() {
    if (destroyed) return;
    const c = cfg(), p = cam.positionCartographic;
    if (!p || !Number.isFinite(p.height)) return;
    agl = p.height - Math.max(0, globe.heightAt(Cesium.Math.toDegrees(p.longitude), Cesium.Math.toDegrees(p.latitude)));
    const limit = mode.tactical ? c.enableHTac : c.enableH, now = performance.now();
    if (ready) lm.update(15_000 * (getQuality().id === 'mobile' ? 0.5 : getQuality().id === 'low' ? 0.7 : 1));
    if (!styles() || !ready) return;
    // entering / leaving the detailed battle view: the loaded tiles swap the satellite photo for the own ground (or back)
    for (const t of tiles.values()) if (t.state === 'ready' && !t.generating && t.ownGround !== mode.tactical) void t.regenerate(styles()!).then(applyLod);
    if (agl > limit) { if (!offSince) offSince = now; if (on && now - offSince > 2500) setActive(false); return; }
    offSince = 0;
    if (!on) setActive(true);
    const f = focus();
    if (!f) return;
    const R = Math.min(6500, Math.max(900, f.dist * 0.95)), [fx, fy] = tileXY(f.lon, f.lat, TZ);
    const mPer = (2 * Math.PI * 6378137 * Math.cos((f.lat * Math.PI) / 180)) / 2 ** TZ, rt = Math.ceil(R / mPer) + 1;
    const cand: { x: number; y: number; d: number }[] = [];
    for (let y = Math.floor(fy) - rt; y <= Math.floor(fy) + rt; y++) for (let x = Math.floor(fx) - rt; x <= Math.floor(fx) + rt; x++) {
      const dx = Math.max(0, Math.abs(x + 0.5 - fx) - 0.5) * mPer, dy = Math.max(0, Math.abs(y + 0.5 - fy) - 0.5) * mPer, d = Math.hypot(dx, dy);
      if (d <= R) cand.push({ x, y, d: Math.hypot((x + 0.5 - fx) * mPer, (y + 0.5 - fy) * mPer) });
    }
    cand.sort((a, b) => a.d - b.d);
    const want = new Set(cand.slice(0, c.maxTiles).map((q) => `${q.x}/${q.y}`));
    for (const q of cand.slice(0, c.maxTiles)) {
      const k = `${q.x}/${q.y}`;
      let t = tiles.get(k);
      if (!t) { t = new CityTile(tileRef(q.x, q.y), viewer, c.roadPx, c.maxTreesPerTile); tiles.set(k, t); queue.push(t); }
      t.lastSeen = now;
    }
    // drop what left the view (grace period so small camera moves do not thrash), and cancel queued loads of unwanted tiles
    for (const [k, t] of tiles) if (t.state === 'failed' && now - t.lastSeen > 6000 && !t.failedAt) t.failedAt = now;
    for (const [k, t] of tiles) if ((t.failedAt && now - t.failedAt > 6000) || (!want.has(k) && now - t.lastSeen > 2500)) { t.dispose(); tiles.delete(k); }
    for (let i = queue.length - 1; i >= 0; i--) if (!want.has(queue[i].ref.key)) { queue[i].dispose(); tiles.delete(queue[i].ref.key); queue.splice(i, 1); }
    const order = (t: CityTile) => cand.find((q) => `${q.x}/${q.y}` === t.ref.key)?.d ?? 1e9;
    queue.sort((a, b) => order(a) - order(b));
    pump();
    applyLod();
  }

  /** Per-tile distance LOD: small buildings and the full tree set only near the camera. */
  function applyLod() {
    if (!on) return;
    const c = cfg(), cp = cam.positionWC;
    for (const t of tiles.values()) {
      if (t.state !== 'ready') continue;
      const d = Math.max(0, Cesium.Cartesian3.distance(cp, t.ref.origin) - t.ref.sizeM * 0.4);
      if (t.minor) t.minor.show = d < c.lodMinor;
      if (t.planes) { t.planes.show(d < c.lodMinor); void t.planes.sync(); }
      if (d < c.treeDist * 1.1) void t.ensureTrees(styles()!); else if (t.trees && d > c.treeDist * 1.8) t.dropTrees();
      // a camera low among the trees (tactical close-ups) would sit inside the crowns: hide the trees then
      const inCanopy = agl < 12; // only hide them when the camera is really inside the crowns
      // trees stand on the same ground surface as the buildings (no per-level re-seating: that made some float)
      if (t.trees) t.trees.update(cp, { near: c.treeNear, mid: c.treeMid, far: c.treeDist }, inCanopy);
    }
    grass.update();
    scene.requestRender();
  }

  // lit-window facade textures when the camera is on the night side (only with the day/night lighting on)
  const sunDir = new Cesium.Cartesian3(), up = new Cesium.Cartesian3();
  const offNight = scene.preRender.addEventListener(() => {
    const a = sharedAppearance();
    if (!a) return;
    let n = 0;
    if (scene.globe.enableLighting) {
      Cesium.Cartesian3.normalize(cam.positionWC, up);
      const d = Cesium.Cartesian3.dot(Cesium.Cartesian3.normalize((scene as any).context.uniformState.sunDirectionWC, sunDir), up);
      n = Math.min(1, Math.max(0, (0.12 - d) / 0.2));
    }
    a.setNight(n);
  });
  // frame interval of consecutive rendered frames (meaningful with continuous rendering on; tests/debug)
  const frames: number[] = []; let lastFrame = 0;
  const offFrame = scene.postRender.addEventListener(() => { const n = performance.now(); if (lastFrame && n - lastFrame < 1000) { frames.push(n - lastFrame); if (frames.length > 120) frames.shift(); } lastFrame = n; });
  const frameMs = () => { const s = [...frames].sort((a, b) => a - b); const q = (p: number) => (s.length ? Math.round(s[Math.floor(p * (s.length - 1))] * 10) / 10 : 0); return { med: q(0.5), p90: q(0.9) }; };
  const off = globe.onCamera(() => { update(); });
  const timer = setInterval(update, 900);
  const stop = scene.camera.moveEnd.addEventListener(update);
  const offRuins = onRuins(() => { for (const t of tiles.values()) t.syncRuins(); });
  const offStyles = onStylesChange((st) => { for (const t of tiles.values()) void t.regenerate(st).then(applyLod); });
  void Promise.all([loadLandmarks(), loadStyles()]).then(() => { ready = true; update(); }).catch((e) => console.warn('[city3d] styles unavailable, layer stays off:', (e as Error).message));
  const hot = import.meta.env.DEV ? setInterval(() => { if (on) void reloadStyles(); }, 2000) : 0;

  const api: City3D = {
    grass,
    reloadStyles: (force = true) => reloadStyles(force),
    active: () => on,
    update,
    pinRuins,
    near: (lon, lat, n = 4) => nearBuildings(tiles.values(), lon, lat, n),
    forceTreeLod(l) { forceTreeLod(l); applyLod(); },
    treeDebug(lon, lat, r = 120) {
      const [gx, gy] = tileXY(lon, lat, TZ), t = tiles.get(`${Math.floor(gx)}/${Math.floor(gy)}`);
      if (!t) return { tile: null };
      const x = (gx - (t.ref.x + 0.5)) * t.ref.sizeM, y = -(gy - (t.ref.y + 0.5)) * t.ref.sizeM;
      const near = (t.treePts ?? []).filter((p) => Math.hypot(p.x - x, p.y - y) < r);
      return { tile: t.ref.key, state: t.state, waterPolys: (t.area?.water ?? []).length, waterClasses: [...new Set((t.area?.water ?? []).map((w) => w.cls))], photo: !!t.veg, greenHere: t.veg ? +t.veg.at(x, y).toFixed(2) : null, greenAround: t.veg ? +t.veg.around(x, y, 30).toFixed(2) : null, treesWithin: near.length, species: [...new Set(near.map((p) => p.sp))], sample: near.slice(0, 6).map((p) => { const [lo, la] = projector(t.ref).lonLat(p.x, p.y); return { lon: +lo.toFixed(5), lat: +la.toFixed(5), z: +p.z.toFixed(1), green: t.veg ? +t.veg.at(p.x, p.y).toFixed(2) : null, water: (t.area?.water ?? []).filter((w) => inPolyEvenOdd(w, p.x, p.y)).map((w) => w.cls), around: t.veg ? +t.veg.around(p.x, p.y, 30).toFixed(2) : null, sp: p.sp }; }), tileDiag: t.treePts ? lastDiag.get(t.treePts) ?? null : null };
    },
    treeFit(n = 200) {
      const d: number[] = [], out: { key: string; level: number; trees: number }[] = [];
      for (const t of tiles.values()) {
        if (!t.trees || !t.treePts) continue;
        out.push({ key: t.ref.key, level: t.treeLevel, trees: t.treePts.length });
        const pj = projector(t.ref), step = Math.max(1, Math.floor(t.treePts.length / n));
        for (let i = 0; i < t.treePts.length; i += step) {
          const p = t.treePts[i], [lo, la] = pj.lonLat(p.x, p.y), h = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lo, la));
          if (h !== undefined) d.push(p.z - h);
        }
      }
      const up = d.map((x) => Math.max(0, x)).sort((a, b) => a - b), dn = d.map((x) => Math.max(0, -x)).sort((a, b) => a - b);
      const P = (a: number[], q: number) => (a.length ? Math.round(a[Math.floor(q * (a.length - 1))] * 100) / 100 : 0);
      return { tiles: out, samples: d.length, floatP90: P(up, 0.9), floatMax: P(up, 1), sinkP90: P(dn, 0.9) };
    },
    tall: (n = 5) => tallBuildings(tiles.values(), n),
    hiddenProbe(t) {
      const g = globe.heightAt(t.lon, t.lat);
      viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat, g + t.h * 0.3), box: { dimensions: new Cesium.Cartesian3(9, 9, t.h * 0.5), material: Cesium.Color.fromCssColorString('#ff00ff'), outline: false } });
      cam.lookAt(Cesium.Cartesian3.fromDegrees(t.lon, t.lat, g + t.h * 0.45), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(30), Cesium.Math.toRadians(-18), Math.max(140, Math.sqrt(t.area) * 2.4)));
      scene.requestRender();
    },
    async legacyBlend(legacy) { opacityDebug.legacy = legacy; await reloadStyles(true); },
    ruinTiles: () => [...tiles.values()].filter((t) => t.rub.stats.hidden > 0 || t.rub.stats.nearest >= 0).map((t) => ({ tile: t.ref.key, state: t.state, stats: t.rub.stats, ruins: t.rub.debug() })),
    ruinStats: () => [...tiles.values()].reduce((a, t) => ({ hidden: a.hidden + t.rub.stats.hidden, done: a.done + t.rub.stats.done, animating: a.animating + t.rub.stats.animating, tris: a.tris + t.rub.stats.tris, matched: a.matched + t.rub.stats.matched, nearest: Math.max(a.nearest, t.rub.stats.nearest) }), { hidden: 0, done: 0, animating: 0, tris: 0, matched: 0, nearest: -1 }),
    stats() {
      const all = [...tiles.values()];
      const sum = (f: (t: CityTile) => number) => all.reduce((s, t) => s + f(t), 0);
      return {
        active: on, agl: Math.round(agl), tiles: all.length, ready: all.filter((t) => t.state === 'ready').length, loading: all.filter((t) => t.state === 'loading').length, failed: all.filter((t) => t.state === 'failed').length,
        cover: all.reduce<Record<string, number>>((a, t) => { for (const [k, v] of Object.entries(t.stats.cover)) a[k] = (a[k] ?? 0) + v; return a; }, {}), treePts: sum((t) => t.stats.treePts), treeSp: all.reduce<Record<string, number>>((a, t) => { for (const [k, v] of Object.entries(t.stats.treeSp)) a[k] = (a[k] ?? 0) + v; return a; }, {}),
        buildings: sum((t) => t.stats.buildings), trees: sum((t) => t.trees?.stats().trees ?? 0), treeModels: sum((t) => t.trees?.stats().models ?? 0), treeTris: sum((t) => t.trees?.stats().tris ?? 0),
        vegCover: all.map((t) => t.stats.vegCover), planes: sum((t) => t.planes?.count ?? 0), treesAtSeaLevel: sum((t) => (t.treePts ?? []).filter((p) => p.z <= 0.3).length), treeRebuilds: all.map((t) => `${t.trees?.stats().rebuilds ?? 0}/${t.trees?.stats().reseats ?? 0}`),
        treeLods: all.reduce((a, t) => { const l = t.trees?.stats().lods; if (l) l.forEach((v, i) => (a[i] += v)); return a; }, [0, 0, 0]), frameMs: frameMs(), roadSegments: sum((t) => t.stats.roads), bridges: sum((t) => t.stats.bridges), tris: sum((t) => t.stats.tris),
        landmarks: lm.count(), loadMs: loadMs.slice(-12), genMs: all.map((t) => t.stats.genMs).filter(Boolean), source: [...new Set(all.map((t) => t.stats.source).filter(Boolean))], cachedTiles: cachedTiles(), timings: all.map((t) => t.stats.t).filter((x) => x.bld !== undefined), stylesLoaded: !!styles(),
        styleUse: all.reduce<Record<string, number>>((a, t) => { for (const [k, v] of Object.entries(t.stats.styles)) a[k] = (a[k] ?? 0) + v; return a; }, {}),
      };
    },
    async idle(timeoutMs = 120_000) {
      const end = performance.now() + timeoutMs;
      while (performance.now() < end) {
        update();
        const busy = [...tiles.values()].some((t) => t.state === 'loading' || t.treeBusy) || queue.length;
        if (!busy && on) { await new Promise((r) => setTimeout(r, 400)); if (![...tiles.values()].some((t) => t.state === 'loading' || t.treeBusy)) return true; }
        await new Promise((r) => setTimeout(r, 300));
      }
      return false;
    },
    destroy() {
      destroyed = true; if (current === api) current = null; lm.destroy(); offNight(); offFrame(); off(); offStyles(); offRuins(); if (hot) clearInterval(hot); clearInterval(timer); stop();
      setActive(false); grass.destroy();
    },
  };
  current = api;
  return api;
}
export { CITY_CONFIG } from './config';
