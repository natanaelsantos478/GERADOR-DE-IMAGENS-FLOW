import { registerInspector, useRegistry, type InspectorProps } from '../registry';
import { cityCauses } from '../../sim/economy';
import { fmtCompact, fmtDec, fmtInt, fmtMoney, fmtMw, fmtPct, levelClass } from '../fmt';
import { goToWhere } from '../goto';
import { t } from '../i18n';
import { KV, Progress } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { ui } from '../store';
import { countryName, me, theWorld, useGame } from '../useGame';
import { Causes, InspectorHead, RepairBlock } from './common';

const W = () => theWorld();

function ProvinceInspector({ sel }: InspectorProps) {
  const p = sel.province ? W().provinceById.get(sel.province) : null;
  const d = useGame((_g, ctx) => p && ({
    owner: ctx.api.worldDyn.ownerOf(p.id), controller: ctx.api.worldDyn.controllerOf(p.id),
    built: ctx.api.economy.structures({ province: p.id }).map((s) => ({ id: s.id, kind: s.kind, progress: s.progress })),
  }));
  if (!p || !d) return <InspectorHead title={t('ui.insp.sea')} />;
  const w = W();
  const cities = (w.citiesByProvince.get(p.id) ?? []).map((i) => w.cities[i]).sort((a, b) => b.pop - a.pop);
  const pop = cities.reduce((a, c) => a + c.pop, 0);
  return (
    <>
      <InspectorHead country={d.owner} title={p.name} sub={countryName(d.owner)} />
      <KV rows={[
        [t('ui.insp.area'), `${fmtInt(p.areaKm2)} km²`], [t('ui.insp.elev'), `${fmtInt(p.elevMean)} m`], [t('ui.insp.urbanPop'), fmtCompact(pop)],
        [t('ui.insp.plants'), fmtInt(w.plantsByProvince.get(p.id)?.length ?? 0)],
        ...(d.controller !== d.owner ? [[t('ui.insp.occupiedBy'), countryName(d.controller)] as [string, string]] : []),
      ]} />
      <div className="sect-title">{t('ui.insp.cities')}</div>
      <div className="col gap4">
        {cities.slice(0, 6).map((c) => (
          <button key={c.index} className="btn sm ghost" style={{ justifyContent: 'space-between' }} onClick={() => ui().select({ kind: 'city', index: c.index, id: c.index, province: p.id, country: d.owner, lonLat: [c.lon, c.lat] })}>
            <span className="row gap4">{c.capital ? <Icon name="capital" /> : <Icon name="city" />}{c.name}</span><span className="dim">{fmtCompact(c.pop)}</span>
          </button>
        ))}
      </div>
      {d.built.length > 0 && <><div className="sect-title">{t('ui.insp.buildings')}</div>{d.built.map((b) => <div key={b.id} className="row sp"><span>{t(`ui.kind.${b.kind}`)}</span><span className="dim">{b.progress < 1 ? fmtPct(b.progress) : t('ui.insp.done')}</span></div>)}</>}
    </>
  );
}

function CityInspector({ sel }: InspectorProps) {
  const i = sel.index ?? -1;
  const city = W().cities[i];
  const d = useGame((_g, ctx) => ({
    sat: ctx.api.economy.citySatisfaction(i), causes: cityCauses(ctx, i), blackout: ctx.api.economy.inBlackout(i),
    owner: city?.provinceId ? ctx.api.worldDyn.controllerOf(city.provinceId) : city?.countryId ?? null,
    built: city?.provinceId ? ctx.api.economy.structures({ province: city.provinceId }).map((s) => ({ id: s.id, kind: s.kind, progress: s.progress })) : [],
  }));
  if (!city || !d) return null;
  return (
    <>
      <InspectorHead icon={city.capital ? 'capital' : 'city'} title={city.name} sub={`${countryName(d.owner)} · ${fmtCompact(city.pop)} ${t('ui.insp.inhabitants')}`} country={d.owner} />
      <div className="row sp"><span className="dim">{t('ui.insp.satisfaction')}</span><b className={levelClass(d.sat)}>{fmtInt(d.sat)}</b></div>
      <Progress value={d.sat / 100} tone={d.sat >= 60 ? 'good' : d.sat >= 40 ? 'warn' : 'bad'} />
      {d.blackout && <div className="chip bad" style={{ marginTop: 6 }}><Icon name="energy" />{t('ui.insp.blackout')}</div>}
      <div className="sect-title">{t('ui.insp.causes')}</div>
      <Causes list={d.causes} />
      <div className="sect-title">{t('ui.insp.damage')}</div>
      <RepairBlock infra="city" index={i} owner={d.owner} />
      {d.built.length > 0 && <><div className="sect-title">{t('ui.insp.buildings')}</div>{d.built.map((b) => <div key={b.id} className="row sp"><span>{t(`ui.kind.${b.kind}`)}</span><span className="dim">{b.progress < 1 ? fmtPct(b.progress) : t('ui.insp.done')}</span></div>)}</>}
    </>
  );
}

function PlantInspector({ sel }: InspectorProps) {
  const plant = W().plants[sel.index ?? -1];
  const owner = useGame((_g, ctx) => (plant?.provinceId ? ctx.api.worldDyn.controllerOf(plant.provinceId) : plant?.countryId ?? null));
  if (!plant) return null;
  return (
    <>
      <InspectorHead icon={plant.fuel === 'other' ? 'energy' : plant.fuel === 'oil' ? 'oil_plant' : plant.fuel} title={plant.name} sub={countryName(owner)} country={owner} />
      <KV rows={[[t('ui.insp.capacity'), fmtMw(plant.mw)], [t('ui.insp.fuel'), t(`eco.fuel.${plant.fuel}`)]]} />
      <div className="sect-title">{t('ui.insp.condition')}</div>
      <RepairBlock infra="plant" index={sel.index!} owner={owner} />
    </>
  );
}

