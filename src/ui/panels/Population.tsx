import { countryCauses, countrySummary } from '../../sim/economy';
import { fmtCompact, fmtDate, fmtInt, fmtPct, levelClass } from '../fmt';
import { goTo } from '../goto';
import { t } from '../i18n';
import { Progress, Table } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { ui } from '../store';
import { me, theWorld, useGame } from '../useGame';
import { Causes } from '../inspect/common';

export function PopulationPanel() {
  const w = theWorld();
  const d = useGame((_g, ctx) => {
    const c = me();
    const rows: Array<{ index: number; name: string; pop: number; sat: number; dark: boolean; province: string | null }> = [];
    for (const p of ctx.api.worldDyn.provincesControlledBy(c))
      for (const i of w.citiesByProvince.get(p) ?? []) rows.push({ index: i, name: w.cities[i].name, pop: w.cities[i].pop, sat: Math.round(ctx.api.economy.citySatisfaction(i)), dark: ctx.api.economy.inBlackout(i), province: p });
    rows.sort((a, b) => b.pop - a.pop);
    const s = countrySummary(ctx, c)!;
    return { rows: rows.slice(0, 150), total: rows.length, causes: countryCauses(ctx, c), s };
  });
  if (!d) return null;
  const { s } = d;
  return (
    <div className="col">
      <div className="fact-grid">
        <div><small>{t('ui.top.stability')}</small><b className={levelClass(s.stability)}>{fmtInt(s.stability)}</b><Progress value={s.stability / 100} tone={s.stability >= 60 ? 'good' : s.stability >= 40 ? 'warn' : 'bad'} /></div>
        <div><small>{t('ui.top.approval')}</small><b className={levelClass(s.approval)}>{fmtInt(s.approval)}%</b><Progress value={s.approval / 100} tone={s.approval >= 60 ? 'good' : s.approval >= 40 ? 'warn' : 'bad'} /></div>
        <div><small>{t('ui.pop.election')}</small><b>{fmtDate(s.nextElectionHours)}</b></div>
        <div><small>{t('ui.pop.weariness')}</small><b>{fmtPct(s.warWeariness)}</b></div>
      </div>
      <div className="sect-title">{t('ui.pop.nationalCauses')}</div>
      <Causes list={d.causes} />
      <div className="sect-title">{t('ui.pop.cities')} ({d.total})</div>
      <Table rowKey={(r) => r.index} rows={d.rows} initialSort={{ key: 'sat' }}
        onRow={(r) => { ui().select({ kind: 'city', index: r.index, id: r.index, province: r.province, country: me(), lonLat: [w.cities[r.index].lon, w.cities[r.index].lat] }); goTo(w.cities[r.index].lon, w.cities[r.index].lat, 400_000); }}
        columns={[
          { key: 'n', label: t('ui.pop.city'), sort: (r) => r.name, render: (r) => <span className="row gap4">{r.dark && <Icon name="energy" className="bad" />}{r.name}</span> },
          { key: 'pop', label: t('ui.pop.population'), right: true, sort: (r) => r.pop, render: (r) => fmtCompact(r.pop) },
          { key: 'sat', label: t('ui.insp.satisfaction'), right: true, sort: (r) => r.sat, render: (r) => <b className={levelClass(r.sat)}>{r.sat}</b> },
        ]} />
      <div className="faint" style={{ fontSize: 11 }}>{t('ui.pop.hint')}</div>
    </div>
  );
}
