import type { ReactNode } from 'react';
import type { InfraKind } from '../../core/contracts';
import { cityCauses, repair, repairCost } from '../../sim/economy';
import type { InfraTarget } from '../../sim/economy';
import { fmtDec, fmtMoney, fmtPct, fmtSigned } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { Progress } from '../kit/controls';
import { Flag, Icon } from '../kit/Icon';
import { ui } from '../store';
import { dispatch, me, useGame } from '../useGame';

export function InspectorHead({ icon, title, sub, country }: { icon?: string; title: ReactNode; sub?: ReactNode; country?: string | null }) {
  return (
    <div className="row" style={{ marginBottom: 8 }}>
      {country ? <Flag id={country} width={28} /> : icon ? <Icon name={icon} size={22} /> : null}
      <div className="grow"><h3 style={{ fontSize: 15 }}>{title}</h3>{sub && <div className="dim" style={{ fontSize: 12 }}>{sub}</div>}</div>
      <button className="btn ghost sm" aria-label={t('ui.close')} onClick={() => ui().select(null)}><Icon name="close" /></button>
    </div>
  );
}

export function Causes({ list }: { list: Array<{ key: string; value: number }> }) {
  const sorted = [...list].filter((c) => Math.abs(c.value) > 0.05).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return (
    <div className="col gap4">
      {sorted.map((c) => <div key={c.key} className="row sp"><span className="dim">{t(c.key)}</span><span className={c.value >= 0 ? 'good' : 'bad'}>{fmtSigned(c.value, (x) => fmtDec(x, 1))}</span></div>)}
      {!sorted.length && <span className="dim">—</span>}
    </div>
  );
}

const KIND: Record<InfraTarget, InfraKind> = { city: 'city', plant: 'plant', airport: 'airport', port: 'port', road: 'road' };

/** Health bar + repair button for static infrastructure owned by the player. */
export function RepairBlock({ infra, index, owner }: { infra: InfraTarget; index: number; owner: string | null }) {
  const d = useGame((g, ctx) => ({ dmg: ctx.api.worldDyn.damageOf(KIND[infra], index), q: repairCost(ctx, infra, index), busy: ctx.state.economy.repairs.some((r) => r.infra === infra && r.index === index) }));
  if (!d) return null;
  const health = 1 - d.dmg;
  return (
    <div className="col gap4">
      <div className="row sp"><span className="dim">{t('ui.insp.health')}</span><b className={health > 0.8 ? 'good' : health > 0.4 ? 'warn' : 'bad'}>{fmtPct(health)}</b></div>
      <Progress value={health} tone={health > 0.8 ? 'good' : health > 0.4 ? 'warn' : 'bad'} />
      {d.dmg > 0.005 && owner === me() && (
        <div className="row sp">
          <span className="dim">{d.busy ? t('ui.insp.repairing') : `${fmtMoney(d.q.cost)} · ${d.q.days} ${t('ui.days')}`}</span>
          <button className="btn sm primary" disabled={d.busy} data-testid="btn-repair" onClick={() => dispatch(repair(me(), infra, index))}><Icon name="construction" />{t('ui.insp.repair')}</button>
        </div>
      )}
    </div>
  );
}
export { cityCauses, goToWhere };
