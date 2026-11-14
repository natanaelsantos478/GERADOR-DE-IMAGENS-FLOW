import { useState } from 'react';
import { describeTech, queueTech, selectTechTree, setAutoResearch, startTech, unqueueTech, type TechView } from '../../sim/research';
import { fmtDec, fmtInt, fmtPct } from '../fmt';
import { hasText, t } from '../i18n';
import { Progress, Tabs, Toggle } from '../kit/controls';
import { Icon } from '../kit/Icon';
import { dispatch, me, useGame } from '../useGame';

const BRANCHES = ['army', 'air', 'navy', 'strategic', 'economy', 'society'] as const;
const STATUS_CLS: Record<TechView['status'], string> = { done: 'good', current: 'warn', queued: 'warn', available: '', locked: 'faint' };

export function unlockName(u: string): string {
  const [kind, name] = u.split('.');
  if (kind === 'unit') return t(`mil.unit.${name}`);
  if (kind === 'build') return t(`ui.kind.${name}`);
  if (kind === 'fuel') return t(`eco.fuel.${name}`);
  return u;
}
export const modName = (k: string) => (hasText(`ui.modk.${k}`) ? t(`ui.modk.${k}`) : k.split('.').pop()!);
/** "+10% Ataque da infantaria" (cost-like keys show the reduction as a gain). */
export const modText = (k: string, v: number) => `${v >= 1 ? '+' : '−'}${fmtDec(Math.abs(v - 1) * 100, 0)}% ${modName(k)}`;

export function TechEffects({ tech }: { tech: Pick<TechView, 'unlocks' | 'mods'> }) {
  void describeTech;
  return (
    <div className="col gap4" style={{ fontSize: 11.5 }}>
      {tech.unlocks.map((u) => <span key={u} className="good">{t(`res.unlock.${u.split('.')[0]}`, { name: unlockName(u) })}</span>)}
      {Object.entries(tech.mods).filter(([, v]) => v !== 1).map(([k, v]) => <span key={k} className="dim">{modText(k, v)}</span>)}
    </div>
  );
}

function TechCard({ tech, names }: { tech: TechView; names: Map<string, string> }) {
  const can = tech.status === 'available' || tech.status === 'queued' || tech.status === 'locked';
  return (
    <div className="card col gap4" style={{ width: 232, opacity: tech.status === 'locked' ? 0.78 : 1 }} data-testid={`tech-${tech.id}`} data-status={tech.status}>
      <div className="row sp"><b style={{ fontSize: 12.5 }}>{t(`tech.${tech.id}`)}</b><span className={`chip ${STATUS_CLS[tech.status]}`}>{t(`res.status.${tech.status}`)}</span></div>
      <div className="row sp dim" style={{ fontSize: 11.5 }}><span>{t('ui.res.cost')}: {fmtInt(tech.cost)} {t('ui.res.pts')}</span>{tech.progress > 0 && tech.status !== 'done' && <span>{fmtPct(tech.progress)}</span>}</div>
      {tech.progress > 0 && tech.status !== 'done' && <Progress value={tech.progress} />}
      {tech.requires.length > 0 && tech.status !== 'done' && (
        <div style={{ fontSize: 11.5 }}><span className="dim">{t('ui.res.requires')}: </span>
          {tech.requires.map((r, i) => <span key={r} className={tech.missing.includes(r) ? 'bad' : 'good'}>{i ? ', ' : ''}{names.get(r) ?? r}</span>)}</div>
      )}
      <TechEffects tech={tech} />
      {can && tech.status !== 'current' && (
        <div className="row">
          {tech.status !== 'locked' && <button className="btn sm primary" data-testid={`tech-start-${tech.id}`} onClick={() => dispatch(startTech(me(), tech.id))}>{t('ui.res.start')}</button>}
          {tech.status === 'queued'
            ? <button className="btn sm" onClick={() => dispatch(unqueueTech(me(), tech.id))}>{t('ui.res.unqueue')}</button>
            : <button className="btn sm" data-testid={`tech-queue-${tech.id}`} onClick={() => dispatch(queueTech(me(), tech.id))}>{t('ui.res.queue')}</button>}
        </div>
      )}
    </div>
  );
}

export function ResearchPanel() {
  const [branch, setBranch] = useState<(typeof BRANCHES)[number]>('army');
  const d = useGame((g, ctx) => ({ tree: selectTechTree(ctx, me()), prog: ctx.api.research.progress(me()), auto: g.state.meta.automation['res.auto'] !== false }));
  if (!d) return null;
  const all = d.tree.flatMap((b) => b.tiers.flat());
  const names = new Map(all.map((x) => [x.id, t(`tech.${x.id}`)]));
  const byId = new Map(all.map((x) => [x.id, x]));
  const cur = d.prog.current ? byId.get(d.prog.current) : null;
  const left = cur ? Math.max(0, cur.cost * (1 - d.prog.progress)) : 0;
  const eta = d.prog.pointsPerDay > 0 ? Math.ceil(left / d.prog.pointsPerDay) : null;
  const tree = d.tree.find((b) => b.branch === branch);
  const count = (b: string) => { const l = d.tree.find((x) => x.branch === b)?.tiers.flat() ?? []; return `${l.filter((x) => x.status === 'done').length}/${l.length}`; };
  return (
    <div className="col" data-testid="research-panel">
      <div className="card col gap4">
        <div className="row sp"><b><Icon name="research" /> {t('ui.res.rate')}: {fmtDec(d.prog.pointsPerDay, 1)} {t('ui.res.ptsDay')}</b><span className="dim">{t('ui.res.done', { n: d.prog.researched })}</span></div>
        {cur ? (
          <>
            <div className="row sp"><span>{t('ui.res.current')}: <b>{t(`tech.${cur.id}`)}</b></span><span className="dim">{fmtPct(d.prog.progress)}{eta !== null ? ` · ${eta} ${t('ui.days')}` : ''}</span></div>
            <Progress value={d.prog.progress} />
          </>
        ) : <span className="warn">{t('ui.res.none')}</span>}
        {d.prog.queue.length > 0 && (
          <div className="row wrap gap4"><span className="dim">{t('ui.res.queueLabel')}:</span>
            {d.prog.queue.map((id, i) => <span key={id} className="chip">{i + 1}. {names.get(id)}<button className="btn ghost sm" style={{ padding: '0 3px' }} onClick={() => dispatch(unqueueTech(me(), id))}>×</button></span>)}
          </div>
        )}
        <Toggle on={d.auto} onChange={(v) => dispatch(setAutoResearch(me(), v))} label={<span title={t('ui.autoHelp.res.auto')}>{t('ui.auto.res.auto')}</span>} />
      </div>
      <Tabs value={branch} onChange={setBranch} tabs={BRANCHES.map((b) => [b, `${t(`ui.res.br.${b}`)} ${count(b)}`])} />
      {tree?.tiers.map((list, i) => list.length > 0 && (
        <div key={i} className="col gap4">
          <div className="sect-title">{t('ui.res.tier', { n: i + 1 })}</div>
          <div className="row wrap" style={{ alignItems: 'stretch', gap: 8 }}>{list.map((x) => <TechCard key={x.id} tech={x} names={names} />)}</div>
        </div>
      ))}
    </div>
  );
}
