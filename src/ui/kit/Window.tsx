import { useRef, type ReactNode } from 'react';
import { useUi } from '../store';
import { t } from '../i18n';
import { playSound } from '../../audio';
import { Icon } from './Icon';

/** Draggable floating window. Position/z-order live in the UI store so windows survive re-renders. */
export function Window({ id, titleKey, icon, width = 460, children }: { id: string; titleKey: string; icon?: string; width?: number; children: ReactNode }) {
  const w = useUi((s) => s.wins[id]);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  if (!w) return null;
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - w.x, dy: e.clientY - w.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const x = Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - 120);
    const y = Math.min(Math.max(46, e.clientY - drag.current.dy), window.innerHeight - 40);
    useUi.getState().moveWin(id, x, y);
  };
  return (
    <div className={`win${w.z === useUi.getState().zTop ? ' front' : ''}`} data-testid={`win-${id}`} style={{ left: w.x, top: w.y, width, zIndex: w.z, maxHeight: Math.max(200, window.innerHeight - w.y - 12) }} onPointerDown={() => useUi.getState().focusWin(id)}>
      <div className="win-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
        {icon && <Icon name={icon} size={16} />}
        <h3>{t(titleKey)}</h3>
        <button className="btn ghost sm" aria-label={t('ui.close')} onClick={() => { playSound('ui_close'); useUi.getState().closeWin(id); }}><Icon name="close" /></button>
      </div>
      <div className="win-body">{children}</div>
    </div>
  );
}
