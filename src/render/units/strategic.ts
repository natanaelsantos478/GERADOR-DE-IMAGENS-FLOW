/** Strategic formations: clustered billboard markers far away, glb models in formation up close, selection and orders. */
import { resolveModel } from '../models/variants';
import * as Cesium from 'cesium';
import type { CountryId, FormationId, FormationView, LonLat } from '../../core/contracts';
import type { Game } from '../../core/game';
import { UNITS, formationRoute, milCmd, visibleFormations } from '../../sim/military';
import type { Globe } from '../globe/types';
import { groundOf, mode, ModelPool, assetUrl, badgeCanvas, clamp, lerpAngle, offsetLonLat, rad, renderEvents, renderLock, svgImage, textBadge, type ModelHandle } from './common';
import { clusterScreen, type ClusterItem } from './cluster';
import { useUnitSelection } from './store';

export const NEAR_H = 30_000;
/** Camera height under which the 3D city appears and the unit models shrink toward their real size. */
const CITY_H = 8_000;
export const MAX_MODELS = 300;
const CLUSTER_PX = 46;
let clusterOn = true, drawn = 0, nGrouped = 0, nVis = 0, nGroups = 0, nPass = 0;
/** Test/debug: toggle the screen-space grouping and read how many formations/models it saved. */
export const nearClusterDebug = { set: (on: boolean) => { clusterOn = on; }, stats: () => ({ on: clusterOn, modelsDrawn: drawn, formationsGrouped: nGrouped, onScreen: nVis, groups: nGroups, passes: nPass }) };
const REL_COLOR = { own: '#4da3ff', ally: '#5ee08a', enemy: '#ff5a4d', neutral: '#d0d4dc', rebel: '#ffb02e' } as const;
type Rel = keyof typeof REL_COLOR;
const FAR = Number.POSITIVE_INFINITY;
const V = (x: number, y: number) => new Cesium.Cartesian2(x, y);

interface FS {
  id: FormationId;
  v: FormationView;
  rel: Rel;
  lon: number; lat: number; hdg: number;
  tlon: number; tlat: number; thdg: number;
  settled: boolean;
  tag: { __fs: true; ids: FormationId[] };
  icon: Cesium.Billboard; flag: Cesium.Billboard; bar: Cesium.Billboard;
  ring?: Cesium.Billboard; count?: Cesium.Billboard;
  keys: { icon: string; bar: string; flag: string };
  handles: ModelHandle[];
  modelSig: string;
  /** Lead of the screen-space group this formation belongs to (null: it is its own icon or the lead). */
  cluster: FS | null;
  /** Lead of a group: member count, predominant symbol and mean position (members' models and badges are not drawn). */
  gN: number; gGlyph?: string; gLon?: number; gLat?: number;
  /** Screen position / visibility from the last grouping pass. */
  sx: number; sy: number; vis: boolean;
  /** Behind the horizon: the badges ignore the depth test (so they show above terrain), hence they must be hidden explicitly. */
  hid: boolean;
}

export interface StrategicApi {
  /** Visible formation states (id → lon/lat/relation) for other layers (minimap, tests). */
  states(): { id: FormationId; lon: number; lat: number; rel: Rel; country: CountryId; clustered: boolean; groupN: number; models: number; modelIds: string[] }[];
  modelCount(): number;
  destroy(): void;
}

