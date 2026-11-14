import { useState } from 'react';
import type { LonLat } from '../../core/contracts';
import { milCmd, stockView, strikeTargets, UNITS, visibleFormations, type TargetRef } from '../../sim/military';
import { fmtInt } from '../fmt';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';
import { dispatch, me, theWorld, useGame } from '../useGame';
import { kmBetween, pickPoint, targetKey, targetName, targetPos } from './common';

function TargetPicker({ from, range, value, onChange }: { from: LonLat; range: number; value: TargetRef | null; onChange(t: TargetRef | null): void }) {
  const list = useGame((_g, ctx) => strikeTargets(ctx, me(), from, range).map((tg) => ({ tg, key: targetKey(tg), name: targetName(tg), pos: targetPos(tg, (id) => ctx.api.military.formation(id)?.pos ?? null) })));
  if (!list) return null;
  const choose = () => pickPoint('ui.mil.pickTarget', (p) => {
    let best: (typeof list)[number] | null = null, bd = 250;
    for (const o of list) if (o.pos) { const k = kmBetween(o.pos, p); if (k < bd) { bd = k; best = o; } }
    if (best) onChange(best.tg); else onChange(null);
  });
  return (
    <div className="col gap4">
      <div className="row sp"><span className="dim">{t('ui.mil.targets', { n: list.length })}</span><button className="btn sm" data-testid="strike-pick" onClick={choose}><Icon name="locate" />{t('ui.mil.chooseOnGlobe')}</button></div>
      {!list.length && <span className="warn" style={{ fontSize: 12 }}>{t('ui.mil.noTargets')}</span>}
      <div className="col gap4" style={{ maxHeight: 150, overflowY: 'auto' }}>
        {list.slice(0, 20).map((o) => (
          <button key={o.key} className={`btn sm ${value && targetKey(value) === o.key ? 'on' : ''}`} style={{ justifyContent: 'space-between' }} onClick={() => onChange(o.tg)}>
            <span>{t(`ui.mil.tk.${o.tg.kind}`)} · {o.name}</span><span className="dim">{o.pos ? fmtInt(kmBetween(from, o.pos)) : '—'} km</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const rangeOf = (templates: string[]) => Math.max(0, ...templates.map((x) => UNITS[x as keyof typeof UNITS]?.radius ?? 0));

/** Strike mission for one air formation (bombers / drones). */
export function StrikeBlock({ formation }: { formation: string }) {
  const [target, setTarget] = useState<TargetRef | null>(null);
  const [open, setOpen] = useState(false);
  const f = useGame((_g, ctx) => { const v = ctx.api.military.formation(formation); return v ? { pos: v.pos, tpl: [...new Set(v.units.map((u) => u.template))] } : null; });
  if (!f || !f.tpl.some((x) => x === 'bomber' || x === 'drone')) return null;
  const range = rangeOf(f.tpl.filter((x) => x === 'bomber' || x === 'drone'));
  return (
    <div className="col gap4" style={{ marginTop: 6 }}>
      <button className="btn sm" onClick={() => setOpen(!open)}><Icon name="attack" />{t('ui.mil.strikeMission')}</button>
      {open && (
        <div className="card col gap4">
          <TargetPicker from={f.pos} range={range} value={target} onChange={setTarget} />
          <button className="btn sm danger" disabled={!target} data-testid="strike-go" onClick={() => { if (target) { dispatch(milCmd.strike(me(), formation, target)); setOpen(false); } }}>{t('ui.mil.launchStrike')}{target ? `: ${targetName(target)}` : ''}</button>
        </div>
      )}
    </div>
  );
}

type Vector = 'bomber' | 'drone' | 'cruise' | 'ballistic' | 'nuke';
const VEC: { id: Vector; icon: string; tpl: string }[] = [
  { id: 'bomber', icon: 'bomber', tpl: 'bomber' }, { id: 'drone', icon: 'drone', tpl: 'drone' }, { id: 'cruise', icon: 'cruise_missile', tpl: 'cruise_missile' },
  { id: 'ballistic', icon: 'ballistic_missile', tpl: 'ballistic_missile' }, { id: 'nuke', icon: 'nuke', tpl: 'nuke' },
];

/** "Ataques" tab: choose a vector, a target on the globe and confirm (nuclear needs a typed confirmation). */
export function StrikesTab() {
  const [vec, setVec] = useState<Vector>('cruise');
  const [target, setTarget] = useState<TargetRef | null>(null);
  const [form, setForm] = useState<string>('');
  const [typed, setTyped] = useState('');
  const d = useGame((_g, ctx) => {
    const s = stockView(ctx, me());
    const air = visibleFormations(ctx, me()).filter((f) => f.country === me() && f.domain === 'air');
    return {
      stock: s,
      bomber: air.filter((f) => f.units.some((u) => u.template === 'bomber')).map((f) => ({ id: f.id, name: f.name, pos: f.pos })),
      drone: air.filter((f) => f.units.some((u) => u.template === 'drone')).map((f) => ({ id: f.id, name: f.name, pos: f.pos })),
    };
  });
  const cap = theWorld().countryById.get(me())?.capital;
  if (!d) return null;
  const isAir = vec === 'bomber' || vec === 'drone';
  const fl = isAir ? d[vec] : [];
  const chosen = fl.find((x) => x.id === form) ?? fl[0];
  const from: LonLat = isAir ? chosen?.pos ?? [cap?.lon ?? 0, cap?.lat ?? 0] : [cap?.lon ?? 0, cap?.lat ?? 0];
  const range = UNITS[VEC.find((v) => v.id === vec)!.tpl as keyof typeof UNITS].radius;
  const have = isAir ? fl.length : d.stock[vec];
  const go = () => {
    if (!target) return;
    if (isAir) { if (chosen) dispatch(milCmd.strike(me(), chosen.id, target)); }
    else dispatch(milCmd.launch(me(), vec as 'cruise', target));
    setTarget(null); setTyped('');
  };
  const nuke = vec === 'nuke';
  return (
    <div className="col" data-testid="strikes-tab">
      <div className="row wrap gap4">
        {VEC.map((v) => {
          const n = v.id === 'bomber' || v.id === 'drone' ? d[v.id].length : d.stock[v.id];
          return <button key={v.id} className={`btn ${vec === v.id ? 'on' : ''}`} data-testid={`vec-${v.id}`} onClick={() => { setVec(v.id); setTarget(null); setTyped(''); }}><Icon name={v.icon} />{t(`ui.mil.vec.${v.id}`)} <b>{n}</b></button>;
        })}
      </div>
      <div className="dim" style={{ fontSize: 12 }}>{t('ui.mil.vecRange', { km: fmtInt(range) })} · {t(`ui.mil.vecHelp.${vec}`)}</div>
      {isAir && fl.length > 0 && (
        <select className="select" value={chosen?.id} onChange={(e) => setForm(e.target.value)}>{fl.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      )}
      {have <= 0 ? <div className="warn">{t(isAir ? 'ui.mil.noAirUnits' : 'ui.mil.noMissiles')}</div> : (
        <>
          <TargetPicker from={from} range={range} value={target} onChange={setTarget} />
          {nuke && target && (
            <div className="card col gap4" style={{ borderColor: '#86332e' }}>
              <b className="bad"><Icon name="nuclear" /> {t('ui.mil.nukeWarn')}</b>
              <span className="dim" style={{ fontSize: 12 }}>{t('ui.mil.nukeType')}</span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="nuke-confirm" placeholder="CONFIRMAR" />
            </div>
          )}
          <button className="btn danger" data-testid="strike-launch" disabled={!target || (nuke && typed.trim().toUpperCase() !== 'CONFIRMAR')} onClick={go}>
            <Icon name={nuke ? 'nuke' : 'attack'} />{t('ui.mil.launchStrike')}{target ? `: ${targetName(target)}` : ''}
          </button>
        </>
      )}
    </div>
  );
}
