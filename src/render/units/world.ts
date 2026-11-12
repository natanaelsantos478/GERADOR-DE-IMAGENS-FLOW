/** Map layers other than formations: built structures, battles, missiles in flight, radiation, strike/nuke effects. */
import * as Cesium from 'cesium';
import type { LonLat, StructureView } from '../../core/contracts';
import type { Game } from '../../core/game';
import { battlePreviews, missilesInFlight, radiationZones } from '../../sim/military';
import type { Globe } from '../globe/types';
import { mode, ModelPool, groundOf, badgeCanvas, clamp, renderEvents, renderLock, svgImage } from './common';
import { createFx } from './fx';

const FAR = Number.POSITIVE_INFINITY;
const V = (x: number, y: number) => new Cesium.Cartesian2(x, y);
const STRUCT_NEAR_H = 25_000, STRUCT_ICON_H = 4_000_000, MAX_STRUCT_MODELS = 60, MAX_FIRES = 10;

function look(s: StructureView): { model?: string; icon: string } | null {
  switch (s.kind) {
    case 'powerPlant': {
      const f = s.fuel;
      return f === 'nuclear' ? { model: 'plant_nuclear', icon: 'nuclear' } : f === 'hydro' ? { model: 'plant_hydro', icon: 'hydro' }
        : f === 'wind' ? { model: 'wind_turbine', icon: 'wind' } : f === 'solar' ? { model: 'solar_farm', icon: 'solar' } : { model: 'plant_thermal', icon: 'energy' };
    }
    case 'civilFactory': return { model: 'factory', icon: 'factory' };
    case 'militaryFactory': return { model: 'factory', icon: 'mil_factory' };
    case 'refinery': return { model: 'refinery', icon: 'oil_plant' };
    case 'port': return { model: 'port', icon: 'port' };
    case 'airport': return { model: 'airport', icon: 'airport' };
    case 'militaryBase': return { model: 'military_base', icon: 'base' };
    case 'airDefense': return { model: 'sam', icon: 'sam_site' };
    case 'radar': return { model: 'radar', icon: 'radar' };
    case 'mine': return { icon: 'mine' };
    case 'farm': return { icon: 'farm' };
    case 'hospital': return { icon: 'hospital' };
    case 'university': return { icon: 'university' };
    case 'silo': return { icon: 'silo' };
    case 'bunker': return { icon: 'bunker' };
    default: return null;
  }
}

export interface WorldLayerApi {
  fx: ReturnType<typeof createFx>;
  counts(): { structures: number; structureModels: number; battles: number; missiles: number; radiation: number; fires: number };
  destroy(): void;
}

