/** Worker: loads the world once, then serves evaluation tasks. */
import { parentPort } from 'node:worker_threads';
import { loadWorldStatic } from '../../src/data/loadWorld';
import { nodeFetchJson } from '../../src/data/fetchNode';
import { setPolicyPack, type PolicyPack } from '../../src/sim/neural/pack';
import { tap, TAC_IN } from '../../src/sim/tactical/aiNeural';
import { build, run, score, type Match } from './tac';
import { handleWar, type WarTask } from './war';
import type { WorldStatic } from '../../src/core/contracts';

let world: WorldStatic | null = null;
const getWorld = async () => (world ??= await loadWorldStatic(nodeFetchJson()));

type Msg =
  | { task: 'tac'; pack: PolicyPack; matches: Match[]; temp: number; timeLimit: number }
  | { task: 'tacRecord'; matches: Match[]; every: number; timeLimit: number }
  | ({ task: 'war' } & WarTask);

async function handle(m: Msg): Promise<unknown> {
  const w = await getWorld();
  if (m.task === 'tac') {
    setPolicyPack(m.pack);
    return m.matches.map((x) => {
      const b = build(w, x, x.neuralSide === 0 ? ['neural', 'rules'] : ['rules', 'neural'], m.temp, m.timeLimit);
      run(b);
      return score(b, x.neuralSide);
    });
  }
  if (m.task === 'tacRecord') {
    setPolicyPack({ format: 1, version: 'rec', seed: 0, nets: {} });
    const rows: number[][] = [];
    let c = 0;
    tap.rec = (X, n) => { if (c++ % m.every === 0) rows.push(Array.from(X.subarray(0, n * TAC_IN))); };
    for (const x of m.matches) run(build(w, x, ['rules', 'rules'], 0, m.timeLimit));
    tap.rec = null;
    return rows;
  }
  return handleWar(w, m);
}

parentPort!.on('message', (m: Msg) => {
  handle(m).then((v) => parentPort!.postMessage({ ok: true, v }), (e: Error) => parentPort!.postMessage({ ok: false, e: String(e.stack ?? e) }));
});
