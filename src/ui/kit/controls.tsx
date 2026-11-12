import { Fragment, useState, type ReactNode } from 'react';
import { clamp } from '../fmt';

export function Slider({ value, min, max, step = 0.01, onChange, format, disabled }: { value: number; min: number; max: number; step?: number; onChange(v: number): void; format?(v: number): string; disabled?: boolean }) {
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={clamp(value, min, max)} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{format ? format(value) : value}</span>
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className={`bar ${tone ?? ''}`}><i style={{ width: `${clamp(value, 0, 1) * 100}%` }} /></div>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Tabs({ tabs, value, onChange }: { tabs: Array<[string, string]>; value: string; onChange: (v: any) => void }) {
  return <div className="tabs">{tabs.map(([id, label]) => <button key={id} className={id === value ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>)}</div>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: ReactNode }) {
  return (
    <label className="row" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
      <span>{label}</span>
    </label>
  );
}

export function KV({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return <div className="kv">{rows.map(([k, v], i) => <Fragment key={i}><span>{k}</span><span>{v}</span></Fragment>)}</div>;
}

export interface Column<R> {
  key: string;
  label: ReactNode;
  render(row: R): ReactNode;
  /** Sort value; omit for non-sortable. */
  sort?(row: R): number | string;
  right?: boolean;
}
export function Table<R>({ columns, rows, rowKey, onRow, initialSort, empty }: { columns: Column<R>[]; rows: R[]; rowKey(r: R): string | number; onRow?(r: R): void; initialSort?: { key: string; desc?: boolean }; empty?: ReactNode }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const col = sort && columns.find((c) => c.key === sort.key);
  const sorted = col?.sort
    ? [...rows].sort((a, b) => {
        const x = col.sort!(a), y = col.sort!(b);
        const d = typeof x === 'string' ? x.localeCompare(y as string, 'pt-BR') : (x as number) - (y as number);
        return sort!.desc ? -d : d;
      })
    : rows;
  return (
    <table className="tbl">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={`${c.sort ? 'sortable' : ''} ${c.right ? 'r' : ''}`} onClick={() => c.sort && setSort(sort?.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: true })}>
              {c.label}{sort?.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={rowKey(r)} className={onRow ? 'click' : ''} onClick={() => onRow?.(r)}>
            {columns.map((c) => <td key={c.key} className={c.right ? 'r' : ''}>{c.render(r)}</td>)}
          </tr>
        ))}
        {!rows.length && empty && <tr><td colSpan={columns.length} className="dim">{empty}</td></tr>}
      </tbody>
    </table>
  );
}