export function attachWorldLayer(globe: Globe, getGame: () => Game | null, pool: ModelPool, visibleFormation: (id: string) => boolean): WorldLayerApi {
  const viewer = globe.viewer, scene = viewer.scene;
  const gh = groundOf(globe);
  const fx = createFx(globe);
  const bills = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
  const labels = scene.primitives.add(new Cesium.LabelCollection({ scene })) as Cesium.LabelCollection;
  const lines = scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
  const radEnts = new Map<string, Cesium.Entity>();
  const glyph = new Map<string, HTMLImageElement>();
  const imgs = new Map<string, HTMLCanvasElement>();
  let dead = false, lastH = -1, pulse = false;

  const img = (b: Cesium.Billboard, name: string, color: string, size = 40, ring?: string) => {
    const key = `${name}|${color}|${ring ?? ''}`;
    const g = glyph.get(name);
    if (!g) { void svgImage(name, '#fff').then((i) => { glyph.set(name, i); if (!dead) { imgs.delete(key); img(b, name, color, size, ring); scene.requestRender(); } }); return; }
    let c = imgs.get(key);
    if (!c) imgs.set(key, (c = badgeCanvas(g, ring ?? color, size)));
    b.setImage(key, c);
  };

  // ------------------------------------------------------------ structures
  interface SS { s: StructureView; b: Cesium.Billboard; h: ReturnType<ModelPool['acquire']>; modelKey: string }
  const structs = new Map<number | string, SS>();
  function syncStructures(g: Game) {
    const list = g.ctx.api.economy.structures({ includeUnfinished: true }).filter((s) => look(s));
    const seen = new Set<number | string>();
    for (const s of list) {
      seen.add(s.id);
      let e = structs.get(s.id);
      const lk = look(s)!;
      const stage = s.progress < 1 ? 'c' : s.health < 0.7 ? 'd' : 'o';
      if (!e) {
        const b = bills.add({ position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat), width: 30, height: 30, disableDepthTestDistance: FAR, id: { __st: true, sid: s.id }, show: false });
        e = { s, b, h: null, modelKey: '' };
        structs.set(s.id, e);
      }
      e.s = s;
      img(e.b, s.progress < 1 ? 'construction' : lk.icon, '', 30, s.progress < 1 ? '#ffb02e' : s.health < 0.7 ? '#ff6a4d' : '#9fb4c8');
      void stage;
    }
    for (const [id, e] of structs) if (!seen.has(id)) { bills.remove(e.b); if (e.h) pool.release(e.h); structs.delete(id); fx.stopFire(`s${id}`); }
  }
  function nearStructures() {
    const cam = globe.cameraState();
    const showIcons = cam.height < STRUCT_ICON_H;
    const near = cam.height < STRUCT_NEAR_H && cam.view;
    const mul = clamp(cam.height / 3000, 1, 12);
    const view = cam.view;
    const inView = (s: StructureView) => !!view && s.lon > view[0] - 0.05 && s.lon < view[2] + 0.05 && s.lat > view[1] - 0.05 && s.lat < view[3] + 0.05;
    const cand: SS[] = [];
    for (const e of structs.values()) {
      e.b.show = showIcons && !(near && e.h?.model);
      if (near && inView(e.s)) cand.push(e);
    }
    cand.sort((a, b) => (a.s.lon - cam.lon) ** 2 + (a.s.lat - cam.lat) ** 2 - ((b.s.lon - cam.lon) ** 2 + (b.s.lat - cam.lat) ** 2));
    const keep = new Set<SS>();
    for (const e of cand.slice(0, MAX_STRUCT_MODELS)) {
      const m = look(e.s)?.model;
      if (!m) continue;
      if (!e.h) e.h = pool.acquire(m, { __st: true, sid: e.s.id });
      if (!e.h) continue;
      keep.add(e);
      const building = e.s.progress < 1;
      pool.setTint(e.h, building ? 2 : e.s.health < 0.5 ? 1 : 0);
      pool.place(e.h, e.s.lon, e.s.lat, gh(e.s.lon, e.s.lat), 0, mul * (building ? 0.35 + 0.65 * e.s.progress : 1));
    }
    for (const e of structs.values()) if (!keep.has(e) && e.h) { pool.release(e.h); e.h = null; }
    // fires on damaged structures, nearest first
    const burning = [...structs.values()].filter((e) => e.s.progress >= 1 && e.s.health < 0.7 && cam.height < 600_000 && inView(e.s)).slice(0, MAX_FIRES);
    const want = new Set(burning.map((e) => `s${e.s.id}`));
    for (const k of fx.fireKeys()) if (k.startsWith('s') && !want.has(k)) fx.stopFire(k);
    for (const e of burning) fx.fire(`s${e.s.id}`, [e.s.lon, e.s.lat], gh(e.s.lon, e.s.lat));
  }

  // ------------------------------------------------------------ battles
  interface BB { b: Cesium.Billboard; l: Cesium.Label; pos: LonLat }
  const battles = new Map<string, BB>();
  function syncBattles(g: Game) {
    const me = g.state.meta.playerCountryId;
    const list = battlePreviews(g.ctx).filter((b) => b.attackerCountries.includes(me) || b.defenderCountries.includes(me) || b.attackers.some(visibleFormation) || b.defenders.some(visibleFormation));
    const seen = new Set<string>();
    for (const bt of list) {
      seen.add(bt.id);
      let e = battles.get(bt.id);
      if (!e) {
        const pos = Cesium.Cartesian3.fromDegrees(bt.pos[0], bt.pos[1]);
        const b = bills.add({ position: pos, width: 40, height: 40, disableDepthTestDistance: FAR, id: { __battle: true, bid: bt.id } });
        img(b, 'war', '#ff4d4d', 44);
        const l = labels.add({ position: pos, pixelOffset: V(0, 34), font: '600 13px system-ui', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: Cesium.HorizontalOrigin.CENTER, disableDepthTestDistance: FAR, translucencyByDistance: new Cesium.NearFarScalar(1e6, 1, 2e7, 0.3) });
        e = { b, l, pos: bt.pos };
        battles.set(bt.id, e);
      }
      const tot = bt.attackerStrength + bt.defenderStrength || 1;
      e.l.text = `${Math.round((bt.attackerStrength / tot) * 100)}% × ${Math.round((bt.defenderStrength / tot) * 100)}%${bt.etaDays != null ? ` · ~${bt.etaDays}d` : ''}`;
    }
    for (const [id, e] of battles) if (!seen.has(id)) { bills.remove(e.b); labels.remove(e.l); battles.delete(id); }
  }

  // ------------------------------------------------------------ missiles
  interface MS { h: ReturnType<ModelPool['acquire']>; trail: Cesium.Polyline; p0: number; t0: number; rate: number; from: LonLat; to: LonLat; weapon: string; geo: Cesium.EllipsoidGeodesic }
  const missiles = new Map<number, MS>();
  const missileAt = (m: MS, f: number): [number, number, number] => {
    const c = m.geo.interpolateUsingFraction(clamp(f, 0, 1));
    const dist = m.geo.surfaceDistance;
    const apex = m.weapon === 'cruise' ? 900 : clamp(dist * 0.13, 40_000, 700_000);
    const alt = m.weapon === 'cruise' ? apex : 4 * apex * f * (1 - f) + 1000;
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude), alt];
  };
  function syncMissiles(g: Game) {
    const list = missilesInFlight(g.ctx);
    const seen = new Set<number>();
    const now = performance.now();
    for (const f of list) {
      seen.add(f.id);
      let m = missiles.get(f.id);
      if (!m) {
        const geo = new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(f.from[0], f.from[1]), Cesium.Cartographic.fromDegrees(f.to[0], f.to[1]));
        m = { h: pool.acquire('missile', { __missile: true, mid: f.id }), trail: lines.add({ positions: [], width: 3, material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#ffcf8a').withAlpha(0.8) }) }), p0: f.progress, t0: now, rate: 0, from: f.from, to: f.to, weapon: f.weapon, geo };
        missiles.set(f.id, m);
      } else {
        const dt = (now - m.t0) / 1000;
        if (dt > 0.05) m.rate = Math.max(0, (f.progress - m.p0) / dt);
        m.p0 = f.progress; m.t0 = now;
      }
    }
    for (const [id, m] of missiles) if (!seen.has(id)) { if (m.h) pool.release(m.h); lines.remove(m.trail); missiles.delete(id); }
    renderLock(globe, 'missiles', missiles.size > 0);
  }
  const onPre = () => {
    const now = performance.now();
    for (const m of missiles.values()) {
      const f = clamp(m.p0 + m.rate * ((now - m.t0) / 1000), 0, 1);
      const [lo, la, alt] = missileAt(m, f);
      const pts: number[] = [];
      for (let i = 0; i <= 14; i++) { const [a, b, c] = missileAt(m, (f * i) / 14); pts.push(a, b, c); }
      m.trail.positions = Cesium.Cartesian3.fromDegreesArrayHeights(pts);
      if (m.h) {
        const [lo2, la2] = missileAt(m, Math.min(1, f + 0.01));
        const hdg = Cesium.Math.toDegrees(Math.atan2((lo2 - lo) * Math.cos(Cesium.Math.toRadians(la)), la2 - la));
        pool.place(m.h, lo, la, alt, hdg, Math.max(1, globe.cameraHeight() / 435));
      }
    }
  };
  scene.preRender.addEventListener(onPre);

  // ------------------------------------------------------------ radiation
  function syncRadiation(g: Game) {
    const zs = radiationZones(g.ctx);
    const seen = new Set<string>();
    for (const z of zs) {
      const k = `${z.pos[0].toFixed(3)},${z.pos[1].toFixed(3)}`;
      seen.add(k);
      if (radEnts.has(k)) continue;
      radEnts.set(k, viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(z.pos[0], z.pos[1]), ellipse: { semiMajorAxis: 30_000, semiMinorAxis: 30_000, material: Cesium.Color.fromCssColorString('#c8ff2e').withAlpha(0.28), outline: true, outlineColor: Cesium.Color.fromCssColorString('#e6ff7a') } }));
    }
    for (const [k, e] of radEnts) if (!seen.has(k)) { viewer.entities.remove(e); radEnts.delete(k); }
  }

  // ------------------------------------------------------------ events
  let offs: (() => void)[] = [], bound: Game | null = null;
  function bindBus() {
    const g = getGame();
    if (g === bound) return;
    offs.forEach((f) => f());
    offs = [];
    bound = g;
    if (!g) return;
    const bus = g.bus;
    offs.push(bus.on('mil.strike', (e) => { const p = (e as { pos: LonLat; intercepted: boolean }); fx.explosion(p.pos, !p.intercepted); renderEvents.emit({ type: 'explosion', pos: p.pos, size: p.intercepted ? 'small' : 'large' }); }));
    offs.push(bus.on('mil.nukeDetonated', (e) => { const p = (e as { pos: LonLat }).pos; fx.nuke(p); renderEvents.emit({ type: 'nuke', pos: p }); }));
    offs.push(bus.on('mil.missileLaunched', (e) => { const p = e as { from: LonLat; weapon: string }; renderEvents.emit({ type: 'missileLaunch', pos: p.from, weapon: p.weapon }); }));
    offs.push(bus.on('mil.battleStarted', (e) => { renderEvents.emit({ type: 'battleStart', pos: (e as { pos: LonLat }).pos }); lastH = -1; }));
    offs.push(bus.on('mil.formationDestroyed', (e) => { const p = (e as { pos: LonLat }).pos; fx.explosion(p, false); renderEvents.emit({ type: 'explosion', pos: p, size: 'small' }); }));
    lastH = -1;
  }

  // ------------------------------------------------------------ minimap + resolvers
  const unPick = globe.registerPickable((p) => {
    const id = p.id as { __st?: boolean; sid?: number; __battle?: boolean; bid?: string; __missile?: boolean; mid?: number } | undefined;
    if (id?.__battle) return { kind: 'battle', id: id.bid! };
    if (id?.__st) return { kind: 'structure', id: id.sid! };
    if (id?.__missile) return { kind: 'missile', id: id.mid! };
    return undefined;
  });
  const unOverlay = globe.minimap.addOverlay((g, project) => {
    for (const b of battles.values()) {
      const [x, y] = project(b.pos[0], b.pos[1]);
      g.strokeStyle = '#ff3b30'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, pulse ? 4.5 : 3, 0, Math.PI * 2); g.stroke();
    }
  });
  const unCam = globe.onCamera(() => { nearStructures(); });

  function refresh(force = false) {
    const g = getGame();
    if (!g || dead) return;
    const h = g.state.time.hours;
    if (!force && h === lastH) return;
    lastH = h;
    syncStructures(g); syncBattles(g); syncRadiation(g);
    nearStructures();
    globe.minimap.redraw();
    globe.requestRender();
  }
  const timer = setInterval(() => { bindBus(); refresh(); const g = getGame(); if (g) syncMissiles(g); }, 300);
  const pulser = setInterval(() => {
    pulse = !pulse;
    bills.show = labels.show = !mode.tactical;
    for (const b of battles.values()) b.b.scale = pulse ? 1.2 : 0.95;
    if (battles.size) globe.requestRender();
  }, 600);
  refresh(true);

  return {
    fx,
    counts: () => ({ structures: structs.size, structureModels: [...structs.values()].filter((e) => e.h?.model).length, battles: battles.size, missiles: missiles.size, radiation: radEnts.size, fires: fx.fireKeys().length }),
    destroy() {
      dead = true;
      clearInterval(timer); clearInterval(pulser);
      scene.preRender.removeEventListener(onPre);
      offs.forEach((f) => f()); unPick(); unOverlay(); unCam();
      for (const e of structs.values()) if (e.h) pool.release(e.h);
      for (const m of missiles.values()) if (m.h) pool.release(m.h);
      radEnts.forEach((e) => viewer.entities.remove(e));
      fx.destroy();
      scene.primitives.remove(bills); scene.primitives.remove(labels); scene.primitives.remove(lines);
      renderLock(globe, 'missiles', false);
    },
  };
}
