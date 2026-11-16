/**
 * Full training pipeline (single entry point). Run from the repository root:
 *   npx tsx tools/ai-train/train.ts --hours 8 --workers 4            # new or resumed run
 *   npx tsx tools/ai-train/train.ts --hours 8 --workers 6 --fresh    # ignore checkpoints
 * Stages: bc (behaviour cloning of the tactical rules) -> tac (ES, tactical) -> war (ES, strategic+operational) -> final
 * (writes public/data/ai/policy.json and runs the acceptance tournament). Checkpoints in tools/ai-train/ckpt, curves in logs/.
 */
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { loadWorldStatic } from '../../src/data/loadWorld';
import { nodeFetchJson } from '../../src/data/fetchNode';
import type { NetSpec } from '../../src/sim/neural/mlp';
import { PACK_FORMAT, type PolicyPack } from '../../src/sim/neural/pack';
import { ckpt, logs, POLICY_OUT } from './paths';
import { Pool } from './pool';
import { stageTac } from './stage-tac';
import { stageWar, warNets } from './stage-war';
import { runBc } from './bc-tac';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const hours = Number(arg('--hours', '1'));
const workers = Number(arg('--workers', String(Math.max(1, Math.min(8, cpus().length - 1)))));
const seed = Number(arg('--seed', '1'));
const fresh = process.argv.includes('--fresh');
const stages = arg('--stages', 'bc,tac,war,final').split(',');
const warDays = Number(arg('--war-days', '90'));

if (fresh) for (const f of ['tac.es.json', 'tac.best.json', 'war.es.json', 'war.best.json']) rmSync(ckpt(f), { force: true });
const t0 = Date.now(), total = hours * 3600_000;
console.log(`treino: ${hours} h, ${workers} workers, seed ${seed}, etapas ${stages.join(',')}`);
const world = await loadWorldStatic(nodeFetchJson());
const pool = new Pool(workers);

if (stages.includes('bc') && (fresh || !existsSync(ckpt('tac.bc.json')))) await runBc(pool, world, seed);
const runTac = stages.includes('tac'), runWar = stages.includes('war');
const share = runTac && runWar ? 0.45 : 0.9;
let tac: NetSpec | null = existsSync(ckpt('tac.best.json')) ? JSON.parse(readFileSync(ckpt('tac.best.json'), 'utf8')) : null;
if (runTac) tac = await stageTac(pool, world, Date.now() + Math.max(60_000, total * share - (Date.now() - t0)), workers, seed);
let war: Float64Array | null = existsSync(ckpt('war.best.json')) ? Float64Array.from(JSON.parse(readFileSync(ckpt('war.best.json'), 'utf8'))) : null;
if (runWar) war = await stageWar(pool, world, Math.max(Date.now() + 60_000, t0 + total * 0.95), workers, seed, tac, warDays);
if (stages.includes('final')) {
  const pack: PolicyPack = { format: PACK_FORMAT, version: arg('--version', `${new Date().toISOString().slice(0, 10)}-s${seed}`), seed, notes: `trained ${hours} h`, nets: { ...(war ? warNets(war) : {}), ...(tac ? { tac } : {}) } };
  writeFileSync(POLICY_OUT, JSON.stringify(pack));
  writeFileSync(logs('pack.meta.json'), JSON.stringify({ version: pack.version, hours, workers, seed, finishedAt: new Date().toISOString() }));
  console.log(`pesos gravados em ${POLICY_OUT} (${(JSON.stringify(pack).length / 1024).toFixed(0)} KB). Rode: npx tsx tools/ai-train/tournament.ts`);
}
await pool.close();
