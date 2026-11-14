import { useState } from 'react';
import {
  dipCommands, selectActionsAgainst, selectRelationBreakdown, selectWarDeclaration, type ActionId,
} from '../../sim/diplomacy';
import { fmtCompact, fmtDec, fmtInt, fmtMoney, fmtPct, fmtSigned } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { Progress } from '../kit/controls';
import { Flag, Icon } from '../kit/Icon';
import { Tip, TipLines } from '../kit/Tooltip';
import { ui } from '../store';
import { countryName, dispatch, me, theWorld, useGame } from '../useGame';

const CMD: Record<Exclude<ActionId, 'territory'>, (c: string, to: string) => ReturnType<typeof dipCommands.improveRelations>> = {
  improve: dipCommands.improveRelations, trade: dipCommands.proposeTrade, nap: dipCommands.proposeNap, access: dipCommands.requestAccess,
  alliance: dipCommands.proposeAlliance, guarantee: dipCommands.guarantee, embargo: dipCommands.embargo, tribute: dipCommands.demandTribute, rebels: dipCommands.supportRebels,
};
const TREATIES = ['trade', 'nap', 'alliance'] as const;

export function CountryFile({ id, onBack }: { id: string; onBack(): void }) {
  const [prov, setProv] = useState<string | null>(null);
  const [cb, setCb] = useState<string>('');
  const [confirmWar, setConfirmWar] = useState(false);
  const c = theWorld().countryById.get(id);
  const d = useGame((_g, ctx) => {
    const dip = ctx.api.diplomacy, M = me();
    return {
      br: selectRelationBreakdown(ctx, M, id),
      actions: selectActionsAgainst(ctx, M, id, prov ?? undefined),
      war: selectWarDeclaration(ctx, M, id),
      atWar: dip.atWar(M, id), emb: dip.embargo(M, id), rep: dip.reputation(id),
      treaty: Object.fromEntries(TREATIES.map((k) => [k, dip.treaty(M, id, k)])) as Record<(typeof TREATIES)[number], boolean>,
      power: ctx.api.military.power(id), mine: ctx.api.military.power(M), gdp: ctx.api.economy.gdp(id), pop: ctx.api.economy.population(id),
      overlord: ctx.api.worldDyn.overlordOf(id), alive: ctx.api.worldDyn.isAlive(id),
    };
  });
  if (!c || !d) return null;
  const best = d.war.options.slice().sort((a, b) => b.strength - a.strength)[0];
  const cbId = cb || best?.id || '';
  const cbOpt = d.war.options.find((o) => o.id === cbId);
  const repCost = [-18, -6, -3, 0][cbOpt?.strength ?? 0];
  const pickProvince = () => ui().setPick({ labelKey: 'ui.dip.pickProvince', onPick: ({ province }) => { if (province) setProv(province); else ui().toast(t('dip.err.badProvince'), 'error'); } });

  return (
    <div className="col" data-testid="country-file">
      <div className="row">
        <button className="btn sm" onClick={onBack} data-testid="dip-back">← {t('ui.back')}</button>
        <Flag id={id} width={28} /><h3 className="grow" style={{ fontSize: 15 }}>{c.namePt}</h3>
        <button className="btn sm" onClick={() => goToWhere({ country: id }, 2_500_000)}><Icon name="locate" />{t('ui.insp.goto')}</button>
      </div>
      <div className="row wrap gap4">
        {d.atWar && <span className="chip bad"><Icon name="war" />{t('ui.dip.atWar')}</span>}
        {d.emb && <span className="chip warn"><Icon name="embargo" />{t('ui.dip.embargoed')}</span>}
        {d.overlord && <span className="chip warn">{t('ui.dip.puppetOf', { c: countryName(d.overlord) })}</span>}
        {!d.alive && <span className="chip bad">{t('ui.dip.dead')}</span>}
        {TREATIES.filter((k) => d.treaty[k]).map((k) => (
          <span key={k} className="chip good">{t(`ui.dip.tr.${k}`)}
            <button className="btn ghost sm" style={{ padding: '0 3px' }} title={t('ui.dip.cancelTreaty')} onClick={() => dispatch(dipCommands.cancelTreaty(me(), id, k))}>×</button>
          </span>
        ))}
        {d.br.treaties.filter((k) => /^(acc|guar)\./.test(k)).map((k) => <span key={k} className="chip">{t(`ui.dip.tr.${k.split('.')[0]}`)}</span>)}
      </div>
      <div className="fact-grid">
        <div><small>{t('ui.country.pop')}</small><b>{fmtCompact(d.pop)}</b></div>
        <div><small>{t('ui.country.gdp')}</small><b>{fmtMoney(d.gdp)}</b></div>
        <div><small>{t('ui.dip.power')}</small><b>{fmtDec(d.power, 0)} <span className="dim">({t('ui.dip.you')} {fmtDec(d.mine, 0)})</span></b></div>
        <div><small>{t('ui.dip.reputation')}</small><b className={d.rep >= 0 ? 'good' : 'bad'}>{fmtSigned(d.rep)}</b></div>
      </div>

      <div className="sect-title">{t('ui.dip.relation')}: <b className={d.br.total >= 20 ? 'good' : d.br.total <= -20 ? 'bad' : ''}>{fmtSigned(d.br.total)}</b></div>
      <Progress value={(d.br.total + 100) / 200} tone={d.br.total >= 20 ? 'good' : d.br.total <= -20 ? 'bad' : 'warn'} />
      <div className="col gap4">
        <div className="row sp"><span className="dim">{t('ui.dip.relBase')}</span><span>{fmtSigned(d.br.base, (x) => fmtDec(x, 1))}</span></div>
        <div className="row sp"><span className="dim">{t('ui.dip.relDynamic')}</span><span>{fmtSigned(d.br.dynamic, (x) => fmtDec(x, 1))}</span></div>
        {d.br.causes.slice(0, 6).map((k, i) => (
          <div key={i} className="row sp" style={{ fontSize: 12 }}><span className="dim">· {t(k.key)}</span><span className={k.v >= 0 ? 'good' : 'bad'}>{fmtSigned(k.v, (x) => fmtDec(x, 1))}</span></div>
        ))}
      </div>

      <div className="sect-title">{t('ui.dip.actions')}</div>
      <table className="tbl" data-testid="dip-actions">
        <tbody>
          {d.actions.map((a) => {
            const run = () => {
              if (a.id === 'territory') { if (prov) { dispatch(dipCommands.demandTerritory(me(), id, prov)); setProv(null); } return; }
              dispatch(CMD[a.id](me(), id));
            };
            const lift = a.id === 'embargo' && d.emb;
            return (
              <tr key={a.id}>
                <td>
                  <Tip tip={<TipLines title={t(`dip.action.${a.id}`)} lines={a.factors.map((f) => [t(f.key), fmtSigned(f.value, (x) => fmtDec(x, 1)), f.value >= 0 ? 'good' : 'bad'])} />}>
                    <span>{t(`dip.action.${a.id}`)}</span>
                  </Tip>
                </td>
                <td className="r">
                  {a.blocked && !lift ? <span className="dim" style={{ whiteSpace: 'normal', fontSize: 11.5 }}>{t(a.blocked, a.blockedParams)}</span>
                    : a.id === 'embargo' || a.id === 'rebels' ? <span className="dim">{a.cost ? fmtMoney(a.cost) : '—'}</span>
                    : <b className={a.chance >= 0.6 ? 'good' : a.chance >= 0.3 ? 'warn' : 'bad'}>{fmtPct(a.chance)}</b>}
                </td>
                <td className="r" style={{ width: 118 }}>
                  {lift ? <button className="btn sm" onClick={() => dispatch(dipCommands.liftEmbargo(me(), id))}>{t('ui.dip.liftEmbargo')}</button>
                    : a.id === 'territory' && !prov ? <button className="btn sm" onClick={pickProvince}>{t('ui.dip.chooseProvince')}</button>
                    : <button className="btn sm primary" data-testid={`dip-act-${a.id}`} disabled={!!a.blocked} onClick={run}>{a.cost > 0 && a.id === 'improve' ? fmtMoney(a.cost) : t('ui.dip.do')}</button>}
                </td>
              </tr>
            );
          })}
          {!d.actions.some((a) => a.id === 'territory') && (
            <tr><td>{t('dip.action.territory')}</td><td className="r dim">—</td><td className="r"><button className="btn sm" onClick={pickProvince}>{t('ui.dip.chooseProvince')}</button></td></tr>
          )}
        </tbody>
      </table>
      {prov && <div className="dim" style={{ fontSize: 12 }}>{t('ui.dip.territoryOf', { p: theWorld().provinceById.get(prov)?.name ?? prov })} <button className="btn ghost sm" onClick={() => setProv(null)}>×</button></div>}

      <div className="sect-title">{t('dip.action.declareWar')}</div>
      {d.war.blocked ? <span className="dim">{t(d.war.blocked)}</span> : (
        <div className="col gap4">
          <div className="row">
            <select className="select grow" value={cbId} onChange={(e) => setCb(e.target.value)} data-testid="dip-cb">
              {!d.war.options.length && <option value="">{t('dip.cb.none')}</option>}
              {d.war.options.map((o) => <option key={o.id} value={o.id}>{t(o.key)} · {t(`ui.dip.cbStrength.${o.strength}`)}</option>)}
            </select>
            <span className="dim" title={t('ui.dip.repHelp')}>{t('ui.dip.reputation')} {fmtInt(repCost)}</span>
          </div>
          {!confirmWar ? <button className="btn danger" data-testid="dip-declare" onClick={() => setConfirmWar(true)}><Icon name="war" />{t('dip.action.declareWar')}</button> : (
            <div className="row">
              <button className="btn danger grow" data-testid="dip-declare-confirm" onClick={() => { dispatch(dipCommands.declareWar(me(), id, cbId || undefined)); setConfirmWar(false); }}>{t('ui.dip.confirmWar', { c: c.namePt })}</button>
              <button className="btn" onClick={() => setConfirmWar(false)}>{t('ui.cancel')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
