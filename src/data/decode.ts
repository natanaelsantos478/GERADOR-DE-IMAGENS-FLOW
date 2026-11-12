/** Decoding of the public/data storage formats (columnar tables, base64 typed arrays). */

export class DataFormatError extends Error {
  constructor(file: string, detail: string) {
    super(`public/data/${file}: formato inválido — ${detail}`);
    this.name = 'DataFormatError';
  }
}

export type Row = Record<string, unknown>;

/**
 * Accepts either a row array `[{…}, …]` or the columnar form `{ n, cols: { a: [...], b: [...] } }`
 * and returns rows. Columns shorter than `n` are an error.
 */
export function decodeTable(file: string, json: unknown): Row[] {
  if (Array.isArray(json)) return json as Row[];
  const t = json as { n?: unknown; cols?: Record<string, unknown[]> } | null;
  if (!t || typeof t !== 'object' || typeof t.n !== 'number' || !t.cols || typeof t.cols !== 'object')
    throw new DataFormatError(file, 'esperado array de objetos ou { n, cols }');
  const n = t.n;
  const keys = Object.keys(t.cols);
  for (const k of keys) {
    if (!Array.isArray(t.cols[k]) || t.cols[k].length !== n) throw new DataFormatError(file, `coluna '${k}' não tem ${n} valores`);
  }
  const rows: Row[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r: Row = {};
    for (const k of keys) r[k] = t.cols[k][i];
    rows[i] = r;
  }
  return rows;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Little-endian Int16 from base64. */
export function base64ToInt16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  if (bytes.length % 2 !== 0) throw new Error('base64 Int16: número ímpar de bytes');
  const out = new Int16Array(bytes.length / 2);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

export const num = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : dflt);
export const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export function numArray(file: string, field: string, v: unknown): number[] {
  if (!Array.isArray(v)) throw new DataFormatError(file, `campo '${field}' deveria ser array`);
  return v as number[];
}
