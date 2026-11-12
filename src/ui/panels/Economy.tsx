import { useState } from 'react';
import { countrySummary, sectorList } from '../../sim/economy';
import type { HistoryPoint } from '../../sim/economy';
import { fmtDate, fmtDec, fmtMoney, fmtPct, fmtCompact, fmtSigned } from '../fmt';
import { t } from '../i18n';
import { KV, Progress, Tabs } from '../kit/controls';
import { LineChart } from '../kit/LineChart';
import { me, useGame } from '../useGame';
import { AutoToggle } from './common';

type Tab = 'gdp' | 'balance' | 'treasury' | 'mood';
export function EconomyPanel() {
  const [tab, setTab] = useState<Tab>('gdp');
  const d = useGame((g, ctx) => ({ s: countrySummary(ctx, me()), hist: ctx.state.economy.history.slice(-120) as HistoryPoint[], now: g.state.time.hours }));
  if (!d?.s) return null;
  const { s, hist } = d;
  const xs = hist.map((h) => h.hours);
  const series = {
    gdp: [{ label: t('ui.eco.gdp'), color: '#3fb6c9', values: hist.map((h) => h.gdp) }],
    balance: [{ label: t('ui.eco.balance'), color: '#4cc38a', values: hist.map((h) => h.balance) }],
    treasury: [{ label: t('ui.top.treasury'), color: '#e0a64a', values: hist.map((h) => h.treasury) }],
    mood: [{ label: t('ui.top.approval'), color: '#5b9cf0', values: hist.map((h) => h.approval) }, { label: t('ui.top.stability'), color: '#e5655d', values: hist.map((h) => h.stability) }],
  }[tab];
  return (
    <div className="col">
      <div className="fact-grid">
        <KV rows={[[t('ui.eco.gdp'), fmtMoney(s.gdp)], [t('ui.eco.growth'), <span className={s.gdpGrowth >= 0 ? 'good' : 'bad'}>{fmtSigned(s.gdpGrowth, (x) => `${fmtDec(x, 1)}%`)}</span>], [t('ui.country.pop'), fmtCompact(s.population)], [t('ui.eco.inflation'), fmtPct(s.inflation, 1)]]} />
        <KV rows={[[t('ui.top.treasury'), fmtMoney(s.treasury)], [t('ui.top.debt'), fmtMoney(s.debt)], [t('eco.summary.rating'), s.rating], [t('ui.eco.interest'), fmtPct(s.interest, 1)]]} />
      </div>
      <div>
        <div className="sect-title">{t('ui.eco.sectors')}</div>
        <div className="col gap4">
          {sectorList.map((k) => (
            <div key={k} className="row"><span style={{ width: 110 }} className="dim">{t(`eco.sector.${k}`)}</span><div className="grow"><Progress value={s.sectors[k]} /></div><span className="num" style={{ width: 46 }}>{fmtPct(s.sectors[k])}</span></div>
          ))}
        </div>
      </div>
      <div>
        <Tabs value={tab} onChange={setTab} tabs={[['gdp', t('ui.eco.gdp')], ['balance', t('ui.eco.balance')], ['treasury', t('ui.top.treasury')], ['mood', t('ui.eco.mood')]]} />
        <LineChart xs={xs} series={series} format={(v) => (tab === 'mood' ? String(Math.round(v)) : fmtMoney(v).replace('US$ ', ''))} xFormat={(h) => fmtDate(h)} />
      </div>
      <div className="card col gap4">
        <div className="sect-title">{t('ui.eco.automation')}</div>
        <AutoToggle k="eco.budget" /><AutoToggle k="eco.build" /><AutoToggle k="eco.trade" />
      </div>
    </div>
  );
}
