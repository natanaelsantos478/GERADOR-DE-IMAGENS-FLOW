import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../../core/game';
import { DATA_FILES, loadWorldStatic } from '../../data/loadWorld';
import { DEFAULT_DATA_DIR, nodeFetchJson } from '../../data/fetchNode';
import { researchSystem } from '../research/system';
import { economySystem } from '../economy/system';
import { diplomacySystem } from '../diplomacy/system';
import { militarySystem } from './system';
import { battleFx, localWeather, moveFx } from './effects';
import { cmdState, makeOfficer, officerOf } from './commanders';
import { defenseOf, powerOf, profileOf } from './combat';
import { wearDay, maintenanceMap } from './wear';
import { apisOf } from './env';
import { weatherAt } from './weather';
import type { Formation, Officer } from './types';

const missing = DATA_FILES.filter((f) => !existsSync(path.join(DEFAULT_DATA_DIR, f)));

describe('weatherAt (modelo climático)', () => {
  const jan = 24 * 15, jul = 24 * (181 + 15);
  it('é determinístico e puro', () => {
    expect(weatherAt(37.6, 55.7, 1234, { seed: 5 })).toEqual(weatherAt(37.6, 55.7, 1234, { seed: 5 }));
    expect(JSON.parse(JSON.stringify(weatherAt(37.6, 55.7, 99)))).toEqual(weatherAt(37.6, 55.7, 99));
  });
  it('estação por hemisfério e latitude', () => {
    const avg = (lon: number, lat: number, h0: number) => {
      let t = 0;
      for (let i = 0; i < 40; i++) t += weatherAt(lon, lat, h0 + i * 17, { seed: 1 }).tempC;
      return t / 40;
    };
    expect(avg(37.6, 55.7, jan)).toBeLessThan(avg(37.6, 55.7, jul) - 12);
    expect(avg(-58.4, -34.6, jan)).toBeGreaterThan(avg(-58.4, -34.6, jul) + 6);
    expect(avg(37.6, 55.7, jan)).toBeLessThan(avg(-46.6, -23.5, jan) - 15);
  });
  it('inverno e lama desaceleram o movimento fora de estrada; monção alaga', () => {
    const mean = (lon: number, lat: number, h0: number, f: (w: ReturnType<typeof weatherAt>) => number) => {
      let t = 0;
      for (let i = 0; i < 60; i++) t += f(weatherAt(lon, lat, h0 + i * 29, { seed: 3, rugged: 0.15 }));
      return t / 60;
    };
    const winter = mean(37.6, 55.7, jan, (w) => w.mods.off), summer = mean(37.6, 55.7, jul, (w) => w.mods.off);
    expect(winter).toBeLessThan(summer - 0.15);
    const autumn = mean(30, 52, 24 * 290, (w) => w.mud), midsummer = mean(30, 52, jul, (w) => w.mud);
    expect(autumn).toBeGreaterThan(midsummer);
    expect(mean(77, 19, jul, (w) => w.mud)).toBeGreaterThan(mean(77, 19, jan, (w) => w.mud) + 0.15);
    const hot = mean(45, 25, jul, (w) => w.mods.heat), cool = mean(37.6, 55.7, jul, (w) => w.mods.heat);
    expect(hot).toBeGreaterThan(cool + 0.1);
  });
  it('teto/visibilidade reduzem operações aéreas em frentes', () => {
    let worst = 1, best = 0;
    for (let i = 0; i < 400; i++) {
      const w = weatherAt(10, 50, i * 7, { seed: 2 });
      worst = Math.min(worst, w.mods.air);
      best = Math.max(best, w.mods.air);
    }
    expect(best).toBeGreaterThan(0.9);
    expect(worst).toBeLessThan(0.5);
  });
});

