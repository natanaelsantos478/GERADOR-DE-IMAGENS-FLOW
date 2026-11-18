/**
 * Touch control of the tactical battle, layered on the globe's pointer events (the layer itself is untouched):
 * tap = select / contextual order, multi toggle, long press = radial order menu. Only `pointerType === 'touch'` is handled,
 * so the mouse keeps the desktop behaviour. One-finger map drag, pinch and two-finger rotate/tilt stay with Cesium.
 */
import { create } from 'zustand';
import type { Game } from '../../core/game';
import { navCell, navOf } from '../../sim/tactical/nav';
import type { Battle, Order } from '../../sim/tactical/types';
import type { Globe } from '../globe/types';
import { useTacSelection } from './store';

const M_PER_DEG = 111_320;
const LONG_MS = 380; // just under the globe's 450 ms so the menu wins over its own long-press order
const SLOP = 10;
const NEAR_PX = 30;

export type RadialKey = 'move' | 'attackMove' | 'attack' | 'hold' | 'retreat' | 'smoke' | 'artillery' | 'occupy' | 'formation';
export interface RadialState { cx: number; cy: number; ids: number[]; x: number; y: number; bld: number; enemy: number; items: RadialKey[] }
interface TouchStore {
  multi: boolean; radial: RadialState | null; setMulti(v: boolean): void; close(): void;
  /** Route mode: ground taps add waypoints (battle metres, [x,y,...]) instead of ordering; `breach` = tracked vehicles may demolish small buildings. */
  routeMode: boolean; route: number[]; breach: boolean; setRouteMode(v: boolean): void; setBreach(v: boolean): void;
}
export const useTacTouch = create<TouchStore>((set) => ({
  multi: false, radial: null, setMulti: (multi) => set({ multi }), close: () => set({ radial: null }),
  routeMode: false, route: [], breach: false, setRouteMode: (routeMode) => set({ routeMode, route: [] }), setBreach: (breach) => set({ breach }),
}));

let ctx: { g: () => Game | null } | null = null;
const battle = (): Battle | null => ctx?.g()?.state.tactical?.battle ?? null;
const liveSq = (b: Battle, id: number) => b.ents.some((e) => e.sq === id && e.alive && !e.gone);
const toXY = (b: Battle, lon: number, lat: number) => ({ x: (lon - b.center[0]) * M_PER_DEG * Math.cos((b.center[1] * Math.PI) / 180), y: (lat - b.center[1]) * M_PER_DEG });

/** Sends a `tac.order`; the reason of a rejection goes to `lastError` (the HUD turns it into a toast). */
export function sendTacOrder(squads: number[], order: Order): boolean {
  const g = ctx?.g();
  if (!g) return false;
  const st = useTacSelection.getState();
  st.setError(null);
  const r = g.dispatch({ type: 'tac.order', country: g.state.meta.playerCountryId, squads, order } as never);
  st.setError(r.ok ? null : (r as { reason?: string }).reason ?? 'error');
  return r.ok;
}
/** Move order through the marked route (last point = destination); also used by the plain tap with `breach` on. */
export function sendRoute(ids: number[], pts: number[]): boolean {
  const n = pts.length;
  if (n < 2) return false;
  const { breach } = useTacTouch.getState();
  return sendTacOrder(ids, { kind: 'move', x: pts[n - 2], y: pts[n - 1], ...(n > 2 ? { via: pts.slice(0, Math.min(n - 2, 48)) } : {}), ...(breach ? { breach: true } : {}) });
}
const buildingAt = (b: Battle, x: number, y: number): number => {
  const rt = b.map && navOf(b.map);
  if (!rt) return 0;
  const id = rt.bld[navCell(rt, x, y)];
  return id && rt.data.buildings[id - 1]?.enterable ? id : 0;
};

