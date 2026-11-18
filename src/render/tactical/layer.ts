/** Tactical battle on the real globe: glb entities on terrain, projectiles, smoke, objectives, selection and orders. */
import { resolveModel } from '../models/variants';
import * as Cesium from 'cesium';
import type { Game } from '../../core/game';
import { setTacticalMapProvider } from '../../sim/tactical';
import type { Battle, Ent, Order } from '../../sim/tactical/types';
import { UNITS } from '../../sim/tactical/units';
import { battlePreviews } from '../../sim/military';
import type { Globe } from '../globe/types';
import { M_PER_DEG, ModelPool, assetUrl, clamp, lerpAngle, loadModelData, mode, renderEvents, renderLock, spriteCanvas, type ModelHandle } from '../units/common';
import { useTacSelection } from './store';
import { sampleGrid } from './terrain';
import { prepareTacticalVector } from '../../data/vector/prepare';
import type { NavData } from '../../data/vector/nav';
import { createTacCamera, type FocusOpts, type FocusTarget } from './camera';
import { attackOrder } from './attackOrder';
import { clusterScreen, type ClusterItem } from '../units/cluster';
import { setRuins, type Ruin } from '../city3d/ruins';
import { styles as cityStyles } from '../city3d/styles';

const SIDE_COLOR = ['#4da3ff', '#ff5a4d'] as const;
const C = Cesium.Color;
const V = (x: number, y: number) => new Cesium.Cartesian2(x, y);
const INF = Number.POSITIVE_INFINITY;
const SOLDIER_KINDS = new Set(['infantry', 'special', 'engineer']);
const MAX_ENTS = 900;

export interface TacticalLayer {
  active(): boolean;
  stats(): { shown: number; models: number; ents: number; proj: number; fx: number; clusters: number; clustered: number };
  /** Screen-space grouping of overlapping units into one count icon (default on). */
  setCluster(on: boolean): void;
  sample(n?: number): unknown[];
  /** Resolves when terrain heights for every current strategic battle are cached. */
  prefetch(): Promise<void>;
  /** Fly the camera to an entity, a squad or a battle point (metres from the centre). */
  focus(target: FocusTarget, o?: FocusOpts | number): boolean;
  frameField(durationS?: number): void;
  /** Test/debug: fire a muzzle flash / an explosion at battle coordinates, and slow effect lifetimes (k>1) so they can be captured. */
  muzzleAt(x: number, y: number, big?: number): void;
  explodeAt(x: number, y: number, r?: number): void;
  pinFx(on: boolean): void;
  /** Test/debug: freeze the age of the live effects (dust of a collapse stays on screen for a capture). */
  holdFx(on: boolean): void;
  tracerAt(x0: number, y0: number, x1: number, y1: number): void;
  ents(): { id: number; sq: number; side: number; kind: string; x: number; y: number; alive: boolean; shown: boolean; ready: boolean }[];
  destroy(): void;
}
interface E { cl?: boolean; mul?: number; pitch?: number; styled?: boolean; wreckAt?: number; smokeT?: number; dustT?: number; dot?: Cesium.Billboard; h: ModelHandle; x: number; y: number; hd: number; shoot: number; dead: boolean; wreck?: Cesium.Billboard; ent: Ent }
type FxKind = 'fire' | 'flame' | 'smoke' | 'dust' | 'flash' | 'debris';
interface Fx { b: Cesium.Billboard; t0: number; size: number; grow: number; life: number; lon: number; lat: number; h0: number; z: number; vx: number; vy: number; vz: number; kind: FxKind }
const MAX_FX = 240, MAX_CRATERS = 36;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function canvas(n: number) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')!] as const; }
/** Irregular billowing puff (several overlapping soft blobs) so smoke/dust does not look like a flat disc. */
function puffCanvas(rgb: [number, number, number]): HTMLCanvasElement {
  const [c, g] = canvas(96);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = i === 0 ? 0 : 14 + (i % 3) * 5, x = 48 + Math.cos(a) * r, y = 48 + Math.sin(a) * r, rad = 22 + (i % 4) * 3;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad), sh = 1 - (i % 3) * 0.1;
    gr.addColorStop(0, `rgba(${rgb[0] * sh | 0},${rgb[1] * sh | 0},${rgb[2] * sh | 0},0.55)`); gr.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
  }
  return c;
}
/** Muzzle flash / explosion core: white-hot centre, orange body, star spikes. */
function flashCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(64);
  g.translate(32, 32);
  g.fillStyle = 'rgba(255,170,60,0.9)';
  for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); g.beginPath(); g.moveTo(-3, 0); g.lineTo(0, -(i % 2 ? 20 : 31)); g.lineTo(3, 0); g.fill(); }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 20);
  gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.35, 'rgba(255,214,110,0.95)'); gr.addColorStop(1, 'rgba(255,110,20,0)');
  g.fillStyle = gr; g.fillRect(-32, -32, 64, 64);
  return c;
}
/** Fireball: white-hot core, yellow/orange body, red rim with a few licks; opaque enough to read over satellite imagery. */
function fireCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(96);
  const blob = (x: number, y: number, r: number, stops: [number, string][]) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 96, 96); };
  for (let i = 0; i < 6; i++) { const a = i * 1.05; blob(48 + Math.cos(a) * 16, 46 + Math.sin(a) * 14, 26, [[0, 'rgba(255,140,30,0.95)'], [0.6, 'rgba(220,70,10,0.7)'], [1, 'rgba(120,20,0,0)']]); }
  blob(48, 48, 28, [[0, 'rgba(255,255,230,1)'], [0.3, 'rgba(255,220,110,0.95)'], [1, 'rgba(255,120,20,0)']]);
  return c;
}
function debrisCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(16);
  g.fillStyle = '#2b2622'; g.beginPath(); g.moveTo(3, 2); g.lineTo(13, 5); g.lineTo(10, 14); g.lineTo(2, 10); g.closePath(); g.fill();
  g.fillStyle = '#5a4a3a'; g.fillRect(5, 4, 4, 3);
  return c;
}
/** Scorched ground decal: dark burnt rim, dark core, blast streaks. */
function craterCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(128);
  let gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(12,10,8,0.92)'); gr.addColorStop(0.45, 'rgba(24,19,15,0.78)'); gr.addColorStop(0.8, 'rgba(40,32,24,0.3)'); gr.addColorStop(1, 'rgba(40,32,24,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(15,12,10,0.4)'; g.lineWidth = 3;
  for (let i = 0; i < 14; i++) { const a = i * 0.9 + (i % 3), r0 = 18 + (i % 4) * 4; g.beginPath(); g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(64 + Math.cos(a) * (46 + (i % 5) * 4), 64 + Math.sin(a) * (46 + (i % 5) * 4)); g.stroke(); }
  gr = g.createRadialGradient(60, 60, 0, 64, 64, 22);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}

