/**
 * Headless soak runner (PLANO §6):
 *   npm run sim:soak -- --years 3 --player BRA [--seed N] [--difficulty normal] [--budget 12] [--data public/data]
 * Runs the whole world (all registered systems, AI included) day by day, prints monthly metrics and
 * exits with code 1 on exception, NaN/Infinity in state, non-JSON state, failed save round-trip or
 * average ms/day above the budget.
 */
import { performance } from 'node:perf_hooks';
import type { Difficulty } from '../core/contracts';
import { formatDateIso, hoursToDate } from '../core/clock';
import { createGame, loadGame } from '../core/game';
import { findJsonIssues, findNonFinite } from '../core/json';
import { loadWorldStatic } from '../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../data/fetchNode';
import { SYSTEMS } from './systems';

/** Automation key telling the AI to also run the player's country (headless only). */
export const AI_CONTROLS_PLAYER = 'ai.controlsPlayer';

interface Args {
  years: number;
  days: number | null;
  player: string;
  seed: number;
  difficulty: Difficulty;
  budget: number;
  data: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { years: 3, days: null, player: 'BRA', seed: 20260101, difficulty: 'normal', budget: 12, data: DEFAULT_DATA_DIR };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    const need = () => {
      if (v === undefined) throw new Error(`argumento ${k} sem valor`);
      i++;
      return v;
    };
    switch (k) {
      case '--years': a.years = Number(need()); break;
      case '--days': a.days = Number(need()); break;
      case '--player': a.player = need().toUpperCase(); break;
      case '--seed': a.seed = Number(need()); break;
      case '--difficulty': a.difficulty = need() as Difficulty; break;
      case '--budget': a.budget = Number(need()); break;
      case '--data': a.data = need(); break;
      default: throw new Error(`argumento desconhecido: ${k}`);
    }
  }
  if (!['sandbox', 'normal', 'hard'].includes(a.difficulty)) throw new Error(`dificuldade inválida: ${a.difficulty}`);
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const world = await loadWorldStatic(nodeFetchJson(args.data));
  console.log(
    `dados: ${world.countries.length} países, ${world.provinces.length} províncias, ${world.cities.length} cidades, ` +
      `${world.plants.length} usinas, ${world.roads.edgeCount} arestas — ${((performance.now() - t0) / 1000).toFixed(1)} s (hash ${world.dataHash})`,
  );
  if (SYSTEMS.length === 0) console.warn('aviso: nenhum sistema registrado em src/app/systems.ts — rodando só o core');
  else console.log(`sistemas: ${SYSTEMS.map((s) => s.id).join(', ')}`);

  const game = createGame(world, {
    systems: SYSTEMS,
    playerCountryId: args.player,
    seed: args.seed,
    difficulty: args.difficulty,
    automation: { [AI_CONTROLS_PLAYER]: true },
  });
  const days = args.days ?? Math.round(args.years * 365.25);
  const WARMUP = Math.min(7, Math.floor(days / 4));
  let totalMs = 0, measuredDays = 0, worstMs = 0, monthMs = 0, monthDays = 0;
  const failures: string[] = [];

  const report = () => {
    const st = game.state;
    const alive = game.ctx.api.worldDyn.aliveCountries().length;
    const metrics: string[] = [];
    for (const s of game.registry.systems) {
      const m = s.metrics?.(game.ctx);
      if (m) for (const [k, v] of Object.entries(m)) metrics.push(`${s.id}.${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`);
    }
    console.log(
      `${formatDateIso(st.time.hours).slice(0, 10)}  ms/dia=${(monthMs / Math.max(1, monthDays)).toFixed(2)}  ` +
        `vivos=${alive}  notícias=${st.news.length}  estado=${(JSON.stringify(st).length / 1024).toFixed(0)}KB  ${metrics.join('  ')}`,
    );
    monthMs = 0;
    monthDays = 0;
  };

  let lastMonth = -1;
  for (let d = 0; d < days; d++) {
    const s = performance.now();
    game.advanceHours(24);
    const ms = performance.now() - s;
    monthMs += ms;
    monthDays++;
    if (d >= WARMUP) {
      totalMs += ms;
      measuredDays++;
      worstMs = Math.max(worstMs, ms);
    }
    const month = hoursToDate(game.state.time.hours).month;
    if (month !== lastMonth) {
      if (lastMonth !== -1) {
        const bad = findNonFinite(game.state);
        if (bad.length) {
          failures.push(`NaN/Infinity no estado: ${bad.join('; ')}`);
          break;
        }
        report();
      }
      lastMonth = month;
    }
  }
  if (monthDays > 0) report();

  const issues = findJsonIssues(game.state);
  if (issues.length) failures.push(`estado não é JSON puro: ${issues.map((i) => `${i.path} (${i.problem})`).join('; ')}`);

  const save = game.serialize();
  const reloaded = loadGame(world, SYSTEMS, JSON.parse(JSON.stringify(save)));
  if (JSON.stringify(reloaded.state) !== JSON.stringify(game.state)) failures.push('serialize → load não reproduz o estado');
  else {
    // Determinism: both copies must stay identical for another simulated day.
    game.advanceHours(24);
    reloaded.advanceHours(24);
    if (JSON.stringify(reloaded.state) !== JSON.stringify(game.state)) failures.push('simulação não determinística após carregar o save');
  }

  const avg = measuredDays ? totalMs / measuredDays : 0;
  console.log(`\n${days} dias simulados · média ${avg.toFixed(2)} ms/dia (pior ${worstMs.toFixed(1)} ms) · orçamento ${args.budget} ms/dia`);
  if (avg > args.budget) failures.push(`orçamento estourado: ${avg.toFixed(2)} ms/dia > ${args.budget}`);
  if (failures.length) {
    for (const f of failures) console.error(`FALHA: ${f}`);
    return 1;
  }
  console.log('OK');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error('FALHA: exceção', e);
    process.exit(1);
  },
);
