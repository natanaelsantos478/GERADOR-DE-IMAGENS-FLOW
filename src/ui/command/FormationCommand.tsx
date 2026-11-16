import type { OfficerView } from '../../core/contracts';
import { milCmd } from '../../sim/military';
import { fmtDec, fmtPct } from '../fmt';
import { t } from '../i18n';
import { Progress } from '../kit/controls';
import { Tip, TipLines } from '../kit/Tooltip';
import { dispatch, me, useGame } from '../useGame';

const tone = (v: number) => (v >= 0.6 ? 'good' : v >= 0.3 ? 'warn' : 'bad');

export function Meter({ label, v, inverse, tip }: { label: string; v: number; inverse?: boolean; tip?: React.ReactNode }) {
  const row = (
    <div className="row" style={{ gap: 6, width: '100%' }}>
      <span className="dim" style={{ width: 110, fontSize: 12 }}>{label}</span>
      <div className="grow"><Progress value={v} tone={tone(inverse ? 1 - v : v)} /></div>
      <span style={{ width: 38, textAlign: 'right', fontSize: 12 }}>{fmtPct(v)}</span>
    </div>
  );
  return tip ? <Tip tip={tip} className="grow">{row}</Tip> : row;
}

export const rankName = (o: Pick<OfficerView, 'rankKey'>) => t(`mil.rank.${o.rankKey}`);

export function TraitChips({ traits }: { traits: string[] }) {
  return (
    <span className="row wrap gap4">
      {traits.map((k) => <Tip key={k} tip={<TipLines title={t(`mil.trait.${k}`)} lines={[[t(`mil.trait.${k}.desc`), '']]} />}><span className="chip">{t(`mil.trait.${k}`)}</span></Tip>)}
    </span>
  );
}

export function SkillsTip({ o }: { o: OfficerView }) {
  return (
    <TipLines title={`${rankName(o)} ${o.name}`} lines={[
      [t('ui.cmd.attack'), fmtDec(o.attack, 1)], [t('ui.cmd.attack.tip'), ''],
      [t('ui.cmd.defense'), fmtDec(o.defense, 1)], [t('ui.cmd.defense.tip'), ''],
      [t('ui.cmd.logistics'), fmtDec(o.logistics, 1)], [t('ui.cmd.logistics.tip'), ''],
      [t('ui.cmd.maneuver'), fmtDec(o.maneuver, 1)], [t('ui.cmd.maneuver.tip'), ''],
    ]} />
  );
}

export function FormationCommandBlock({ id }: { id: string }) {
  const d = useGame((_g, ctx) => {
    const m = ctx.api.military;
    const f = m.formation(id);
    if (!f) return null;
    const own = f.country === me();
    const options = own ? m.officers(me()).filter((o) => o.status === 'active' && o.domain === f.domain).map((o) => ({ id: o.id, label: `${t(`mil.rank.${o.rankKey}`)} ${o.name} (${o.attack.toFixed(0)}/${o.defense.toFixed(0)}/${o.logistics.toFixed(0)}/${o.maneuver.toFixed(0)})${o.formation && o.formation !== id ? ' •' : ''}` })) : [];
    return { f, own, options };
  });
  if (!d) return null;
  const { f, own, options } = d;
  const c = f.commander ?? null, fg = f.fatigue ?? 0, q = f.readiness ?? 1, w = f.weather;
  const causes: string[] = [];
  if (w) {
    if (w.mud > 0.25) causes.push(t('ui.cmd.wx.cause.mud'));
    if (w.tempC < -8) causes.push(t('ui.cmd.wx.cause.cold'));
    if (w.tempC > 33) causes.push(t('ui.cmd.wx.cause.heat'));
    if (w.kind === 'snow') causes.push(t('ui.cmd.wx.cause.snow'));
    if (f.domain === 'air' && w.air < 0.7) causes.push(t('ui.cmd.wx.cause.air'));
  }
  return (
    <div data-testid="formation-command" className="col gap4" style={{ marginTop: 8 }}>
      <div className="sect-title">{t('ui.cmd.commander')}</div>
      {c ? (
        <>
          <Tip tip={<SkillsTip o={c} />}>
            <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
              <b>{rankName(c)} {c.name}</b>
              <span className="dim">{t('ui.cmd.abbr')} {c.attack.toFixed(0)}/{c.defense.toFixed(0)}/{c.logistics.toFixed(0)}/{c.maneuver.toFixed(0)}</span>
            </div>
          </Tip>
          <TraitChips traits={c.traits} />
          <Meter label={t('ui.cmd.exp')} v={c.experience} />
        </>
      ) : <span className="dim">{t('ui.cmd.noCommander')}</span>}
      {own && (
        <select className="btn sm" value={c?.id ?? ''} data-testid="commander-select" onChange={(e) => dispatch(milCmd.assignCommander(me(), id, e.target.value || null))}>
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
      <Meter label={t('ui.cmd.fatigue')} v={fg} inverse tip={<TipLines title={t('ui.cmd.fatigue')} lines={[[t('ui.cmd.fatigue.tip'), ''], [t('ui.cmd.fatigue.eff', { s: Math.round((1 - 0.4 * fg) * 100), p: Math.round((1 - 0.3 * fg) * 100) }), ''], [t('ui.cmd.fatigue.mor'), '']]} />} />
      <Meter label={t('ui.cmd.readiness')} v={q} tip={<TipLines title={t('ui.cmd.readiness')} lines={[[t('ui.cmd.ready.tip'), ''], [t('ui.cmd.ready.eff', { p: Math.round((0.7 + 0.3 * q) * 100), s: Math.round((0.8 + 0.2 * q) * 100) }), '']]} />} />
      {w && (
        <Tip tip={<TipLines title={t('ui.cmd.weather')} lines={[
          [t('ui.cmd.wx.temp'), `${fmtDec(w.tempC, 0)} °C`], [t('ui.cmd.wx.mud'), fmtPct(w.mud)], [t('ui.cmd.wx.off'), fmtPct(w.off)],
          [t('ui.cmd.wx.air', { c: w.ceilingM, v: fmtDec(w.visKm, 0) }), fmtPct(w.air)],
          [t('ui.cmd.wx.cause'), causes.length ? causes.join('; ') : t('ui.cmd.wx.cause.ok')],
        ]} />}>
          <div className="row" style={{ gap: 6 }}><span className="dim" style={{ width: 110, fontSize: 12 }}>{t('ui.cmd.weather')}</span><span>{t(`ui.cmd.wx.kind.${w.kind}`)} · {fmtDec(w.tempC, 0)} °C</span></div>
        </Tip>
      )}
    </div>
  );
}
