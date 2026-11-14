import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { Icon } from '../kit/Icon';
import { ui, useUi } from '../store';
import { useGame, me } from '../useGame';

const KEY = 'meridiano.tutorial';
const read = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } };
const subs = new Set<() => void>();
export function startTutorial() { write(''); subs.forEach((f) => f()); }

interface Step { id: string; win?: string; icon: string }
const STEPS: Step[] = [
  { id: 'pause', icon: 'pause' }, { id: 'budget', win: 'budget', icon: 'budget' }, { id: 'plant', win: 'construction', icon: 'energy' },
  { id: 'research', win: 'research', icon: 'research' }, { id: 'move', win: 'forces', icon: 'move' }, { id: 'diplomacy', win: 'diplomacy', icon: 'diplomacy' },
];

/** Short dismissible guided tour; each step ticks itself when the player does the thing. */
export function Tutorial() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(() => read() !== 'done');
  const [i, setI] = useState(0);
  useEffect(() => { const f = () => { setOpen(true); setI(0); force((x) => x + 1); }; subs.add(f); return () => { subs.delete(f); }; }, []);
  const wins = useUi((s) => s.wins);
  const d = useGame((g, ctx) => ({
    paused: g.state.time.paused,
    plant: ctx.api.economy.structures().some((s) => s.country === me()),
    research: !!ctx.api.research.progress(me()).current,
    moved: ctx.api.military.formations({ country: me() }).some((f) => f.order === 'move' || f.order === 'attack'),
  }));
  if (!open || !d) return null;
  const done: Record<string, boolean> = {
    pause: d.paused, budget: !!wins.budget, plant: d.plant, research: d.research, move: d.moved, diplomacy: !!wins.diplomacy,
  };
  const s = STEPS[i];
  const close = () => { write('done'); setOpen(false); };
  return (
    <div className="tutorial pe" data-testid="tutorial">
      <div className="row sp"><b><Icon name={s.icon} /> {t('ui.tut.title', { n: i + 1, total: STEPS.length })}</b><button className="btn ghost sm" onClick={close} title={t('ui.tut.dismiss')}><Icon name="close" /></button></div>
      <div style={{ fontSize: 13 }}>{t(`ui.tut.${s.id}`)}</div>
      <div className="row" style={{ marginTop: 4 }}>
        {s.win && <button className="btn sm" onClick={() => ui().openWin(s.win!)}>{t('ui.tut.open')}</button>}
        {done[s.id] && <span className="chip good"><Icon name="check" />{t('ui.tut.done')}</span>}
        <span className="grow" />
        <button className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}>←</button>
        {i < STEPS.length - 1 ? <button className="btn sm primary" data-testid="tut-next" onClick={() => setI(i + 1)}>{t('ui.tut.next')}</button> : <button className="btn sm primary" onClick={close}>{t('ui.tut.finish')}</button>}
      </div>
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start', color: 'var(--faint)' }} data-testid="tut-dismiss" onClick={close}>{t('ui.tut.dismiss')}</button>
    </div>
  );
}
