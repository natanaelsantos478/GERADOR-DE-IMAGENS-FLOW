import { useEffect, useState } from 'react';
import {
  dipCommands, selectConferences, selectPeaceChance, selectProposals, selectVote, selectWars, type PeaceOption,
} from '../../sim/diplomacy';
import { fmtDate, fmtPct } from '../fmt';
import { t } from '../i18n';
import { Table, Tabs, type Column } from '../kit/controls';
import { Flag, Icon } from '../kit/Icon';
import { Progress } from '../kit/controls';
import { ui, useUi } from '../store';
import { countryName, dispatch, me, theWorld, useGame } from '../useGame';
import { CountryFile } from './CountryFile';
import { eventHidden, setEventHidden } from './EventModal';

type Tab = 'countries' | 'wars' | 'pending' | 'assembly';
type Row = { id: string; name: string; rel: number; war: boolean; ally: boolean; trade: boolean; power: number; nb: boolean };

function Countries({ onOpen }: { onOpen(id: string): void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'nb' | 'war' | 'ally'>('nb');
  const rows = useGame((_g, ctx): Row[] => {
    const w = theWorld(), M = me(), dip = ctx.api.diplomacy, nbs = new Set(w.countryById.get(M)?.neighbors ?? []);
    const needle = q.trim().toLowerCase();
    const out: Row[] = [];
    for (const c of w.countries) {
      if (c.id === M || !ctx.api.worldDyn.isAlive(c.id)) continue;
      if (needle && !c.namePt.toLowerCase().includes(needle) && !c.id.toLowerCase().includes(needle)) continue;
      const nb = nbs.has(c.id), war = dip.atWar(M, c.id), ally = dip.allied(M, c.id);
      if (!needle && ((f === 'nb' && !nb) || (f === 'war' && !war) || (f === 'ally' && !ally))) continue;
      out.push({ id: c.id, name: c.namePt, rel: dip.relation(M, c.id), war, ally, trade: dip.tradeDeal(M, c.id), power: ctx.api.military.power(c.id), nb });
      if (out.length >= 120) break;
    }
    return out;
  });
  const cols: Column<Row>[] = [
    { key: 'n', label: t('ui.dip.country'), sort: (r) => r.name, render: (r) => <span className="row gap4"><Flag id={r.id} width={20} />{r.name}{r.nb && <span className="faint" title={t('ui.dip.neighbor')}>·</span>}</span> },
    { key: 'r', label: t('ui.dip.relation'), right: true, sort: (r) => r.rel, render: (r) => <b className={r.rel >= 20 ? 'good' : r.rel <= -20 ? 'bad' : ''}>{r.rel > 0 ? '+' : ''}{Math.round(r.rel)}</b> },
    { key: 'p', label: t('ui.dip.power'), right: true, sort: (r) => r.power, render: (r) => Math.round(r.power) },
    { key: 's', label: '', render: (r) => <span className="row gap4">{r.war && <Icon name="war" />}{r.ally && <Icon name="alliance" />}{r.trade && <Icon name="trade" />}</span> },
  ];
  return (
    <div className="col">
      <div className="row">
        <input className="input grow" placeholder={t('ui.dip.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="dip-search" />
        <select className="select" value={f} onChange={(e) => setF(e.target.value as typeof f)}>
          {(['nb', 'all', 'war', 'ally'] as const).map((k) => <option key={k} value={k}>{t(`ui.dip.filter.${k}`)}</option>)}
        </select>
      </div>
      <Table columns={cols} rows={rows} rowKey={(r) => r.id} onRow={(r) => onOpen(r.id)} initialSort={{ key: 'p', desc: true }} empty={t('ui.dip.none')} />
    </div>
  );
}

function Wars() {
  const d = useGame((_g, ctx) => ({ mine: selectWars(ctx, me()), all: selectWars(ctx).length, now: ctx.state.time.hours }));
  const peace = useGame((_g, ctx) => Object.fromEntries(selectWars(ctx, me()).map((w) => [w.war.id, { white: selectPeaceChance(ctx, me(), w.war.id, 'white'), annex: selectPeaceChance(ctx, me(), w.war.id, 'annexOccupied') }])));
  if (!d) return null;
  return (
    <div className="col" data-testid="dip-wars">
      {!d.mine.length && <div className="dim">{t('ui.dip.noWars')}</div>}
      {d.mine.map((w) => {
        const p = peace?.[w.war.id];
        const leader = w.side === 'defenders' ? w.war.defenderLeader : w.war.attackerLeader;
        return (
          <div key={w.war.id} className="card col gap4">
            <div className="row">
              <span className="row gap4"><Flag id={w.war.attackerLeader} width={20} />{countryName(w.war.attackerLeader)}{w.war.attackers.length > 1 && <span className="dim">+{w.war.attackers.length - 1}</span>}</span>
              <span className="grow" style={{ textAlign: 'center' }}><Icon name="war" /></span>
              <span className="row gap4"><Flag id={w.war.defenderLeader} width={20} />{countryName(w.war.defenderLeader)}{w.war.defenders.length > 1 && <span className="dim">+{w.war.defenders.length - 1}</span>}</span>
            </div>
            <div className="row sp"><span className="dim">{t('ui.dip.score')}</span><b className={w.score > 5 ? 'good' : w.score < -5 ? 'bad' : ''}>{w.score > 0 ? '+' : ''}{Math.round(w.score)}</b></div>
            <Progress value={(w.score + 100) / 200} tone={w.score > 5 ? 'good' : w.score < -5 ? 'bad' : 'warn'} />
            <div className="row sp dim" style={{ fontSize: 12 }}><span>{t(w.war.casusBelli)}</span><span>{w.days} {t('ui.days')} · {t('ui.dip.occupation')} {fmtPct(w.war.occA)} / {fmtPct(w.war.occD)}</span></div>
            {w.side && leader === me() && (
              <div className="row wrap gap4">
                <button className="btn sm" onClick={() => dispatch(dipCommands.proposePeace(me(), w.war.id, 'white'))}>{t('dip.peace.white')}{p?.white ? ` (${fmtPct(p.white.chance)})` : ''}</button>
                <button className="btn sm" onClick={() => dispatch(dipCommands.proposePeace(me(), w.war.id, 'annexOccupied'))}>{t('dip.peace.annexOccupied')}{p?.annex ? ` (${fmtPct(p.annex.chance)})` : ''}</button>
                <button className="btn sm" onClick={() => dispatch(dipCommands.callAllies(me(), w.war.id))}><Icon name="alliance" />{t('dip.action.callAllies')}</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="dim" style={{ fontSize: 12 }}>{t('ui.dip.worldWars', { n: d.all })}</div>
    </div>
  );
}

const OPT_ICON: Record<PeaceOption, string> = { annexAll: 'capital', annexOccupied: 'map', puppet: 'treaty', regime: 'stability', reparations: 'money', white: 'peace' };

function Pending() {
  const d = useGame((_g, ctx) => ({ props: selectProposals(ctx, me()), confs: selectConferences(ctx, me()), now: ctx.state.time.hours, ev: ctx.api.diplomacy ? (ctx.state as unknown as { diplomacy: { event: { id: number; type: string } | null } }).diplomacy.event : null }));
  if (!d) return null;
  const empty = !d.props.length && !d.confs.length && !d.ev;
  return (
    <div className="col" data-testid="dip-pending">
      {empty && <div className="dim">{t('ui.dip.nothingPending')}</div>}
      {d.ev && (
        <div className="card row"><Icon name="warning" /><span className="grow">{t(`dip.event.${d.ev.type}.title`)}</span>
          <button className="btn sm primary" onClick={() => setEventHidden(false)}>{t('ui.dip.openEvent')}</button></div>
      )}
      {d.props.map((p) => (
        <div key={p.id} className="card row" data-testid="dip-proposal">
          <Flag id={p.from} width={22} />
          <div className="grow"><b>{countryName(p.from)}</b><div className="dim" style={{ fontSize: 12 }}>{t(`ui.dip.prop.${p.kind}`)} · {t('ui.dip.until')} {fmtDate(p.until)}</div></div>
          <button className="btn sm primary" onClick={() => dispatch(dipCommands.respond(me(), p.id, true))}>{t('ui.dip.accept')}</button>
          <button className="btn sm" onClick={() => dispatch(dipCommands.respond(me(), p.id, false))}>{t('ui.dip.refuse')}</button>
        </div>
      ))}
      {d.confs.map((c) => (
        <div key={c.id} className="card col" data-testid="dip-conference">
          <div className="row"><Icon name="peace" /><b>{t('ui.dip.conference')}: {countryName(c.loser)}</b></div>
          <div className="dim" style={{ fontSize: 12 }}>{t('ui.dip.confHelp', { occ: fmtPct(c.occupied) })}</div>
          <div className="row wrap gap4">
            {c.options.map((o) => <button key={o} className="btn sm" data-testid={`peace-${o}`} onClick={() => dispatch(dipCommands.peaceChoose(me(), c.id, o))}><Icon name={OPT_ICON[o]} />{t(`dip.peace.${o}`)}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Assembly({ target }: { target: string | null }) {
  const d = useGame((_g, ctx) => ({
    vote: selectVote(ctx), rep: ctx.api.diplomacy.reputation(me()), lvl: ctx.api.diplomacy.sanctionLevel(me()),
    sanctions: Object.entries((ctx.state as unknown as { diplomacy: { sanctions: Record<string, number> } }).diplomacy.sanctions).filter(([, u]) => u > ctx.state.time.hours),
  }));
  if (!d) return null;
  const v = d.vote;
  return (
    <div className="col" data-testid="dip-assembly">
      <div className="row sp"><span className="dim">{t('ui.dip.myReputation')}</span><b className={d.rep >= 0 ? 'good' : 'bad'}>{Math.round(d.rep)}</b></div>
      {d.lvl > 0.01 && <div className="chip bad">{t('ui.dip.sanctionedYou', { p: fmtPct(d.lvl) })}</div>}
      <div className="sect-title">{t('ui.dip.vote')}</div>
      {v ? (
        <div className="card col gap4" data-testid="dip-vote">
          <div className="row"><Flag id={v.target} width={22} /><b>{t('ui.dip.voteAgainst', { c: countryName(v.target) })}</b></div>
          <div className="dim" style={{ fontSize: 12 }}>{t(v.reason)} · {t('ui.dip.proposedBy', { c: countryName(v.proposer) })} · {t('ui.dip.until')} {fmtDate(v.endsHours)}</div>
          {v.player === undefined ? (
            <div className="row"><button className="btn sm primary" onClick={() => dispatch(dipCommands.vote(me(), true))}>{t('ui.dip.voteYes')}</button><button className="btn sm" onClick={() => dispatch(dipCommands.vote(me(), false))}>{t('ui.dip.voteNo')}</button></div>
          ) : <span className="chip">{v.player ? t('ui.dip.voteYes') : t('ui.dip.voteNo')}</span>}
        </div>
      ) : <div className="dim">{t('ui.dip.noVote')}</div>}
      {target && target !== me() && !v && (
        <button className="btn sm" onClick={() => dispatch(dipCommands.proposeSanction(me(), target))}>{t('dip.action.sanction')}: {countryName(target)}</button>
      )}
      {d.sanctions.length > 0 && <>
        <div className="sect-title">{t('ui.dip.activeSanctions')}</div>
        {d.sanctions.map(([c, u]) => <div key={c} className="row sp"><span className="row gap4"><Flag id={c} width={18} />{countryName(c)}</span><span className="dim">{t('ui.dip.until')} {fmtDate(u)}</span></div>)}
      </>}
    </div>
  );
}

export function DiplomacyPanel() {
  const selCountry = useUi((s) => (s.selection?.kind === 'country' ? (s.selection.country ?? null) : null));
  const [tab, setTab] = useState<Tab>('countries');
  const [open, setOpen] = useState<string | null>(selCountry);
  const pending = useGame((_g, ctx) => selectProposals(ctx, me()).length + selectConferences(ctx, me()).length + ((ctx.state as unknown as { diplomacy: { event: unknown } }).diplomacy.event ? 1 : 0));
  useEffect(() => { if (selCountry) { setOpen(selCountry); setTab('countries'); } }, [selCountry]);
  void eventHidden;
  return (
    <div className="col" data-testid="dip-panel">
      <Tabs value={tab} onChange={(v: Tab) => { setTab(v); if (v !== 'countries') setOpen(null); }} tabs={[
        ['countries', t('ui.dip.tab.countries')], ['wars', t('ui.dip.tab.wars')], ['pending', `${t('ui.dip.tab.pending')}${pending ? ` (${pending})` : ''}`], ['assembly', t('ui.dip.tab.assembly')],
      ]} />
      {tab === 'countries' && (open ? <CountryFile id={open} onBack={() => setOpen(null)} /> : <Countries onOpen={(id) => { setOpen(id); ui().select({ kind: 'country', id, country: id }); }} />)}
      {tab === 'wars' && <Wars />}
      {tab === 'pending' && <Pending />}
      {tab === 'assembly' && <Assembly target={open ?? selCountry} />}
    </div>
  );
}
