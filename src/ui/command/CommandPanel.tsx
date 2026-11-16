import { Fragment, useState } from 'react';
import type { OfficerView } from '../../core/contracts';
import { milCmd } from '../../sim/military';
import { fmtDate, fmtPct } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { Tabs } from '../kit/controls';
import { Tip } from '../kit/Tooltip';
import { dispatch, me, useGame } from '../useGame';
import { Meter, rankName, SkillsTip, TraitChips } from './FormationCommand';

const FILTERS = ['all', 'land', 'naval', 'air'] as const;

function Detail({ o, forms }: { o: OfficerView; forms: { id: string; name: string; domain: string }[] }) {
  const [target, setTarget] = useState('');
  const mine = forms.filter((f) => f.domain === o.domain);
  return (
    <div className="col gap4" style={{ padding: '6px 4px 10px' }} data-testid="officer-detail">
      <Meter label={t('ui.cmd.exp')} v={o.experience} />
      <Meter label={t('ui.cmd.loyalty')} v={o.loyalty} tip={t('ui.cmd.loyalty.tip')} />
      <span className="dim">{t('ui.cmd.record', { b: o.battles, w: o.wins })}</span>
      <div className="sect-title">{t('ui.cmd.history')}</div>
      {o.history.length === 0 ? <span className="dim">{t('ui.cmd.noHistory')}</span> : o.history.map((h, i) => (
        <div key={i} className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>{t(`ui.cmd.hist.${h.code}`)}{h.arg && h.code === 'promoted' ? ` → ${t(`mil.rank.${['brigadier', 'major', 'lieutenant', 'general', 'marshal'][Number(h.arg)]}.${o.domain}`)}` : ''}</span><span className="dim">{fmtDate(h.hours)}</span></div>
      ))}
      {o.status === 'active' && (
        <div className="row gap4" style={{ marginTop: 4 }}>
          <select className="btn sm" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('ui.cmd.pickFormation')}</option>
            {mine.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button className="btn sm primary" disabled={!target} onClick={() => dispatch(milCmd.assignCommander(me(), target, o.id))}>{t('ui.cmd.assign')}</button>
          {o.formation && <button className="btn sm" onClick={() => dispatch(milCmd.assignCommander(me(), o.formation!, null))}>{t('ui.cmd.unassign')}</button>}
          {o.formation && <button className="btn sm" onClick={() => goToWhere({ formation: o.formation! }, 600_000)}>{t('ui.insp.goto')}</button>}
        </div>
      )}
    </div>
  );
}

export function CommandPanel() {
  const [dom, setDom] = useState<(typeof FILTERS)[number]>('all');
  const [open, setOpen] = useState<string | null>(null);
  const d = useGame((_g, ctx) => {
    const m = ctx.api.military;
    const c = me();
    return {
      ws: m.warSupport(c),
      offs: m.officers(c),
      forms: m.formations({ country: c }).map((f) => ({ id: f.id, name: f.name, domain: f.domain })),
    };
  });
  if (!d) return null;
  const nameOf = (id: string | null) => d.forms.find((f) => f.id === id)?.name ?? '—';
  const list = d.offs.filter((o) => dom === 'all' || o.domain === dom).slice(0, 120);
  return (
    <div className="col gap4" data-testid="command-panel">
      <Meter label={t('ui.cmd.warSupport')} v={d.ws / 100} tip={t('ui.cmd.warSupport.tip')} />
      <Tabs tabs={FILTERS.map((k) => [k, t(`ui.cmd.filter.${k}`)] as [string, string])} value={dom} onChange={setDom} />
      {list.length === 0 && <span className="dim">{t('ui.cmd.none')}</span>}
      <table className="tbl"><thead><tr>
        <th>{t('ui.cmd.col.name')}</th><th>{t('ui.cmd.col.skills')}</th><th>{t('ui.cmd.col.traits')}</th><th>{t('ui.cmd.col.post')}</th><th className="r">{t('ui.cmd.col.loyalty')}</th>
      </tr></thead><tbody>
        {list.map((o) => (
          <Fragment key={o.id}>
            <tr className="click" onClick={() => setOpen(open === o.id ? null : o.id)}>
              <td><Tip tip={<SkillsTip o={o} />}><span><b>{rankName(o)}</b> {o.name}</span></Tip></td>
              <td className="r">{o.attack.toFixed(0)}/{o.defense.toFixed(0)}/{o.logistics.toFixed(0)}/{o.maneuver.toFixed(0)}</td>
              <td><TraitChips traits={o.traits} /></td>
              <td>{o.status !== 'active' ? <span className="bad">{t(`ui.cmd.status.${o.status}`)}</span> : o.formation ? nameOf(o.formation) : <span className="dim">{t('ui.cmd.free')}</span>}</td>
              <td className="r"><span className={o.loyalty < 0.3 ? 'bad' : o.loyalty < 0.5 ? 'warn' : 'good'}>{fmtPct(o.loyalty)}</span></td>
            </tr>
            {open === o.id && <tr><td colSpan={5}><Detail o={o} forms={d.forms} /></td></tr>}
          </Fragment>
        ))}
      </tbody></table>
    </div>
  );
}
