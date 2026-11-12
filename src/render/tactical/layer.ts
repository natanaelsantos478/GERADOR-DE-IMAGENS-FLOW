/** Tactical battle on the real globe: glb entities on terrain, projectiles, smoke, objectives, selection and orders. */
import * as Cesium from 'cesium';
import type { Game } from '../../core/game';
import { setTacticalMapProvider } from '../../sim/tactical';
import type { Battle, Ent, Order } from '../../sim/tactical/types';
import { UNITS } from '../../sim/tactical/units';
import { battlePreviews } from '../../sim/military';
import type { Globe } from '../globe/types';
import { M_PER_DEG, ModelPool, assetUrl, clamp, lerpAngle, loadManifest, mode, renderEvents, renderLock, spriteCanvas, type ModelHandle } from '../units/common';
import { useTacSelection } from './store';
import { sampleGrid } from './terrain';

const SIDE_COLOR = ['#4da3ff', '#ff5a4d'] as const;
const C = Cesium.Color;
const V = (x: number, y: number) => new Cesium.Cartesian2(x, y);
const INF = Number.POSITIVE_INFINITY;
const SOLDIER_KINDS = new Set(['infantry', 'special', 'engineer']);
const MAX_ENTS = 300;

export interface TacticalLayer {
  active(): boolean;
  stats(): { models: number; ents: number; proj: number };
  sample(n?: number): unknown[];
  /** Resolves when terrain heights for every current strategic battle are cached. */
  prefetch(): Promise<void>;
  destroy(): void;
}
interface E { h: ModelHandle; x: number; y: number; hd: number; shoot: number; dead: boolean; wreck?: Cesium.Billboard; ent: Ent }
interface Fx { b: Cesium.Billboard; t0: number; size: number; grow: number }

