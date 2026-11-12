import { useEffect, useState } from 'react';
import type { LonLat } from '../../core/contracts';
import { build, cancelBuild, constructionOptions, repair, repairCost } from '../../sim/economy';
import type { BuildOption, InfraTarget } from '../../sim/economy';
import { getGlobe } from '../../render/globe/registry';
import { fmtInt, fmtMoney, fmtMw, fmtPct } from '../fmt';
import { goTo } from '../goto';
import { t } from '../i18n';
import { Progress, Table, Tabs } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { Tip } from '../kit/Tooltip';
import { ui, useUi } from '../store';
import { dispatch, me, theWorld, useGame } from '../useGame';
import { AutoToggle, resIcon } from './common';

interface Loc { province: string; lonLat: LonLat | null }
const REPAIRABLE: Array<[InfraTarget, 'cityDamage' | 'plantDamage' | 'airportDamage' | 'portDamage']> = [['city', 'cityDamage'], ['plant', 'plantDamage'], ['airport', 'airportDamage'], ['port', 'portDamage']];

function Cost({ o }: { o: BuildOption }) {
  return (
    <span className="row wrap gap4">
      {Object.entries(o.cost).filter(([, v]) => v).map(([k, v]) => (
        <span key={k} className="row gap4" title={t(`eco.res.${k}`)}><Icon name={resIcon(k)} />{k === 'money' ? fmtMoney(v!) : fmtInt(v!)}</span>
      ))}
    </span>
  );
}