export function attachStrategic(globe: Globe, getGame: () => Game | null, pool: ModelPool): StrategicApi {
  const viewer = globe.viewer, scene = viewer.scene;
  const gh = groundOf(globe);
  const bills = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
  const routes = scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
  const dests = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
  const states = new Map<FormationId, FS>();
  const built = new Map<string, HTMLCanvasElement>();
  const glyphs = new Map<string, HTMLImageElement>();
  let lastHours = -1, dirty = true, lastRefresh = 0, dead = false;
  let mul = 1;

  // ------------------------------------------------------------ images
  const barLevel = (v: FormationView) => `${Math.round(v.strength * 10)}:${Math.round(v.organization * 4)}`;
  function barCanvas(key: string): HTMLCanvasElement {
    const [s, o] = key.split(':').map(Number);
    const c = document.createElement('canvas');
    c.width = 40; c.height = 10;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, 40, 10);
    const sv = s / 10;
    g.fillStyle = sv > 0.6 ? '#53d36f' : sv > 0.3 ? '#f2c84b' : '#ef5350';
    g.fillRect(2, 2, 36 * sv, 4);
    g.fillStyle = '#58a6ff'; g.fillRect(2, 7, 36 * (o / 4), 1.5);
    return c;
  }
  function setImg(b: Cesium.Billboard, key: string, make: () => HTMLCanvasElement) {
    let c = built.get(key);
    if (!c) built.set(key, (c = make()));
    b.setImage(key, c);
  }
  function applyIcon(fs: FS) {
    const glyph = fs.gGlyph ?? glyphOf(fs);
    const key = `i:${glyph}:${fs.rel}`;
    if (fs.keys.icon === key) return;
    const img = glyphs.get(glyph);
    if (!img) {
      void svgImage(glyph, '#ffffff').then((i) => { glyphs.set(glyph, i); if (!dead) { fs.keys.icon = ''; applyIcon(fs); scene.requestRender(); } });
      return;
    }
    fs.keys.icon = key;
    setImg(fs.icon, key, () => badgeCanvas(img, REL_COLOR[fs.rel], 44, fs.rel === 'rebel'));
  }

  // ------------------------------------------------------------ sync with the game
  function relOf(g: Game, c: CountryId, v: FormationView): Rel {
    const me = g.state.meta.playerCountryId;
    if (v.rebel) return 'rebel';
    if (c === me) return 'own';
    const d = g.ctx.api.diplomacy;
    return d.atWar(me, c) ? 'enemy' : d.allied(me, c) ? 'ally' : 'neutral';
  }
  function create(g: Game, v: FormationView, rel: Rel): FS {
    const tag = { __fs: true as const, ids: [v.id] };
    const p0 = Cesium.Cartesian3.fromDegrees(v.pos[0], v.pos[1]);
    const mk = (extra: Partial<Cesium.Billboard.ConstructorOptions>) => bills.add({ id: tag, position: p0, disableDepthTestDistance: FAR, ...extra });
    const iso = g.world.countryById.get(v.country)?.iso2?.toLowerCase();
    const fs: FS = {
      id: v.id, v, rel, lon: v.pos[0], lat: v.pos[1], hdg: v.heading, tlon: v.pos[0], tlat: v.pos[1], thdg: v.heading, settled: true, tag,
      icon: mk({ width: 38, height: 38 }),
      flag: mk({ width: 22, height: 15, pixelOffset: V(-17, -17), image: iso ? assetUrl(`data/flags/${iso}.svg`) : undefined }),
      bar: mk({ width: 36, height: 9, pixelOffset: V(0, 26) }),
      keys: { icon: '', bar: '', flag: iso ?? '' }, handles: [], modelSig: '', cluster: null, gN: 0, sx: 0, sy: 0, vis: false, hid: false,
    };
    return fs;
  }
  function update(g: Game, fs: FS, v: FormationView, rel: Rel) {
    const moved = Math.abs(v.pos[0] - fs.tlon) + Math.abs(v.pos[1] - fs.tlat) > 1e-7 || Math.abs(v.heading - fs.thdg) > 0.1;
    fs.v = v;
    if (rel !== fs.rel) { fs.rel = rel; fs.keys.icon = ''; }
    fs.tlon = v.pos[0]; fs.tlat = v.pos[1]; fs.thdg = v.heading;
    if (moved) fs.settled = false;
    applyIcon(fs);
    const bk = barLevel(v);
    if (bk !== fs.keys.bar) { fs.keys.bar = bk; setImg(fs.bar, `b:${bk}`, () => barCanvas(bk)); }
    void g;
  }
  function refresh(force = false) {
    const g = getGame();
    if (!g || dead) return;
    const hours = g.state.time.hours;
    const now = performance.now();
    if (!force && !dirty && hours === lastHours) return;
    if (!force && now - lastRefresh < 250) return;
    lastRefresh = now; lastHours = hours; dirty = false;
    const me = g.state.meta.playerCountryId;
    const list = visibleFormations(g.ctx, me);
    const seen = new Set<FormationId>();
    let anyMove = false;
    for (const v of list) {
      seen.add(v.id);
      const rel = relOf(g, v.country, v);
      let fs = states.get(v.id);
      if (!fs) { fs = create(g, v, rel); states.set(v.id, fs); applyIcon(fs); const bk = barLevel(v); fs.keys.bar = bk; setImg(fs.bar, `b:${bk}`, () => barCanvas(bk)); }
      else update(g, fs, v, rel);
      if (!fs.settled) anyMove = true;
    }
    for (const [id, fs] of states) if (!seen.has(id)) remove(fs, id);
    lastRegroup = 0;
    layout();
    updateSelectionVisuals();
    if (anyMove) renderLock(globe, 'units', true);
    globe.minimap.redraw();
    globe.requestRender();
  }
  function remove(fs: FS, id: FormationId) {
    fs.handles.forEach((h) => pool.release(h));
    for (const b of [fs.icon, fs.flag, fs.bar, fs.ring, fs.count]) if (b) bills.remove(b);
    states.delete(id);
    const sel = useUnitSelection.getState();
    if (sel.selected.includes(id)) sel.select(sel.selected.filter((x) => x !== id));
  }

  // ------------------------------------------------------------ positions & models
  const cart = new Cesium.Cartesian3();
  const liftOf = (fs: FS, near: boolean) => (near ? (fs.v.domain === 'air' ? 1500 + mul * 30 : fs.v.domain === 'naval' ? 0 : gh(fs.lon, fs.lat)) + mul * 22 : 0);
  function applyPos(fs: FS) {
    const near = fs.handles.some((h) => h.model);
    Cesium.Cartesian3.fromDegrees(fs.gLon ?? fs.lon, fs.gLat ?? fs.lat, liftOf(fs, near), undefined, cart);
    fs.icon.position = cart; fs.flag.position = cart; fs.bar.position = cart;
    if (fs.ring) fs.ring.position = cart;
    if (fs.count) fs.count.position = cart;
    if (fs.handles.length) placeModels(fs);
  }
  function desired(fs: FS): string[] {
    const out: string[] = [];
    const naval = fs.v.domain === 'naval';
    const cc = fs.v.rebel ? 'REB' : fs.v.country;
    for (const [ui, u] of fs.v.units.slice(0, 6).entries()) {
      if (u.strength < 0.02) continue;
      const mid = resolveModel(u.modelId, cc, `${fs.id}:${ui}`, { mf: pool.manifest });
      const ents = UNITS[u.template]?.ents ?? 4;
      const n = naval ? 1 : clamp(Math.round((ents * u.strength) / 4), 1, 3);
      for (let i = 0; i < n && out.length < (naval ? 6 : 12); i++) out.push(mid);
    }
    return out;
  }
  function placeModels(fs: FS) {
    const n = fs.handles.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5)));
    const sp = (fs.v.domain === 'naval' ? 260 : fs.v.domain === 'air' ? 160 : 70) * mul;
    const h = rad(fs.hdg), fx = Math.sin(h), fy = Math.cos(h);
    fs.handles.forEach((hd, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const right = (col - (Math.min(n, cols) - 1) / 2) * sp, back = row * sp;
      const [lo, la] = offsetLonLat(fs.lon, fs.lat, right * fy - back * fx, -right * fx - back * fy);
      const naval = fs.v.domain === 'naval';
      // a ship slot that falls on land (formation spread around a naval base) would hang over hills: keep only the icon there
      if (naval && gh(lo, la) > 2) { pool.hide(hd); return; }
      const ht = fs.v.domain === 'air' ? gh(lo, la) + 1500 + mul * 30 : naval ? 0 : gh(lo, la);
      pool.place(hd, lo, la, ht, fs.hdg, mul);
    });
  }
  function updateNear() {
    const cam = globe.cameraState();
    // exaggeration for legibility from afar; it fades out below CITY_H, where the 3D city is drawn at real scale
    // (a 150 m ship x20 became a 3 km hull over the Rio hills)
    mul = cam.height >= CITY_H ? clamp(cam.height / 250, 3, 40) : clamp((cam.height / 250) * (cam.height / CITY_H) ** 2, 1, 40);
    const near = !mode.tactical && cam.height < NEAR_H;
    let budget = MAX_MODELS;
    const W = scene.canvas.clientWidth / 2, H = scene.canvas.clientHeight / 2;
    // models only for formations that are their own icon on screen (grouped ones are one icon with a count, their models are not drawn)
    const cand = near ? [...states.values()].filter((fs) => fs.vis && fs.cluster === null && fs.gN === 0).sort((a, b) => (a.sx - W) ** 2 + (a.sy - H) ** 2 - ((b.sx - W) ** 2 + (b.sy - H) ** 2)) : [];
    const keep = new Set<FS>();
    for (const fs of cand) {
      if (budget <= 0) break;
      const want = desired(fs).slice(0, budget);
      const sig = want.join(',');
      if (sig !== fs.modelSig) {
        fs.handles.forEach((h) => pool.release(h));
        fs.handles = want.map((m) => pool.acquire(m, fs.tag)).filter(Boolean) as ModelHandle[];
        fs.modelSig = sig;
      }
      budget -= fs.handles.length;
      keep.add(fs);
      applyPos(fs);
    }
    drawn = 0; for (const f of keep) drawn += f.handles.length;
    for (const fs of states.values()) {
      if (keep.has(fs)) continue;
      if (fs.handles.length) { fs.handles.forEach((h) => pool.release(h)); fs.handles = []; fs.modelSig = ''; applyPos(fs); }
    }
    // markers: a member of a group shows nothing; the badge of a single formation hides once its model is on screen
    for (const fs of states.values()) {
      const hasModel = fs.handles.some((h) => h.model), member = fs.cluster !== null;
      fs.icon.show = !fs.hid && !hasModel && !member; fs.flag.show = !fs.hid && !member; fs.bar.show = !fs.hid && !member;
      const f = hasModel ? 1 : 0;
      fs.flag.pixelOffset = V(-17, -17 - f * 10); fs.bar.pixelOffset = V(0, f ? 14 : 26);
    }
    globe.requestRender();
  }

  // ------------------------------------------------------------ screen-space grouping (supercluster) of every icon, far and near
  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, Cesium.Cartesian3.ZERO);
  const wp = new Cesium.Cartesian3();
  const glyphOf = (fs: FS) => (fs.v.units[0] ? UNITS[fs.v.units[0].template]?.iconId : undefined) ?? 'infantry';
  let lastRegroup = 0, regroupTimer = 0;
  /** Throttled (the camera fires every frame while it moves). */
  function layout() {
    const now = performance.now();
    if (now - lastRegroup < 120) { if (!regroupTimer) regroupTimer = window.setTimeout(() => { regroupTimer = 0; layout(); }, 130); return; }
    lastRegroup = now;
    regroup();
  }
  function regroup() {
    if (dead) return;
    const cam = globe.cameraState(), near = !mode.tactical && cam.height < NEAR_H;
    const sel = new Set(useUnitSelection.getState().selected);
    occluder.cameraPosition = scene.camera.positionWC;
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
    const items: ClusterItem<FS>[] = [];
    for (const fs of states.values()) {
      fs.cluster = null; fs.vis = false; fs.hid = true;
      Cesium.Cartesian3.fromDegrees(fs.lon, fs.lat, near && fs.v.domain === 'land' ? gh(fs.lon, fs.lat) : 0, undefined, wp);
      if (!occluder.isPointVisible(wp)) continue;
      fs.hid = false;
      const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, wp);
      if (!w) continue;
      fs.sx = w.x; fs.sy = w.y;
      if (w.x < -60 || w.x > W + 60 || w.y < -60 || w.y > H + 60) continue;
      fs.vis = true;
      if (sel.has(fs.id)) continue; // selected formations stay individual
      items.push({ x: w.x, y: w.y, side: fs.rel, kind: glyphOf(fs), weight: Math.max(0.05, fs.v.strength), ref: fs });
    }
    nPass++; nVis = items.length;
    const res = clusterOn ? clusterScreen(items, CLUSTER_PX, 2) : { groups: [], singles: items };
    for (const fs of states.values()) {
      const wasG = fs.gGlyph;
      fs.icon.show = fs.flag.show = fs.bar.show = !fs.hid; fs.tag.ids = [fs.id]; fs.gN = 0; fs.gGlyph = undefined; fs.gLon = fs.gLat = undefined;
      if (fs.count) fs.count.show = false;
      if (wasG) { fs.keys.icon = ''; applyIcon(fs); }
    }
    nGrouped = 0; nGroups = res.groups.length;
    for (const grp of res.groups) {
      const mem = grp.members.map((m) => m.ref).sort((a, b) => b.v.strength - a.v.strength), lead = mem[0], ids = mem.map((f) => f.id);
      lead.tag.ids = ids; lead.gN = mem.length; lead.gGlyph = grp.kind;
      let lo = 0, la = 0;
      for (const f of mem) { lo += f.lon; la += f.lat; }
      lead.gLon = lo / mem.length; lead.gLat = la / mem.length;
      for (let i = 1; i < mem.length; i++) { const f = mem[i]; f.cluster = lead; f.icon.show = f.flag.show = f.bar.show = false; f.tag.ids = ids; }
      nGrouped += mem.length;
      lead.keys.icon = ''; applyIcon(lead);
      const n = mem.length;
      if (!lead.count) lead.count = bills.add({ position: Cesium.Cartesian3.ZERO, id: lead.tag, width: 34, height: 18, pixelOffset: V(19, -17), disableDepthTestDistance: FAR });
      setImg(lead.count, `c:${Math.min(n, 99)}`, () => textBadge(n > 99 ? '×99+' : `×${n}`, '#c0392b'));
      lead.count.show = true;
    }
    for (const fs of states.values()) applyPos(fs);
    updateNear();
  }
  
  // ------------------------------------------------------------ selection visuals, routes
  const ringImg = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 72;
    const g = c.getContext('2d')!;
    g.lineWidth = 4; g.strokeStyle = '#ffe14d'; g.setLineDash([9, 5]);
    g.beginPath(); g.arc(36, 36, 31, 0, Math.PI * 2); g.stroke();
    return c;
  })();
  function updateSelectionVisuals() {
    const g = getGame();
    const sel = new Set(useUnitSelection.getState().selected);
    for (const fs of states.values()) {
      const on = sel.has(fs.id);
      if (on && !fs.ring) { fs.ring = bills.add({ id: fs.tag, width: 64, height: 64, disableDepthTestDistance: FAR, position: fs.icon.position }); setImg(fs.ring, 'ring', () => ringImg); }
      if (fs.ring) fs.ring.show = on && fs.cluster === null && !fs.hid;
    }
    routes.removeAll(); dests.removeAll();
    if (!g) return;
    const nearTerrain = globe.cameraHeight() < 400_000;
    for (const id of sel) {
      const fs = states.get(id);
      if (!fs || fs.rel !== 'own') continue;
      let pts: LonLat[] = formationRoute(g.ctx, id);
      const dest = fs.v.destination;
      if (!pts.length && dest) pts = [dest];
      if (!pts.length) continue;
      let bi = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = (p[0] - fs.lon) ** 2 + (p[1] - fs.lat) ** 2; if (d < bd) { bd = d; bi = i; } });
      const rest = [[fs.lon, fs.lat] as LonLat, ...pts.slice(bi + 1)];
      const flat: number[] = [];
      for (const p of rest) flat.push(p[0], p[1], nearTerrain ? gh(p[0], p[1]) + 20 : 0);
      if (rest.length < 2) continue;
      routes.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 3.5, material: Cesium.Material.fromType('PolylineDash', { color: Cesium.Color.fromCssColorString('#ffe14d'), dashLength: 14 }) });
      const end = rest[rest.length - 1];
      const d = dests.add({ position: Cesium.Cartesian3.fromDegrees(end[0], end[1], nearTerrain ? gh(end[0], end[1]) + 20 : 0), width: 22, height: 22, disableDepthTestDistance: FAR });
      setImg(d, 'dest', () => badgeCanvas(glyphs.get('move') ?? null, '#ffe14d', 32));
    }
    scene.requestRender();
  }
  void svgImage('move', '#ffe14d').then((i) => { glyphs.set('move', i); });
  const unsubSel = useUnitSelection.subscribe(() => { lastRegroup = 0; layout(); updateSelectionVisuals(); });

  // ------------------------------------------------------------ per-frame smoothing
  let last = performance.now();
  const onPre = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 5);
    let moving = false;
    for (const fs of states.values()) {
      if (fs.settled) continue;
      const dl = fs.tlon - fs.lon, db = fs.tlat - fs.lat, dh = fs.thdg - fs.hdg;
      if (Math.abs(dl) + Math.abs(db) < 2e-6 && Math.abs(((dh + 540) % 360) - 180) < 0.3) { fs.lon = fs.tlon; fs.lat = fs.tlat; fs.hdg = fs.thdg; fs.settled = true; applyPos(fs); continue; }
      fs.lon += dl * k; fs.lat += db * k; fs.hdg = lerpAngle(fs.hdg, fs.thdg, k);
      moving = true;
      applyPos(fs);
    }
    if (!moving) renderLock(globe, 'units', false);
  };
  scene.preRender.addEventListener(onPre);

  // ------------------------------------------------------------ input
  const unPick = globe.registerPickable((p) => {
    const id = p.id as { __fs?: boolean; ids?: string[] } | undefined;
    return id?.__fs && id.ids ? { kind: 'formation', id: id.ids[0], data: { ids: id.ids } } : undefined;
  });
  const idsOf = (f?: { kind: string; data?: unknown }) => (f?.kind === 'formation' ? ((f.data as { ids: string[] }).ids ?? []) : []);
  const unClick = globe.on('click', (e) => {
    const ids = idsOf(e.pick.feature);
    const s = useUnitSelection.getState();
    if (ids.length) { if (e.shift) s.toggle(ids[0]); else s.select(ids); } else if (!e.shift) s.clear();
  });
  const unBox = globe.on('box', (b) => {
    const hit: FormationId[] = [];
    for (const fs of states.values()) {
      if (fs.rel !== 'own' || fs.cluster) continue;
      const p = globe.toScreen(fs.lon, fs.lat, 0);
      if (p && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) hit.push(fs.id);
    }
    useUnitSelection.getState().select(hit, b.ctrl);
  });
  const unRight = globe.on('rightclick', (e) => {
    const g = getGame();
    if (!g) return;
    const me = g.state.meta.playerCountryId;
    const own = useUnitSelection.getState().selected.filter((id) => states.get(id)?.rel === 'own');
    if (!own.length) return;
    const at = g.ctx.api.diplomacy;
    const f = e.pick.feature;
    const tgtFs = idsOf(f).map((id) => states.get(id)).find((s) => s && s.rel !== 'own');
    const enemyHere = !!e.pick.countryId && at.atWar(me, e.pick.countryId);
    const report = (r: { ok: boolean; reason?: string }) => { if (!r.ok) renderEvents.emit({ type: 'commandRejected', reason: r.reason ?? '' }); };
    const strikeKinds = ['city', 'plant', 'airport', 'port'];
    if (f && strikeKinds.includes(f.kind) && f.index != null && enemyHere) {
      const ground = own.filter((id) => states.get(id)!.v.domain !== 'air');
      for (const id of own) if (states.get(id)!.v.domain === 'air') report(g.dispatch(milCmd.strike(me, id, { kind: f.kind as 'city', index: f.index })));
      if (ground.length && e.pick.lonLat) report(g.dispatch(milCmd.move(me, ground, e.pick.lonLat, true)));
    } else if (tgtFs) {
      const pos: LonLat = [tgtFs.lon, tgtFs.lat];
      const air = own.filter((id) => states.get(id)!.v.domain === 'air');
      if (tgtFs.rel === 'enemy') for (const id of air) report(g.dispatch(milCmd.strike(me, id, { kind: 'formation', id: tgtFs.id })));
      const rest = tgtFs.rel === 'enemy' ? own.filter((id) => !air.includes(id)) : own;
      if (rest.length) report(g.dispatch(milCmd.move(me, rest, pos, tgtFs.rel === 'enemy')));
    } else if (e.pick.lonLat) report(g.dispatch(milCmd.move(me, own, e.pick.lonLat, enemyHere)));
    dirty = true;
    setTimeout(() => refresh(true), 60);
  });
  const unCam = globe.onCamera(() => { layout(); });
  const unOverlay = globe.minimap.addOverlay((g, project) => {
    for (const fs of states.values()) {
      const [x, y] = project(fs.lon, fs.lat);
      g.fillStyle = REL_COLOR[fs.rel];
      g.fillRect(x - 1, y - 1, 2.4, 2.4);
    }
  });
  const timer = setInterval(() => { bills.show = routes.show = dests.show = !mode.tactical; refresh(); updateNearIfNeeded(); if (++regroupTick % 4 === 0) layout(); }, 250);
  let nearTick = 0, regroupTick = 0;
  function updateNearIfNeeded() {
    if (globe.cameraHeight() < NEAR_H && ++nearTick % 4 === 0) updateNear();
  }
  refresh(true);
  updateNear();

  return {
    states: () => [...states.values()].map((s) => ({ id: s.id, lon: s.lon, lat: s.lat, rel: s.rel, country: s.v.country, clustered: s.cluster !== null, groupN: s.gN, models: s.handles.length, modelIds: s.handles.map((h) => h.modelId) })),
    modelCount: () => [...states.values()].reduce((a, s) => a + s.handles.length, 0),
    destroy() {
      dead = true;
      clearInterval(timer); clearTimeout(regroupTimer);
      scene.preRender.removeEventListener(onPre);
      unsubSel(); unPick(); unClick(); unBox(); unRight(); unCam(); unOverlay();
      for (const [id, fs] of states) remove(fs, id);
      scene.primitives.remove(bills); scene.primitives.remove(routes); scene.primitives.remove(dests);
      renderLock(globe, 'units', false);
    },
  };
}
