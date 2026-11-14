import { fmtInt, fmtPct } from '../fmt';
import { t } from '../i18n';
import { countryName } from '../useGame';
import { Flag, Icon } from '../kit/Icon';
import type { TacModel } from './model';

export function TacResult({ m, onExit }: { m: TacModel; onExit(): void }) {
  const r = m.result!;
  const ps = m.player ?? 0;
  const won = r.winner === ps, draw = r.winner === null;
  const side = (s: 0 | 1) => r.squads.filter((q) => q.side === s);
  const cols = ([0, 1] as const).map((s) => ({ s, list: side(s), lost: r.casualties[s], country: m.countries[s][0] }));
  return (
    <div className="modal-back" style={{ zIndex: 40 }}>
      <div className="modal" style={{ width: 640 }} data-testid="tac-result">
        <div className="win-head"><h3>{t('ui.tac.resultTitle')}</h3></div>
        <div className="win-body col">
          <div className="row" style={{ justifyContent: 'center', fontSize: 18 }}>
            <Icon name={draw ? 'peace' : won ? 'check' : 'warning'} size={26} />
            <b className={draw ? 'warn' : won ? 'good' : 'bad'}>{draw ? t('tac.result.draw') : t('tac.result.winner', { side: countryName(m.countries[r.winner!][0]) })}</b>
          </div>
          <div className="dim" style={{ textAlign: 'center' }}>{t(`tac.result.${r.reason}`)} · {Math.floor(r.elapsedS / 60)} min · {t('ui.tac.score')} {r.score[ps]} × {r.score[1 - ps]}</div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            {cols.map((c) => (
              <div key={c.s} className="col gap4" style={{ flex: 1 }}>
                <div className="row gap4"><Flag id={c.country} width={20} /><b>{countryName(c.country)}</b>{c.s === ps && <span className="chip">{t('ui.tac.you')}</span>}</div>
                <div className="bad" style={{ fontSize: 13 }}>{t('ui.tac.casualties')}: <b>{fmtInt(c.lost)}</b></div>
                <table className="tbl"><tbody>
                  {c.list.map((q) => <tr key={q.ref}><td>{t(`tac.kind.${q.kind}`)}</td><td className="r">{q.alive}/{q.initial}</td><td className="r">{fmtPct(q.strength)}</td></tr>)}
                </tbody></table>
              </div>
            ))}
          </div>
          {r.collateral > 0.02 && <div className="warn" style={{ fontSize: 12 }}>{t('ui.tac.collateral', { p: fmtPct(r.collateral) })}</div>}
          <button className="btn primary" data-testid="tac-result-ok" onClick={onExit}>{t('ui.tac.backToMap')}</button>
        </div>
      </div>
    </div>
  );
}
