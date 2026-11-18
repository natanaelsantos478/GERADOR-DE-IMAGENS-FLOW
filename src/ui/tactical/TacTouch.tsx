/** Phone controls of the tactical battle: multi/box toggles, radial order menu, selection rings and order lines. */
import { useEffect, useRef, useState } from 'react';
import { useTacSelection } from '../../render/tactical/store';
import { attachTacTouch, radialOrder, sendRoute, squadScreens, useTacTouch, type RadialKey } from '../../render/tactical/touch';
import { getGlobe, onGlobe } from '../../render/globe/registry';
import { appHost } from '../../app/host';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';
import { ui, useUi } from '../store';
import type { TacModel } from './model';

const ICON: Record<RadialKey, string> = { move: 'move', attackMove: 'attack_move', attack: 'attack', hold: 'hold', retreat: 'retreat', smoke: 'smoke', artillery: 'call_artillery', occupy: 'entrench', formation: 'formation_wedge' };
const LABEL: Record<RadialKey, string> = { move: 'tac.order.move', attackMove: 'tac.order.attackMove', attack: 'tac.order.attack', hold: 'tac.order.hold', retreat: 'tac.order.retreat', smoke: 'tac.order.smoke', artillery: 'tac.order.artillery', occupy: 'ui.tac.occupy', formation: 'ui.tac.formation' };
const FORMS: Array<[string, string]> = [['form-line', 'formation_line'], ['form-column', 'formation_column'], ['form-wedge', 'formation_wedge'], ['form-scatter', 'formation_spread']];
const R = 86;

