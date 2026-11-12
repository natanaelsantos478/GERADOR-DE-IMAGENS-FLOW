import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../../core/game';
import { findJsonIssues, findNonFinite } from '../../core/json';
import { DATA_FILES, loadWorldStatic } from '../../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../../data/fetchNode';
import { SYSTEMS } from '../../app/systems';

const missing = DATA_FILES.filter((f) => !existsSync(path.join(DEFAULT_DATA_DIR, f)));

describe.skipIf(missing.length > 0)('IA estratégica (mundo real, todos os sistemas)', () => {
  let game: Game;
  let battles = 0;
  beforeAll(async () => {
    const world = await loadWorldStatic(nodeFetchJson());
    game = createGame(world, { systems: SYSTEMS, playerCountryId: 'BRA', seed: 7, automation: { 'ai.controlsPlayer': true } });
    game.bus.on('mil.battleEnded', () => battles++);
  }, 120_000);

  it('países em guerra lutam, produzem e o estado segue JSON puro', () => {
    for (let d = 0; d < 45; d++) game.advanceHours(24);
    expect(battles).toBeGreaterThan(5);
    expect(game.state.ai.stats.warThinks).toBeGreaterThan(0);
    expect(game.state.ai.stats.produced).toBeGreaterThan(0);
    expect(findJsonIssues(game.state.ai)).toEqual([]);
    expect(findNonFinite(game.state)).toEqual([]);
  }, 120_000);

  it('conselheiro devolve itens acionáveis ordenados por prioridade', () => {
    const items = game.ctx.api.ai.advice('BRA');
    expect(Array.isArray(items)).toBe(true);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].priority).toBeGreaterThanOrEqual(items[i].priority);
    for (const it of items) expect(it.key.startsWith('ai.advice.')).toBe(true);
  });

  it('a IA nunca usa arma nuclear sem ter sofrido ataque nuclear', () => {
    expect(game.state.ai.stats.launches).toBeGreaterThanOrEqual(0);
    expect(Object.keys(game.state.ai.nuked)).toHaveLength(0);
  });
});