export function ConstructionPanel() {
  const w = theWorld();
  const [tab, setTab] = useState<'new' | 'queue' | 'repair'>('new');
  const [loc, setLoc] = useState<Loc | null>(null);
  const pickMode = useUi((s) => s.pickMode);
  const capProv = useGame((_g, ctx) => { const i = ctx.world.capitalCityOf(me()); return i === null ? null : ctx.world.cities[i].provinceId; });
  useEffect(() => { if (!loc && capProv) setLoc({ province: capProv, lonLat: null }); }, [loc, capProv]);
  useEffect(() => { getGlobe()?.highlightProvince(loc?.province ?? null, 'select'); }, [loc]);

  const d = useGame((_g, ctx) => {
    const c = me();
    const owned = ctx.api.economy.structures({ country: c });
    const damaged: Array<{ infra: InfraTarget; index: number; name: string; dmg: number; cost: number; days: number }> = [];
    for (const [infra, key] of REPAIRABLE) {
      for (const k of Object.keys(ctx.state.world[key])) {
        const index = Number(k);
        const q = repairCost(ctx, infra, index);
        if (q.damage < 0.005) continue;
        const item = infra === 'city' ? ctx.world.cities[index] : infra === 'plant' ? ctx.world.plants[index] : infra === 'airport' ? ctx.world.airports[index] : ctx.world.ports[index];
        if (!item?.provinceId || ctx.api.worldDyn.controllerOf(item.provinceId) !== c) continue;
        damaged.push({ infra, index, name: item.name, dmg: q.damage, cost: q.cost, days: q.days });
      }
    }
    return {
      options: loc ? constructionOptions(ctx, c, loc.province) : [],
      queue: owned.filter((s) => s.progress < 1).map((s) => ({ id: s.id, kind: s.kind, fuel: s.fuel, mw: s.mw, progress: s.progress, province: s.province, lon: s.lon, lat: s.lat, days: ctx.state.economy.structures[s.id]?.days ?? 0 })),
      damaged,
      repairs: ctx.state.economy.repairs.filter((r) => r.country === c),
    };
  });
  if (!d) return null;
  const choose = () => {
    ui().setPick({ labelKey: 'ui.con.pickBanner', onPick: (p) => { if (p.province) setLoc({ province: p.province, lonLat: p.lonLat }); else ui().toast(t('eco.err.badLocation'), 'error'); } });
  };
  const useSelection = () => { const s = ui().selection; if (s?.province) setLoc({ province: s.province, lonLat: s.lonLat ?? null }); };
  const prov = loc ? w.provinceById.get(loc.province) : null;
  const groups = [...new Set(d.options.map((o) => o.kind))];

  return (
    <div className="col" data-testid="construction-panel">
      <Tabs value={tab} onChange={setTab} tabs={[['new', t('ui.con.new')], ['queue', `${t('ui.con.queue')} (${d.queue.length})`], ['repair', `${t('ui.con.repair')} (${d.damaged.length})`]]} />
      {tab === 'new' && (
        <>
          <div className="card row">
            <Icon name="locate" />
            <div className="grow"><div className="dim" style={{ fontSize: 11 }}>{t('ui.con.location')}</div><b>{prov ? `${prov.name} · ${w.countryById.get(prov.countryId)?.namePt}` : '—'}</b></div>
            <button className="btn sm" onClick={useSelection} disabled={!useUi.getState().selection?.province}>{t('ui.con.useSelection')}</button>
            <button className={`btn sm primary ${pickMode ? 'on' : ''}`} data-testid="btn-pick-loc" onClick={choose}>{t('ui.con.pick')}</button>
          </div>
          {groups.map((kind) => (
            <div key={kind}>
              <div className="sect-title">{t(`ui.kind.${kind}`)}</div>
              <Table rowKey={(o) => o.id} rows={d.options.filter((o) => o.kind === kind)}
                columns={[
                  { key: 'n', label: t('ui.con.name'), render: (o) => <span title={o.blocked ? t(o.blocked) : undefined}>{t(o.nameKey)}{o.mw ? <span className="dim"> · {fmtMw(o.mw)}</span> : null}</span> },
                  { key: 'c', label: t('ui.con.cost'), render: (o) => <Cost o={o} /> },
                  { key: 'd', label: t('ui.days'), right: true, render: (o) => fmtInt(o.days) },
                  { key: 'b', label: '', right: true, render: (o) => (
                    <Tip tip={o.blocked ? t(o.blocked) : ''}>
                      <button className="btn sm primary" disabled={!!o.blocked} data-testid={`build-${o.id}`}
                        onClick={() => loc && dispatch(build(me(), o.kind, loc.province, { variant: o.variant, mw: o.mw, lon: loc.lonLat?.[0], lat: loc.lonLat?.[1] }))}>{t('ui.con.build')}</button>
                    </Tip>) },
                ]} />
              {d.options.filter((o) => o.kind === kind && o.blocked).slice(0, 1).map((o) => <div key="b" className="faint" style={{ fontSize: 11 }}>{t('ui.con.blockedHint')}: {t(o.blocked!)}</div>)}
            </div>
          ))}
          {!groups.length && <div className="dim">{t('ui.con.noOptions')}</div>}
          <AutoToggle k="eco.build" />
        </>
      )}
      {tab === 'queue' && (
        <Table rowKey={(s) => s.id} rows={d.queue} empty={t('ui.con.emptyQueue')}
          columns={[
            { key: 'n', label: t('ui.con.name'), render: (s) => <span>{s.kind === 'powerPlant' && s.fuel ? t(`eco.build.plant.${s.fuel}`) : t(`ui.kind.${s.kind}`)}{s.mw ? <span className="dim"> · {fmtMw(s.mw)}</span> : null}</span> },
            { key: 'p', label: t('ui.insp.progress'), render: (s) => <div style={{ width: 90 }}><Progress value={s.progress} /></div> },
            { key: 'e', label: t('ui.con.eta'), right: true, render: (s) => `${fmtInt(Math.ceil((1 - s.progress) * s.days))} ${t('ui.days')}` },
            { key: 'x', label: '', right: true, render: (s) => (
              <span className="row gap4" style={{ justifyContent: 'flex-end' }}>
                <button className="btn sm ghost" onClick={() => goTo(s.lon, s.lat, 300_000)}><Icon name="locate" /></button>
                <button className="btn sm danger" data-testid={`cancel-${s.id}`} onClick={() => dispatch(cancelBuild(me(), s.id))}>{t('ui.cancel')}</button>
              </span>) },
          ]} />
      )}
      {tab === 'repair' && (
        <>
          <Table rowKey={(r) => `${r.infra}${r.index}`} rows={d.damaged} empty={t('ui.con.noDamage')} initialSort={{ key: 'dmg', desc: true }}
            columns={[
              { key: 'n', label: t('ui.con.name'), sort: (r) => r.name, render: (r) => <span className="row gap4"><Icon name={r.infra} />{r.name}</span> },
              { key: 'dmg', label: t('ui.insp.damage'), right: true, sort: (r) => r.dmg, render: (r) => <span className="bad">{fmtPct(r.dmg)}</span> },
              { key: 'c', label: t('ui.con.cost'), right: true, render: (r) => `${fmtMoney(r.cost)} · ${r.days} ${t('ui.days')}` },
              { key: 'x', label: '', right: true, render: (r) => {
                const busy = d.repairs.some((j) => j.infra === r.infra && j.index === r.index);
                return <button className="btn sm primary" disabled={busy} onClick={() => dispatch(repair(me(), r.infra, r.index))}>{busy ? t('ui.insp.repairing') : t('ui.insp.repair')}</button>;
              } },
            ]} />
        </>
      )}
    </div>
  );
}
