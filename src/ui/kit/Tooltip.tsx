import { useSyncExternalStore, type ReactNode } from 'react';

interface TipState { content: ReactNode; x: number; y: number }
let cur: TipState | null = null;
const subs = new Set<() => void>();
const set = (s: TipState | null) => { cur = s; subs.forEach((f) => f()); };

/** Wrap anything: `<Tip tip="texto">…</Tip>`; content may be rich. */
export function Tip({ tip, children, className = '' }: { tip: ReactNode; children: ReactNode; className?: string }) {
  if (!tip) return <>{children}</>;
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={(e) => set({ content: tip, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => set({ content: tip, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => set(null)}
    >
      {children}
    </span>
  );
}

export function TooltipLayer() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cur);
  if (!s) return null;
  const left = Math.min(s.x + 14, window.innerWidth - 336), top = s.y + 18 > window.innerHeight - 120 ? s.y - 70 : s.y + 18;
  return <div className="tip" style={{ left: Math.max(4, left), top }}>{s.content}</div>;
}
/** A tooltip body with a title and label/value lines (cause → effect). */
export function TipLines({ title, lines }: { title?: string; lines: Array<[string, string, string?]> }) {
  return (
    <div>
      {title && <div className="tip-t">{title}</div>}
      {lines.map(([k, v, cls], i) => (
        <div className="tip-l" key={i}><span className="dim">{k}</span><span className={cls}>{v}</span></div>
      ))}
    </div>
  );
}
