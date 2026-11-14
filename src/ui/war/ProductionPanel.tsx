import { useState } from 'react';
import type { Cost } from '../../core/contracts';
import { milCmd, productionQueue, unitCatalog } from '../../sim/military';
import { countrySummary } from '../../sim/economy';
import { TECHS } from '../../sim/research';
import { fmtCompact, fmtDec, fmtInt, fmtMoney, fmtPct } from '../fmt';
import { t } from '../i18n';
import { Progress, Tabs, Toggle } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { Tip, TipLines } from '../kit/Tooltip';
import { dispatch, me, useGame } from '../useGame';

const DOMAINS = ['land', 'air', 'naval', 'missile'] as const;
const techFor = (unit: string) => TECHS.find((x) => x.unlocks.includes(`unit.${unit}`));

export function costText(c: Cost): string {
  return Object.entries(c).filter(([, v]) => v).map(([k, v]) => (k === 'money' ? fmtMoney(v!) : `${fmtInt(v!)} ${t(`eco.res.${k}`)}`)).join(' · ');
}

export function ProductionPanel() {
  const [dom, setDom] = useState<(typeof DOMAINS)[number]>('land');
  const [qty, setQty] = useState(1);
  const d = useGame((g, ctx) => ({
    cat: unitCatalog(ctx, me()).map((u) => ({ u, afford: ctx.api.economy.canAfford(me(), u.cost), researched: u.available })),
    queue: productionQueue(ctx, me()), auto: g.state.meta.automation['mil.production'] === true,
    man: countrySummary(ctx, me())?.manpower ?? 0,
  }));
  if (!d) return null;
  const rows = d.cat.filter((r) => r.u.domain === dom);
  return (
    <div className="col" data-testid="production-panel">
      <div className="row sp"><b>{t('ui.prod.queue')} ({d.queue.length})</b><span className="dim"><Icon name="manpower" /> {fmtCompact(d.man)}</span></div>
      {!d.queue.length && <div className="dim">{t('ui.prod.emptyQueue')}</div>}
      {d.queue.map((q) => (
        <div key={q.id} className="card row" data-testid="queue-item">
          <div className="grow"><div className="row sp"><b>{q.qty}× {t(`mil.unit.${q.t}`)}</b><span className="dim">{q.left > 0 ? fmtPct(q.progress) : t('ui.prod.waiting')}</span></div><Progress value={q.progress} /></div>
          <button className="btn sm" onClick={() => dispatch(milCmd.cancelProduction(me(), q.id))}>{t('ui.prod.cancel')}</button>
        </div>
      ))}
      <Toggle on={d.auto} onChange={(v) => dispatch({ type: 'game.setAutomation', country: me(), key: 'mil.production', value: v } as never)} label={<span title={t('ui.autoHelp.mil.production')}>{t('ui.auto.mil.production')}</span>} />
      <div className="sect-title">{t('ui.prod.catalog')}</div>
      <div className="row">
        <div className="grow"><Tabs value={dom} onChange={setDom} tabs={DOMAINS.map((x) => [x, t(`ui.mil.domain.${x}`)])} /></div>
        <span className="dim">{t('ui.prod.qty')}</span><input className="input" type="number" min={1} max={20} value={qty} style={{ width: 56 }} onChange={(e) => setQty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
      </div>
      <table className="tbl"><tbody>
        {rows.map(({ u, afford, researched }) => {
          const tech = techFor(u.id);
          const block = !researched ? t('ui.prod.needsTech', { tech: tech ? t(`tech.${tech.id}`) : '—' }) : !afford ? t('ui.prod.noResources') : null;
          return (
            <tr key={u.id} data-testid={`unit-${u.id}`}>
              <td><Tip tip={<TipLines title={t(`mil.unit.${u.id}`)} lines={[[t('ui.prod.men'), fmtInt(u.men)], [t('ui.prod.range'), `${fmtInt(u.range)} km`], [t('ui.prod.speed'), `${fmtInt(u.road || u.sea || u.fly)} km/h`], [t('ui.prod.upkeep'), fmtMoney(u.upkeep)], ...(u.cap ? [[t('ui.prod.cap'), String(u.cap)] as [string, string]] : [])]} />}><span><Icon name={u.iconId} /> {t(`mil.unit.${u.id}`)}</span></Tip></td>
              <td className="dim" style={{ fontSize: 11.5 }}>{costText(u.cost)}<br />{fmtDec(u.pts, 0)} {t('ui.prod.pts')}</td>
              <td className="r" style={{ width: 150 }}>
                {block ? <span className="dim" style={{ fontSize: 11.5, whiteSpace: 'normal' }}>{block}</span>
                  : <button className="btn sm primary" data-testid={`produce-${u.id}`} onClick={() => dispatch(milCmd.produce(me(), u.id, qty))}>{t('ui.prod.produce')} ×{qty}</button>}
              </td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}
