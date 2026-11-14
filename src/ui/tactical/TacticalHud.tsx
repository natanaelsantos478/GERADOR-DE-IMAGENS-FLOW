import { useEffect, useState } from 'react';
import type { LonLat } from '../../core/contracts';
import { useTacSelection } from '../../render/tactical/store';
import type { FormationKind, Order } from '../../sim/tactical/types';
import { fmtInt } from '../fmt';
import { t } from '../i18n';
import { Progress } from '../kit/controls';
import { Flag, Icon } from '../kit/Icon';
import { ui } from '../store';
import { dispatch, me, useGame } from '../useGame';
import { pickPoint } from '../war/common';
import { tacModel, type SquadCard, type TacModel } from './model';
import { TacResult } from './TacResult';

const M_PER_DEG = 111_320;
const SPEEDS = [0.5, 1, 2, 4];
const FORMS: Array<[FormationKind, string]> = [['line', 'formation_line'], ['column', 'formation_column'], ['wedge', 'formation_wedge'], ['scatter', 'formation_spread']];
const tone = (v: number) => (v >= 0.6 ? 'good' : v >= 0.3 ? 'warn' : 'bad');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useTacModel() { return useGame((g) => tacModel(g)); }
const tacSend = (squads: number[], order: Order) => {
  const r = dispatch({ type: 'tac.order', country: me(), squads, order } as never);
  useTacSelection.getState().setError(r.ok ? null : (r as { reason?: string }).reason ?? 'error');
  return r.ok;
};
const toLocal = (m: TacModel, p: LonLat) => ({ x: (p[0] - m.center[0]) * M_PER_DEG * Math.cos((m.center[1] * Math.PI) / 180), y: (p[1] - m.center[1]) * M_PER_DEG });

function Card({ q, selected, onClick, mine }: { q: SquadCard; selected: boolean; onClick(e: React.MouseEvent): void; mine: boolean }) {
  const frac = q.n0 ? q.alive / q.n0 : 0;
  return (
    <div className={`sq-card ${selected ? 'sel' : ''} ${q.routed || !q.alive ? 'dead' : ''}`} onClick={onClick} data-testid={`sq-${q.id}`} data-side={q.side}>
      <div className="row sp"><b style={{ fontSize: 12 }}>{q.name || t(`tac.kind.${q.kind}`)}</b><span className="dim" style={{ fontSize: 11 }}>{q.routed ? t('ui.tac.routed') : q.alive ? t(`ui.tac.ord.${q.order}`) : t('ui.tac.destroyed')}</span></div>
      <div className="row" style={{ gap: 6, fontSize: 11 }}><span className="dim" style={{ width: 52 }}>{t('ui.tac.men')}</span><div className="grow"><Progress value={frac} tone={tone(frac)} /></div><span style={{ width: 38, textAlign: 'right' }}>{q.alive}/{q.n0}</span></div>
      <div className="row" style={{ gap: 6, fontSize: 11 }}><span className="dim" style={{ width: 52 }}>{t('ui.tac.morale')}</span><div className="grow"><Progress value={q.morale} tone={tone(q.morale)} /></div><span style={{ width: 38, textAlign: 'right' }}>{Math.round(q.morale * 100)}%</span></div>
      {mine && <div className="row" style={{ gap: 6, fontSize: 11 }}><span className="dim" style={{ width: 52 }}>{t('ui.tac.ammo')}</span><div className="grow"><Progress value={q.ammo} tone={tone(q.ammo)} /></div><span style={{ width: 38, textAlign: 'right' }}>{Math.round(q.ammo * 100)}%</span></div>}
    </div>
  );
}

function B({ icon, label, on, id, dis, extra }: { icon: string; label: string; on(): void; id: string; dis?: boolean; extra?: string }): JSX.Element {
  return (
    <button className="btn sm tac-btn" title={label} data-testid={`tac-ord-${id}`} disabled={dis} onClick={on}><Icon name={icon} /><span>{label}{extra ? ` ${extra}` : ''}</span></button>
  );
}

