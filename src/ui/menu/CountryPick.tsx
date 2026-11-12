import { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, WorldStatic } from '../../core/contracts';
import { appHost, useAppHost } from '../../app/host';
import { setMusic } from '../../audio';
import { onGlobe } from '../../render/globe/registry';
import { fmtCompact, fmtDec, fmtInt, fmtMoney } from '../fmt';
import { t } from '../i18n';
import { Toggle } from '../kit/controls';
import { Flag } from '../kit/Icon';
import { ui } from '../store';

const AUTOMATIONS = ['eco.budget', 'eco.build', 'eco.trade', 'mil.production'] as const;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CountryFacts({ world, id }: { world: WorldStatic; id: string }) {
  const c = world.countryById.get(id)!;
  const st = world.stats[id], mil = world.military[id];
  const plants = world.plantsByCountry.get(id) ?? [];
  const mw = plants.reduce((a, i) => a + world.plants[i].mw, 0);
  const allies = world.alliances.alliances.filter((a) => a.members.includes(id)).map((a) => a.name);
  const fact = (k: string, v: string) => <div><small>{k}</small><b>{v}</b></div>;
  return (
    <div className="card col" data-testid="country-facts">
      <div className="row"><Flag id={id} width={44} /><div><h2 style={{ fontSize: 20 }}>{c.namePt}</h2><div className="dim">{t('ui.country.capital')}: {c.capital.name}</div></div></div>
      <div className="fact-grid">
        {fact(t('ui.country.pop'), st ? fmtCompact(st.pop) : '—')}
        {fact(t('ui.country.gdp'), st ? fmtMoney(st.gdpUsd / 1e6) : '—')}
        {fact(t('ui.country.growth'), st ? `${fmtDec(st.gdpGrowth)}%` : '—')}
        {fact(t('ui.country.milExp'), st ? fmtMoney(st.milExpUsd / 1e6) : '—')}
        {fact(t('ui.country.armed'), st ? fmtCompact(st.armedForces) : '—')}
        {fact(t('ui.country.plants'), `${fmtInt(plants.length)} · ${fmtInt(mw / 1000)} GW`)}
        {mil && fact(t('ui.country.tanks'), fmtInt(mil.tanks))}
        {mil && fact(t('ui.country.fighters'), fmtInt(mil.fighters))}
        {mil && fact(t('ui.country.navy'), fmtInt(mil.destroyers + mil.frigates + mil.subs + mil.carriers))}
        {mil && fact(t('ui.country.nukes'), fmtInt(mil.nukes))}
      </div>
      <div><small className="faint">{t('ui.country.alliances').toUpperCase()}</small><div className="row wrap gap4" style={{ marginTop: 4 }}>{allies.length ? allies.map((a) => <span className="chip" key={a}>{a}</span>) : <span className="dim">{t('ui.country.noAlliances')}</span>}</div></div>
    </div>
  );
}

export function CountryPick() {
  const world = useAppHost((s) => s.world)!;
  const [sel, setSel] = useState<string>('BRA');
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [auto, setAuto] = useState<Record<string, boolean>>({ 'eco.budget': false, 'eco.build': false, 'eco.trade': false, 'mil.production': false });
  const list = useMemo(() => {
    const n = norm(q);
    return world.countries.filter((c) => c.sovereign && (!n || norm(c.namePt).includes(n) || norm(c.name).includes(n))).sort((a, b) => a.namePt.localeCompare(b.namePt, 'pt-BR'));
  }, [world, q]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    const un = onGlobe((g) => {
      off?.();
      off = g?.on('click', (e) => {
        const id = e.pick.countryId;
        if (id && world.countryById.get(id)?.sovereign) setSel(id);
      });
    });
    return () => { un(); off?.(); };
  }, [world]);
  useEffect(() => onGlobe((g) => {
    if (!g || !world.countryById.has(sel)) return;
    g.highlightCountry(sel, 'select');
    const c = world.countryById.get(sel)!;
    void g.flyToBBox(c.bbox, { durationS: 1.2 });
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    return undefined;
  }), [sel, world]);
  useEffect(() => () => onGlobe((g) => g?.highlightCountry(null, 'select'))(), []);

  const start = () => {
    appHost.getState().newGame({ playerCountryId: sel, difficulty: diff, automation: auto });
    ui().select(null);
    ui().go('game');
    setMusic('peace');
    const cap = world.countryById.get(sel)!.capital;
    onGlobe((g) => void g?.flyTo(cap.lon, cap.lat, { height: 2_500_000, durationS: 1.5 }))();
  };
  return (
    <div className="pick pe" data-testid="country-pick">
      <h2>{t('ui.newgame.title')}</h2>
      <p className="dim">{t('ui.newgame.hint')}</p>
      <input className="input" data-testid="country-search" placeholder={t('ui.newgame.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list" ref={listRef} style={{ maxHeight: 190, flex: 'none' }}>
        {list.map((c) => (
          <button key={c.id} data-testid={`pick-${c.id}`} className={c.id === sel ? 'on' : ''} onClick={() => setSel(c.id)}>
            <Flag id={c.id} width={22} /><span className="grow">{c.namePt}</span><span className="faint">{fmtCompact(world.stats[c.id]?.pop ?? 0)}</span>
          </button>
        ))}
      </div>
      {world.countryById.has(sel) && <CountryFacts world={world} id={sel} />}
      <div className="row">
        {(['sandbox', 'normal', 'hard'] as Difficulty[]).map((d) => (
          <button key={d} data-testid={`diff-${d}`} className={`btn grow ${diff === d ? 'on' : ''}`} onClick={() => setDiff(d)}>{t(`ui.diff.${d}`)}</button>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 12 }}>{t(`ui.diff.${diff}.desc`)}</div>
      <div className="col gap4">
        <div className="sect-title">{t('ui.newgame.automation')}</div>
        <div className="fact-grid">{AUTOMATIONS.map((k) => <Toggle key={k} on={auto[k]} onChange={(v) => setAuto({ ...auto, [k]: v })} label={t(`ui.auto.${k}`)} />)}</div>
      </div>
      <div className="row" style={{ marginTop: 'auto' }}>
        <button className="btn" onClick={() => ui().go('menu')}>{t('ui.back')}</button>
        <button className="btn primary grow" data-testid="start-game" onClick={start}>{t('ui.newgame.start')} — {world.countryById.get(sel)?.namePt}</button>
      </div>
    </div>
  );
}
