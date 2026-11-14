import { visibleFormations } from '../../sim/military';
import { selectAdvice } from '../../sim/ai';
import { fmtDec } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { Flag, Icon } from '../kit/Icon';
import { countryName, dispatch, me, theWorld, useGame } from '../useGame';
import { selectFormation } from './ForcesPanel';
import type { AdviceItem } from '../../core/contracts';

export function AdviceRow({ a, compact }: { a: AdviceItem; compact?: boolean }) {
  return (
    <div className={compact ? 'row' : 'card row'} style={{ alignItems: 'flex-start', gap: 6 }} data-testid="advice-item">
      <Icon name="intelligence" />
      <div className="grow" style={{ fontSize: compact ? 12 : 13 }}>{t(a.key, a.params)}</div>
      {a.where && <button className="btn ghost sm" title={t('ui.insp.goto')} onClick={() => goToWhere(a.where)}><Icon name="locate" /></button>}
      {a.command && <button className="btn sm primary" data-testid="advice-do" onClick={() => dispatch(a.command!)}>{t('ui.intel.apply')}</button>}
    </div>
  );
}

export function IntelPanel() {
  const d = useGame((_g, ctx) => {
    const M = me(), w = theWorld(), dip = ctx.api.diplomacy;
    const nb = new Set(w.countryById.get(M)?.neighbors ?? []);
    for (const e of dip.enemies(M)) nb.add(e);
    const mine = ctx.api.military.power(M);
    const rows = [...nb].filter((c) => ctx.api.worldDyn.isAlive(c)).map((c) => ({ id: c, power: ctx.api.military.power(c), rel: dip.relation(M, c), war: dip.atWar(M, c), ally: dip.allied(M, c) }));
    const mineProv = new Set(ctx.api.worldDyn.provincesOwnedBy(M));
    const threats = visibleFormations(ctx, M).filter((f) => f.country !== M && dip.atWar(M, f.country) && f.province && mineProv.has(f.province)).map((f) => ({ id: f.id, name: f.name, country: f.country, strength: f.strength }));
    return { mine, rows: rows.sort((a, b) => b.power - a.power), threats, adv: selectAdvice(ctx, M), cap: ctx.api.military.strikeCapability(M) };
  });
  if (!d) return null;
  const max = Math.max(d.mine, ...d.rows.map((r) => r.power), 1);
  const bar = (id: string, name: string, v: number, cls = '') => (
    <div key={id} className="row" style={{ gap: 6 }}><span style={{ width: 130 }} className="row gap4"><Flag id={id} width={16} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span></span>
      <div className="grow bar"><i style={{ width: `${(v / max) * 100}%`, background: cls || undefined }} /></div><b style={{ width: 44, textAlign: 'right' }}>{fmtDec(v, 0)}</b></div>
  );
  return (
    <div className="col" data-testid="intel-panel">
      <div className="sect-title">{t('ui.intel.advice')}</div>
      {d.adv.length ? d.adv.map((a, i) => <AdviceRow key={i} a={a} />) : <div className="dim">{t('ui.intel.noAdvice')}</div>}
      <div className="sect-title">{t('ui.intel.compare')}</div>
      {bar(me(), `${t('ui.dip.you')}`, d.mine, 'var(--good)')}
      {d.rows.map((r) => (
        <div key={r.id} className="row" style={{ gap: 4 }}>
          <div className="grow">{bar(r.id, countryName(r.id), r.power, r.war ? 'var(--bad)' : r.ally ? 'var(--good)' : undefined)}</div>
          {r.power > d.mine * 0.8 && !r.ally && r.rel < 20 && <span className="chip warn" title={t('ui.intel.threatHelp')}>{t('ui.intel.threat')}</span>}
        </div>
      ))}
      <div className="sect-title">{t('ui.intel.threats')}</div>
      {!d.threats.length && <div className="dim">{t('ui.intel.noThreats')}</div>}
      {d.threats.map((f) => (
        <button key={f.id} className="btn sm" style={{ justifyContent: 'space-between' }} onClick={() => selectFormation(f.id)}>
          <span className="row gap4"><Flag id={f.country} width={16} />{f.name}</span><span className="bad">{Math.round(f.strength * 100)}%</span>
        </button>
      ))}
      <div className="sect-title">{t('ui.intel.arsenal')}</div>
      <div className="row wrap gap4">
        <span className="chip">{t('ui.mil.vec.cruise')} {d.cap.cruiseMissiles}</span><span className="chip">{t('ui.mil.vec.ballistic')} {d.cap.ballisticMissiles}</span>
        <span className="chip">{t('ui.mil.vec.nuke')} {d.cap.nukes}</span><span className="chip">{t('ui.mil.vec.bomber')} {d.cap.bombers}</span><span className="chip">{t('ui.mil.vec.drone')} {d.cap.drones}</span>
      </div>
    </div>
  );
}

/** Discreet top-3 advice card on the HUD. */
export function AdviceCard() {
  const adv = useGame((_g, ctx) => selectAdvice(ctx, me()).slice(0, 3));
  if (!adv?.length) return null;
  return (
    <div className="advice pe" data-testid="advice-card">
      <div className="sect-title" style={{ margin: 0 }}>{t('ui.intel.advisor')}</div>
      {adv.map((a, i) => <AdviceRow key={i} a={a} compact />)}
    </div>
  );
}