export function attachTacticalLayer(globe: Globe, getGame: () => Game | null): TacticalLayer {
  const viewer = globe.viewer, scene = viewer.scene;
  const cache = new Map<string, { heights: number[]; nav?: NavData | null }>();
  const key = (lon: number, lat: number) => `${lon.toFixed(3)},${lat.toFixed(3)}`;
  const pending = new Map<string, Promise<void>>();
  const prefetchAt = (lon: number, lat: number) => {
    const k = key(lon, lat);
    if (cache.has(k)) return Promise.resolve();
    let p = pending.get(k);
    if (!p) { p = sampleGrid(lon, lat).then(async (h) => {
      if (!h) return;
      cache.set(k, { heights: h });
      // real vector map (Overture / OpenFreeMap) BEFORE tac.start: the sim reads it synchronously from this cache
      // slow links (tests through a proxy) can raise the per-source budget with window.__vectorTimeoutMs
      const nav = await prepareTacticalVector(lon, lat, { heights: h, hn: 64, timeoutMs: (window as unknown as { __vectorTimeoutMs?: number }).__vectorTimeoutMs });
      cache.set(k, { heights: h, nav });
    }).finally(() => pending.delete(k)); pending.set(k, p); }
    return p;
  };
  // The sim asks for heights synchronously at `tac.start`; fall back to the rendered globe when the cache is cold.
  setTacticalMapProvider((lon, lat) => {
    const hit = cache.get(key(lon, lat));
    if (hit) return { heights: hit.heights, vectorArea: hit.nav ?? undefined };
    void prefetchAt(lon, lat);
    const n = 64, sizeM = 8000, cs = sizeM / n, mPer = M_PER_DEG * Math.cos((lat * Math.PI) / 180), cg = new Cesium.Cartographic();
    const hs: number[] = [];
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      Cesium.Cartographic.fromDegrees(lon + ((cx + 0.5) * cs - sizeM / 2) / mPer, lat + ((cy + 0.5) * cs - sizeM / 2) / M_PER_DEG, 0, cg);
      hs.push(Math.max(0, scene.globe.getHeight(cg) ?? 0));
    }
    return { heights: hs };
  });
  const timerPre = setInterval(() => {
    const g = getGame();
    if (g) for (const b of battlePreviews(g.ctx)) void prefetchAt(b.pos[0], b.pos[1]);
  }, 4000);

  // ------------------------------------------------------------ per-battle state
  let cur: { id: string; b: Battle; pool: ModelPool | null; ents: Map<number, E>; clat: number; clon: number; mPerLon: number } | null = null;
  let bills: Cesium.BillboardCollection, lines: Cesium.PolylineCollection, labels: Cesium.LabelCollection;
  const testLines: Cesium.Polyline[] = [];
  let fxs: Fx[] = [], craters: Cesium.Entity[] = [], wreckSmoke = 0, dustT = 0, projLines: Cesium.Polyline[] = [], seenProj = new Map<number, { x1: number; y1: number; kind: string; side: 0 | 1 }>();
  let objs: { pole: Cesium.Polyline; ring: Cesium.Polyline; flag: Cesium.Billboard; label: Cesium.Label; sig: string }[] = [];
  let deployLines: Cesium.Polyline[] = [];
  let hoverSq = -1, groundC = 0;
  // destroyed buildings (collapse + rubble in the city 3D) and marked routes
  const ruinCache = new Map<number, Ruin>(), ruinFx = new Map<number, { t: number; start: boolean; end: boolean; acc: number; blk: number; bp?: [number, number] }>();
  let ruinList: Ruin[] = [], ruinN = -1, held = false, heldNow = 0;
  const routeVis = new Map<number, { line: Cesium.Polyline; marks: Cesium.Billboard[]; sig: string; at: number }>();
  let navB: Map<number, import('../../data/vector/nav').NavBuilding> | null = null;
  const garrLines = new Map<number, { l: Cesium.Polyline; side: number }>();
  let squadLabels = new Map<number, Cesium.Label>(), selLines = new Map<number, { ring: Cesium.Polyline; ord: Cesium.Polyline }>();
  let smokeZones = new Map<string, Cesium.Billboard[]>();
  const squadMarks = new Map<number, Cesium.Billboard>();
  let saved: { mode: string; fill: boolean; light: Cesium.Light; roads: boolean } | null = null;
  let tcam: ReturnType<typeof createTacCamera> | null = null, pinned = false;
  const PIN_AGE: Record<FxKind, number> = { flash: 0.12, fire: 0.18, flame: 0.25, smoke: 0.4, dust: 0.35, debris: 0.3 };
  let mul = 1, last = performance.now(), nextShotEv = 0, wrecks = 0;
  const imgs = { flame: spriteCanvas([255, 190, 90], 1), smoke: puffCanvas([78, 76, 74]), dark: spriteCanvas([30, 30, 30], 0.9), dust: puffCanvas([168, 146, 112]), flash: flashCanvas(), fire: fireCanvas(), debris: debrisCanvas() };
  const craterImg = craterCanvas();
  const neutralFlag = (() => { const c = document.createElement('canvas'); c.width = 30; c.height = 20; const g = c.getContext('2d')!; g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, 30, 20); g.strokeStyle = '#555'; g.strokeRect(0.5, 0.5, 29, 19); return c; })();

  const KIND_LETTER: Record<string, string> = { infantry: 'I', special: 'S', engineer: 'E', mech: 'M', mbt: 'T', recon: 'R', artillery: 'A', mlrs: 'L', sam: 'D', logistics: 'U', attackHeli: 'H' };
  const markImgs = new Map<string, HTMLCanvasElement>();
  function markImg(side: number, kind: string, dot = false): [string, HTMLCanvasElement] {
    const k = `${dot ? 'd' : 'm'}${side}${kind}`;
    let c = markImgs.get(k);
    if (!c) {
      const z = dot ? 20 : 56;
      c = document.createElement('canvas'); c.width = c.height = z;
      const g = c.getContext('2d')!, col = SIDE_COLOR[side];
      g.beginPath();
      if (dot) { g.moveTo(z / 2, 1); g.lineTo(z - 2, z - 3); g.lineTo(2, z - 3); g.closePath(); } else g.roundRect(3, 3, z - 6, z - 6, 10);
      g.fillStyle = col; g.fill(); g.lineWidth = dot ? 2 : 4; g.strokeStyle = '#fff'; g.stroke();
      if (!dot) { g.fillStyle = '#fff'; g.font = '700 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4; g.strokeText(KIND_LETTER[kind] ?? '?', z / 2, z / 2 + 2); g.fillText(KIND_LETTER[kind] ?? '?', z / 2, z / 2 + 2); }
      markImgs.set(k, c);
    }
    return [k, c];
  }

  function resolveTarget(t: FocusTarget): { x: number; y: number } | null {
    if (!cur) return null;
    if ('ent' in t) { const e = cur.b.ents.find((q) => q.id === t.ent); return e ? { x: e.x, y: e.y } : null; }
    if ('squad' in t) { const q = cur.b.squads[t.squad]; return q ? { x: q.x, y: q.y } : null; }
    return t;
  }
  const ll = (x: number, y: number): [number, number] => [cur!.clon + x / cur!.mPerLon, cur!.clat + y / M_PER_DEG];
  const cg = new Cesium.Cartographic();
  function mapH(x: number, y: number): number {
    const m = cur!.b.map, cs = m.sizeM / m.n;
    const fx = clamp((x + m.sizeM / 2) / cs - 0.5, 0, m.n - 1.001), fy = clamp((y + m.sizeM / 2) / cs - 0.5, 0, m.n - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, H = m.heights;
    return (H[iy * m.n + ix] * (1 - tx) + H[iy * m.n + ix + 1] * tx) * (1 - ty) + (H[(iy + 1) * m.n + ix] * (1 - tx) + H[(iy + 1) * m.n + ix + 1] * tx) * ty;
  }
  /** Rendered terrain when loaded and plausible, else the sampled grid (the globe can report garbage for half-loaded tiles). */
  function hAt(x: number, y: number): number {
    const [lo, la] = ll(x, y);
    const h = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lo, la, 0, cg));
    const mh = mapH(x, y);
    return h === undefined || Math.abs(h - mh) > 250 ? mh : h;
  }
  const P = (x: number, y: number, up = 0) => { const [lo, la] = ll(x, y); return Cesium.Cartesian3.fromDegrees(lo, la, hAt(x, y) + up); };

  function circle(x: number, y: number, r: number, up: number, n = 40): Cesium.Cartesian3[] {
    const out: Cesium.Cartesian3[] = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push(P(x + Math.sin(a) * r, y + Math.cos(a) * r, up)); }
    return out;
  }
  const mat = (css: string, a = 1) => Cesium.Material.fromType('Color', { color: C.fromCssColorString(css).withAlpha(a) });

  async function enter(g: Game, b: Battle) {
    mode.tactical = true;
    const mf = await loadModelData();
    if (g.state.tactical?.battle?.id !== b.id) { mode.tactical = false; return; }
    cur = { id: b.id, b, pool: new ModelPool(scene, mf), ents: new Map(), clat: b.center[1], clon: b.center[0], mPerLon: M_PER_DEG * Math.cos((b.center[1] * Math.PI) / 180) };
    bills = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
    lines = scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
    labels = scene.primitives.add(new Cesium.LabelCollection({ scene })) as Cesium.LabelCollection;
    saved = { mode: globe.currentMapMode(), fill: globe.isLayerVisible('fill'), light: scene.light, roads: globe.isLayerVisible('roads') };
    // the stylised globe road layer draws wide misaligned stripes over the real roads (the orange band across the river)
    if (saved.roads) globe.setLayerVisible('roads', false);
    {
      // Fixed bright daylight so models read at any game hour.
      const m = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(b.center[0], b.center[1], 0));
      scene.light = new Cesium.DirectionalLight({ direction: Cesium.Matrix4.multiplyByPointAsVector(m, new Cesium.Cartesian3(-0.45, 0.3, -0.85), new Cesium.Cartesian3()), intensity: 3 });
    }
    tcam = createTacCamera({ viewer, hAt: (x, y) => hAt(x, y), ll, resolve: resolveTarget });
    if (saved.mode !== 'satellite') globe.setMapMode('satellite');
    globe.setLayerVisible('fill', false);
    renderLock(globe, 'tac', true);
    useTacSelection.getState().clear();
    navB = b.map.nav ? new Map(b.map.nav.buildings.map((x) => [x.id, x])) : null;
    frameForces(2.2);
    objs = b.objs.map((o) => {
      const ring = lines.add({ positions: circle(o.x, o.y, o.r, 4, 48), width: 3, material: mat('#ffd54a', 0.9) });
      const pole = lines.add({ positions: [P(o.x, o.y), P(o.x, o.y, 45)], width: 3, material: mat('#eeeeee') });
      const flag = bills.add({ position: P(o.x, o.y, 45), width: 30, height: 20, horizontalOrigin: Cesium.HorizontalOrigin.LEFT, verticalOrigin: Cesium.VerticalOrigin.TOP, disableDepthTestDistance: INF });
      flag.setImage('nflag', neutralFlag);
      const label = labels.add({ position: P(o.x, o.y, 60), text: o.name, font: '600 13px system-ui', fillColor: C.WHITE, outlineColor: C.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: V(18, -22), disableDepthTestDistance: INF });
      return { pole, ring, flag, label, sig: '' };
    });
    renderEvents.emit({ type: 'battleStart', pos: b.center });
  }
  function leave() {
    if (!cur) { mode.tactical = false; return; }
    clBills.length = 0; clGroups = clMembers = 0;
    cur.pool?.destroy();
    for (const c of [bills, lines, labels]) scene.primitives.remove(c);
    for (const e of craters) viewer.entities.remove(e);
    craters = []; cur = null; fxs = []; ruinCache.clear(); ruinFx.clear(); ruinList = []; ruinN = -1; routeVis.clear(); setRuins([], 0); projLines = []; seenProj.clear(); objs = []; deployLines = []; squadLabels.clear(); squadMarks.clear(); selLines.clear(); garrLines.clear(); navB = null; smokeZones.clear(); wrecks = 0;
    renderLock(globe, 'tac', false);
    tcam?.destroy(); tcam = null;
    if (saved) { scene.light = saved.light; if (saved.mode !== 'satellite') globe.setMapMode(saved.mode); globe.setLayerVisible('fill', saved.fill); if (saved.roads) globe.setLayerVisible('roads', true); saved = null; }
    mode.tactical = false;
    useTacSelection.getState().clear();
    globe.requestRender();
  }

  // ------------------------------------------------------------ frame
  const squadSide = (sq: number) => cur!.b.squads[sq]?.side ?? 0;
  interface FxOpt { grow?: number; life?: number; up?: number; vx?: number; vy?: number; vz?: number }
  /** Pooled sprite effect; positions are in battle metres, velocities in m/s (render-only ballistics). */
  /** Metres that cover `px` pixels at the ground point (so effects stay readable from far away). */
  function pxM(x: number, y: number, px: number): number {
    const [lo, la] = ll(x, y), d = Math.max(20, Cesium.Cartesian3.distance(viewer.camera.positionWC, Cesium.Cartesian3.fromDegrees(lo, la, hAt(x, y))));
    return (px * 2 * d * Math.tan(((viewer.camera.frustum as Cesium.PerspectiveFrustum).fovy ?? 1) / 2)) / (scene.canvas.clientHeight || 900);
  }
  const FX_MAX_PX: Record<FxKind, number> = { flash: 70, fire: 100, flame: 90, smoke: 130, dust: 110, debris: 14 };
  let testFx = false;
  function spawnFx(x: number, y: number, size: number, kind: FxKind, o: FxOpt = {}) {
    if (pinned && !testFx) return; // frozen-effects capture: only the effects the caller fires explicitly
    // legible from far away (minimum on-screen size) but never bigger than FX_MAX_PX on screen at the end of its growth, whatever the camera distance
    const gmax = 0.6 + (o.grow ?? 3) * 0.5, hi = pxM(x, y, FX_MAX_PX[kind]) / (kind === 'debris' ? 1 : gmax);
    size = Math.min(Math.max(size, pxM(x, y, kind === 'flash' ? 20 : kind === 'debris' ? 5 : kind === 'smoke' || kind === 'dust' ? 40 : 52)), hi);
    let f = fxs.find((q) => !q.b.show);
    if (!f && fxs.length < MAX_FX) {
      const b = bills.add({ position: Cesium.Cartesian3.ZERO, sizeInMeters: true, show: false, disableDepthTestDistance: 0 });
      fxs.push((f = { b, t0: 0, size: 0, grow: 3, life: 1, lon: 0, lat: 0, h0: 0, z: 0, vx: 0, vy: 0, vz: 0, kind }));
    }
    if (!f) return;
    const [lon, lat] = ll(x, y);
    f.b.setImage(`fx-${kind}`, imgs[kind]);
    Object.assign(f, { t0: performance.now(), size, grow: o.grow ?? 3, life: o.life ?? 1.6, lon, lat, h0: hAt(x, y), z: o.up ?? size * 0.3, vx: (o.vx ?? 0) / mul0(lat), vy: (o.vy ?? 0) / M_PER_DEG, vz: o.vz ?? 0, kind });
    f.b.position = Cesium.Cartesian3.fromDegrees(lon, lat, f.h0 + f.z);
    f.b.width = f.b.height = size; f.b.show = true; f.b.color = C.WHITE;
  }
  const mul0 = (lat: number) => M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  function crater(x: number, y: number, r: number) {
    const [lon, lat] = ll(x, y);
    const e = viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat), ellipse: { semiMajorAxis: r * rnd(1, 1.25), semiMinorAxis: r, rotation: rnd(0, 6.28), stRotation: rnd(0, 6.28), material: new Cesium.ImageMaterialProperty({ image: craterImg, transparent: true }), classificationType: Cesium.ClassificationType.TERRAIN } });
    craters.push(e);
    if (craters.length > MAX_CRATERS) viewer.entities.remove(craters.shift()!);
  }
  /** Fireball + smoke column + debris + scorch decal. `r` is blast scale in metres. */
  function explode(x: number, y: number, r: number, decal = true) {
    const m = mul;
    spawnFx(x, y, r * 1.5 * m, 'flash', { grow: 1.2, life: 0.22, up: r * 0.4 * m });
    spawnFx(x, y, r * 1.9 * m, 'fire', { grow: 1.5, life: 0.55, up: r * 0.5 * m, vz: 2 });
    spawnFx(x, y, r * 1.6 * m, 'flame', { grow: 1.8, life: 0.7, up: r * 0.5 * m, vz: 3 });
    spawnFx(x, y, r * 1.2 * m, 'flame', { grow: 1.4, life: 0.5, up: r * 0.8 * m, vz: 8 });
    spawnFx(x, y, r * 2.2 * m, 'dust', { grow: 2.4, life: 1.8, up: r * 0.3 * m, vz: 1.5 });
    for (let i = 0; i < 2; i++) spawnFx(x + rnd(-r, r) * 0.3, y + rnd(-r, r) * 0.3, r * (2 + i) * m, 'smoke', { grow: 2.2, life: 3.2 + i, up: r * 0.8 * m, vz: (5 + i * 3) * clamp(m * 0.5, 1, 6) });
    const nd = r > 20 ? 7 : 4;
    for (let i = 0; i < nd; i++) { const a = rnd(0, 6.28), v = rnd(6, 22) * clamp(m * 0.5, 1, 6); spawnFx(x, y, r * 0.16 * m, 'debris', { grow: 0, life: 1.3, up: 1, vx: Math.sin(a) * v, vy: Math.cos(a) * v, vz: rnd(14, 34) * clamp(m * 0.5, 1, 6) }); }
    if (decal) crater(x, y, r * 0.55);
  }

  /** Frame both sides: centre on the live units, range from their spread (never beyond the whole field). */
  function frameForces(durationS: number) {
    const b = cur?.b;
    if (!b || !tcam) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of b.ents) if (e.alive && !e.gone) { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y); }
    if (!Number.isFinite(x0)) { tcam.frameField(durationS); return; }
    const ext = Math.max(x1 - x0, y1 - y0);
    tcam.focus({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, { range: clamp(ext * 1.35 + 500, 800, 10500), pitchDeg: -48, headingDeg: 0, durationS });
  }

  function updateEnts(b: Battle, now: number, dt: number) {
    const c = cur!, pool = c.pool!, k = 1 - Math.exp(-dt * 9);
    let n = 0;
    const camPos = viewer.camera.positionWC, tanH = Math.tan(((viewer.camera.frustum as Cesium.PerspectiveFrustum).fovy ?? 1) / 2), viewH = scene.canvas.clientHeight || 900;
    for (const e of b.ents) {
      if (e.gone || n++ >= MAX_ENTS) continue;
      let s = c.ents.get(e.id);
      const sq = b.squads[e.sq];
      if (!s) {
        const h = pool.acquire(resolveModel(sq.modelId || UNITS[e.kind].model, sq.country, `${sq.ref}:${e.id}`, { mf: pool.manifest, needAnim: SOLDIER_KINDS.has(e.kind) }), { __tac: true, sq: e.sq, ent: e.id, side: e.side });
        if (!h) continue;
        s = { h, x: e.x, y: e.y, hd: (e.h * 180) / Math.PI, shoot: 0, dead: false, ent: e };
        c.ents.set(e.id, s);
      }
      s.ent = e;
      s.x += (e.x - s.x) * k; s.y += (e.y - s.y) * k;
      s.hd = lerpAngle(s.hd, (e.h * 180) / Math.PI, k);
      const soldier = SOLDIER_KINDS.has(e.kind);
      if (!e.alive) {
        if (!s.dead) {
          s.dead = true;
          pool.setTint(s.h, 1);
          if (soldier) pool.setAnim(s.h, 'Death', true);
          else if (wrecks < 40) { wrecks++; s.wreck = bills.add({ position: Cesium.Cartesian3.ZERO, sizeInMeters: true, width: 12 * mul, height: 12 * mul, disableDepthTestDistance: 0 }); s.wreck.setImage('fx-dark', imgs.dark); }
          explode(e.x, e.y, soldier ? 3 : 9, false);
          s.wreckAt = wrecks;
        }
        if (s.wreck) {
          s.wreck.position = P(s.x, s.y, 3 * mul);
          if (!soldier && (s.wreckAt ?? 0) > wrecks - 14 && now > (s.smokeT ?? 0)) { s.smokeT = now + 650; spawnFx(s.x, s.y, 9 * mul, 'smoke', { grow: 2.4, life: 3.4, up: 3 * mul, vz: 4 * clamp(mul * 0.6, 1, 6) }); if (Math.random() < 0.3) spawnFx(s.x, s.y, 5 * mul, 'flame', { grow: 1.2, life: 0.5, up: 2 * mul, vz: 2 }); }
        }
      } else if (!soldier && e.moving && now > (s.dustT ?? 0) && mul < 9) { s.dustT = now + 260; spawnFx(s.x - Math.sin(e.h) * 3, s.y - Math.cos(e.h) * 3, 7 * mul, 'dust', { grow: 2.2, life: 1.5, up: 1.2 * mul, vz: 1.2 }); }
      if (e.alive && soldier) pool.setAnim(s.h, s.shoot > now ? 'shoot' : e.moving ? 'run' : 'idle');
      // Exaggeration from the distance to the camera so every unit keeps a readable on-screen size (soldiers ~22 px, vehicles ~34 px).
      const info = pool.info(s.h.modelId), len = info?.lengthM ?? 3;
      const gh = hAt(s.x, s.y), [slon, slat] = ll(s.x, s.y);
      const dist = Math.max(20, Cesium.Cartesian3.distance(camPos, Cesium.Cartesian3.fromDegrees(slon, slat, gh)));
      const want = clamp((soldier ? 46 : 70) / (len * (viewH / (2 * dist * tanH))), 1, soldier ? 70 : 90);
      s.mul = s.mul === undefined ? want : s.mul + (want - s.mul) * k;
      const m = s.mul;
      if (!s.dot) { const [k, img] = markImg(e.side, e.kind, true); s.dot = bills.add({ position: Cesium.Cartesian3.ZERO, width: 15, height: 15, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: INF }); s.dot.setImage(k, img); }
      const inside = soldier && sq.gar !== undefined;
      s.dot.show = e.alive && !s.cl && (m > 6 || inside);
      if (s.dot.show) s.dot.position = Cesium.Cartesian3.fromDegrees(slon, slat, gh + (inside ? (navB?.get(sq.gar!)?.h ?? 8) + 2 : len * m * 1.15));
      const mdl = s.h.model;
      if (mdl && !s.styled && e.alive) {
        s.styled = true;
        // Readable at any distance: brighter light, faint side tint, never smaller than a few pixels on screen.
        mdl.lightColor = new Cesium.Cartesian3(3.2, 3.2, 3.2);
        mdl.color = C.fromCssColorString(SIDE_COLOR[e.side]); mdl.colorBlendMode = Cesium.ColorBlendMode.MIX; mdl.colorBlendAmount = 0.08;
        try { mdl.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1.5, 1.5); } catch { /* older Cesium */ }
        mdl.silhouetteColor = C.fromCssColorString(SIDE_COLOR[e.side]); mdl.silhouetteSize = soldier ? 2 : 2.5;
      }
      // Vehicles pitch with the ground slope under hull length.
      let pt = 0;
      if (!soldier) { const dx = Math.sin((s.hd * Math.PI) / 180) * len * 0.35, dy = Math.cos((s.hd * Math.PI) / 180) * len * 0.35; pt = clamp((Math.atan2(mapH(s.x + dx, s.y + dy) - mapH(s.x - dx, s.y - dy), len * 0.7) * 180) / Math.PI, -18, 18); }
      s.pitch = (s.pitch ?? pt) + (pt - (s.pitch ?? pt)) * k;
      pool.place(s.h, slon, slat, gh, s.hd, m, soldier && s.dead ? 90 : 0, !(soldier && sq.gar !== undefined && e.alive) && !s.cl, s.pitch);
    }
    if (c.ents.size > n) {
      const live = new Set(b.ents.filter((e) => !e.gone).map((e) => e.id));
      for (const [id, s] of c.ents) if (!live.has(id)) { pool.release(s.h); if (s.wreck) bills.remove(s.wreck); if (s.dot) bills.remove(s.dot); c.ents.delete(id); }
    }
  }

  function updateProjectiles(b: Battle, now: number) {
    const cur2 = new Set<number>();
    let i = 0;
    for (const p of b.proj) {
      cur2.add(p.id);
      const f = clamp((b.t - p.t0) / Math.max(0.05, p.t1 - p.t0), 0, 1);
      const x = p.x0 + (p.x1 - p.x0) * f, y = p.y0 + (p.y1 - p.y0) * f;
      const dist = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
      const arc = p.kind === 'shell' ? dist * 0.22 : p.kind === 'rocket' ? dist * 0.05 + 8 : p.kind === 'missile' ? 18 : 0;
      const vm = clamp(mul * 0.7, 1, 10), up = p.kind === 'bomb' ? 300 * (1 - f) : (1.8 + 4 * arc * f * (1 - f)) * vm;
      const tail = (p.kind === 'bullet' ? 14 : p.kind === 'bomb' ? 24 : 38) * clamp(mul * 0.8, 1, 12);
      const bx = x - ((p.x1 - p.x0) / Math.max(1, dist)) * tail, by = y - ((p.y1 - p.y0) / Math.max(1, dist)) * tail;
      let l = projLines[i];
      const pos = [P(bx, by, p.kind === 'bomb' ? up + 24 : Math.max(1, up - 1)), P(x, y, up)];
      if (!l) { l = lines.add({ positions: pos, width: p.kind === 'bullet' ? 3 : 6, material: Cesium.Material.fromType('PolylineGlow', { color: C.fromCssColorString(p.kind === 'bullet' ? '#ffb23a' : '#ffd98a'), glowPower: 0.35, taperPower: 0.9 }) }); projLines.push(l); } else { l.positions = pos; l.show = true; }
      i++;
      if (!seenProj.has(p.id)) {
        if (now > nextShotEv) { nextShotEv = now + 70; renderEvents.emit({ type: 'tacShot', kind: p.kind, side: p.side, pos: ll(p.x0, p.y0), dist }); }
        if (p.kind !== 'bomb' && (p.kind !== 'bullet' || Math.random() < 0.35)) {
          const ux = (p.x1 - p.x0) / Math.max(1, dist), uy = (p.y1 - p.y0) / Math.max(1, dist), big = p.kind === 'bullet' ? 2.2 : p.kind === 'shell' ? 7 : 5;
          spawnFx(p.x0 + ux * big * 0.6, p.y0 + uy * big * 0.6, big * Math.max(1, mul * 0.7), 'flash', { grow: 0.8, life: p.kind === 'bullet' ? 0.09 : 0.16, up: 2 * clamp(mul * 0.7, 1, 10) });
          if (p.kind === 'shell') spawnFx(p.x0 + ux * 6, p.y0 + uy * 6, 9 * mul, 'smoke', { grow: 2, life: 1.4, up: 2.5 * mul, vz: 2 });
        }
        if (p.kind !== 'bomb') for (const [, s] of cur!.ents) if (s.ent.side === p.side && s.ent.alive && Math.abs(s.ent.x - p.x0) < 6 && Math.abs(s.ent.y - p.y0) < 6) { s.shoot = now + 450; break; }
      }
      seenProj.set(p.id, { x1: p.x1, y1: p.y1, kind: p.kind, side: p.side });
    }
    for (; i < projLines.length; i++) projLines[i].show = false;
    for (const [id, s] of seenProj) {
      if (cur2.has(id)) continue;
      seenProj.delete(id);
      if (s.kind === 'bullet') continue;
      explode(s.x1, s.y1, s.kind === 'bomb' ? 26 : s.kind === 'shell' ? 12 : s.kind === 'rocket' ? 9 : 8);
      renderEvents.emit({ type: 'tacExplosion', kind: s.kind, pos: ll(s.x1, s.y1) });
    }
  }

  function updateFx(now: number, dt: number) {
    if (held) { now = heldNow; dt = 0; } else heldNow = now;
    for (const f of fxs) {
      if (!f.b.show) continue;
      const a = pinned ? PIN_AGE[f.kind] : (now - f.t0) / 1000 / f.life;
      if (a >= 1) { f.b.show = false; continue; }
      if (pinned) f.t0 = now - f.life * 1000 * a;
      if (f.vx || f.vy || f.vz) {
        f.lon += f.vx * dt; f.lat += f.vy * dt; f.z = Math.max(0, f.z + f.vz * dt);
        if (f.kind === 'debris') f.vz -= 40 * dt * clamp(mul * 0.5, 1, 6); else f.vz *= 1 - dt * 0.8;
        f.b.position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.h0 + f.z);
      }
      f.b.width = f.b.height = f.kind === 'debris' ? f.size : f.size * (0.6 + a * f.grow * 0.5);
      const fade = f.kind === 'smoke' ? Math.min(1, a * 6) * (1 - a) : f.kind === 'flash' ? 1 - a * a : Math.min(1, (1 - a) * 2.2);
      f.b.color = C.WHITE.withAlpha(Math.max(0, fade));
    }
  }

  function updateSmoke(b: Battle) {
    const live = new Set<string>();
    for (const s of b.smokes) {
      const k = `${s.x},${s.y},${s.until}`;
      live.add(k);
      if (smokeZones.has(k) || b.t >= s.until) continue;
      const arr: Cesium.Billboard[] = [];
      const n = clamp(Math.round(s.r / 5), 4, 18);
      for (let j = 0; j < n; j++) {
        const a = j * 2.399, rr = Math.sqrt((j + 0.5) / n) * s.r * 0.8;
        const bb = bills.add({ sizeInMeters: true, width: s.r * 0.9, height: s.r * 0.9, position: P(s.x + Math.sin(a) * rr, s.y + Math.cos(a) * rr, 9), color: C.WHITE.withAlpha(0.8), disableDepthTestDistance: 0 });
        bb.setImage('fx-smoke', imgs.smoke);
        arr.push(bb);
      }
      smokeZones.set(k, arr);
    }
    for (const [k, arr] of smokeZones) if (!live.has(k)) { arr.forEach((a) => bills.remove(a)); smokeZones.delete(k); }
  }

  function updateObjectives(b: Battle) {
    const g = getGame()!;
    b.objs.forEach((o, i) => {
      const v = objs[i];
      if (!v) return;
      const sig = `${o.owner}|${Math.round(o.cap * 100)}`;
      if (sig === v.sig) return;
      v.sig = sig;
      const col = o.owner === -1 ? '#ffd54a' : SIDE_COLOR[o.owner];
      v.ring.material = mat(col, 0.95);
      v.label.text = `${o.name} ${Math.round(((o.cap + 1) / 2) * 100)}%`;
      v.label.fillColor = C.fromCssColorString(col);
      const country = o.owner === -1 ? null : b.country[o.owner];
      const iso = country ? g.world.countryById.get(country)?.iso2?.toLowerCase() : null;
      if (iso) v.flag.setImage(`flag-${iso}`, assetUrl(`data/flags/${iso}.svg`) as never);
      else v.flag.setImage('nflag', neutralFlag);
    });
  }

  function updateDeploy(b: Battle) {
    if (b.phase === 'deploy' && !deployLines.length) {
      b.deploy.forEach((r, side) => {
        const pts: Cesium.Cartesian3[] = [];
        const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2, st = 60;
        for (let x = x0; x < x1; x += st) pts.push(P(x, y0, 3));
        for (let y = y0; y < y1; y += st) pts.push(P(x1, y, 3));
        for (let x = x1; x > x0; x -= st) pts.push(P(x, y1, 3));
        for (let y = y1; y > y0; y -= st) pts.push(P(x0, y, 3));
        pts.push(pts[0]);
        deployLines.push(lines.add({ positions: pts, width: 3, material: Cesium.Material.fromType('PolylineDash', { color: C.fromCssColorString(SIDE_COLOR[side]), dashLength: 18 }) }));
      });
    } else if (b.phase !== 'deploy' && deployLines.length) { deployLines.forEach((l) => lines.remove(l)); deployLines = []; }
  }

  // ------------------------------------------------------------ screen-space clustering (fewer models drawn)
  let clusterOn = true, clNext = 0;
  const clBills: Cesium.Billboard[] = [], clImgs = new Map<string, HTMLCanvasElement>();
  let clGroups = 0, clMembers = 0;
  function clusterImg(side: number, kind: string, n: number): [string, HTMLCanvasElement] {
    const k = `cl${side}${kind}${n}`;
    let c = clImgs.get(k);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fillStyle = SIDE_COLOR[side]; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 4;
      g.font = '700 26px system-ui'; g.strokeText(String(n), 32, 27); g.fillText(String(n), 32, 27);
      g.font = '700 15px system-ui'; g.strokeText(KIND_LETTER[kind] ?? '?', 32, 47); g.fillText(KIND_LETTER[kind] ?? '?', 32, 47);
      clImgs.set(k, c);
    }
    return [k, c];
  }
  function updateClusters(now: number) {
    if (now < clNext) return;
    clNext = now + 150;
    const c = cur!, items: ClusterItem<E>[] = [];
    for (const [, s] of c.ents) s.cl = false;
    if (clusterOn) {
      for (const [, s] of c.ents) {
        if (!s.ent.alive || s.ent.gone) continue;
        const [lo, la] = ll(s.x, s.y), p = globe.toScreen(lo, la, hAt(s.x, s.y));
        if (p) items.push({ x: p.x, y: p.y, side: String(s.ent.side), kind: s.ent.kind, weight: 1, ref: s });
      }
    }
    let gi = 0; clMembers = 0;
    // supercluster in screen space: a group of >= 3 entities becomes one badge (side colour, count, predominant type); zooming in dissolves it
    for (const grp of clusterScreen(items, 46, 3).groups) {
      let x = 0, y = 0;
      for (const m of grp.members) { m.ref.cl = true; x += m.ref.x; y += m.ref.y; }
      const l = grp.members;
      let bb = clBills[gi];
      if (!bb) { bb = bills.add({ position: Cesium.Cartesian3.ZERO, width: 38, height: 38, disableDepthTestDistance: INF }); clBills[gi] = bb; }
      const [k, img] = clusterImg(l[0].ref.ent.side, grp.kind, l.length);
      bb.setImage(k, img); bb.position = P(x / l.length, y / l.length, 6); bb.show = true;
      gi++; clMembers += l.length;
    }
    clGroups = gi;
    for (; gi < clBills.length; gi++) clBills[gi].show = false;
  }

  /** Occupied buildings: a glowing roof outline in the occupying side's colour. */
  function updateGarrison(b: Battle) {
    if (!navB) return;
    const live = new Set<number>();
    for (const [k, sqs] of Object.entries(b.garr ?? {})) {
      const id = Number(k), q = sqs.map((i) => b.squads[i]).find((x) => x && x.n0 > 0);
      const nb = navB.get(id);
      if (!q || !nb) continue;
      live.add(id);
      if (garrLines.get(id)?.side === q.side) continue;
      if (garrLines.has(id)) lines.remove(garrLines.get(id)!.l);
      const roof = hAt(nb.cx, nb.cy) + nb.h + 0.6, pts: Cesium.Cartesian3[] = [];
      for (let i = 0; i <= nb.poly.length / 2; i++) { const j = i % (nb.poly.length / 2); pts.push(P(nb.poly[j * 2], nb.poly[j * 2 + 1], roof - hAt(nb.poly[j * 2], nb.poly[j * 2 + 1]))); }
      garrLines.set(id, { side: q.side, l: lines.add({ positions: pts, width: 5, material: Cesium.Material.fromType('PolylineGlow', { color: C.fromCssColorString(SIDE_COLOR[q.side]), glowPower: 0.3 }) }) });
    }
    for (const [id, g] of garrLines) if (!live.has(id)) { lines.remove(g.l); garrLines.delete(id); }
  }

  function updateSquads(b: Battle) {
    const sel = new Set(useTacSelection.getState().selected);
    for (const s of b.squads) {
      let alive = 0, mx = 0, my = 0, up = 0;
      for (const [, e] of cur!.ents) if (e.ent.sq === s.id && e.ent.alive) { alive++; mx += e.x; my += e.y; up = Math.max(up, (cur!.pool?.info(e.h.modelId)?.lengthM ?? 2) * (e.mul ?? mul) * 0.9 + 3); }
      if (alive) { mx /= alive; my /= alive; } else { mx = s.x; my = s.y; }
      let l = squadLabels.get(s.id);
      if (!l) { l = labels.add({ position: Cesium.Cartesian3.ZERO, font: '600 12px system-ui', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: C.BLACK, pixelOffset: V(0, -50), disableDepthTestDistance: INF, fillColor: C.fromCssColorString(SIDE_COLOR[s.side]) }); squadLabels.set(s.id, l); }
      const focus = sel.has(s.id) || hoverSq === s.id;
      l.show = alive > 0 && (focus || s.routed);
      l.text = focus ? `${s.name ? s.name.slice(0, 18) + ' ' : ''}${alive}/${s.n0}${s.routed ? ' !' : ''}` : '!';
      l.position = P(mx, my, up + 10);
      let mk = squadMarks.get(s.id);
      if (!mk) { const [k, img] = markImg(s.side, s.kind); mk = bills.add({ position: Cesium.Cartesian3.ZERO, width: 34, height: 34, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: INF }); mk.setImage(k, img); squadMarks.set(s.id, mk); }
      mk.show = alive > 0;
      mk.position = l.position;
      const on = sel.has(s.id);
      let sl = selLines.get(s.id);
      if (on && !sl) {
        sl = { ring: lines.add({ positions: circle(s.x, s.y, 30, 3), width: 3, material: mat('#ffe14d') }), ord: lines.add({ positions: [P(s.x, s.y, 3), P(s.x, s.y, 3)], width: 2.5, material: Cesium.Material.fromType('PolylineDash', { color: C.fromCssColorString('#ffe14d'), dashLength: 12 }) }) };
        selLines.set(s.id, sl);
      }
      if (!on && sl) { lines.remove(sl.ring); lines.remove(sl.ord); selLines.delete(s.id); }
      if (on && sl) {
        const r = clamp(Math.sqrt(s.n0) * 12, 24, 110);
        sl.ring.positions = circle(s.x, s.y, r, 3);
        let tx = s.ox, ty = s.oy, moving = s.order === 'move' || s.order === 'amove' || s.order === 'retreat';
        if (s.order === 'attack') { const t = b.ents.find((e) => e.id === s.target); if (t) { tx = t.x; ty = t.y; moving = true; } }
        sl.ord.show = moving;
        if (moving) sl.ord.positions = [P(s.x, s.y, 3), P(tx, ty, 3)];
      }
    }
  }


  // ------------------------------------------------------------ destroyed buildings: city 3D collapse + dust and falling blocks
  /** Footprint ring (lon/lat) of a fallen nav building, cached per id; null until the rubble pattern is loaded. */
  function ruinOf(b: Battle, r: NonNullable<Battle['map']['rub']>[number]): Ruin | null {
    let o = ruinCache.get(r.id);
    if (o) return o;
    const spec = cityStyles()?.rubble, nb = navB?.get(r.id);
    if (!spec || !nb) return null;
    const ring: number[] = [];
    for (let i = 0; i < nb.poly.length; i += 2) ring.push(...ll(nb.poly[i], nb.poly[i + 1]));
    const [lon, lat] = ll(nb.cx, nb.cy);
    o = { key: `${b.id}:${r.id}`, id: r.id, ring, lon, lat, fl: r.fl, h: r.h, m: r.m, by: r.by, t: r.t, dur: spec.collapse[r.by].duration };
    if (r.by === 'breach') {
      // the breaching vehicle's side: the wall falls away from it
      let best = 1e9, bq: Battle['squads'][number] | undefined;
      for (const q of b.squads) { const d = q.brk === r.id ? 0 : Math.hypot(q.x - nb.cx, q.y - nb.cy); if (d < best && (q.brk === r.id || d < 45)) { best = d; bq = q; } }
      if (bq) o.brk = ll(bq.x, bq.y);
    }
    ruinCache.set(r.id, o);
    return o;
  }
  function updateRuins(b: Battle, now: number) {
    const rub = b.map.rub ?? [];
    if (rub.length !== ruinN || ruinList.length !== rub.length) {
      const list: Ruin[] = [];
      for (const r of rub) { const o = ruinOf(b, r); if (o) list.push(o); }
      if (list.length === rub.length) ruinN = rub.length;
      if (list.length !== ruinList.length || list.some((o, i) => o !== ruinList[i])) ruinList = list;
    }
    setRuins(ruinList, b.t);
    for (const o of ruinList) {
      const p = (b.t - o.t) / o.dur;
      let f = ruinFx.get(o.id);
      if (p >= 1 && !f) continue; // loaded save / finished long ago: final state only, no animation
      if (!f) ruinFx.set(o.id, (f = { t: b.t, start: false, end: false, acc: 0, blk: 0 }));
      if (p >= 1.2) { ruinFx.delete(o.id); continue; }
      const nb = navB?.get(o.id), spec = cityStyles()?.rubble.collapse[o.by];
      if (!nb || !spec) continue;
      const dsim = Math.max(0, Math.min(0.5, b.t - f.t));
      f.t = b.t;
      const size = clamp(Math.sqrt(nb.area) * 0.4, 5, 24) * mul, R = Math.sqrt(nb.area) * 0.5;
      const bp = o.brk ? [(o.brk[0] - cur!.clon) * cur!.mPerLon, (o.brk[1] - cur!.clat) * M_PER_DEG] : null;
      const at = (): [number, number] => {
        if (bp && Math.random() < 0.6) { const k = Math.random() * 0.5; return [bp[0] + (nb.cx - bp[0]) * k + rnd(-3, 3), bp[1] + (nb.cy - bp[1]) * k + rnd(-3, 3)]; }
        const a = rnd(0, 6.28), d = Math.sqrt(Math.random()) * R; return [nb.cx + Math.sin(a) * d, nb.cy + Math.cos(a) * d];
      };
      if (!f.start) { // the roof goes: one big cloud
        f.start = true;
        for (let i = 0; i < 3; i++) { const [x, y] = at(); spawnFx(x, y, size * 2 * (1 + i * 0.3), 'dust', { grow: 2.8, life: 2.6, up: nb.h * 0.4, vz: 2 + i }); }
      }
      f.acc += dsim * spec.dust; f.blk += dsim * spec.blocks;
      for (; f.acc >= 1; f.acc -= 1) { const [x, y] = at(); spawnFx(x, y, size * rnd(1.1, 1.8), 'dust', { grow: 2.4, life: 2 + Math.random(), up: nb.h * Math.max(0.1, 0.55 * (1 - p)), vz: 1.5, vx: rnd(-2, 2), vy: rnd(-2, 2) }); }
      for (; f.blk >= 1; f.blk -= 1) { const [x, y] = at(); spawnFx(x, y, Math.min(1.3, 0.5 + nb.area / 400) * Math.max(1, mul * 0.6), 'debris', { grow: 0, life: 1.4, up: nb.h * Math.max(0.2, 1 - p), vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(-4, 1) }); }
      if (p > 0.8 && !f.end) { f.end = true; for (let i = 0; i < 2; i++) { const [x, y] = at(); spawnFx(x, y, size * 2.4, 'dust', { grow: 3, life: 3.4, up: 2, vz: 1.2 }); } }
    }
  }

  // ------------------------------------------------------------ marked routes: dashed line on the ground with numbered points
  const numImgs = new Map<string, HTMLCanvasElement>();
  function numImg(n: number, side: number): [string, HTMLCanvasElement] {
    const k = `n${side}-${n}`;
    let c = numImgs.get(k);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 40;
      const g = c.getContext('2d')!;
      g.beginPath(); g.arc(20, 20, 16, 0, Math.PI * 2); g.fillStyle = SIDE_COLOR[side]; g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = '700 20px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3;
      g.strokeText(String(n), 20, 21); g.fillText(String(n), 20, 21);
      numImgs.set(k, c);
    }
    return [k, c];
  }
  /** Terrain-following points of a polyline [x,y,...]: a point at least every 24 m. */
  function dense(pts: number[]): Cesium.Cartesian3[] {
    const out: Cesium.Cartesian3[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      if (i) { const ax = pts[i - 2], ay = pts[i - 1], d = Math.hypot(pts[i] - ax, pts[i + 1] - ay), n = Math.min(40, Math.floor(d / 24)); for (let j = 1; j <= n; j++) out.push(P(ax + ((pts[i] - ax) * j) / (n + 1), ay + ((pts[i + 1] - ay) * j) / (n + 1), 2.5)); }
      out.push(P(pts[i], pts[i + 1], 2.5));
    }
    return out;
  }
  function updateRoutes(b: Battle, now: number) {
    const live = new Set<number>();
    for (const s of b.squads) {
      const marked = s.side === b.player && (s.order === 'move' || s.order === 'amove') && !!s.route?.length;
      if (!marked) continue;
      live.add(s.id);
      const wp = [s.ox, s.oy, ...(s.route ?? [])];
      const sig = `${wp.join(',')}|${s.path.length}:${s.pi}|${s.breach ? 1 : 0}`;
      let v = routeVis.get(s.id);
      if (v && v.sig === sig && now - v.at < 700) continue;
      // current leg along its searched path, then straight legs to the next marks (those are searched when reached)
      const head: number[] = [s.x, s.y];
      for (let i = s.pi; i + 1 < s.path.length; i += 2) head.push(s.path[i], s.path[i + 1]);
      head.push(...wp);
      const positions = dense(head);
      if (!v) {
        v = { line: lines.add({ positions, width: 4, material: Cesium.Material.fromType('PolylineDash', { color: C.fromCssColorString(s.breach ? '#ffb347' : SIDE_COLOR[s.side]), gapColor: C.BLACK.withAlpha(0.0), dashLength: 16 }) }), marks: [], sig, at: now };
        routeVis.set(s.id, v);
      } else { v.line.positions = positions; v.sig = sig; v.at = now; }
      for (let i = 0; i < wp.length / 2; i++) {
        let mk = v.marks[i];
        const [k, img] = numImg(i + 1, s.side);
        if (!mk) { mk = bills.add({ position: Cesium.Cartesian3.ZERO, width: 26, height: 26, disableDepthTestDistance: INF }); v.marks[i] = mk; }
        mk.setImage(k, img); mk.position = P(wp[i * 2], wp[i * 2 + 1], 3); mk.show = true;
      }
      for (let i = wp.length / 2; i < v.marks.length; i++) v.marks[i].show = false;
    }
    for (const [id, v] of routeVis) if (!live.has(id)) { lines.remove(v.line); v.marks.forEach((m) => bills.remove(m)); routeVis.delete(id); }
  }

  const onPre = () => {
    const g = getGame();
    const b = g?.state.tactical?.battle ?? null;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!g || !b || !cur || cur.id !== b.id) return;
    if (!pinned && testLines.length) { for (const l of testLines) lines.remove(l); testLines.length = 0; }
    mul = clamp((globe.cameraHeight() - groundC) / 450, 1, 22); // above the battlefield, not above sea level (Rwanda sits at 1700 m)
    cur.b = b;
    groundC = mapH(0, 0);
    updateClusters(now);
    updateEnts(b, now, dt);
    updateProjectiles(b, now);
    updateFx(now, dt);
    updateSmoke(b);
    updateObjectives(b);
    updateDeploy(b);
    updateSquads(b);
    updateGarrison(b);
    updateRuins(b, now);
    updateRoutes(b, now);
  };
  scene.preRender.addEventListener(onPre);

  // The sim clock is driven by wall time, independent of the render frame rate (a slow GPU must not slow the battle down).
  let simLast = performance.now();
  const simTimer = setInterval(() => {
    const now = performance.now(), dt = Math.min(0.25, (now - simLast) / 1000); // capped: an overloaded thread slows the sim instead of spiralling
    simLast = now;
    const g = getGame();
    if (g && cur && g.state.tactical?.battle?.id === cur.id) g.ctx.api.tactical.advance(dt);
  }, 50);

  // ------------------------------------------------------------ lifecycle poll
  const timer = setInterval(() => {
    const g = getGame();
    const b = g?.state.tactical?.battle ?? null;
    if (b && (!cur || cur.id !== b.id) && !mode.tactical) void enter(g!, b);
    else if (!b && (cur || mode.tactical)) leave();
  }, 200);

  // ------------------------------------------------------------ input
  const unPick = globe.registerPickable((p) => {
    const id = p.id as { __tac?: boolean; sq?: number; ent?: number; side?: number } | undefined;
    return id?.__tac ? { kind: 'tacSquad', id: id.sq!, data: { sq: id.sq, ent: id.ent, side: id.side } } : undefined;
  });
  const player = () => cur?.b.player ?? null;
  const unHover = globe.on('hover', (e) => { const f = e.pick.feature; hoverSq = cur && f?.kind === 'tacSquad' ? (f.data as { sq: number }).sq : -1; });
  const unClick = globe.on('click', (e) => {
    if (!cur) return;
    const st = useTacSelection.getState(), f = e.pick.feature;
    if (f?.kind === 'tacSquad') { const d = f.data as { sq: number; side: number }; if (d.side === player()) { st.select([d.sq], e.shift); return; } }
    if (!e.shift) st.clear();
  });
  const unBox = globe.on('box', (bx) => {
    if (!cur) return;
    const hit: number[] = [];
    for (const s of cur.b.squads) {
      if (s.side !== player()) continue;
      const [lo, la] = ll(s.x, s.y);
      const p = globe.toScreen(lo, la, hAt(s.x, s.y));
      if (p && p.x >= bx.x0 && p.x <= bx.x1 && p.y >= bx.y0 && p.y <= bx.y1) hit.push(s.id);
    }
    useTacSelection.getState().select(hit, bx.ctrl);
  });
  const unRight = globe.on('rightclick', (e) => {
    const g = getGame();
    if (!cur || !g) return;
    const sel = useTacSelection.getState().selected.filter((id) => cur!.b.squads[id]?.side === player());
    if (!sel.length) return;
    const f = e.pick.feature;
    let order: Order | null = null;
    if (f?.kind === 'tacSquad') {
      const d = f.data as { sq: number; ent: number; side: number };
      if (d.side !== player()) order = attackOrder(d.sq);
    }
    if (!order && e.pick.lonLat) {
      const x = (e.pick.lonLat[0] - cur.clon) * cur.mPerLon, y = (e.pick.lonLat[1] - cur.clat) * M_PER_DEG;
      order = { kind: e.ctrl || e.alt ? 'attackMove' : 'move', x, y };
    }
    if (!order) return;
    const r = g.dispatch({ type: 'tac.order', country: g.state.meta.playerCountryId, squads: sel, order } as never);
    useTacSelection.getState().setError(r.ok ? null : (r as { reason?: string }).reason ?? 'error');
    renderEvents.emit({ type: 'tacOrder', ok: r.ok });
  });

  const unFocus = useTacSelection.subscribe((st, prev) => { if (st.focusRequest && st.focusRequest !== prev.focusRequest) tcam?.focus({ squad: st.focusRequest.sq }, { range: 380, pitchDeg: -40 }); });
  (window as unknown as { __tacSel?: typeof useTacSelection }).__tacSel = useTacSelection;
  return {
    active: () => !!cur,
    focus: (t, o) => tcam?.focus(t, typeof o === 'number' ? { range: o } : o) ?? false,
    frameField: (d) => frameForces(d ?? 2.2),
    muzzleAt: (x, y, big = 3) => { testFx = true; spawnFx(x, y, big * Math.max(1, mul * 0.7), 'flash', { grow: 0.8, life: 0.16, up: 2 * clamp(mul * 0.7, 1, 10) }); testFx = false; },
    explodeAt: (x, y, r = 12) => { testFx = true; explode(x, y, r); testFx = false; },
    holdFx: (on) => { held = on; },
    pinFx: (on) => { pinned = on; if (on) for (const f of fxs) f.b.show = false; },
    tracerAt: (x0, y0, x1, y1) => { const l = lines.add({ positions: [P(x0, y0, 2.5), P(x1, y1, 2.5)], width: 5, material: Cesium.Material.fromType('PolylineGlow', { color: C.fromCssColorString('#ffd060'), glowPower: 0.4, taperPower: 0.9 }) }); testLines.push(l); },
    ents: () => [...(cur?.ents.values() ?? [])].map((e) => ({ id: e.ent.id, sq: e.ent.sq, side: e.ent.side, kind: e.ent.kind, x: e.ent.x, y: e.ent.y, alive: e.ent.alive, shown: !!e.h.model?.show, ready: !!e.h.model?.ready })),
    sample: (n = 5) => [...(cur?.ents.values() ?? [])].slice(0, n).map((e) => { const [lo, la] = ll(e.x, e.y); return { id: e.ent.id, x: Math.round(e.x), y: Math.round(e.y), h: Math.round(hAt(e.x, e.y)), shown: !!e.h.model?.show, ready: !!e.h.model?.ready, scale: e.h.model?.scale, screen: globe.toScreen(lo, la, hAt(e.x, e.y)) }; }),
    stats: () => ({ shown: [...(cur?.ents.values() ?? [])].filter((e) => e.h.model?.show).length, models: cur?.pool?.liveCount ?? 0, ents: cur?.ents.size ?? 0, proj: cur?.b.proj.length ?? 0, fx: fxs.filter((f) => f.b.show).length, clusters: clGroups, clustered: clMembers }),
    setCluster: (on) => { clusterOn = on; clNext = 0; },
    prefetch: async () => { const g = getGame(); if (g) await Promise.all(battlePreviews(g.ctx).map((b) => prefetchAt(b.pos[0], b.pos[1]))); },
    destroy() {
      clearInterval(timer); clearInterval(timerPre); clearInterval(simTimer);
      scene.preRender.removeEventListener(onPre);
      unFocus(); unPick(); unHover(); unClick(); unBox(); unRight();
      leave();
      setTacticalMapProvider(null);
    },
  };
}