/** Menu entry chosen: acts on the squads that were selected when the menu opened. */
export function radialOrder(key: RadialKey | 'form-line' | 'form-column' | 'form-wedge' | 'form-scatter'): void {
  const r = useTacTouch.getState().radial;
  if (!r) return;
  if (key === 'formation') return; // opens the sub-ring in the UI
  useTacTouch.getState().close();
  useTacSelection.getState().select(r.ids);
  if (key.startsWith('form-')) { sendTacOrder(r.ids, { kind: 'formation', form: key.slice(5) as 'line' }); return; }
  switch (key as RadialKey) {
    case 'move': sendRoute(r.ids, [r.x, r.y]); break;
    case 'attackMove': sendTacOrder(r.ids, { kind: 'attackMove', x: r.x, y: r.y }); break;
    case 'attack': sendTacOrder(r.ids, { kind: 'attack', target: r.enemy }); break;
    case 'hold': sendTacOrder(r.ids, { kind: 'hold' }); break;
    case 'retreat': sendTacOrder(r.ids, { kind: 'retreat' }); break;
    case 'smoke': sendTacOrder(r.ids, { kind: 'smoke', x: r.x, y: r.y }); break;
    case 'artillery': sendTacOrder([], { kind: 'artillery', x: r.x, y: r.y }); break;
    case 'occupy': sendTacOrder(r.ids, { kind: 'occupy', building: r.bld }); break;
  }
}

/** Screen position (canvas px) of every squad: mean of its live entities, projected by the layer with its own terrain heights. */
export function squadScreens(): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  const t = (window as unknown as { __tactical?: { ents(): { id: number; sq: number; alive: boolean }[]; sample(n: number): { id: number; screen?: { x: number; y: number } | null }[] } }).__tactical;
  if (!t) return out;
  const sc = new Map<number, { x: number; y: number }>();
  for (const q of t.sample(4000)) if (q.screen) sc.set(q.id, q.screen);
  const acc = new Map<number, { x: number; y: number; n: number }>();
  for (const e of t.ents()) {
    const p = e.alive ? sc.get(e.id) : undefined;
    if (!p) continue;
    const a = acc.get(e.sq) ?? { x: 0, y: 0, n: 0 };
    a.x += p.x; a.y += p.y; a.n++;
    acc.set(e.sq, a);
  }
  for (const [k, a] of acc) out.set(k, { x: a.x / a.n, y: a.y / a.n });
  return out;
}

