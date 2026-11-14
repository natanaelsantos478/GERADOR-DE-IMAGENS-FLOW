import { battlePreviews } from '../../sim/military';
import { fmtDec, fmtPct } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { InspectorHead } from '../inspect/common';
import type { InspectorProps } from '../registry';
import { Progress } from '../kit/controls';
import { Flag, Icon } from '../kit/Icon';
import { ui } from '../store';
import { countryName, dispatch, me, useGame } from '../useGame';
import { selectFormation } from './ForcesPanel';

export function BattleInspector({ sel }: InspectorProps) {
  const id = String(sel.id ?? '');
  const d = useGame((g, ctx) => {
    const b = battlePreviews(ctx).find((x) => x.id === id);
    if (!b) return null;
    const fm = (ids: string[]) => ids.map((f) => ctx.api.military.formation(f)).filter(Boolean).map((f) => ({ id: f!.id, name: f!.name, country: f!.country, strength: f!.strength, morale: f!.morale, domain: f!.domain }));
    const tac = g.state.tactical?.battle;
    return { b, A: fm(b.attackers), D: fm(b.defenders), tacBusy: !!tac && !tac.result, mine: b.attackerCountries.includes(me()) || b.defenderCountries.includes(me()), paused: g.state.time.paused };
  });
  if (!d) return <InspectorHead title={t('ui.mil.battleOver')} />;
  const { b } = d;
  const total = b.attackerStrength + b.defenderStrength || 1;
  const side = (list: typeof d.A, countries: string[], key: string) => (
    <div className="col gap4" style={{ flex: 1, minWidth: 0 }}>
      <div className="row gap4"><Flag id={countries[0]} width={18} /><b>{countryName(countries[0])}</b>{countries.length > 1 && <span className="dim">+{countries.length - 1}</span>}</div>
      <div className="dim" style={{ fontSize: 11 }}>{t(key)}</div>
      {list.map((f) => <button key={f.id} className="btn ghost sm" style={{ justifyContent: 'space-between', padding: '2px 4px' }} onClick={() => selectFormation(f.id)}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span><span className={f.strength > 0.5 ? 'good' : 'warn'}>{fmtPct(f.strength)}</span></button>)}
    </div>
  );
  return (
    <div data-testid="battle-inspector">
      <InspectorHead icon="war" title={t('ui.mil.battle')} />
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>{side(d.A, b.attackerCountries, 'ui.mil.attackers')}{side(d.D, b.defenderCountries, 'ui.mil.defenders')}</div>
      <div className="sect-title">{t('ui.mil.forecast')}</div>
      <div className="row sp"><span>{fmtDec(b.attackerStrength, 1)}</span><span className="dim">{t('ui.mil.balance')}: {b.balance > 0 ? '+' : ''}{Math.round(b.balance * 100)}%</span><span>{fmtDec(b.defenderStrength, 1)}</span></div>
      <Progress value={b.attackerStrength / total} tone={b.balance > 0.1 ? 'good' : b.balance < -0.1 ? 'bad' : 'warn'} />
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{b.etaDays === null ? t('ui.mil.stalemate') : t('ui.mil.etaBreak', { d: b.etaDays })}</div>
      <div className="col" style={{ marginTop: 10 }}>
        {b.tactical ? <div className="chip warn">{t('ui.mil.inTactical')}</div> : (
          <>
            <button className="btn primary" data-testid="btn-tac-start" disabled={!d.mine || d.tacBusy} title={!d.mine ? t('ui.mil.notParticipant') : undefined} onClick={() => dispatch({ type: 'tac.start', country: me(), battleId: id } as never)}><Icon name="attack" />{t('ui.mil.commandBattle')}</button>
            <button className="btn" data-testid="btn-tac-auto" onClick={() => { if (d.paused) dispatch({ type: 'game.resume', country: me() }); ui().toast(t('ui.mil.autoResolving')); ui().select(null); }}>{t('ui.mil.autoResolve')}</button>
          </>
        )}
        <button className="btn ghost" onClick={() => goToWhere({ battle: id }, 40_000)}><Icon name="locate" />{t('ui.insp.goto')}</button>
      </div>
    </div>
  );
}
