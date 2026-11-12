export interface Series { label: string; color: string; values: number[] }

/** Minimal responsive SVG line chart; `xs` are the sample positions (e.g. hours), shared by all series. */
export function LineChart({ xs, series, height = 130, format, xFormat }: { xs: number[]; series: Series[]; height?: number; format?(v: number): string; xFormat?(x: number): string }) {
  const W = 520, H = height, L = 46, R = 8, T = 8, B = 18;
  if (xs.length < 2) return <div className="dim" style={{ padding: 10 }}>…</div>;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const px = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const f = format ?? ((v: number) => String(Math.round(v)));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
        {[0, 0.5, 1].map((k) => {
          const v = lo + (hi - lo) * k, y = py(v);
          return <g key={k}><line x1={L} x2={W - R} y1={y} y2={y} stroke="#243445" strokeWidth="1" /><text x={L - 4} y={y + 3} textAnchor="end">{f(v)}</text></g>;
        })}
        <text x={L} y={H - 3}>{xFormat ? xFormat(x0) : x0}</text>
        <text x={W - R} y={H - 3} textAnchor="end">{xFormat ? xFormat(x1) : x1}</text>
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" points={s.values.map((v, i) => `${px(xs[i]).toFixed(1)},${py(v).toFixed(1)}`).join(' ')} />
        ))}
      </svg>
      <div className="row wrap" style={{ fontSize: 11.5, gap: 12 }}>
        {series.map((s) => <span key={s.label} className="row gap4"><i style={{ width: 10, height: 3, background: s.color, display: 'inline-block' }} />{s.label}</span>)}
      </div>
    </div>
  );
}
