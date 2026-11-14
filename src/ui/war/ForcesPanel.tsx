import { useEffect, useState } from 'react';
import { battlePreviews, UNITS, visibleFormations } from '../../sim/military';
import { useUnitSelection } from '../../render/units/store';
import { fmtPct } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { Tabs } from '../kit/controls';
import { Flag, Icon } from '../kit/Icon';
import { ui, useUi } from '../store';
import { countryName, me, useGame } from '../useGame';
import { orderLabel } from './common';
import { StrikesTab } from './StrikePanel';

const tone = (v: number) => (v >= 0.6 ? 'good' : v >= 0.3 ? 'warn' : 'bad');
const DOMAINS = ['land', 'air', 'naval'] as const;

/** Keeps the right-hand inspector in sync with the globe's box/click selection of formations. */
export function UnitSelectionBridge() {
  useEffect(() => useUnitSelection.subscribe((s, prev) => {
    if (s.selected === prev.selected || !s.selected.length) return;
    const cur = ui().selection;
    if (cur?.kind === 'formation' && cur.id === s.selected[0]) return;
    ui().select({ kind: 'formation', id: s.selected[0] });
  }), []);
  return null;
}

export function selectFormation(id: string) {
  useUnitSelection.getState().select([id]);
  ui().select({ kind: 'formation', id });
  goToWhere({ formation: id }, 700_000);
}

function FormationList() {
  const [others, setOthers] = useState(false);
  const selected = useUnitSelection((s) => s.selected);
  const cur = useUi((s) => (s.selection?.kind === 'formation' ? String(s.selection.id) : null));
  const d = useGame((_g, ctx) => ({
    list: visibleFormations(ctx, me()).filter((f) => others || f.country === me()).map((f) => ({
      id: f.id, name: f.name, domain: f.domain, country: f.country, strength: f.strength, org: f.organization, supply: f.supply, order: f.order, battle: !!f.battleId, tpl: f.units[0]?.template,
    })),
    battles: battlePreviews(ctx).map((b) => ({ id: b.id, a: b.attackerCountries, d: b.defenderCountries, bal: b.balance })),
  }));
  if (!d) return null;
  return (
    <div className="col" data-testid="forces-list">
      {d.battles.length > 0 && (
        <>
          <div className="sect-title">{t('ui.mil.battles')}</div>
          {d.battles.map((b) => (
            <button key={b.id} className="btn sm" style={{ justifyContent: 'space-between' }} data-testid="battle-row" onClick={() => { ui().select({ kind: 'battle', id: b.id }); goToWhere({ battle: b.id }, 60_000); }}>
              <span className="row gap4"><Icon name="war" /><Flag id={b.a[0]} width={16} />{countryName(b.a[0])} × <Flag id={b.d[0]} width={16} />{countryName(b.d[0])}</span>
              <span className={b.bal > 0.1 ? 'good' : b.bal < -0.1 ? 'bad' : 'dim'}>{b.bal > 0 ? '+' : ''}{Math.round(b.bal * 100)}%</span>
            </button>
          ))}
        </>
      )}
      <label className="row dim" style={{ fontSize: 12 }}><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />{t('ui.mil.showOthers')}</label>
      {DOMAINS.map((dom) => {
        const rows = d.list.filter((f) => f.domain === dom);
        if (!rows.length) return null;
        return (
          <div key={dom} className="col gap4">
            <div className="sect-title">{t(`ui.mil.domain.${dom}`)} ({rows.length})</div>
            <table className="tbl"><tbody>
              {rows.map((f) => (
                <tr key={f.id} className="click" data-testid="formation-row" style={selected.includes(f.id) || cur === f.id ? { background: '#14424b' } : undefined} onClick={() => selectFormation(f.id)}>
                  <td>{f.tpl && <Icon name={UNITS[f.tpl as 'infantry']?.iconId ?? 'infantry'} />} {f.country !== me() && <Flag id={f.country} width={14} />} {f.name}{f.battle && <Icon name="war" />}</td>
                  <td className="r"><span className={tone(f.strength)} title={t('ui.mil.strength')}>{fmtPct(f.strength)}</span></td>
                  <td className="r"><span className={tone(f.org)} title={t('ui.mil.org')}>{fmtPct(f.org)}</span></td>
                  <td className="r"><span className={tone(f.supply)} title={t('ui.mil.supply')}>{fmtPct(f.supply)}</span></td>
                  <td className="dim">{orderLabel(f.order)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        );
      })}
      {!d.list.length && <div className="dim">{t('ui.mil.noForces')}</div>}
      <div className="dim" style={{ fontSize: 11.5 }}>{t('ui.mil.cols')}</div>
    </div>
  );
}

export function ForcesPanel() {
  const [tab, setTab] = useState<'list' | 'strikes'>('list');
  return (
    <div className="col" data-testid="forces-panel">
      <Tabs value={tab} onChange={setTab} tabs={[['list', t('ui.mil.tab.forces')], ['strikes', t('ui.mil.tab.strikes')]]} />
      {tab === 'list' ? <FormationList /> : <StrikesTab />}
    </div>
  );
}