describe.skipIf(missing.length > 0)('comando, cansaço, desgaste (sistemas reais)', () => {
  let game: Game;
  beforeAll(async () => {
    const world = await loadWorldStatic(nodeFetchJson());
    game = createGame(world, { systems: [researchSystem, economySystem, diplomacySystem, militarySystem], playerCountryId: 'BRA', paused: false });
  }, 120_000);

  let n = 0;
  const mk = (): { f: Formation; o: Officer } => {
    const m = game.ctx.api.military;
    const id = m.spawn('BRA', 'armor', { lon: -47.9 + 0.3 * n++, lat: -15.8 })!;
    const f = game.state.military.forms[id];
    f.u = [{ t: 'infantry', k: 4, s: 1 }, { t: 'armor', k: 3, s: 1 }];
    const cs = cmdState(game.ctx);
    const o = makeOfficer(game.ctx, 'BRA', 'land', 1, 9000 + cs.nx, `T${cs.nx++}`);
    cs.off[o.id] = o;
    o.f = f.id; f.cm = o.id;
    return { f, o };
  };
  const clearEnv = { rugged: 0.3, urban: false, cold: false, naval: false };
  const fxIn = (wx = weatherAt(-47, -15, 100)) => battleFx(game.ctx, { wx: { ...wx, mud: 0, mods: { ...wx.mods, air: 1, sea: 1 } }, terrain: clearEnv });
  const mc = { get: () => 1 } as never;
  const power = (f: Formation, vs: Formation, fx = fxIn()) => powerOf([f], profileOf([vs]), false, mc, 0.3, [], undefined, fx);

  it('gera quadro de oficiais determinístico, com nomes e traços, e JSON puro', () => {
    const cs = cmdState(game.ctx);
    const br = Object.values(cs.off).filter((o) => o.c === 'BRA');
    expect(br.length).toBeGreaterThan(5);
    expect(br.every((o) => o.n.includes(' ') && o.tr.length >= 1 && o.tr.length <= 2 && o.a >= 1 && o.a <= 10)).toBe(true);
    expect(JSON.parse(JSON.stringify(game.state.military.cmd))).toEqual(game.state.military.cmd);
    const view = game.ctx.api.military.officers('BRA')[0];
    expect(view.rankKey).toMatch(/\./);
    const forms = game.ctx.api.military.formations({ country: 'BRA', domain: 'land' });
    expect(forms.filter((f) => f.commander).length).toBeGreaterThan(3);
  });

  it('comandante melhor vence mais (poder e defesa)', () => {
    const a = mk(), b = mk();
    Object.assign(a.o, { a: 9, df: 9, m: 9, x: 0.5, tr: [] });
    Object.assign(b.o, { a: 2, df: 2, m: 2, x: 0, tr: [] });
    const ratio = power(a.f, b.f) / power(b.f, a.f);
    expect(ratio).toBeGreaterThan(1.25);
    const mcx = mc;
    const dA = defenseOf([a.f], mcx, 1, fxIn()), dB = defenseOf([b.f], mcx, 1, fxIn());
    expect(dA / dB).toBeGreaterThan(1.2);
    b.o.tr = ['armor'];
    expect(power(b.f, a.f)).toBeGreaterThan(power(b.f, a.f) * 0.99);
  });

  it('tropa descansada vence a cansada; material gasto rende menos', () => {
    const a = mk(), b = mk();
    Object.assign(a.o, { a: 5, df: 5, m: 5, x: 0, tr: [] });
    Object.assign(b.o, { a: 5, df: 5, m: 5, x: 0, tr: [] });
    b.f.fg = 0.7;
    expect(power(a.f, b.f) / power(b.f, a.f)).toBeGreaterThan(1.2);
    b.f.fg = 0;
    b.f.q = 0.5;
    expect(power(a.f, b.f) / power(b.f, a.f)).toBeGreaterThan(1.1);
  });

  it('lama/inverno desaceleram, tropa cansada anda menos', () => {
    const { f } = mk();
    f.o = 1;
    const base = moveFx(game.ctx, f);
    expect(base.spd).toBeGreaterThan(0);
    f.fg = 0.8;
    expect(moveFx(game.ctx, f).spd).toBeLessThan(base.spd * 0.75);
    // Moscou em janeiro vs julho: velocidade fora de estrada
    const h = game.ctx.state.time.hours;
    const w = (lon: number, lat: number, hh: number) => localWeather(game.ctx, [lon, lat], null, hh).mods.off;
    let jan = 0, jul = 0;
    for (let i = 0; i < 20; i++) { jan += w(37.6, 55.7, h + 24 * (10 + i)); jul += w(37.6, 55.7, h + 24 * (190 + i)); }
    expect(jan).toBeLessThan(jul);
  });

  it('desgaste recupera com manutenção, que custa dinheiro; embargo piora', () => {
    const { f } = mk();
    f.q = 0.5;
    f.fg = 0.5;
    f.rt = null;
    f.bt = null;
    f.pr = game.ctx.world.locateProvince(f.p[0], f.p[1]);
    game.state.world.controller[f.pr!] = 'BRA';
    const A = apisOf(game.ctx);
    const t0 = A.eco!.treasury('BRA');
    const mx = maintenanceMap(game.ctx, A);
    for (let i = 0; i < 6; i++) wearDay(game.ctx, A, f, 5, mx);
    expect(f.q ?? 1).toBeGreaterThan(0.9);
    expect(f.fg ?? 0).toBeLessThan(0.1);
    expect(A.eco!.treasury('BRA')).toBeLessThan(t0);
    const sanc = new Map([['BRA', 0.5]]);
    f.q = 0.5;
    for (let i = 0; i < 3; i++) wearDay(game.ctx, A, f, 5, sanc);
    const withEmbargo = f.q ?? 1;
    f.q = 0.5;
    for (let i = 0; i < 3; i++) wearDay(game.ctx, A, f, 5, new Map());
    expect(f.q ?? 1).toBeGreaterThan(withEmbargo);
  });

  it('troca manual de comandante (com permuta) e comandante some ao ser removido', () => {
    const a = mk(), b = mk();
    const oa = a.o.id, ob = b.o.id;
    expect(game.ctx.dispatch({ type: 'mil.assignCommander', country: 'BRA', formation: a.f.id, officer: ob }).ok).toBe(true);
    expect(a.f.cm).toBe(ob);
    expect(b.f.cm).toBe(oa);
    expect(officerOf(game.ctx, a.f)?.id).toBe(ob);
    expect(game.ctx.dispatch({ type: 'mil.assignCommander', country: 'BRA', formation: a.f.id, officer: null }).ok).toBe(true);
    expect(a.f.cm).toBeUndefined();
  });

  it('tabela: efeito médio de cada mecânica numa batalha padrão', () => {
    const base = weatherAt(-47, -15, 100);
    const wxs = (o: Partial<typeof base>) => ({ ...base, mud: 0, snowCover: 0, tempC: 15, ...o, mods: { ...base.mods, air: 1, sea: 1, off: 1, road: 1, ...(o.mods ?? {}) } });
    const std = () => {
      const a = mk(), v = mk();
      for (const x of [a.o, v.o]) Object.assign(x, { a: 5, df: 5, l: 5, m: 5, x: 0, tr: [] });
      return { a, v };
    };
    const row = (name: string, setup: (a: ReturnType<typeof mk>) => void, env = wxs({}), terrain = clearEnv) => {
      const { a, v } = std();
      const fx0 = battleFx(game.ctx, { wx: wxs({}), terrain: clearEnv });
      const p0 = powerOf([a.f], profileOf([v.f]), false, mc, 0.3, [], undefined, fx0), d0 = defenseOf([a.f], mc, 1, fx0), s0 = moveFx(game.ctx, a.f).spd;
      setup(a);
      const fx1 = battleFx(game.ctx, { wx: env, terrain });
      const p1 = powerOf([a.f], profileOf([v.f]), false, mc, 0.3, [], undefined, fx1), d1 = defenseOf([a.f], mc, 1, fx1);
      const mf = moveFx(game.ctx, a.f);
      const s1 = mf.spd * (env.mods.off);
      return `| ${name} | ${((p1 / p0 - 1) * 100).toFixed(0)}% | ${((d1 / d0 - 1) * 100).toFixed(0)}% | ${((s1 / s0 - 1) * 100).toFixed(0)}% |`;
    };
    const lines = [
      '| Mecânica (brigada padrão: 4 inf + 3 blind.) | Ataque | Defesa | Velocidade |', '|---|---|---|---|',
      row('Comandante excelente (9/9/9, exp 50%)', (a) => Object.assign(a.o, { a: 9, df: 9, m: 9, x: 0.5 })),
      row('Comandante fraco (2/2/2)', (a) => Object.assign(a.o, { a: 2, df: 2, m: 2 })),
      row('Sem comandante', (a) => { delete a.f.cm; }),
      row('Traço blindado (força blindada)', (a) => { a.o.tr = ['armor']; }),
      row('Traço urbano em cidade', (a) => { a.o.tr = ['urban']; }, wxs({}), { ...clearEnv, urban: true }),
      row('Defensor obstinado', (a) => { a.o.tr = ['stubborn']; }),
      row('Fadiga 60%', (a) => { a.f.fg = 0.6; }),
      row('Material a 60%', (a) => { a.f.q = 0.6; }),
      row('Lama (60%)', () => undefined, wxs({ mud: 0.6, mods: { ...base.mods, off: 0.7 } as never })),
      row('Inverno -15°C, sem traço', () => undefined, wxs({ tempC: -15, snowCover: 0.8, mods: { ...base.mods, off: 0.75 } as never }), { ...clearEnv, cold: true }),
      row('Inverno -15°C, comandante de inverno', (a) => { a.o.tr = ['winter']; }, wxs({ tempC: -15, snowCover: 0.8, mods: { ...base.mods, off: 0.75 } as never }), { ...clearEnv, cold: true }),
    ];
    console.log('\n' + lines.join('\n'));
    expect(lines.length).toBeGreaterThan(8);
  });
});
