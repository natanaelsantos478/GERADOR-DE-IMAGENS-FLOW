/** Node-only disk tile cache (tools/tests). Not imported by browser code. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TileStore } from './tiles';

export function diskStore(dir: string): TileStore {
  const file = (k: string) => path.join(dir, `${k}.pbf`);
  return {
    async get(k) { try { return new Uint8Array(await readFile(file(k))); } catch { return null; } },
    async put(k, v) { const f = file(k); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, v); },
  };
}
