import { useMemo, useState } from 'react';
import { countrySummary, setEmbargo, trade } from '../../sim/economy';
import type { StockResource } from '../../core/contracts';
import { fmtDec, fmtInt, fmtMoney } from '../fmt';
import { t } from '../i18n';
import { Table } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { countryName, dispatch, me, theWorld, useGame } from '../useGame';
import { AutoToggle, resIcon } from './common';

export function TradePanel() {
  const world = theWorld();
  const [qty, setQty] = useState(100);
  const [target, setTarget] = useState('');
  const d = useGame((_g, ctx) => ({ s: countrySummary(ctx, me()), embargo: ctx.state.economy.embargo[me()] ?? [], blockaded: (ctx.state.economy.blockade[me()] ?? 0) > ctx.state.time.hours }));
  const countries = useMemo(() => world.countries.filter((c) => c.sovereign && c.id !== me()).sort((a, b) => a.namePt.localeCompare(b.namePt, 'pt-BR')), [world]);
  if (!d?.s) return null;
  return (
    <div className="col">
      {d.blockaded && <div className="chip bad"><Icon name="warning" />{t('ui.trade.blockaded')}</div>}
      <div className="row"><span className="dim">{t('ui.trade.qty')}</span><input className="input" style={{ width: 100 }} type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} /><span className="faint grow" style={{ fontSize: 11 }}>{t('ui.trade.fees')}</span></div>
      <Table rowKey={(r) => r.res} rows={d.s.stocks}
        columns={[
          { key: 'r', label: t('ui.trade.resource'), render: (r) => <span className="row gap4"><Icon name={resIcon(r.res)} />{t(`eco.res.${r.res}`)}</span> },
          { key: 's', label: t('ui.trade.stock'), right: true, render: (r) => fmtInt(r.stock) },
          { key: 'net', label: t('ui.trade.netDay'), right: true, render: (r) => { const n = r.prodPerDay - r.consPerDay; return <span className={n >= 0 ? 'good' : 'bad'}>{n > 0 ? '+' : ''}{fmtDec(n, 1)}</span>; } },
          { key: 'u', label: t('ui.trade.unmet'), right: true, render: (r) => (r.unmet > 0.01 ? <span className="bad">{fmtDec(r.unmet, 1)}</span> : '—') },
          { key: 'p', label: t('ui.trade.price'), right: true, render: (r) => fmtMoney(r.price) },
          { key: 'x', label: '', right: true, render: (r) => (
            <span className="row gap4" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm" data-testid={`buy-${r.res}`} onClick={() => dispatch(trade(me(), r.res as StockResource, qty))}>{t('ui.trade.buy')}</button>
              <button className="btn sm" onClick={() => dispatch(trade(me(), r.res as StockResource, -qty))}>{t('ui.trade.sell')}</button>
            </span>) },
        ]} />
      <div className="sect-title">{t('ui.trade.embargoes')}</div>
      <div className="row wrap gap4">
        {d.embargo.map((c) => <span key={c} className="chip bad">{countryName(c)} <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => dispatch(setEmbargo(me(), c, false))}>×</button></span>)}
        {!d.embargo.length && <span className="dim">{t('ui.trade.noEmbargo')}</span>}
      </div>
      <div className="row">
        <select className="select grow" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('ui.en.chooseCountry')}</option>
          {countries.filter((c) => !d.embargo.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.namePt}</option>)}
        </select>
        <button className="btn danger" disabled={!target} onClick={() => { dispatch(setEmbargo(me(), target, true)); setTarget(''); }}>{t('ui.trade.embargo')}</button>
      </div>
      <AutoToggle k="eco.trade" />
    </div>
  );
}