function SiteInspector({ sel }: InspectorProps) {
  const w = W();
  const isAir = sel.kind === 'airport';
  const site = isAir ? w.airports[sel.index ?? -1] : w.ports[sel.index ?? -1];
  const owner = useGame((_g, ctx) => (site?.provinceId ? ctx.api.worldDyn.controllerOf(site.provinceId) : site?.countryId ?? null));
  if (!site) return null;
  const rows: Array<[string, string]> = [[t('ui.insp.size'), t(`ui.size.${site.size}`)]];
  if (isAir) {
    const a = w.airports[sel.index!];
    rows.push([t('ui.insp.iata'), a.iata || '—'], [t('ui.insp.type'), a.military ? t('ui.insp.military') : t('ui.insp.civil')]);
  }
  return (
    <>
      <InspectorHead icon={isAir ? 'airport' : 'port'} title={site.name} sub={countryName(owner)} country={owner} />
      <KV rows={rows} />
      <div className="sect-title">{t('ui.insp.condition')}</div>
      <RepairBlock infra={isAir ? 'airport' : 'port'} index={sel.index!} owner={owner} />
    </>
  );
}

function StructureInspector({ sel }: InspectorProps) {
  const s = useGame((_g, ctx) => ctx.api.economy.structures().find((x) => x.id === sel.id) ?? null);
  if (!s) return <InspectorHead title="—" />;
  return (
    <>
      <InspectorHead icon={s.kind === 'powerPlant' ? 'energy' : 'construction'} title={t(`ui.kind.${s.kind}`)} sub={countryName(s.country)} country={s.country} />
      <KV rows={[
        ...(s.mw ? [[t('ui.insp.capacity'), fmtMw(s.mw)] as [string, string]] : []),
        ...(s.fuel ? [[t('ui.insp.fuel'), t(`eco.fuel.${s.fuel}`)] as [string, string]] : []),
        [t('ui.insp.progress'), fmtPct(s.progress)], [t('ui.insp.health'), fmtPct(s.health)],
      ]} />
      <Progress value={s.progress} />
    </>
  );
}

function CountryInspector({ sel }: InspectorProps) {
  const id = sel.country ?? '';
  const c = W().countryById.get(id);
  const hasDip = useRegistry((s) => s.panels.some((p) => p.id === 'diplomacy'));
  const d = useGame((_g, ctx) => ({
    rel: ctx.api.diplomacy.relation(me(), id), war: ctx.api.diplomacy.atWar(me(), id), ally: ctx.api.diplomacy.allied(me(), id), trade: ctx.api.diplomacy.tradeDeal(me(), id),
    power: ctx.api.military.power(id), gdp: ctx.api.economy.gdp(id), pop: ctx.api.economy.population(id), alive: ctx.api.worldDyn.isAlive(id), overlord: ctx.api.worldDyn.overlordOf(id),
  }));
  if (!c || !d) return null;
  return (
    <>
      <InspectorHead country={id} title={c.namePt} sub={sel.province ? W().provinceById.get(sel.province)?.name : c.continent} />
      <div className="row wrap gap4" style={{ marginBottom: 8 }}>
        {d.war && <span className="chip bad"><Icon name="war" />{t('ui.dip.atWar')}</span>}
        {d.ally && <span className="chip good"><Icon name="alliance" />{t('ui.dip.allied')}</span>}
        {d.trade && <span className="chip"><Icon name="trade" />{t('ui.dip.tradeDeal')}</span>}
        {d.overlord && <span className="chip warn">{t('ui.dip.puppetOf', { c: countryName(d.overlord) })}</span>}
        {!d.alive && <span className="chip bad">{t('ui.dip.dead')}</span>}
      </div>
      <div className="row sp"><span className="dim">{t('ui.dip.relation')}</span><b className={d.rel >= 20 ? 'good' : d.rel <= -20 ? 'bad' : ''}>{d.rel > 0 ? '+' : ''}{fmtInt(d.rel)}</b></div>
      <Progress value={(d.rel + 100) / 200} tone={d.rel >= 20 ? 'good' : d.rel <= -20 ? 'bad' : 'warn'} />
      <div style={{ marginTop: 8 }}><KV rows={[
        [t('ui.country.pop'), fmtCompact(d.pop)], [t('ui.country.gdp'), fmtMoney(d.gdp)], [t('ui.dip.power'), fmtDec(d.power, 0)], [t('ui.country.capital'), c.capital.name],
      ]} /></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn grow" onClick={() => goToWhere({ country: id }, 2_500_000)}><Icon name="locate" />{t('ui.insp.goto')}</button>
        <button className="btn primary grow" data-testid="btn-open-dip" disabled={!hasDip} title={hasDip ? undefined : t('ui.dip.soon')} onClick={() => ui().openWin('diplomacy')}><Icon name="diplomacy" />{t('ui.dip.open')}</button>
      </div>
    </>
  );
}

registerInspector('province', ProvinceInspector);
registerInspector('city', CityInspector);
registerInspector('plant', PlantInspector);
registerInspector('airport', SiteInspector);
registerInspector('port', SiteInspector);
registerInspector('structure', StructureInspector);
registerInspector('country', CountryInspector);