function OrderBar({ m }: { m: TacModel }) {
  const sel = useTacSelection((s) => s.selected);
  const err = useTacSelection((s) => s.lastError);
  const ps = m.player ?? 0;
  const mineSel = sel.filter((id) => m.squads[id]?.side === ps && m.squads[id].alive > 0);
  const combat = m.phase === 'combat';
  const need = () => { if (!mineSel.length) { ui().toast(t('ui.tac.selectFirst'), 'error'); return false; } return true; };
  const direct = (order: Order) => () => { if (need()) tacSend(mineSel, order); };
  const point = (labelKey: string, mk: (x: number, y: number) => Order) => () => {
    if (!need()) return;
    const ids = mineSel;
    pickPoint(labelKey, (p) => { const l = toLocal(m, p); tacSend(ids, mk(l.x, l.y)); setTimeout(() => useTacSelection.getState().select(ids), 0); });
  };
  const attack = () => {
    if (!need()) return;
    const ids = mineSel;
    pickPoint('ui.tac.pickEnemy', (p) => {
      const l = toLocal(m, p);
      const e = m.squads.filter((q) => q.side !== ps && q.alive > 0).map((q) => ({ q, d: Math.hypot(q.x - l.x, q.y - l.y) })).sort((a, b) => a.d - b.d)[0];
      if (e && e.d < 600) tacSend(ids, { kind: 'attack', target: e.q.id }); else ui().toast(t('dip.err.badChoice'), 'error');
      setTimeout(() => useTacSelection.getState().select(ids), 0);
    });
  };
  const support = (kind: 'artillery' | 'airstrike' | 'drone') => () => pickPoint(`ui.tac.pick.${kind}`, (p) => { const l = toLocal(m, p); tacSend([], { kind, x: l.x, y: l.y }); });
  const face = () => {
    if (!need()) return;
    const ids = mineSel, cx = ids.reduce((a, i) => a + m.squads[i].x, 0) / ids.length, cy = ids.reduce((a, i) => a + m.squads[i].y, 0) / ids.length;
    pickPoint('ui.tac.pickFront', (p) => { const l = toLocal(m, p); tacSend(ids, { kind: 'face', facing: Math.atan2(l.x - cx, l.y - cy) }); setTimeout(() => useTacSelection.getState().select(ids), 0); });
  };
  if (m.player === null) return null;
  return (
    <div className="tac-bar pe" data-testid="tac-orderbar">
      {err && <div className="bad" style={{ fontSize: 12, textAlign: 'center' }}>{t(err)}</div>}
      <div className="row wrap" style={{ justifyContent: 'center', gap: 4 }}>
        <B id="move" icon="move" label={t('tac.order.move')} on={point('ui.tac.pickDest', (x, y) => ({ kind: 'move', x, y }))} />
        <B id="attackMove" icon="attack_move" label={t('tac.order.attackMove')} dis={!combat} on={point('ui.tac.pickDest', (x, y) => ({ kind: 'attackMove', x, y }))} />
        <B id="attack" icon="attack" label={t('tac.order.attack')} dis={!combat} on={attack} />
        <B id="hold" icon="hold" label={t('tac.order.hold')} dis={!combat} on={direct({ kind: 'hold' })} />
        <B id="retreat" icon="retreat" label={t('tac.order.retreat')} dis={!combat} on={direct({ kind: 'retreat' })} />
        <B id="face" icon="move" label={t('tac.order.face')} on={face} />
        <span className="tac-sep" />
        {FORMS.map(([k, ic]) => <B key={k} id={`form-${k}`} icon={ic} label={t(`tac.form.${k}`)} on={direct({ kind: 'formation', form: k })} />)}
        <span className="tac-sep" />
        <B id="ceasefire" icon="cease_fire" label={t('tac.order.ceasefire')} on={direct({ kind: 'fire', free: false })} />
        <B id="firefree" icon="fire_at_will" label={t('tac.order.fireAtWill')} on={direct({ kind: 'fire', free: true })} />
        <B id="dig" icon="entrench" label={t('tac.order.dig')} dis={!combat} on={direct({ kind: 'dig' })} />
        <B id="smoke" icon="smoke" label={t('tac.order.smoke')} dis={!combat} on={direct({ kind: 'smoke' })} />
        <B id="dismount" icon="mechanized" label={t('tac.order.dismount')} dis={!combat} on={direct({ kind: 'dismount' })} />
        <span className="tac-sep" />
        <B id="artillery" icon="call_artillery" label={t('tac.order.artillery')} extra={`×${m.support.artillery}`} dis={!combat || m.support.artillery <= 0} on={support('artillery')} />
        <B id="airstrike" icon="call_airstrike" label={t('tac.order.airstrike')} extra={`×${m.support.airstrike}`} dis={!combat || m.support.airstrike <= 0} on={support('airstrike')} />
        <B id="drone" icon="drone" label={t('tac.order.drone')} extra={`×${m.support.drone}`} dis={!combat || m.support.drone <= 0} on={support('drone')} />
      </div>
    </div>
  );
}

