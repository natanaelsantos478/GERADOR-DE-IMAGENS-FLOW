/** Node-only fetcher for public/data (headless runner, vitest). Not imported by browser code. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchJson } from './loadWorld';

export const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data');

export function nodeFetchJson(dataDir: string = DEFAULT_DATA_DIR): FetchJson {
  return async (file) => JSON.parse(await readFile(path.join(dataDir, file), 'utf8'));
}
