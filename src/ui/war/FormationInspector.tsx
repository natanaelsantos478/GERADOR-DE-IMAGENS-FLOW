import { useState } from 'react';
import { formationDetail, milCmd, UNITS, visibleFormations } from '../../sim/military';
import { useUnitSelection } from '../../render/units/store';
import { fmtDec, fmtInt, fmtPct } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { InspectorHead } from '../inspect/common';
import { KV, Progress } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { ui } from '../store';
import { dispatch, me, theWorld, useGame } from '../useGame';
import { StrikeBlock } from './StrikePanel';
import { kmBetween, orderLabel, pickPoint } from './common';
import type { InspectorProps } from '../registry';

const tone = (v: number) => (v >= 0.6 ? 'good' : v >= 0.3 ? 'warn' : 'bad');
function Meter({ label, v }: { label: string; v: number }) {
  return <div className="row" style={{ gap: 6 }}><span className="dim" style={{ width: 84, fontSize: 12 }}>{label}</span><div className="grow"><Progress value={v} tone={tone(v)} /></div><span style={{ width: 38, textAlign: 'right', fontSize: 12 }}>{fmtPct(v)}</span></div>;
}

export function FormationInspector({ sel }: InspectorProps) {
  const id = String(sel.id ?? '');
  const multi = useUnitSelection((s) => s.selected);
  const [name, setName] = useState<string | null>(null);
  const [splitSlots, setSplit] = useState<number[]>([]);
  const [open, setOpen] = useState<null | 'split' | 'merge' | 'embark'>(null);
  const d = useGame((ctx0, ctx) => {
    void ctx0;
    const f = formationDetail(ctx, id);
    if (!f) return null;
    const near = visibleFormations(ctx, me()).filter((o) => o.country === me() && o.id !== id).map((o) => ({ o, km: kmBetween(o.pos, f.pos) })).sort((a, b) => a.km - b.km).slice(0, 8);
    const raw = ctx.state.military.forms[id];
    return { f, near: near.map((n) => ({ id: n.o.id, name: n.o.name, domain: n.o.domain, km: Math.round(n.km) })), embarked: !!raw?.cr, carrierCap: f.slots.some((s) => UNITS[s.template].cap > 0) };
  });
  if (!d) return <InspectorHead title="—" />;
  const { f } = d;
  const own = f.country === me();
  const ids = multi.includes(id) && multi.length > 1 ? multi : [id];
  const cmd = dispatch;
  const first = f.slots[0];
  return (
    <div data-testid="formation-inspector">
      <InspectorHead country={f.country} title={f.name} sub={`${t(`ui.mil.domain.${f.domain}`)}${ids.length > 1 ? ` · ${t('ui.mil.nSelected', { n: ids.length })}` : ''}`} />
      <div className="col gap4">
        <Meter label={t('ui.mil.strength')} v={f.strength} />
        <Meter label={t('ui.mil.org')} v={f.organization} />
        <Meter label={t('ui.mil.morale')} v={f.morale} />
        <Meter label={t('ui.mil.supply')} v={f.supply} />
        <KV rows={[
          [t('ui.mil.order'), <b key="o">{orderLabel(f.order)}</b>],
          [t('ui.mil.xp'), fmtPct(f.experience)], [t('ui.mil.entrench'), fmtPct(f.entrenchment)],
          ...(f.etaHours !== null ? [[t('ui.mil.eta'), `${fmtDec(f.etaHours / 24, 1)} ${t('ui.days')}`] as [string, string]] : []),
        ]} />
      </div>
      <div className="sect-title">{t('ui.mil.composition')}</div>
      <table className="tbl"><tbody>
        {f.slots.map((s, i) => (
          <tr key={i}><td><Icon name={s.iconId} /> {t(`mil.unit.${s.template}`)}</td><td className="r">×{fmtDec(s.k, 1)}</td><td className="r"><span className={tone(s.strength)}>{fmtPct(s.strength)}</span></td><td className="r dim">{fmtInt(s.men)}</td></tr>
        ))}
      </tbody></table>
      {f.carried.length > 0 && <div className="dim" style={{ fontSize: 12 }}>{t('ui.mil.carrying', { n: f.carried.length })}</div>}
      <button className="btn sm" style={{ marginTop: 6 }} onClick={() => goToWhere({ formation: id }, 600_000)}><Icon name="locate" />{t('ui.insp.goto')}</button>

      {own && (
        <>
          <div className="sect-title">{t('ui.mil.orders')}</div>
          <div className="row wrap gap4">
            <button className="btn sm primary" data-testid="fm-move" onClick={() => pickPoint('ui.mil.pickDest', (p) => dispatch(milCmd.move(me(), ids, p, false)))}><Icon name="move" />{t('ui.mil.move')}</button>
            <button className="btn sm" onClick={() => pickPoint('ui.mil.pickDest', (p) => dispatch(milCmd.move(me(), ids, p, true)))}><Icon name="attack_move" />{t('ui.mil.attackMove')}</button>
            <button className="btn sm" onClick={() => cmd(milCmd.defend(me(), ids))}><Icon name="hold" />{t('ui.mil.defend')}</button>
            <button className="btn sm" onClick={() => cmd(milCmd.retreat(me(), ids))}><Icon name="retreat" />{t('ui.mil.retreat')}</button>
            <button className="btn sm" onClick={() => cmd(milCmd.stop(me(), ids))}><Icon name="pause" />{t('ui.mil.stop')}</button>
            {f.domain === 'naval' && (
              <button className="btn sm" onClick={() => pickPoint('ui.mil.pickPort', (p) => {
                const ports = theWorld().ports;
                let bi = -1, bd = 400;
                ports.forEach((o, i) => { const k = kmBetween([o.lon, o.lat], p); if (k < bd) { bd = k; bi = i; } });
                if (bi >= 0) dispatch(milCmd.blockade(me(), ids, bi)); else ui().toast(t('ui.mil.noPort'), 'error');
              })}>{t('ui.mil.blockade')}</button>
            )}
            {d.embarked && <button className="btn sm" onClick={() => dispatch(milCmd.disembark(me(), id))}>{t('ui.mil.disembark')}</button>}
            {!d.embarked && f.domain === 'land' && <button className="btn sm" onClick={() => setOpen(open === 'embark' ? null : 'embark')}>{t('ui.mil.embark')}</button>}
            <button className="btn sm" onClick={() => setOpen(open === 'merge' ? null : 'merge')}>{t('ui.mil.merge')}</button>
            {f.slots.length > 1 && <button className="btn sm" onClick={() => { setOpen(open === 'split' ? null : 'split'); setSplit([]); }}>{t('ui.mil.split')}</button>}
          </div>
          {open === 'split' && (
            <div className="card col gap4" style={{ marginTop: 6 }}>
              <span className="dim" style={{ fontSize: 12 }}>{t('ui.mil.splitHelp')}</span>
              {f.slots.map((s, i) => (
                <label key={i} className="row"><input type="checkbox" checked={splitSlots.includes(i)} onChange={(e) => setSplit(e.target.checked ? [...splitSlots, i] : splitSlots.filter((x) => x !== i))} />{t(`mil.unit.${s.template}`)}</label>
              ))}
              <button className="btn sm primary" disabled={!splitSlots.length || splitSlots.length >= f.slots.length} onClick={() => { dispatch(milCmd.split(me(), id, splitSlots)); setOpen(null); }}>{t('ui.mil.split')}</button>
            </div>
          )}
          {(open === 'merge' || open === 'embark') && (
            <div className="card col gap4" style={{ marginTop: 6 }}>
              <span className="dim" style={{ fontSize: 12 }}>{t(open === 'merge' ? 'ui.mil.mergeHelp' : 'ui.mil.embarkHelp')}</span>
              {d.near.length === 0 && <span className="dim">{t('ui.mil.noNearby')}</span>}
              {d.near.map((o) => (
                <button key={o.id} className="btn sm" style={{ justifyContent: 'space-between' }} onClick={() => { dispatch(open === 'merge' ? milCmd.merge(me(), id, o.id) : milCmd.embark(me(), id, o.id)); setOpen(null); }}>
                  <span>{o.name}</span><span className="dim">{o.km} km</span>
                </button>
              ))}
            </div>
          )}
          {name === null ? (
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setName(f.name)}>{t('ui.mil.rename')}</button>
          ) : (
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input grow" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              <button className="btn sm primary" onClick={() => { if (name.trim()) dispatch(milCmd.rename(me(), id, name.trim())); setName(null); }}>OK</button>
            </div>
          )}
          {f.domain === 'air' && first && <StrikeBlock formation={id} />}
        </>
      )}
    </div>
  );
}
