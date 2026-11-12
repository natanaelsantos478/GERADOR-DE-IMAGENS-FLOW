/** Shared by the research/diplomacy tests: real data + whatever real systems exist on disk. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import type { AnySimSystem, Difficulty, WorldStatic } from '../../core/contracts';
import { createGame, type Game } from '../../core/game';
import { loadWorldStatic, DATA_FILES } from '../../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../../data/fetchNode';
import { researchSystem } from '../research/system';
import { diplomacySystem } from './system';

export const dataMissing = DATA_FILES.filter((f) => !existsSync(path.join(DEFAULT_DATA_DIR, f)));
let worldP: Promise<WorldStatic> | null = null;
export const getWorld = (): Promise<WorldStatic> => (worldP ??= loadWorldStatic(nodeFetchJson()));

/** Other modules' real systems, when their files exist and load. */
export async function optionalSystems(): Promise<AnySimSystem[]> {
  const out: AnySimSystem[] = [];
  const tries: [string, string][] = [
    ['economy', '../economy/system'], ['military', '../military/system'],
  ];
  for (const [id, rel] of tries) {
    if (!existsSync(path.join(HERE, `${rel}.ts`))) continue;
    try {
      const mod = await import(/* @vite-ignore */ rel);
      const sys = Object.values(mod).find((v) => (v as { id?: string })?.id === id);
      if (sys) out.push(sys as AnySimSystem);
    } catch (e) {
      console.warn(`sistema ${id} não carregou: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function makeGame(opts: { player?: string; difficulty?: Difficulty; withOthers?: boolean; seed?: number } = {}): Promise<Game> {
  const world = await getWorld();
  const systems: AnySimSystem[] = [researchSystem, diplomacySystem, ...(opts.withOthers ? await optionalSystems() : [])];
  return createGame(world, { systems, playerCountryId: opts.player ?? 'BRA', difficulty: opts.difficulty ?? 'normal', seed: opts.seed ?? 20260101 });
}
