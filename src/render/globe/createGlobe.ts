import * as Cesium from 'cesium';
import type { BBox, CountryId, GeoFeature, ProvinceId, WorldStatic } from '../../core/contracts';
import type { Game } from '../../core/game';
import { configureCamera, cameraState, flyToPoint, flyToRect, installKeyboard, MAX_HEIGHT, setViewPoint } from './camera';
import { createCanvasImagery } from './canvasProvider';
import { createTerrariumTerrain } from './terrain';
import { chooseSource, nextSource, offlineProvider, onlineProvider, type ImageryKind } from './imagery';
import { GlobeInput } from './input';
import { createBuiltinModes, toMode } from './mapModes';
import { markerFeature, Markers } from './markers';
import { createMinimap } from './minimap';
import { createReliefImagery } from './relief';
import { accessKeys } from './settings';
import { SwapLayer } from './swapLayer';
import type { CameraState, FlyOptions, Globe, GlobeOptions, LayerId, MapMode, MapModeContext, MapModeDef, PickableResolver, PickResult } from './types';
import { bordersDraw, buildIndex, css, FillPainter, HighlightPainter, RoadPainter } from './vector';

const SIM_EPOCH = Cesium.JulianDate.fromDate(new Date(Date.UTC(2026, 0, 1)));
const CREDITS = [
  'Imagens: Esri World Imagery · EOX Sentinel-2 cloudless 2020 · Natural Earth II',
  'Terreno: Mapzen Terrarium (SRTM/GMTED/ETOPO1) via AWS Open Data',
  'Dados: Natural Earth · WRI Global Power Plant Database · Banco Mundial · CesiumJS',
];
const ALL_LAYERS: LayerId[] = ['fill', 'countryBorders', 'provinceBorders', 'roads', 'railways', 'countryLabels', 'cities', 'cityLabels', 'plants', 'airports', 'ports'];