export function attachTacTouch(globe: Globe, getGame: () => Game | null, busy: () => boolean = () => false): () => void {
  ctx = { g: getGame };
  (window as unknown as { __tacTouch?: typeof useTacTouch }).__tacTouch = useTacTouch;
  const canvas = globe.viewer.canvas;
  const ptr = new Map<number, { x: number; y: number }>();
  let downScr: Map<number, { x: number; y: number }> | null = null, downTs = 0, snap: number[] = [], start: { x: number; y: number } | null = null, touchTap = false, longOpen = false, timer: ReturnType<typeof setTimeout> | null = null;
  const own = (b: Battle) => (b.player ?? 0);
  const rel = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const mine = (b: Battle, ids: number[]) => ids.filter((id) => b.squads[id]?.side === own(b) && liveSq(b, id));
  /** Squad under the finger: the picked one, else the nearest within a finger's width. */
  const squadAt = (b: Battle, x: number, y: number, picked?: number): number => {
    if (picked !== undefined && picked >= 0 && liveSq(b, picked)) return picked;
    let best = -1, bd = NEAR_PX;
    const scr = downScr ?? squadScreens();
    for (const s of b.squads) {
      const p = scr.get(s.id);
      const d = p ? Math.hypot(p.x - x, p.y - y) : 1e9;
      if (d < bd) { bd = d; best = s.id; }
    }
    return best;
  };
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    ptr.set(e.pointerId, rel(e));
    if (ptr.size > 1) { clearTimer(); touchTap = false; return; }
    const b = battle();
    if (!b) return;
    touchTap = true; longOpen = false;
    start = rel(e);
    downTs = e.timeStamp;
    downScr = squadScreens(); // hit-test against where the squads were when the finger landed
    snap = mine(b, useTacSelection.getState().selected);
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      const bb = battle(), s0 = start;
      if (!bb || !s0 || ptr.size !== 1 || !touchTap) return;
      const pick = globe.pick(s0.x, s0.y);
      if (!pick.lonLat) return;
      const ids = mine(bb, snap);
      longOpen = true;
      try { navigator.vibrate?.(18); } catch { /* unsupported */ }
      if (!ids.length) { useTacSelection.getState().setError(null); useTacSelection.getState().setError('ui.tac.selectFirst'); return; }
      const { x, y } = toXY(bb, pick.lonLat[0], pick.lonLat[1]);
      const f = pick.feature, ps = f?.kind === 'tacSquad' ? (f.data as { sq: number }).sq : undefined;
      const foe = squadAt(bb, s0.x, s0.y, ps);
      const enemy = foe >= 0 && bb.squads[foe].side !== own(bb) ? foe : -1;
      const bld = buildingAt(bb, x, y);
      const items: RadialKey[] = ['move', 'attackMove', ...(enemy >= 0 ? ['attack' as const] : []), 'hold', 'retreat', 'smoke', 'artillery', 'occupy', 'formation'];
      const r = canvas.getBoundingClientRect();
      // The globe's own long press (450 ms) would issue a move order: hide the selection from it, then give it back.
      useTacSelection.setState({ selected: [] });
      setTimeout(() => useTacSelection.setState({ selected: ids }), 90);
      useTacTouch.setState({ radial: { cx: r.left + s0.x, cy: r.top + s0.y, ids, x, y, bld, enemy, items } });
    }, LONG_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !ptr.has(e.pointerId)) return;
    const p = rel(e);
    ptr.set(e.pointerId, p);
    if (start && !longOpen && Math.hypot(p.x - start.x, p.y - start.y) > SLOP) { clearTimer(); touchTap = false; }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    ptr.delete(e.pointerId);
    clearTimer();
    // A starved main thread can fire the timer before this event is handled: by hardware timestamps it was a plain tap.
    if (longOpen && touchTap && e.timeStamp - downTs < LONG_MS - 40) { longOpen = false; useTacTouch.getState().close(); }
    if (!ptr.size) start = null;
  };
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, true); // capture: must run before the globe's own pointerup emits the click
  window.addEventListener('pointercancel', onUp);

  // Runs after the layer's own click handler (registered earlier), which has already replaced / cleared the selection.
  const unClick = globe.on('click', (e) => {
    const b = battle();
    if (!b || !touchTap) return;
    const dbg = { x: e.x, y: e.y, longOpen, busy: busy(), snap: [...snap], n: downScr?.size ?? -1, feature: e.pick.feature?.kind ?? null };
    (window as unknown as { __tacTouchDbg?: unknown }).__tacTouchDbg = dbg;
    touchTap = false;
    if (busy()) return;
    const st = useTacSelection.getState(), multi = useTacTouch.getState().multi;
    if (longOpen) { st.select(snap); return; }
    const f = e.pick.feature;
    const sq = squadAt(b, e.x, e.y, f?.kind === 'tacSquad' ? (f.data as { sq: number }).sq : undefined);
    if (sq >= 0 && b.squads[sq].side === own(b)) {
      st.setError(null);
      if (multi) st.select(snap.includes(sq) ? snap.filter((i) => i !== sq) : [...snap, sq]);
      else st.select([sq]);
      return;
    }
    st.select(snap); // keep the selection; only an order may follow
    if (!snap.length || (multi && !useTacTouch.getState().routeMode)) return;
    if (sq >= 0) { sendTacOrder(snap, { kind: 'attack', target: sq }); return; }
    if (!e.pick.lonLat) return;
    const { x, y } = toXY(b, e.pick.lonLat[0], e.pick.lonLat[1]);
    const tt = useTacTouch.getState();
    if (tt.routeMode) { if (tt.route.length < 48) useTacTouch.setState({ route: [...tt.route, x, y] }); return; }
    const bld = buildingAt(b, x, y);
    if (bld) sendTacOrder(snap, { kind: 'occupy', building: bld }); else sendRoute(snap, [x, y]);
  });

  return () => {
    clearTimer();
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp);
    unClick();
    useTacTouch.setState({ radial: null, multi: false, routeMode: false, route: [], breach: false });
    ctx = null;
  };
}
