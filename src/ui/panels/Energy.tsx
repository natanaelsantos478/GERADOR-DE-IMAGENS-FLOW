import { useMemo, useState } from 'react';
import { energyByFuel, setPowerContract } from '../../sim/economy';
import { fmtMw, fmtPct, fmtInt } from '../fmt';
import { t } from '../i18n';
import { Progress, Table } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { useUi } from '../store';
import { countryName, dispatch, me, theWorld, useGame } from '../useGame';

const fuelIcon = (f: string) => (f === 'oil' ? 'oil_plant' : f === 'other' ? 'energy' : f);

export function EnergyPanel() {
  const world = theWorld();
  const [partner, setPartner] = useState('');
  const [mw, setMw] = useState(500);
  const d = useGame((_g, ctx) => {
    const c = me();
    const e = ctx.state.economy.c[c];
    let dark = 0, total = 0;
    for (const p of ctx.api.worldDyn.provincesControlledBy(c)) for (const i of world.citiesByProvince.get(p) ?? []) { total++; if (ctx.api.economy.inBlackout(i)) dark++; }
    return { en: ctx.api.economy.energy(c), fuels: energyByFuel(ctx, c), imp: e.energy.importMw, exp: e.energy.exportMw, contracts: ctx.state.economy.contracts.filter((k) => k.from === c || k.to === c), dark, total };
  });
  const countries = useMemo(() => world.countries.filter((c) => c.sovereign && c.id !== me()).sort((a, b) => a.namePt.localeCompare(b.namePt, 'pt-BR')), [world]);
  if (!d) return null;
  const tone = d.en.ratio >= 0.99 ? 'good' : d.en.ratio >= 0.9 ? 'warn' : 'bad';
  return (
    <div className="col">
      <div className="card col gap4">
        <div className="row sp"><span>{t('ui.top.supply')} / {t('ui.top.demand')}</span><b>{fmtMw(d.en.supplyMw)} / {fmtMw(d.en.demandMw)}</b></div>
        <Progress value={Math.min(1, d.en.ratio)} tone={tone} />
        <div className="row sp"><span className="dim">{t('ui.top.coverage')}</span><b className={tone}>{fmtPct(d.en.ratio, 1)}</b></div>
        <div className="row sp"><span className="dim">{t('ui.en.imports')} / {t('ui.en.exports')}</span><span>{fmtMw(d.imp)} / {fmtMw(d.exp)}</span></div>
        <div className="row sp"><span className="dim">{t('ui.en.blackouts')}</span><b className={d.dark ? 'bad' : 'good'}>{d.dark ? t('ui.en.citiesDark', { n: d.dark, total: d.total }) : t('ui.en.none')}</b></div>
      </div>
      <div className="sect-title">{t('ui.en.byFuel')}</div>
      <Table rowKey={(r) => r.fuel} rows={d.fuels} initialSort={{ key: 'mw', desc: true }}
        columns={[
          { key: 'f', label: t('ui.insp.fuel'), sort: (r) => t(`eco.fuel.${r.fuel}`), render: (r) => <span className="row gap4"><Icon name={fuelIcon(r.fuel)} />{t(`eco.fuel.${r.fuel}`)}</span> },
          { key: 'mw', label: 'MW', right: true, sort: (r) => r.mw, render: (r) => fmtInt(r.mw) },
          { key: 'sh', label: '%', right: true, render: (r) => fmtPct(r.mw / Math.max(1, d.en.supplyMw)) },
        ]} />
      <div className="sect-title">{t('ui.en.contracts')}</div>
      <Table rowKey={(k) => `${k.from}-${k.to}`} rows={d.contracts} empty={t('ui.en.noContracts')}
        columns={[
          { key: 'd', label: t('ui.en.direction'), render: (k) => (k.from === me() ? `${t('ui.en.exportTo')} ${countryName(k.to)}` : `${t('ui.en.importFrom')} ${countryName(k.from)}`) },
          { key: 'mw', label: 'MW', right: true, render: (k) => fmtInt(k.mw) },
          { key: 'x', label: '', right: true, render: (k) => (k.from === me() ? <button className="btn sm danger" onClick={() => dispatch(setPowerContract(me(), k.to, 0))}>{t('ui.cancel')}</button> : null) },
        ]} />
      <div className="row">
        <select className="select grow" value={partner} onChange={(e) => setPartner(e.target.value)}>
          <option value="">{t('ui.en.chooseCountry')}</option>
          {countries.map((c) => <option key={c.id} value={c.id}>{c.namePt}</option>)}
        </select>
        <input className="input" style={{ width: 90 }} type="number" min={50} step={50} value={mw} onChange={(e) => setMw(Number(e.target.value))} />
        <button className="btn primary" disabled={!partner} onClick={() => dispatch(setPowerContract(me(), partner, mw))}>{t('ui.en.sell')}</button>
      </div>
      <button className="btn" onClick={() => useUi.getState().openWin('construction')}><Icon name="construction" />{t('ui.en.build')}</button>
    </div>
  );
}
