import { useState } from 'react';
import { borrow, countrySummary, ledgerOf, repay, setSpend, setTax, TAX_KINDS } from '../../sim/economy';
import type { Pillar } from '../../sim/economy';
import { fmtMoney, fmtPct } from '../fmt';
import { t } from '../i18n';
import { Slider, Table } from '../kit/controls';
import { dispatch, me, useGame } from '../useGame';
import { AutoToggle } from './common';

const PILLARS: Pillar[] = ['health', 'education', 'security', 'infrastructure', 'social', 'defense', 'research'];

export function BudgetPanel() {
  const [amount, setAmount] = useState(10000);
  const d = useGame((_g, ctx) => ({ s: countrySummary(ctx, me()), ledger: ledgerOf(ctx, me()) }));
  if (!d?.s) return null;
  const { s, ledger } = d;
  const rev = ledger.filter((l) => l.category === 'revenue'), exp = ledger.filter((l) => l.category === 'expense');
  return (
    <div className="col">
      <div className="sect-title">{t('ui.bud.taxes')}</div>
      {TAX_KINDS.map((k) => (
        <div key={k} className="row" title={t(`ui.bud.taxHelp.${k}`)}>
          <span style={{ width: 90 }}>{t(`eco.tax.${k}`)}</span>
          <div className="grow"><Slider value={s.taxes[k]} min={0} max={0.6} step={0.01} onChange={(v) => dispatch(setTax(me(), k, v))} format={(v) => fmtPct(v)} /></div>
        </div>
      ))}
      <div className="sect-title">{t('ui.bud.spending')}</div>
      {PILLARS.map((p) => (
        <div key={p} className="row" title={t(`ui.bud.pillarHelp.${p}`)}>
          <span style={{ width: 90 }}>{t(`eco.pillar.${p}`)}</span>
          <div className="grow"><Slider value={s.spending[p]} min={0} max={2} step={0.05} onChange={(v) => dispatch(setSpend(me(), p, v))} format={(v) => fmtPct(v)} /></div>
        </div>
      ))}
      <div className="sect-title">{t('ui.bud.ledger')}</div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow"><Table columns={[{ key: 'k', label: t('ui.bud.revenue'), render: (l) => t(l.key) }, { key: 'v', label: '', right: true, render: (l) => <span className="good">{fmtMoney(l.amount, true)}</span> }]} rows={rev} rowKey={(l) => l.key} /></div>
        <div className="grow"><Table columns={[{ key: 'k', label: t('ui.bud.expense'), render: (l) => t(l.key) }, { key: 'v', label: '', right: true, render: (l) => <span className="bad">{fmtMoney(l.amount, true)}</span> }]} rows={exp} rowKey={(l) => l.key} /></div>
      </div>
      <div className="row sp card"><b>{t('ui.top.balance')}{t('ui.perMonth')}</b><b className={s.balance >= 0 ? 'good' : 'bad'}>{fmtMoney(s.balance, true)}</b></div>
      <div className="sect-title">{t('ui.bud.debt')} · {t('eco.summary.rating')} {s.rating} · {fmtPct(s.interest, 1)} a.a.</div>
      <div className="row sp"><span className="dim">{t('ui.top.debt')}</span><b>{fmtMoney(s.debt)}</b></div>
      <div className="row">
        <input className="input grow" type="number" min={100} step={1000} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />
        <span className="dim">US$ mi</span>
        <button className="btn" data-testid="btn-borrow" onClick={() => dispatch(borrow(me(), amount))}>{t('ui.bud.borrow')}</button>
        <button className="btn" onClick={() => dispatch(repay(me(), amount))}>{t('ui.bud.repay')}</button>
      </div>
      <AutoToggle k="eco.budget" />
    </div>
  );
}
