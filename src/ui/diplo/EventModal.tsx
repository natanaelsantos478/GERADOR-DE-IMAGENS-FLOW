import { useEffect, useSyncExternalStore } from 'react';
import { dipCommands, EVENTS, selectPendingEvent } from '../../sim/diplomacy';
import { fmtDec } from '../fmt';
import { hasText, t } from '../i18n';
import { Modal } from '../menu/Modal';
import { Icon } from '../kit/Icon';
import { countryName, dispatch, me, useGame } from '../useGame';

let hidden = false, hiddenFor = -1;
const subs = new Set<() => void>();
export const eventHidden = () => hidden;
export function setEventHidden(v: boolean) { hidden = v; subs.forEach((f) => f()); }
const useHidden = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, eventHidden);

type Fx = readonly unknown[];
function fxText(fx: Fx): string | null {
  const [k, a, b] = fx as [string, number | string, number];
  void b;
  switch (k) {
    case 'money': return t('ui.dip.fx.money', { v: fmtDec(Math.abs(a as number) * 100, 0), s: (a as number) < 0 ? '−' : '+' });
    case 'unrest': return t('ui.dip.fx.unrest', { v: `${(a as number) > 0 ? '+' : '−'}${Math.abs(a as number)}`, d: b });
    case 'mod': { const f = fx[2] as number; return t('ui.dip.fx.mod', { k: hasText(`ui.modk.${a}`) ? t(`ui.modk.${a}`) : String(a), v: `${f >= 1 ? '+' : '−'}${fmtDec(Math.abs(f - 1) * 100, 0)}%`, d: fx[3] as number }); }
    case 'rel': return t('ui.dip.fx.rel', { v: (a as number) > 0 ? `+${a}` : String(a) });
    case 'rep': return t('ui.dip.fx.rep', { v: (a as number) > 0 ? `+${a}` : String(a) });
    case 'damage': return t('ui.dip.fx.damage', { v: fmtDec((fx[2] as number) * 100, 0), k: t(a === 'city' ? 'ui.dip.fx.city' : 'ui.dip.fx.plant') });
    default: return null;
  }
}

export function EventModal() {
  const ev = useGame((_g, ctx) => selectPendingEvent(ctx));
  const hid = useHidden();
  useEffect(() => { if (ev && ev.id !== hiddenFor) { hiddenFor = ev.id; setEventHidden(false); } }, [ev]);
  if (!ev || hid) return null;
  const def = EVENTS.find((e) => e.id === ev.type);
  const params = { country: countryName(ev.country), other: ev.other ? countryName(ev.other) : '' };
  return (
    <Modal titleKey={`dip.event.${ev.type}.title`} onClose={() => setEventHidden(true)} width={560}>
      <div className="col" data-testid="world-event">
        <div className="row"><Icon name="warning" size={22} /><div className="grow">{t(`dip.event.${ev.type}.desc`, params)}</div></div>
        {def?.fx && <div className="dim" style={{ fontSize: 12 }}>{def.fx.map(fxText).filter(Boolean).join(' · ')}</div>}
        <div className="sect-title">{t('ui.dip.yourChoice')}</div>
        {ev.choices.map((c) => {
          const fx = def?.choices.find((x) => x.id === c.id)?.fx ?? [];
          return (
            <button key={c.id} className="btn" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left' }} data-testid={`event-choice-${c.id}`}
              onClick={() => { dispatch(dipCommands.eventChoose(me(), ev.id, c.id)); }}>
              <b>{t(c.key, params)}</b>
              <span className="dim" style={{ fontSize: 12 }}>{fx.length ? fx.map(fxText).filter(Boolean).join(' · ') : t('ui.dip.fx.none')}</span>
            </button>
          );
        })}
        <div className="dim" style={{ fontSize: 11.5 }}>{t('ui.dip.eventDefault')}</div>
      </div>
    </Modal>
  );
}