export function attachTacticalLayer(globe: Globe, getGame: () => Game | null): TacticalLayer {
  const viewer = globe.viewer, scene = viewer.scene;
  const cache = new Map<string, number[]>();
  const key = (lon: number, lat: number) => `${lon.toFixed(3)},${lat.toFixed(3)}`;
  const pending = new Map<string, Promise<void>>();
  const prefetchAt = (lon: number, lat: number) => {
    const k = key(lon, lat);
    if (cache.has(k)) return Promise.resolve();
    let p = pending.get(k);
    if (!p) { p = sampleGrid(lon, lat).then((h) => { if (h) cache.set(k, h); }).finally(() => pending.delete(k)); pending.set(k, p); }
    return p;
  };
  // The sim asks for heights synchronously at `tac.start`; fall back to the rendered globe when the cache is cold.
  setTacticalMapProvider((lon, lat) => {
    const hit = cache.get(key(lon, lat));
    if (hit) return { heights: hit };
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
  let fxs: Fx[] = [], projLines: Cesium.Polyline[] = [], seenProj = new Map<number, { x1: number; y1: number; kind: string; side: 0 | 1 }>();
  let objs: { pole: Cesium.Polyline; ring: Cesium.Polyline; flag: Cesium.Billboard; label: Cesium.Label; sig: string }[] = [];
  let deployLines: Cesium.Polyline[] = [];
  let squadLabels = new Map<number, Cesium.Label>(), selLines = new Map<number, { ring: Cesium.Polyline; ord: Cesium.Polyline }>();
  let smokeZones = new Map<string, Cesium.Billboard[]>();
  let mul = 1, last = performance.now(), nextShotEv = 0, wrecks = 0;
  const imgs = { flame: spriteCanvas([255, 190, 90], 1), smoke: spriteCanvas([85, 85, 85], 0.85), dark: spriteCanvas([30, 30, 30], 0.9), dust: spriteCanvas([150, 130, 100], 0.7) };
  const neutralFlag = (() => { const c = document.createElement('canvas'); c.width = 30; c.height = 20; const g = c.getContext('2d')!; g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, 30, 20); g.strokeStyle = '#555'; g.strokeRect(0.5, 0.5, 29, 19); return c; })();

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
    const mf = await loadManifest();
    if (g.state.tactical?.battle?.id !== b.id) { mode.tactical = false; return; }
    cur = { id: b.id, b, pool: new ModelPool(scene, mf), ents: new Map(), clat: b.center[1], clon: b.center[0], mPerLon: M_PER_DEG * Math.cos((b.center[1] * Math.PI) / 180) };
    bills = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
    lines = scene.primitives.add(new Cesium.PolylineCollection()) as Cesium.PolylineCollection;
    labels = scene.primitives.add(new Cesium.LabelCollection({ scene })) as Cesium.LabelCollection;
    renderLock(globe, 'tac', true);
    useTacSelection.getState().clear();
    const ground = mapH(0, 0);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(b.center[0], b.center[1], ground), 1), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), 5200), duration: 2.2,
    });
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
    cur.pool?.destroy();
    for (const c of [bills, lines, labels]) scene.primitives.remove(c);
    cur = null; fxs = []; projLines = []; seenProj.clear(); objs = []; deployLines = []; squadLabels.clear(); selLines.clear(); smokeZones.clear(); wrecks = 0;
    renderLock(globe, 'tac', false);
    mode.tactical = false;
    useTacSelection.getState().clear();
    globe.requestRender();
  }

  // ------------------------------------------------------------ frame
  const squadSide = (sq: number) => cur!.b.squads[sq]?.side ?? 0;
  function spawnFx(x: number, y: number, size: number, kind: 'flame' | 'smoke' | 'dust', grow = 3) {
    let f = fxs.find((q) => !q.b.show);
    if (!f && fxs.length < 80) {
      const b = bills.add({ position: Cesium.Cartesian3.ZERO, sizeInMeters: true, show: false, disableDepthTestDistance: 0 });
      fxs.push((f = { b, t0: 0, size: 0, grow }));
    }
    if (!f) return;
    f.b.setImage(`fx-${kind}`, imgs[kind]);
    f.b.position = P(x, y, size * 0.3);
    f.t0 = performance.now(); f.size = size; f.grow = grow;
    f.b.width = f.b.height = size; f.b.show = true; f.b.color = C.WHITE;
  }

  function updateEnts(b: Battle, now: number, dt: number) {
    const c = cur!, pool = c.pool!, k = 1 - Math.exp(-dt * 9);
    let n = 0;
    for (const e of b.ents) {
      if (e.gone || n++ >= MAX_ENTS) continue;
      let s = c.ents.get(e.id);
      const sq = b.squads[e.sq];
      if (!s) {
        const h = pool.acquire(sq.modelId || UNITS[e.kind].model, { __tac: true, sq: e.sq, ent: e.id, side: e.side });
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
          else if (wrecks < 40) { wrecks++; s.wreck = bills.add({ position: Cesium.Cartesian3.ZERO, sizeInMeters: true, width: 26 * mul, height: 26 * mul, disableDepthTestDistance: 0 }); s.wreck.setImage('fx-dark', imgs.dark); }
          spawnFx(e.x, e.y, 14 * mul, 'flame', 2);
        }
        if (s.wreck) s.wreck.position = P(s.x, s.y, 10 * mul + Math.sin(now / 400 + e.id) * 2);
      } else if (soldier) pool.setAnim(s.h, s.shoot > now ? 'shoot' : e.moving ? 'run' : 'idle');
      const m = soldier ? mul * 1.3 : mul;
      pool.place(s.h, ll(s.x, s.y)[0], ll(s.x, s.y)[1], hAt(s.x, s.y), s.hd, m, soldier && s.dead ? 90 : 0, true);
    }
    if (c.ents.size > n) {
      const live = new Set(b.ents.filter((e) => !e.gone).map((e) => e.id));
      for (const [id, s] of c.ents) if (!live.has(id)) { pool.release(s.h); if (s.wreck) bills.remove(s.wreck); c.ents.delete(id); }
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
      const up = p.kind === 'bomb' ? 300 * (1 - f) : 1.8 + 4 * arc * f * (1 - f);
      const tail = p.kind === 'bullet' ? 14 : p.kind === 'bomb' ? 24 : 38;
      const bx = x - ((p.x1 - p.x0) / Math.max(1, dist)) * tail, by = y - ((p.y1 - p.y0) / Math.max(1, dist)) * tail;
      let l = projLines[i];
      const pos = [P(bx, by, p.kind === 'bomb' ? up + 24 : Math.max(1, up - 1)), P(x, y, up)];
      if (!l) { l = lines.add({ positions: pos, width: p.kind === 'bullet' ? 2 : 4, material: mat('#ffe6a0', 0.95) }); projLines.push(l); } else { l.positions = pos; l.show = true; }
      i++;
      if (!seenProj.has(p.id)) {
        if (now > nextShotEv) { nextShotEv = now + 70; renderEvents.emit({ type: 'tacShot', kind: p.kind, side: p.side }); }
        if (p.kind !== 'bomb') for (const [, s] of cur!.ents) if (s.ent.side === p.side && s.ent.alive && Math.abs(s.ent.x - p.x0) < 6 && Math.abs(s.ent.y - p.y0) < 6) { s.shoot = now + 450; break; }
      }
      seenProj.set(p.id, { x1: p.x1, y1: p.y1, kind: p.kind, side: p.side });
    }
    for (; i < projLines.length; i++) projLines[i].show = false;
    for (const [id, s] of seenProj) {
      if (cur2.has(id)) continue;
      seenProj.delete(id);
      if (s.kind === 'bullet') continue;
      const big = s.kind === 'bomb' ? 70 : s.kind === 'shell' ? 38 : 28;
      spawnFx(s.x1, s.y1, big * mul * 0.7, 'flame', 2.6);
      spawnFx(s.x1, s.y1, big * mul, 'dust', 3.4);
      renderEvents.emit({ type: 'tacExplosion', kind: s.kind });
    }
  }

  function updateFx(now: number) {
    for (const f of fxs) {
      if (!f.b.show) continue;
      const a = (now - f.t0) / 1000;
      if (a > 1.6) { f.b.show = false; continue; }
      const s = f.size * (0.4 + a * f.grow * 0.5);
      f.b.width = f.b.height = s;
      f.b.color = C.WHITE.withAlpha(Math.max(0, 1 - a / 1.6));
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

  function updateSquads(b: Battle) {
    const sel = new Set(useTacSelection.getState().selected);
    for (const s of b.squads) {
      let alive = 0;
      for (const [, e] of cur!.ents) if (e.ent.sq === s.id && e.ent.alive) alive++;
      let l = squadLabels.get(s.id);
      if (!l) { l = labels.add({ position: Cesium.Cartesian3.ZERO, font: '600 12px system-ui', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: C.BLACK, pixelOffset: V(0, -16), disableDepthTestDistance: INF, fillColor: C.fromCssColorString(SIDE_COLOR[s.side]) }); squadLabels.set(s.id, l); }
      l.show = alive > 0;
      l.text = `${s.name ? s.name.slice(0, 14) + ' ' : ''}${alive}/${s.n0}${s.routed ? ' !' : ''}`;
      l.position = P(s.x, s.y, 14 * mul);
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

  const onPre = () => {
    const g = getGame();
    const b = g?.state.tactical?.battle ?? null;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!g || !b || !cur || cur.id !== b.id) return;
    g.ctx.api.tactical.advance(dt);
    mul = clamp(globe.cameraHeight() / 350, 1, 12);
    cur.b = b;
    updateEnts(b, now, dt);
    updateProjectiles(b, now);
    updateFx(now);
    updateSmoke(b);
    updateObjectives(b);
    updateDeploy(b);
    updateSquads(b);
  };
  scene.preRender.addEventListener(onPre);

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
      if (d.side !== player()) order = { kind: 'attack', target: d.ent };
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

  (window as unknown as { __tacSel?: typeof useTacSelection }).__tacSel = useTacSelection;
  return {
    active: () => !!cur,
    sample: (n = 5) => [...(cur?.ents.values() ?? [])].slice(0, n).map((e) => { const [lo, la] = ll(e.x, e.y); return { id: e.ent.id, x: Math.round(e.x), y: Math.round(e.y), h: Math.round(hAt(e.x, e.y)), shown: !!e.h.model?.show, ready: !!e.h.model?.ready, scale: e.h.model?.scale, screen: globe.toScreen(lo, la, hAt(e.x, e.y)) }; }),
    stats: () => ({ models: cur?.pool?.liveCount ?? 0, ents: cur?.ents.size ?? 0, proj: cur?.b.proj.length ?? 0 }),
    prefetch: async () => { const g = getGame(); if (g) await Promise.all(battlePreviews(g.ctx).map((b) => prefetchAt(b.pos[0], b.pos[1]))); },
    destroy() {
      clearInterval(timer); clearInterval(timerPre);
      scene.preRender.removeEventListener(onPre);
      unPick(); unClick(); unBox(); unRight();
      leave();
      setTacticalMapProvider(null);
    },
  };
}
