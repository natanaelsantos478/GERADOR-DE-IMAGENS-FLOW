/** OpenFreeMap vector-tile client: TileJSON discovery (URL never hard-coded), memory + persistent cache, injectable fetch. */
import type { TileBytes, TileSource } from './types';

export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export interface TileStore { get(key: string): Promise<Uint8Array | null>; put(key: string, v: Uint8Array): Promise<void> }
export interface TileSourceOptions {
  fetchFn?: typeof fetch;
  /** Persistent cache (IndexedDB in the browser, disk in Node). */
  store?: TileStore;
  tileJsonUrl?: string;
  /** Max concurrent downloads. */
  concurrency?: number;
}
const UA = 'Meridiano-Game/1.0';
const enc = new TextEncoder(), dec = new TextDecoder();

export function createTileSource(o: TileSourceOptions = {}): TileSource {
  const f = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const headers: Record<string, string> | undefined = typeof window === 'undefined' ? { 'User-Agent': UA } : undefined;
  const mem = new Map<string, Promise<TileBytes | null>>();
  let tpl: Promise<string | null> | null = null;
  let active = 0;
  const waiters: (() => void)[] = [];
  const slot = async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= (o.concurrency ?? 6)) await new Promise<void>((r) => waiters.push(r));
    active++;
    try { return await fn(); } finally { active--; waiters.shift()?.(); }
  };
  const template = (): Promise<string | null> => tpl ??= (async () => {
    try {
      const r = await f(o.tileJsonUrl ?? TILEJSON_URL, headers ? { headers } : undefined);
      if (!r.ok) throw new Error(String(r.status));
      const t = (await r.json() as { tiles?: string[] }).tiles?.[0];
      if (!t) throw new Error('no tiles');
      await o.store?.put('meta/template', enc.encode(t)).catch(() => {});
      return t;
    } catch {
      const s = await o.store?.get('meta/template').catch(() => null);
      return s ? dec.decode(s) : null;
    }
  })();
  const version = (t: string) => /planet\/([^/]+)\//.exec(t)?.[1] ?? 'v';
  async function load(z: number, x: number, y: number): Promise<TileBytes | null> {
    const t = await template();
    if (!t) return null;
    const key = `${version(t)}/${z}/${x}/${y}`;
    const hit = await o.store?.get(key).catch(() => null);
    if (hit) return hit;
    try {
      const bytes = await slot(async () => {
        const r = await f(t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), headers ? { headers } : undefined);
        if (r.status === 404 || r.status === 204) return new Uint8Array(0);
        if (!r.ok) throw new Error(String(r.status));
        return new Uint8Array(await r.arrayBuffer());
      });
      await o.store?.put(key, bytes).catch(() => {});
      return bytes;
    } catch { return null; }
  }
  return {
    get(z, x, y) {
      const k = `${z}/${x}/${y}`;
      let p = mem.get(k);
      if (!p) { p = load(z, x, y); mem.set(k, p); p.then((v) => { if (!v) mem.delete(k); }); }
      return p;
    },
  };
}

/** Browser cache: IndexedDB (falls back to no cache when unavailable). */
export function idbStore(name = 'meridiano-vector-tiles'): TileStore | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise<IDBDatabase>((res, rej) => {
    const q = indexedDB.open(name, 1);
    q.onupgradeneeded = () => q.result.createObjectStore('t');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await open();
    return new Promise<T>((res, rej) => { const r = fn(d.transaction('t', mode).objectStore('t')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  };
  return {
    async get(k) { const v = await run<Uint8Array | undefined>('readonly', (s) => s.get(k)); return v ?? null; },
    async put(k, v) { await run('readwrite', (s) => s.put(v, k)); },
  };
}