function Radial() {
  const r = useTacTouch((s) => s.radial);
  const [forms, setForms] = useState(false);
  useEffect(() => setForms(false), [r]);
  if (!r) return null;
  const vw = window.innerWidth, vh = window.innerHeight, m = R + 30;
  const cx = Math.min(vw - m, Math.max(m, r.cx)), cy = Math.min(vh - m, Math.max(m, r.cy));
  const list: Array<[string, string, string, boolean]> = forms
    ? FORMS.map(([k, ic]) => [k, ic, t(`tac.form.${k.slice(5)}`), false])
    : r.items.map((k) => [k, ICON[k], t(LABEL[k]), k === 'occupy' && !r.bld]);
  return (
    <div className="rad-back pe" data-testid="tac-radial" onPointerDown={(e) => { if (e.target === e.currentTarget) useTacTouch.getState().close(); }}>
      <div className="rad-hub" style={{ left: cx, top: cy }} />
      {list.map(([k, ic, label, off], i) => {
        const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <button key={k} className={`rad-item ${off ? 'off' : ''}`} data-testid={`rad-${k}`} aria-label={label} style={{ left: cx + Math.cos(a) * R, top: cy + Math.sin(a) * R }}
            onClick={() => { if (k === 'formation') setForms(true); else radialOrder(k as RadialKey); }}>
            <Icon name={ic} /><span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Rings under the selected squads and a line to each squad's move destination, projected every few frames. */
function Overlay() {
  const [, tick] = useState(0);
  const sel = useTacSelection((s) => s.selected);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let off: (() => void) | undefined, last = 0;
    const un = onGlobe((g) => { off?.(); off = g?.viewer.scene.postRender.addEventListener(() => { const n = performance.now(); if (n - last > 120) { last = n; tick((v) => v + 1); } }); });
    return () => { un(); off?.(); };
  }, []);
  const g = getGlobe(), b = appHost.getState().game?.state.tactical?.battle;
  if (!g || !b || !sel.length) return <svg ref={svg} className="tac-ov" />;
  const k = Math.cos((b.center[1] * Math.PI) / 180) * 111_320;
  const proj = (x: number, y: number) => g.toScreen(b.center[0] + x / k, b.center[1] + y / 111_320, 0);
  const scr = squadScreens();
  const rt = useTacTouch.getState().route;
  const els: JSX.Element[] = [];
  for (const id of sel) {
    const s = b.squads[id];
    if (!s) continue;
    const p = scr.get(id);
    if (!p) continue;
    if ((s.order === 'move' || s.order === 'amove' || s.order === 'occupy') && s.path.length) {
      const d0 = proj(s.ox, s.oy), s0 = proj(s.x, s.y), d = d0 && s0 ? { x: p.x + d0.x - s0.x, y: p.y + d0.y - s0.y } : null;
      if (d) els.push(<g key={`o${id}`}><line x1={p.x} y1={p.y} x2={d.x} y2={d.y} className="ov-line" /><circle cx={d.x} cy={d.y} r={9} className="ov-dest" /><circle cx={d.x} cy={d.y} r={3} className="ov-dot" /></g>);
    }
    els.push(<circle key={`r${id}`} cx={p.x} cy={p.y} r={24} className="ov-ring" />);
  }
  // marked route (drawn from the first selected squad) and the remaining route of moving squads
  const lead = scr.get(sel[0]);
  if (lead && rt.length) {
    const pts = [lead, ...Array.from({ length: rt.length / 2 }, (_, i) => { const q = proj(rt[2 * i], rt[2 * i + 1]), s0 = proj(b.squads[sel[0]].x, b.squads[sel[0]].y); return q && s0 ? { x: lead.x + q.x - s0.x, y: lead.y + q.y - s0.y } : lead; })];
    els.push(<polyline key="route" points={pts.map((q) => `${q.x},${q.y}`).join(' ')} className="ov-line" fill="none" />);
    pts.slice(1).forEach((q, i) => els.push(<circle key={`rp${i}`} cx={q.x} cy={q.y} r={7} className="ov-dest" />));
  }
  return <svg ref={svg} className="tac-ov" data-testid="tac-overlay" data-rings={els.length}>{els}</svg>;
}

export function TacTouch({ m }: { m: TacModel }) {
  const radial = useTacTouch((s) => !!s.radial);
  const multi = useTacTouch((s) => s.multi), routeMode = useTacTouch((s) => s.routeMode), breach = useTacTouch((s) => s.breach), nPts = useTacTouch((s) => s.route.length / 2);
  const [box, setBox] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    const un = onGlobe((g) => { off?.(); off = g ? attachTacTouch(g, () => appHost.getState().game, () => !!useUi.getState().pickMode) : undefined; });
    return () => { un(); off?.(); getGlobe()?.setBoxMode(false); };
  }, []);
  useEffect(() => useTacSelection.subscribe((s, p) => { if (s.lastError && s.lastError !== p.lastError) ui().toast(t(s.lastError), 'error'); }), []);
  const toggleBox = () => { const v = !box; setBox(v); getGlobe()?.setBoxMode(v); };
  if (m.player === null) return null;
  return (
    <>
      <Overlay />
      <div className="tac-tools pe m-only" style={radial ? { visibility: 'hidden' } : undefined}>
        {open && <>
        <button className={`fab-sm ${multi ? 'on' : ''}`} data-testid="btn-multi" aria-pressed={multi} onClick={() => useTacTouch.getState().setMulti(!multi)}><Icon name="check" /><span>{t('ui.tac.multi')}</span></button>
        <button className={`fab-sm ${routeMode ? 'on' : ''}`} data-testid="btn-route" aria-pressed={routeMode} onClick={() => {
          const tt = useTacTouch.getState();
          if (tt.routeMode && tt.route.length >= 2) { const b = appHost.getState().game?.state.tactical?.battle, ids = useTacSelection.getState().selected.filter((i) => b?.squads[i]?.side === b?.player); sendRoute(ids, tt.route); }
          tt.setRouteMode(!tt.routeMode);
        }}><Icon name="move" /><span>{routeMode && nPts ? `${t('ui.tac.routeGo')} (${nPts})` : t('ui.tac.route')}</span></button>
        <button className={`fab-sm ${breach ? 'on' : ''}`} data-testid="btn-breach" aria-pressed={breach} onClick={() => useTacTouch.getState().setBreach(!breach)}><Icon name="attack" /><span>{t('ui.tac.breach')}</span></button>
        <button className={`fab-sm ${box ? 'on' : ''}`} data-testid="btn-boxmode" aria-pressed={box} onClick={toggleBox}><Icon name="forces" /><span>{t('ui.mobile.boxSelect')}</span></button>
        </>}
        <button className={`fab-sm ${open || multi || box || routeMode || breach ? 'on' : ''}`} data-testid="btn-tools" aria-expanded={open} aria-label={t('ui.tac.tools')} onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'forces'} /><span>{t('ui.tac.tools')}</span></button>
      </div>
      <Radial />
    </>
  );
}
