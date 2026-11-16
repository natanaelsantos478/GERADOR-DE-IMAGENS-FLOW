/**
 * Forced-war performance scenario: RUS declares war on Poland on day 0 (alliances drag NATO in), then 60 days are simulated
 * with the AI driving every country. Usage: npx tsx src/app/perfwar.ts [--days 60] [--player RUS] [--target POL]
 */
import { performance } from 'node:perf_hooks';
import { createGame } from '../core/game';
import { loadWorldStatic } from '../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../data/fetchNode';
import { dipCommands } from '../sim/diplomacy';
import { pathStats } from '../sim/military/pathing';
import { SYSTEMS } from './systems';
const AI_CONTROLS_PLAYER = 'ai.controlsPlayer'; // same key as soak.ts (not imported: soak runs on import)

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const days = Number(arg('--days', '60')), player = arg('--player', 'RUS'), target = arg('--target', 'POL');

const world = await loadWorldStatic(nodeFetchJson(DEFAULT_DATA_DIR));
const game = createGame(world, { systems: SYSTEMS, playerCountryId: player, seed: 20260101, difficulty: 'hard', automation: { [AI_CONTROLS_PLAYER]: true } });
const r = game.dispatch(dipCommands.declareWar(player, target));
if (!r.ok) throw new Error(`declareWar falhou: ${JSON.stringify(r)}`);
const times: number[] = [], exps: number[] = [], cpu: number[] = [];
for (let d = 0; d < days; d++) {
  const t = performance.now(), c0 = process.cpuUsage();
  game.advanceHours(24);
  times.push(performance.now() - t);
  { const c = process.cpuUsage(c0); cpu.push((c.user + c.system) / 1000); }
  exps.push(pathStats.expanded);
}
const nWars = game.ctx.api.diplomacy.wars().length, atWar = game.ctx.api.diplomacy.enemies(player).length;
const sorted = [...times].sort((a, b) => a - b);
const avg = times.reduce((a, v) => a + v, 0) / times.length;
console.log(`guerras=${nWars} inimigos de ${player}=${atWar} formações=${game.ctx.api.military.formations({}).length}`);
console.log(`${days} dias: média ${avg.toFixed(2)} ms/dia · mediana ${sorted[days >> 1].toFixed(2)} · p95 ${sorted[Math.floor(days * 0.95)].toFixed(2)} · pior ${sorted[days - 1].toFixed(1)} ms`);
{ const cs = [...cpu].sort((a, b) => a - b); console.log(`CPU: média ${(cpu.reduce((a, v) => a + v, 0) / days).toFixed(2)} ms/dia · mediana ${cs[days >> 1].toFixed(2)} · p95 ${cs[Math.floor(days * 0.95)].toFixed(2)} · pior ${cs[days - 1].toFixed(1)} ms (tempo de CPU do processo, imune a carga da máquina)`); }
console.log(`A*: buscas=${pathStats.searches} falhas=${pathStats.failed} nós expandidos=${pathStats.expanded} cache(+/-)=${pathStats.hits}/${pathStats.negHits}`);
const worst = times.map((t, i) => ({ d: i, t, e: exps[i] - (exps[i - 1] ?? 0) })).sort((a, b) => b.t - a.t).slice(0, 5);
console.log('piores dias (dia, ms, nós A*):', worst.map((w) => `${w.d}:${w.t.toFixed(0)}ms/${w.e}`).join('  '));
const dump = arg('--dump', '');
if (dump) (await import('node:fs')).writeFileSync(dump, JSON.stringify(times));
process.exit(0);