export function TacticalHud() {
  const m = useTacModel();
  const sel = useTacSelection((s) => s.selected);
  const [confirmW, setConfirmW] = useState(false);
  useEffect(() => { if (m?.phase === 'ended') useTacSelection.getState().clear(); }, [m?.phase]);
  if (!m) return null;
  const ps = m.player ?? 0;
  const mine = m.squads.filter((q) => q.side === ps), foes = m.squads.filter((q) => q.side !== ps);
  const alive = (l: SquadCard[]) => l.reduce((a, q) => a + q.alive, 0), n0 = (l: SquadCard[]) => l.reduce((a, q) => a + q.n0, 0);
  const send = (id: string, payload: Record<string, unknown> = {}) => dispatch({ type: id, country: me(), ...payload } as never);
  const clickMine = (id: number) => (e: React.MouseEvent) => useTacSelection.getState().select([id], e.shiftKey);
  const clickFoe = (id: number) => {
    const ids = sel.filter((s) => m.squads[s]?.side === ps);
    if (ids.length && m.phase === 'combat') tacSend(ids, { kind: 'attack', target: id });
  };
  const left = m.phase === 'deploy' ? Math.max(0, m.deployLimit - m.t) : Math.max(0, m.timeLimit - m.t);
  return (
    <>
      <div className="tac-top pe" data-testid="tac-top">
        <div className="row" style={{ gap: 10 }}>
          <b><Icon name="war" /> {t('tac.title')}</b>
          <span className={`chip ${m.phase === 'combat' ? 'warn' : ''}`} data-testid="tac-phase">{t(`tac.phase.${m.phase}`)}</span>
          <span className="dim" title={t('ui.tac.timeLeft')}>{clock(m.t)} · {t('ui.tac.left')} {clock(left)}</span>
          <span className="row gap4" title={t('ui.tac.score')}><Flag id={m.countries[ps][0]} width={18} /><b className="good">{m.score[ps]}</b><span className="dim">×</span><b className="bad">{m.score[1 - ps]}</b><Flag id={m.countries[1 - ps][0]} width={18} /></span>
        </div>
        <div className="row wrap gap4" style={{ justifyContent: 'center' }}>
          {m.objs.map((o) => <span key={o.id} className={`chip ${o.owner === ps ? 'good' : o.owner === -1 ? '' : 'bad'}`} title={`${t('ui.tac.objective')}: ${fmtInt(o.cap * 100)}%`}>{o.name || t('ui.tac.objective')} {o.owner === ps ? '●' : o.owner === -1 ? '○' : '◆'}</span>)}
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
          {m.phase === 'deploy' && !m.ready && <button className="btn primary" data-testid="tac-ready" onClick={() => send('tac.ready')}><Icon name="check" />{t('ui.tac.ready')}</button>}
          {m.phase === 'deploy' && m.ready && <span className="chip">{t('ui.tac.waiting')}</span>}
          {SPEEDS.map((s) => <button key={s} className={`btn sm ${m.timeScale === s ? 'on' : ''}`} data-testid={`tac-speed-${s}`} onClick={() => send('tac.speed', { scale: s })}>×{s}</button>)}
          <button className={`btn sm ${m.paused ? 'on' : ''}`} data-testid="tac-pause" onClick={() => send('tac.pause')} title={t('tac.pause')}><Icon name="pause" /></button>
          <button className={`btn sm ${m.auto ? 'on' : ''}`} data-testid="tac-auto" onClick={() => send('tac.auto', { value: !m.auto })}>{t('tac.auto')}</button>
          {!confirmW ? <button className="btn sm danger" data-testid="tac-withdraw" onClick={() => setConfirmW(true)}><Icon name="retreat" />{t('ui.tac.withdraw')}</button> : (
            <>
              <button className="btn sm danger" data-testid="tac-withdraw-ok" onClick={() => { send('tac.withdraw'); setConfirmW(false); }}>{t('ui.tac.withdrawConfirm')}</button>
              <button className="btn sm" onClick={() => setConfirmW(false)}>{t('ui.cancel')}</button>
            </>
          )}
          <button className="btn sm" data-testid="tac-exit" onClick={() => send('tac.exit', { resolve: 'auto' })}>{t('tac.exit')}</button>
        </div>
        {m.phase === 'deploy' && <div className="dim" style={{ fontSize: 12, textAlign: 'center' }}>{t('ui.tac.deployHelp')}</div>}
      </div>
      <div className="tac-left pe" data-testid="tac-squads">
        <div className="sect-title" style={{ margin: 0 }}>{t('ui.tac.yourSide')} · {alive(mine)}/{n0(mine)}</div>
        {mine.map((q) => <Card key={q.id} q={q} mine selected={sel.includes(q.id)} onClick={clickMine(q.id)} />)}
      </div>
      <div className="tac-right pe" data-testid="tac-foes">
        <div className="sect-title" style={{ margin: 0 }}>{t('ui.tac.enemy')} · {alive(foes)}/{n0(foes)}</div>
        {foes.map((q) => <Card key={q.id} q={q} mine={false} selected={false} onClick={() => clickFoe(q.id)} />)}
      </div>
      <OrderBar m={m} />
      {m.phase === 'ended' && m.result && <TacResult m={m} onExit={() => send('tac.exit')} />}
    </>
  );
}
