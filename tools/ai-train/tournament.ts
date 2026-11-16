/**
 * Acceptance tournament with the weights in public/data/ai/policy.json (or --pack FILE):
 *   npx tsx tools/ai-train/tournament.ts [--tac 48] [--war 6] [--days 90] [--workers 4]
 * Tactical: neural x rules on maps NOT used in training (test split), sides and attacker alternated.
 * War: neural vs rules on neighbour pairs of the test split, sides alternated, plus a rules-vs-rules control.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { loadWorldStatic } from '../../src/data/loadWorld';
import { nodeFetchJson } from '../../src/data/fetchNode';
import type { PolicyPack } from '../../src/sim/neural/pack';
import { logs, POLICY_OUT } from './paths';
import { Pool } from './pool';
import { splitPairs } from './stage-war';
import { locations, type Match } from './tac';
import type { WarOutcome, WarScenario } from './war';
import { mulberry } from './nn';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const nTac = Number(arg('--tac', '48')), nWar = Number(arg('--war', '6')), days = Number(arg('--days', '90'));
const workers = Number(arg('--workers', String(Math.max(1, Math.min(8, cpus().length - 1)))));
const pack = JSON.parse(readFileSync(arg('--pack', POLICY_OUT), 'utf8')) as PolicyPack;
const world = await loadWorldStatic(nodeFetchJson());
const pool = new Pool(workers);
const report: Record<string, unknown> = { version: pack.version };

if (nTac > 0) {
  const { test } = locations(world);
  const r = mulberry(4242);
  const ms: Match[] = Array.from({ length: nTac }, (_, i) => ({ loc: test[Math.floor(r() * test.length)], seed: 9000 + i, neuralSide: (i & 1) as 0 | 1, attacker: ((i >> 1) & 1) as 0 | 1, k0: 1, k1: 1, mix0: 0.5, mix1: 0.5 }));
  const chunks = await Promise.all(Array.from({ length: Math.ceil(nTac / 2) }, (_, i) => pool.run<{ win: number; fit: number }[]>({ task: 'tac', pack, matches: ms.slice(i * 2, i * 2 + 2), temp: Number(arg('--temp', '0.045')), timeLimit: Number(arg('--limit', '900')) })));
  const res = chunks.flat();
  const w = res.filter((x) => x.win > 0).length, l = res.filter((x) => x.win < 0).length, d = res.length - w - l;
  const rate = (w + 0.5 * d) / res.length;
  const asNeuralAttacker = res.filter((_, i) => ms[i].attacker === ms[i].neuralSide);
  console.log(`TATICO ${res.length} batalhas em mapas de teste: vitórias ${w}, empates ${d}, derrotas ${l} -> taxa ${(rate * 100).toFixed(1)}% (empate = 0,5); só vitórias ${(w / res.length * 100).toFixed(1)}%; neural atacando ${(asNeuralAttacker.filter((x) => x.win > 0).length / Math.max(1, asNeuralAttacker.length) * 100).toFixed(0)}%`);
  report.tactical = { battles: res.length, wins: w, draws: d, losses: l, rate };
}
if (nWar > 0) {
  const { test } = splitPairs(world);
  const pairs = test.slice(0, nWar);
  const sc: WarScenario[] = pairs.flatMap((p, i) => [{ ...p, seed: 100 + i, neuralIs: 'a' as const }, { ...p, seed: 100 + i, neuralIs: 'b' as const }]);
  const run = (engine: 'neural' | 'rules') => Promise.all(sc.map((s) => pool.run<WarOutcome[]>({ task: 'war', kind: 'war', pack, scenarios: [s], days, engine }).then((x) => x[0])));
  const [neu, ctl] = [await run('neural'), await run('rules')];
  const avg = (a: WarOutcome[], k: keyof WarOutcome) => a.reduce((s, x) => s + Number(x[k]), 0) / a.length;
  console.log(`GUERRA ${sc.length} cenários (${pairs.length} pares x 2 lados, ${days} dias):`);
  console.log(`  neural : placar médio ${avg(neu, 'ws').toFixed(1)}  fitness ${avg(neu, 'fit').toFixed(3)}  provs ${avg(neu, 'dProv').toFixed(3)}  forças ${avg(neu, 'dForce').toFixed(3)}`);
  console.log(`  controle (regras x regras, mesmos cenários): placar médio ${avg(ctl, 'ws').toFixed(1)}  fitness ${avg(ctl, 'fit').toFixed(3)}`);
  sc.forEach((s, i) => console.log(`  ${s.a}-${s.b} neural=${s.neuralIs}: placar neural ${neu[i].ws} | controle ${ctl[i].ws}`));
  report.war = { scenarios: sc.length, neuralWs: avg(neu, 'ws'), controlWs: avg(ctl, 'ws'), neuralFit: avg(neu, 'fit'), controlFit: avg(ctl, 'fit') };
}
writeFileSync(logs('tournament.json'), JSON.stringify(report, null, 1));
await pool.close();
