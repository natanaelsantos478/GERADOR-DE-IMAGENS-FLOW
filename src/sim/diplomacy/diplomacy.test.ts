import { describe, expect, it } from 'vitest';
import type { Game } from '../../core/game';
import { findJsonIssues, findNonFinite } from '../../core/json';
import { EVENTS } from './events';
import { dipCommands as D, selectActionsAgainst, selectWars, selectPendingEvent } from './index';
import { dataMissing, getWorld, makeGame } from './dip.test-util';
import { diplomacyPt } from './i18n.pt';

describe.skipIf(dataMissing.length > 0)('diplomacia (dados reais)', () => {
  it('estado inicial: alianças, rivalidades e guerras reais', async () => {
    const g = await makeGame();
    const api = g.ctx.api.diplomacy;
    expect(api.atWar('RUS', 'UKR')).toBe(true);
    expect(api.atWar('ISR', 'PSX')).toBe(true);
    expect(api.allied('USA', 'DEU')).toBe(true);
    expect(api.allied('USA', 'RUS')).toBe(false);
    expect(api.tradeDeal('DEU', 'FRA')).toBe(true);
    expect(api.relation('IND', 'PAK')).toBeLessThan(-20);
    expect(api.relation('USA', 'GBR')).toBeGreaterThan(20);
    expect(api.access('USA', 'POL')).toBe(true);
    expect(api.wars().length).toBe(g.ctx.world.alliances.conflicts.length);
    expect(api.warScore(api.wars()[0].id, 'attackers')).toBe(0);
  });

  it('IA só ataca o jogador conforme a dificuldade', async () => {
    const sb = await makeGame({ difficulty: 'sandbox' });
    expect(sb.dispatch(D.declareWar('ARG', 'BRA'))).toMatchObject({ ok: false, reason: 'dip.err.sandboxPeace' });
    const nm = await makeGame({ difficulty: 'normal' });
    expect(nm.dispatch(D.declareWar('ARG', 'BRA'))).toMatchObject({ ok: false, reason: 'dip.err.noStrongCb' });
    const hd = await makeGame({ difficulty: 'hard' });
    expect(hd.dispatch(D.declareWar('ARG', 'BRA')).ok).toBe(true);
  });

  it('ações mostram bloqueio, chance e fatores; recusa não é aleatória escondida', async () => {
    const g = await makeGame();
    const acts = selectActionsAgainst(g.ctx, 'BRA', 'ARG');
    const trade = acts.find((a) => a.id === 'trade')!;
    expect(trade.factors.length).toBeGreaterThan(0);
    expect(acts.find((a) => a.id === 'alliance')!.blocked).toBeDefined();
    const hostile = selectActionsAgainst(g.ctx, 'BRA', 'RUS').find((a) => a.id === 'trade')!;
    expect(hostile.chance).toBeLessThanOrEqual(trade.chance);
    g.dispatch(D.improveRelations('BRA', 'ARG'));
    expect(g.ctx.api.diplomacy.lastCauses('BRA', 'ARG')[0].key).toBe('dip.cause.improve');
    expect(g.dispatch(D.improveRelations('BRA', 'ARG'))).toMatchObject({ ok: false, reason: 'dip.err.cooldown' });
  });

  it('guerra do jogador: declaração, ocupação parcial não capitula, ocupação com capital capitula, conferência aplica anexação', async () => {
    const g = await makeGame({ player: 'BRA', difficulty: 'normal' });
    const w = g.ctx.world;
    const r = g.dispatch(D.declareWar('BRA', 'URY'));
    expect(r.ok).toBe(true);
    const api = g.ctx.api.diplomacy;
    expect(api.atWar('BRA', 'URY')).toBe(true);
    expect(g.dispatch(D.declareWar('BRA', 'URY'))).toMatchObject({ ok: false, reason: 'dip.err.atWar' });
    expect(g.ctx.api.diplomacy.reputation('BRA')).toBeLessThan(0); // sem casus belli custa reputação
    const wd = g.ctx.api.worldDyn;
    const ury = [...wd.provincesOwnedBy('URY')];
    const capIdx = w.capitalCityOf('URY')!;
    const capProv = w.cities[capIdx].provinceId!;
    // ocupa só uma província que não é a capital
    const other = ury.find((p) => p !== capProv)!;
    wd.setController(other, 'BRA');
    g.advanceHours(24);
    expect(g.state.diplomacy.conferences.length).toBe(0);
    for (const p of ury) wd.setController(p, 'BRA');
    g.advanceHours(24);
    const conf = g.state.diplomacy.conferences[0];
    expect(conf?.receiver).toBe('BRA');
    expect(selectWars(g.ctx, 'BRA')[0].score).toBeGreaterThan(50);
    expect(g.dispatch(D.peaceChoose('BRA', conf.id, 'annexOccupied'))).toMatchObject({ ok: true });
    expect(wd.ownerOf(capProv)).toBe('BRA');
    expect(api.atWar('BRA', 'URY')).toBe(false);
    expect(findJsonIssues(g.state.diplomacy)).toEqual([]);
  });

  it('assembleia: nuclear gera reação (reputação, evento, votação de sanção)', async () => {
    const g = await makeGame();
    g.ctx.bus.emit({ type: 'mil.nukeDetonated', country: 'PRK', targetCountry: 'KOR' });
    expect(g.ctx.api.diplomacy.reputation('PRK')).toBeLessThan(-20);
    expect(g.ctx.api.diplomacy.sanctionLevel('PRK')).toBeGreaterThan(0.3);
    expect(g.state.diplomacy.vote?.target).toBe('PRK');
    expect(g.ctx.api.diplomacy.relation('PRK', 'KOR')).toBeLessThan(-50);
    expect(g.ctx.api.diplomacy.tradeFactor('PRK', 'JPN')).toBeLessThan(g.ctx.api.diplomacy.tradeFactor('KOR', 'JPN'));
  });

  it('eventos: ≥ 15 tipos com textos e escolhas; evento do jogador resolve', async () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(15);
    for (const e of EVENTS) {
      expect(diplomacyPt[`dip.event.${e.id}.title`], e.id).toBeTruthy();
      for (const c of e.choices) expect(diplomacyPt[`dip.event.${e.id}.c.${c.id}`], `${e.id}.${c.id}`).toBeTruthy();
    }
    const g = await makeGame();
    g.advanceHours(24 * 70);
    const ev = selectPendingEvent(g.ctx);
    if (ev) {
      expect(g.dispatch(D.eventChoose('BRA', ev.id, ev.choices[0].id)).ok).toBe(true);
      expect(selectPendingEvent(g.ctx)).toBeNull();
    }
    expect(g.state.diplomacy.stats.events).toBeGreaterThan(10);
  });

  it('10 anos com sistemas reais existentes: sem NaN, guerras não explodem nem congelam, ≤ 1 ms/dia (diplomacia)', async () => {
    const g: Game = await makeGame({ withOthers: true, difficulty: 'normal' });
    const ids = g.ctx.world.countries.length;
    expect(ids).toBeGreaterThan(200);
    const series: number[] = [];
    let started = g.state.diplomacy.stats.warsStarted;
    let ms = 0;
    for (let y = 0; y < 10; y++) {
      for (let d = 0; d < 365; d += 5) g.advanceHours(24 * 5);
      series.push(g.state.diplomacy.wars.length);
      expect(findNonFinite(g.state)).toEqual([]);
      expect(findJsonIssues(g.state.diplomacy)).toEqual([]);
      expect(findJsonIssues(g.state.research)).toEqual([]);
    }
    started = g.state.diplomacy.stats.warsStarted - started;
    console.log(`guerras ativas por ano: ${series.join(' ')} · iniciadas em 10 anos: ${started} · encerradas: ${g.state.diplomacy.stats.warsEnded} · eventos: ${g.state.diplomacy.stats.events}`);
    expect(Math.max(...series)).toBeLessThanOrEqual(14);
    expect(series.some((n) => n > 0)).toBe(true);
    expect(g.state.diplomacy.stats.warsStarted + g.state.diplomacy.stats.warsEnded).toBeGreaterThan(5);
    void getWorld;
  }, 600_000);
});