export function createGlobe(container: HTMLElement, world: WorldStatic, opts: GlobeOptions = {}): Globe {
  Cesium.Ion.defaultAccessToken = ''; // never fall back to the shared demo token
  const lang = opts.language ?? 'pt';
  const getGame = (): Game | null => opts.getGame?.() ?? null;

  const creditBox = document.createElement('div');
  Object.assign(creditBox.style, { position: 'absolute', left: '8px', bottom: '4px', maxWidth: '420px', fontSize: '10px', opacity: '0.75', zIndex: '4' });
  container.appendChild(creditBox);

  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    terrainProvider: createTerrariumTerrain(),
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, vrButton: false,
    shouldAnimate: false,
    requestRenderMode: opts.requestRenderMode ?? true,
    maximumRenderTimeChange: Infinity,
    creditContainer: creditBox,
    contextOptions: { webgl: { powerPreference: 'high-performance' } },
  });
  const scene = viewer.scene;
  const globe = scene.globe;
  viewer.resolutionScale = opts.resolutionScale ?? Math.min(2, window.devicePixelRatio || 1);
  globe.baseColor = Cesium.Color.fromCssColorString('#0c2133');
  globe.showGroundAtmosphere = true;
  globe.depthTestAgainstTerrain = false; // markers stay readable over relief; model layers may override
  globe.maximumScreenSpaceError = 2.2;
  globe.enableLighting = !!opts.dayNight;
  scene.backgroundColor = Cesium.Color.fromCssColorString('#020409');
  scene.highDynamicRange = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  configureCamera(viewer);
  for (const c of CREDITS) viewer.creditDisplay.addStaticCredit(new Cesium.Credit(c, false));
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-35, 12, 2.4e7) });

  // ------------------------------------------------------------ imagery layers (bottom → top)
  const layers = viewer.imageryLayers;
  const ne2 = Cesium.ImageryLayer.fromProviderAsync(offlineProvider());
  layers.add(ne2);
  let kind: ImageryKind = 'esri';
  let failures = 0;
  let failStart = 0;
  const makeSat = () => {
    const p = onlineProvider(kind === 'eox' ? 'eox' : 'esri');
    p.errorEvent.addEventListener(() => {
      const now = performance.now();
      if (now - failStart > 12000) {
        failStart = now;
        failures = 0;
      }
      if (++failures >= 8) failover();
    });
    return p;
  };
  const sat = new SwapLayer(viewer, makeSat);
  const tint = new SwapLayer(viewer, () => createReliefImagery('tint'), { show: false });
  const gray = new SwapLayer(viewer, () => createReliefImagery('gray'), { show: false });
  function failover() {
    failures = 0;
    const n = nextSource(kind);
    if (!n) return;
    kind = n;
    if (n === 'offline') sat.setShow(false);
    else sat.refresh();
    applyBase();
  }
  void chooseSource().then((k) => {
    if (k === kind || destroyed) return;
    kind = k;
    if (k === 'offline') sat.setShow(false);
    else sat.refresh();
    applyBase();
  });

  // ------------------------------------------------------------ modes
  const modes = new Map<string, MapMode>();
  for (const m of createBuiltinModes(world)) modes.set(m.id, m);
  let current = 'satellite';
  const modeListeners = new Set<(id: string) => void>();
  const vis = Object.fromEntries(ALL_LAYERS.map((l) => [l, true])) as Record<LayerId, boolean>;
  const modeCtx = (): MapModeContext => {
    const game = getGame();
    const owner = game?.state.world.owner;
    return { game, countryOf: (pid) => owner?.[pid] ?? world.provinceById.get(pid)?.countryId ?? null };
  };

  // ------------------------------------------------------------ vector layers (built after first paint)
  let fills: SwapLayer | null = null;
  let fillPainter: FillPainter | null = null;
  let provBorders: SwapLayer | null = null;
  let countryBorders: SwapLayer | null = null;
  let highlightLayer: SwapLayer | null = null;
  let hlPainter: HighlightPainter | null = null;
  let roadsLayer: SwapLayer | null = null;
  let roadPainter: RoadPainter | null = null;
  let roadsBuilding = false;
  let destroyed = false;

  function applyBase() {
    const m = modes.get(current)!;
    ne2.show = m.base === 'satellite';
    sat.setShow(m.base === 'satellite' && kind !== 'offline');
    tint.setShow(m.base === 'relief');
    gray.setShow(m.base === 'shade');
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  function paintFills() {
    const m = modes.get(current)!;
    applyBase();
    if (!fills || !fillPainter) return;
    if (!m.colorOfProvince || !vis.fill) {
      fills.setShow(false);
      return;
    }
    const ctx = modeCtx();
    m.prepare?.(ctx);
    fillPainter.colors.clear();
    fillPainter.hatch.clear();
    for (const p of world.provinces) {
      const c = m.colorOfProvince(p.id, ctx);
      if (c && c[3] > 0.02) fillPainter.colors.set(p.id, css(c));
    }
    const dyn = ctx.game?.state.world;
    if (dyn && m.hatchOccupation !== false) {
      for (const [pid, ctl] of Object.entries(dyn.controller)) {
        if (ctl !== dyn.owner[pid]) {
          const col = world.countryById.get(ctl)?.color;
          if (col && fillPainter.colors.has(pid)) fillPainter.hatch.set(pid, css([col[0] * 0.55 + 60, col[1] * 0.55 + 60, col[2] * 0.55 + 60]));
        }
      }
    }
    fills.setShow(true);
    fills.setAlpha(m.base === 'satellite' ? 0.45 : 0.72);
    fills.refresh();
  }
  function scheduleFills(ms = 400) {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      paintFills();
    }, ms);
  }

  const provFeat = new Map<string, GeoFeature>(world.provincesGeo.features.map((f) => [f.properties.id, f]));
  const countryFeat = new Map<string, GeoFeature>(world.countriesGeo.features.map((f) => [f.properties.id, f]));
  const hl = { select: { p: [] as string[], c: [] as string[] }, hover: { p: [] as string[], c: [] as string[] } };

  function initVectors() {
    if (destroyed) return;
    fillPainter = new FillPainter(world.provincesGeo);
    const fp = fillPainter;
    fills = new SwapLayer(viewer, () => createCanvasImagery({ size: 512, maxLevel: 12, draw: fp.draw }), { alpha: 0.7, show: false });
    const pIndex = buildIndex(world.provincesGeo);
    const cIndex = buildIndex(world.countriesGeo);
    provBorders = new SwapLayer(viewer, () => createCanvasImagery({ size: 512, maxLevel: 15, draw: bordersDraw(pIndex, 'province') }), { show: vis.provinceBorders });
    countryBorders = new SwapLayer(viewer, () => createCanvasImagery({ size: 512, maxLevel: 15, draw: bordersDraw(cIndex, 'country') }), { show: vis.countryBorders });
    hlPainter = new HighlightPainter((id) => provFeat.get(id), (id) => countryFeat.get(id));
    const hp = hlPainter;
    highlightLayer = new SwapLayer(viewer, () => createCanvasImagery({ size: 512, maxLevel: 15, draw: hp.draw }), { show: false });
    paintFills();
    scene.requestRender();
  }
  setTimeout(initVectors, 30);

  function ensureRoads() {
    if (roadPainter || roadsBuilding || destroyed) return;
    roadsBuilding = true;
    setTimeout(() => {
      if (destroyed) return;
      const r = world.roads;
      const lines: { cls: number; coords: number[][] }[] = [];
      for (let e = 0; e < r.edgeCount; e++) {
        const s = r.edgeGeomStart[e], n = r.edgeGeomLen[e];
        const coords: number[][] = new Array(n);
        for (let k = 0; k < n; k++) coords[k] = [r.geom[(s + k) * 2], r.geom[(s + k) * 2 + 1]];
        lines.push({ cls: r.edgeCls[e], coords });
      }
      roadPainter = new RoadPainter(lines);
      syncRoadDamage(false);
      const rp = roadPainter;
      roadPainter.showRoads = vis.roads;
      roadPainter.showRail = vis.railways;
      roadsLayer = new SwapLayer(viewer, () => createCanvasImagery({ size: 512, maxLevel: 14, draw: rp.draw }), { show: vis.roads || vis.railways });
      scene.requestRender();
    }, 0);
  }
  function syncRoadDamage(refresh = true) {
    const d = getGame()?.state.world.roadDamage;
    const lines: number[][][] = [];
    if (d) {
      for (const [e, v] of Object.entries(d)) {
        if (v < 0.15) continue;
        const g = world.roads.edgeGeometry(+e);
        if (g.length > 1) lines.push(g);
      }
    }
    roadPainter?.setDamaged(lines);
    if (refresh) roadsLayer?.refresh();
  }

  // ------------------------------------------------------------ markers
  const markers = new Markers(viewer, world, lang);
  void markers.build().then(() => {
    if (destroyed) return;
    markers.syncDamage(getGame()?.state.world ?? null);
    for (const l of ['countryLabels', 'cities', 'cityLabels', 'plants', 'airports', 'ports'] as LayerId[]) markers.setVisible(l, vis[l]);
  });

  // ------------------------------------------------------------ pick & events
  const resolvers = new Set<PickableResolver>();
  const tmp2 = new Cesium.Cartesian2();
  function pick(x: number, y: number): PickResult {
    tmp2.x = x;
    tmp2.y = y;
    let feature: PickResult['feature'];
    const picked = scene.pick(tmp2) as { primitive?: unknown; id?: unknown } | undefined;
    if (picked) {
      for (const r of resolvers) if ((feature = r(picked))) break;
      feature ??= markerFeature(picked);
    }
    const ray = viewer.camera.getPickRay(tmp2);
    const hit = ray ? globe.pick(ray, scene) : undefined;
    let lonLat: PickResult['lonLat'] = null;
    if (hit) {
      const c = Cesium.Cartographic.fromCartesian(hit);
      lonLat = [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
    }
    const provinceId = lonLat ? world.nearestProvince(lonLat[0], lonLat[1], 3) : null;
    const countryId = provinceId ? (getGame()?.state.world.owner[provinceId] ?? world.provinceById.get(provinceId)?.countryId ?? null) : null;
    return { lonLat, provinceId, countryId, feature };
  }
  const input = new GlobeInput(viewer.canvas, container, pick);

  // ------------------------------------------------------------ camera events / minimap
  const camListeners = new Set<(s: CameraState) => void>();
  const minimap = createMinimap(
    world,
    (lon, lat) => setView(lon, lat, { height: Math.min(cameraHeight(), 2.5e7), pitchDeg: -90 }),
    () => cameraState(viewer),
  );
  let camTimer: ReturnType<typeof setTimeout> | null = null;
  function onCameraChange() {
    if (camTimer) return;
    camTimer = setTimeout(() => {
      camTimer = null;
      if (destroyed) return;
      const s = cameraState(viewer);
      markers.ensureLazyLabels(s.height);
      if (s.height < 5e6) ensureRoads();
      minimap.redraw();
      camListeners.forEach((f) => f(s));
    }, 90);
  }
  viewer.camera.changed.addEventListener(onCameraChange);
  viewer.camera.moveEnd.addEventListener(onCameraChange);
  const offKeys = opts.keyboard === false ? () => {} : installKeyboard(viewer, container);
  setTimeout(() => !destroyed && minimap.redraw(), 200);

  // ------------------------------------------------------------ game events
  let busOff: (() => void)[] = [];
  let roadTimer: ReturnType<typeof setTimeout> | null = null;
  function bindGame() {
    busOff.forEach((f) => f());
    busOff = [];
    const g = getGame();
    markers.syncDamage(g?.state.world ?? null);
    if (roadPainter) syncRoadDamage();
    if (g) {
      const dmg = (e: { kind: string; index: number; total: number }) => {
        if (e.kind === 'road') {
          if (!roadTimer)
            roadTimer = setTimeout(() => {
              roadTimer = null;
              syncRoadDamage();
            }, 1200);
        } else markers.setDamage(e.kind as 'city', e.index, e.total);
      };
      busOff.push(g.bus.on('world.damaged', dmg), g.bus.on('world.repaired', dmg));
      busOff.push(g.bus.on('world.controllerChanged', () => scheduleFills(600)), g.bus.on('world.ownerChanged', () => scheduleFills(600)));
      busOff.push(g.bus.on('time.day', () => { if (modes.get(current)?.dynamic) scheduleFills(100); }));
      busOff.push(g.bus.on('game.loaded', () => bindGame()));
      busOff.push(g.bus.on('time.day', (e) => { if (globe.enableLighting) api.setGameHours(e.hours); }));
    }
    paintFills();
  }
  bindGame();

  // ------------------------------------------------------------ misc helpers
  function cameraHeight() {
    return viewer.camera.positionCartographic.height;
  }
  const groundAt = (lon: number, lat: number) => heightAt(lon, lat);
  function heightAt(lon: number, lat: number): number {
    const h = globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
    return h ?? Math.max(0, world.elevationAt(lon, lat));
  }
  function setView(lon: number, lat: number, o: FlyOptions = {}) {
    setViewPoint(viewer, groundAt(lon, lat), lon, lat, o);
    scene.requestRender();
  }
  function setHighlight(slot: 'select' | 'hover', key: 'p' | 'c', ids: string | string[] | null) {
    const arr = ids === null ? [] : Array.isArray(ids) ? ids : [ids];
    const cur = hl[slot][key];
    if (arr.length === cur.length && arr.every((v, i) => v === cur[i])) return;
    hl[slot][key] = arr;
    if (!hlPainter || !highlightLayer) return;
    hlPainter.set(slot, { provinces: hl[slot].p, countries: hl[slot].c });
    highlightLayer.setShow(!hlPainter.isEmpty());
    if (!hlPainter.isEmpty()) highlightLayer.refresh();
  }

  async function applyAccessKeys() {
    const ion = accessKeys.ionToken();
    const gk = accessKeys.googleKey();
    try {
      if (ion) {
        Cesium.Ion.defaultAccessToken = ion;
        viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
        viewer.scene.primitives.add(await Cesium.createOsmBuildingsAsync());
      }
      if (gk) {
        Cesium.GoogleMaps.defaultApiKey = gk;
        viewer.scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset());
      }
    } catch (e) {
      console.warn('[globe] chave opcional rejeitada:', e);
    }
    scene.requestRender();
  }
  if (accessKeys.ionToken() || accessKeys.googleKey()) void applyAccessKeys();

  const api: Globe = {
    viewer,
    minimap,
    credits: CREDITS,
    imageryProvider: () => kind,
    flyTo: (lon, lat, o) => flyToPoint(viewer, groundAt(lon, lat), lon, lat, o),
    flyToBBox: (b: BBox, o) => flyToRect(viewer, b, o),
    setView,
    cameraState: () => cameraState(viewer),
    cameraHeight,
    onCamera(cb) {
      camListeners.add(cb);
      return () => camListeners.delete(cb);
    },
    pick,
    registerPickable(r) {
      resolvers.add(r);
      return () => resolvers.delete(r);
    },
    on: (t, cb) => input.on(t, cb),
    setMapMode(id) {
      const m = modes.get(id);
      if (!m || (m.available && !m.available(modeCtx()))) return false;
      current = id;
      paintFills();
      modeListeners.forEach((f) => f(id));
      return true;
    },
    currentMapMode: () => current,
    registerMapMode(id, def: MapModeDef) {
      modes.set(id, toMode(id, def));
    },
    mapModes() {
      const ctx = modeCtx();
      return [...modes.values()].map((m) => ({
        id: m.id, label: m.label, labelKey: m.labelKey,
        available: !m.available || m.available(ctx),
        legend: typeof m.legend === 'function' ? m.legend() : (m.legend ?? null),
      }));
    },
    refreshMapMode: () => scheduleFills(100),
    onMapModeChange(cb) {
      modeListeners.add(cb);
      return () => modeListeners.delete(cb);
    },
    setLayerVisible(id, v) {
      vis[id] = v;
      switch (id) {
        case 'fill': paintFills(); break;
        case 'countryBorders': countryBorders?.setShow(v); break;
        case 'provinceBorders': provBorders?.setShow(v); break;
        case 'roads':
        case 'railways':
          if (v) ensureRoads();
          if (roadPainter) {
            roadPainter.showRoads = vis.roads;
            roadPainter.showRail = vis.railways;
            roadsLayer?.setShow(vis.roads || vis.railways);
            roadsLayer?.refresh();
          }
          break;
        default: markers.setVisible(id, v);
      }
      scene.requestRender();
    },
    isLayerVisible: (id) => vis[id],
    highlightProvince: (ids: ProvinceId | ProvinceId[] | null, slot = 'select') => setHighlight(slot, 'p', ids),
    highlightCountry: (ids: CountryId | CountryId[] | null, slot = 'select') => setHighlight(slot, 'c', ids),
    heightAt,
    toScreen(lon, lat, h) {
      const p = Cesium.Cartesian3.fromDegrees(lon, lat, h ?? heightAt(lon, lat));
      if (!new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.positionWC).isPointVisible(p)) return null;
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p);
      return w ? { x: w.x, y: w.y } : null;
    },
    requestRender: () => scene.requestRender(),
    setContinuousRender(on) {
      scene.requestRenderMode = !on;
      scene.requestRender();
    },
    setGameHours(h) {
      viewer.clock.currentTime = Cesium.JulianDate.addHours(SIM_EPOCH, h, new Cesium.JulianDate());
      scene.requestRender();
    },
    setDayNight(on) {
      globe.enableLighting = on;
      globe.dynamicAtmosphereLighting = on;
      scene.requestRender();
    },
    refreshGame: bindGame,
    applyAccessKeys,
    destroy() {
      destroyed = true;
      busOff.forEach((f) => f());
      offKeys();
      input.destroy();
      markers.destroy();
      if (camTimer) clearTimeout(camTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (!viewer.isDestroyed()) viewer.destroy();
      creditBox.remove();
    },
  };
  void MAX_HEIGHT;
  return api;
}
