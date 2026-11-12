import { formatDate } from '../core/clock';

const nf = (d: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const N0 = nf(0), N1 = nf(1), N2 = nf(2);

export const fmtInt = (n: number) => N0.format(Math.round(n));
export const fmtDec = (n: number, d = 1) => (d === 0 ? N0 : d === 1 ? N1 : d === 2 ? N2 : nf(d)).format(n);
export const fmtPct = (frac: number, d = 0) => `${fmtDec(frac * 100, d)}%`;
export const fmtSigned = (n: number, f: (x: number) => string = fmtInt) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));

/** Large counts (people, units): 1,2 mi · 3,4 bi. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${N1.format(n / 1e12)} tri`;
  if (a >= 1e9) return `${N1.format(n / 1e9)} bi`;
  if (a >= 1e6) return `${N1.format(n / 1e6)} mi`;
  if (a >= 1e4) return `${N0.format(n / 1e3)} mil`;
  return N0.format(Math.round(n));
}
/** Millions of USD → "US$ 1,5 bi". */
export function fmtMoney(musd: number, signed = false): string {
  const a = Math.abs(musd);
  let s: string;
  if (a >= 1e6) s = `${N2.format(a / 1e6)} tri`;
  else if (a >= 1e3) s = `${N1.format(a / 1e3)} bi`;
  else s = `${N0.format(a)} mi`;
  const sign = musd < 0 ? '−' : signed && musd > 0 ? '+' : '';
  return `${sign}US$ ${s}`;
}
export const fmtMw = (mw: number) => (mw >= 1000 ? `${N1.format(mw / 1000)} GW` : `${N0.format(mw)} MW`);
export const fmtDate = (hours: number, withHour = false) => formatDate(hours, 'pt-BR', withHour);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** CSS class by threshold: >= hi good, >= lo warn, else bad. */
export const levelClass = (v: number, lo = 40, hi = 60) => (v >= hi ? 'good' : v >= lo ? 'warn' : 'bad');
