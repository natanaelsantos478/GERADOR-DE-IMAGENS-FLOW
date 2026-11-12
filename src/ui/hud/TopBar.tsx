import { countrySummary, countryCauses, ledgerOf } from '../../sim/economy';
import { playSound } from '../../audio';
import { useAppHost } from '../../app/host';
import { clamp, fmtDate, fmtDec, fmtInt, fmtCompact, fmtMoney, fmtMw, fmtPct, fmtSigned, levelClass } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { Flag, Icon } from '../kit/Icon';
import { Tip, TipLines } from '../kit/Tooltip';
import { useUi } from '../store';
import { dispatch, me, useGame } from '../useGame';
import type { Speed } from '../../core/contracts';

function causeLines(list: Array<{ key: string; value: number }>): Array<[string, string, string]> {
  return [...list].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 6).map((c) => [t(c.key), fmtSigned(c.value, (x) => fmtDec(x, 1)), c.value >= 0 ? 'good' : 'bad']);
}

export function TopBar() {
  const world = useAppHost((s) => s.world)!;
  const d = useGame((g, ctx) => {
    const c = g.state.meta.playerCountryId;
    const s = countrySummary(ctx, c);
    return {
      c, s, time: g.state.time,
      ledger: ledgerOf(ctx, c).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 6),
      causes: countryCauses(ctx, c),
    };
  });
  if (!d?.s) return null;
  const { s, time } = d;
  const country = world.countryById.get(d.c)!;
  const setSpeed = (sp: Speed) => { playSound('ui_click'); dispatch({ type: 'game.setSpeed', country: me(), speed: sp }); if (time.paused) dispatch({ type: 'game.resume', country: me() }); };
  const energyTone = s.energy.ratio >= 0.99 ? 'good' : s.energy.ratio >= 0.9 ? 'warn' : 'bad';
  return (
    <div className="topbar pe" data-testid="topbar">
      <Tip tip={t('ui.top.gotoCapital')}>
        <button className="btn ghost" onClick={() => goToWhere({ country: d.c }, 2_500_000)}><Flag id={d.c} width={26} /><b>{country.namePt}</b></button>
      </Tip>
      <div className="sep" />
      <span className="mono" data-testid="game-date" style={{ minWidth: 118, fontSize: 14 }}>{fmtDate(time.hours)}</span>
      <div className="speedbar">
        <Tip tip={`${t('ui.top.pause')} (Espaço)`}>
          <button className={`btn sm ${time.paused ? 'on' : ''}`} data-testid="btn-pause" onClick={() => dispatch({ type: 'game.togglePause', country: me() })}><Icon name={time.paused ? 'play' : 'pause'} /></button>
        </Tip>
        {[1, 2, 3, 4, 5].map((n) => (
          <Tip key={n} tip={`${t('ui.top.speed', { n })} (${n})`}>
            <button className={`btn sm ${!time.paused && time.speed === n ? 'on' : ''}`} data-testid={`btn-speed-${n}`} onClick={() => setSpeed(n as Speed)}><Icon name={`speed_${n}`} /></button>
          </Tip>
        ))}
      </div>
      <div className="sep" />
      <Tip tip={<TipLines title={t('ui.top.money')} lines={[[t('ui.top.treasury'), fmtMoney(s.treasury)], [t('ui.top.balance'), fmtMoney(s.balance, true), s.balance >= 0 ? 'good' : 'bad'], [t('ui.top.debt'), fmtMoney(s.debt)], ...d.ledger.map((l) => [t(l.key), fmtMoney(l.amount, true), l.amount >= 0 ? 'good' : 'bad'] as [string, string, string])]} />}>
        <span className="stat" data-testid="stat-money"><Icon name="money" /><b>{fmtMoney(s.treasury)}</b><span className={s.balance >= 0 ? 'good' : 'bad'}>{fmtMoney(s.balance, true)}{t('ui.perMonth')}</span></span>
      </Tip>
      <Tip tip={<TipLines title={t('ui.top.energy')} lines={[[t('ui.top.supply'), fmtMw(s.energy.supplyMw)], [t('ui.top.demand'), fmtMw(s.energy.demandMw)], [t('ui.top.coverage'), fmtPct(s.energy.ratio), energyTone]]} />}>
        <span className="stat"><Icon name="energy" /><b className={energyTone}>{fmtMw(s.energy.supplyMw)}</b><span className="dim">/ {fmtMw(s.energy.demandMw)}</span></span>
      </Tip>
      <Tip tip={<TipLines title={t('ui.top.stability')} lines={causeLines(d.causes)} />}>
        <span className="stat"><Icon name="stability" /><b className={levelClass(s.stability)}>{fmtInt(clamp(s.stability, 0, 100))}</b></span>
      </Tip>
      <Tip tip={<TipLines title={t('ui.top.approval')} lines={causeLines(d.causes)} />}>
        <span className="stat"><Icon name="approval" /><b className={levelClass(s.approval)}>{fmtInt(clamp(s.approval, 0, 100))}%</b></span>
      </Tip>
      <Tip tip={t('ui.top.manpowerTip')}>
        <span className="stat"><Icon name="manpower" /><b>{fmtCompact(s.manpower)}</b></span>
      </Tip>
      <div className="grow" />
      <Tip tip={`${t('ui.menu.pause')} (Esc)`}>
        <button className="btn ghost" data-testid="btn-menu" onClick={() => useUi.getState().setPauseMenu(true)}><Icon name="settings" /></button>
      </Tip>
    </div>
  );
}
