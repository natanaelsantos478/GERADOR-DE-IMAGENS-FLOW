import { expect, test } from '@playwright/test';

/**
 * PLANO §8 item 2, end to end: menu → new game (BRA, sandbox) → 60 days → every panel → build a plant → recruit → move a formation →
 * declare war → battle → tactical mode → orders → conclude → result → save → reload → load. Zero console errors.
 * Waiting for game time uses direct sim calls (`__game.advanceHours`, `tactical.advance`) because the headless software GL is far slower than real time.
 */
const RAW_KEY = /\b(ui|eco|dip|mil|res|tac|err|tech|ai)\.[a-zA-Z]+(\.[a-zA-Z0-9_]+)*\b/;
const PANELS = ['economy', 'budget', 'energy', 'construction', 'population', 'trade', 'diplomacy', 'research', 'forces', 'production', 'intelligence', 'guide'];
const SHOT = { timeout: 180_000 };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

test('MERIDIANO: partida completa do menu ao carregar o save', async ({ page }) => {
  test.setTimeout(1_500_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // Count real WebAudio activity (decoded files, failed decodes, started sources).
  await page.addInitScript(() => {
    const st = { decoded: 0, failed: 0, sources: 0 };
    (window as unknown as { __audioStats: typeof st }).__audioStats = st;
    const AC = window.AudioContext;
    if (!AC) return;
    const dec = AC.prototype.decodeAudioData;
    AC.prototype.decodeAudioData = function (this: AudioContext, data: ArrayBuffer) {
      return (dec.call(this, data) as Promise<AudioBuffer>).then((b) => { st.decoded++; return b; }, (e) => { st.failed++; throw e; });
    } as typeof AC.prototype.decodeAudioData;
    const cbs = AC.prototype.createBufferSource;
    AC.prototype.createBufferSource = function (this: AudioContext) { st.sources++; return cbs.call(this); };
  });
  const noRaw = async (scope = 'body', label = scope) => {
    const text = await page.locator(scope).innerText();
    expect(text.match(RAW_KEY)?.[0] ?? null, `chave i18n crua em ${label}`).toBeNull();
  };
  const ev = <T,>(fn: () => T) => page.evaluate(fn);
  const hours = () => ev(() => window.__game!.state.time.hours);
  // Random world events open a modal that blocks the UI: answer them the way a player would.
  const clearEvents = async () => {
    for (let i = 0; i < 6 && (await page.getByTestId('world-event').count()); i++) {
      await page.locator('[data-testid^="event-choice-"]').first().click();
      await page.waitForTimeout(300);
    }
  };
  const tilesSettled = async (ms = 90_000) => {
    await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: ms }).catch(() => undefined);
    await page.waitForTimeout(1500);
  };

  // ------------------------------------------------------------------ menu
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await noRaw();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/assets/final-menu.png', ...SHOT });
  log('novo jogo');
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('country-pick')).toBeVisible();
  await page.getByTestId('country-search').fill('Brasil');
  await page.getByTestId('pick-BRA').click();
  await expect(page.getByTestId('country-facts')).toContainText('Brasil');
  await page.getByTestId('diff-sandbox').click();
  await noRaw();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  expect(await ev(() => window.__game!.state.meta.playerCountryId)).toBe('BRA');
  await page.waitForTimeout(2500);

  log('tutorial');
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await noRaw('[data-testid=tutorial]', 'tutorial');
  await page.getByTestId('tut-next').click();
  await page.getByTestId('tut-dismiss').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);

  // ------------------------------------------------------------------ 60 days
  log('60 dias');
  await ev(() => { window.__game!.advanceHours(24 * 60); });
  expect(await hours()).toBeGreaterThanOrEqual(24 * 60);
  await clearEvents();
  await expect(page.getByTestId('game-date')).toContainText('2026');
  await page.getByTestId('btn-speed-5').click(); // exercises the speed buttons (and the UI click sound)
  await page.keyboard.press('Space');
  await expect.poll(() => ev(() => window.__game!.state.time.paused)).toBe(true);
  await clearEvents();
  await noRaw('[data-testid=topbar]', 'barra superior');

  // World + country views.
  await ev(() => { void window.__globe!.flyTo(-35, 12, { height: 2.4e7, durationS: 0.1 }); });
  await tilesSettled();
  await page.screenshot({ path: 'docs/assets/final-world.png', ...SHOT });
  await ev(() => { void window.__globe!.flyTo(-52, -12, { height: 4.2e6, durationS: 0.1 }); });
  await tilesSettled();
  await page.screenshot({ path: 'docs/assets/final-country.png', ...SHOT });

  // ------------------------------------------------------------------ every panel
  log('painéis');
  for (const id of PANELS) {
    await page.getByTestId(`sb-${id}`).click();
    await expect(page.getByTestId(`win-${id}`)).toBeVisible();
    await noRaw(`[data-testid=win-${id}]`, id);
  }
  const guide = page.getByTestId('win-guide');
  for (const tab of ['Construções', 'Tecnologias', 'Recursos', 'Unidades']) { await guide.getByRole('button', { name: tab }).click(); await noRaw('[data-testid=win-guide]', `guia/${tab}`); }
  for (const id of PANELS) if (id !== 'budget' && id !== 'construction' && id !== 'forces') await page.getByTestId(`sb-${id}`).click();

  log('imposto');
  const before = await ev(() => window.__game!.state.economy.c.BRA.tax.income);
  await page.getByTestId('win-budget').locator('input[type=range]').first().fill(before > 0.3 ? '0.15' : '0.35');
  expect(Math.abs((await ev(() => window.__game!.state.economy.c.BRA.tax.income)) - before)).toBeGreaterThan(0.05);

  log('construir usina');
  const nStruct = () => ev(() => window.__game!.ctx.api.economy.structures({ country: 'BRA' }).length);
  const s0 = await nStruct();
  const cwin = page.getByTestId('win-construction');
  const btn = cwin.locator('[data-testid^="build-powerPlant"]:not([disabled])').first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(nStruct).toBe(s0 + 1);
  await cwin.getByRole('button', { name: /Fila/ }).click();
  await expect(cwin.locator('[data-testid^="cancel-"]').first()).toBeVisible();
  await page.getByTestId('sb-construction').click();
  await page.getByTestId('sb-budget').click();

  log('pesquisa');
  await page.getByTestId('sb-research').click();
  const rwin = page.getByTestId('win-research');
  const rq = () => ev(() => window.__game!.ctx.api.research.progress('BRA').queue.length + (window.__game!.ctx.api.research.progress('BRA').current ? 1 : 0));
  const q0 = await rq();
  await rwin.locator('[data-testid^="tech-queue-"]').first().click();
  await expect.poll(rq).toBeGreaterThan(q0);
  await page.getByTestId('sb-research').click();

  log('recrutar');
  await page.getByTestId('sb-production').click();
  const pwin = page.getByTestId('win-production');
  const nq = () => ev(() => ((window.__game!.state as any).military.queue.BRA ?? []).length as number);
  const n0 = await nq();
  await pwin.locator('[data-testid^="produce-"]:not([disabled])').first().click();
  await expect.poll(nq).toBeGreaterThan(n0);
  await expect(pwin.getByTestId('queue-item').first()).toBeVisible();
  await page.getByTestId('sb-production').click();

  log('mover formação');
  const fwin = page.getByTestId('win-forces');
  await expect(fwin.getByTestId('formation-row').first()).toBeVisible();
  await fwin.getByTestId('formation-row').first().click();
  await expect(page.getByTestId('formation-inspector')).toBeVisible();
  await noRaw('[data-testid=formation-inspector]', 'inspetor de formação');
  await page.getByTestId('fm-move').click();
  await expect(page.getByTestId('pick-banner')).toBeVisible();
  await ev(() => {
    const f = window.__game!.ctx.api.military.formation(window.__ui!.getState().selection!.id as string)!;
    window.__ui!.getState().pickMode!.onPick({ lonLat: [f.pos[0] + 0.4, f.pos[1] + 0.2], province: null });
    window.__ui!.getState().setPick(null);
  });
  await expect.poll(() => ev(() => window.__game!.ctx.api.military.formation(window.__ui!.getState().selection!.id as string)!.order)).not.toBe('idle');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'docs/assets/final-panel-forces.png', ...SHOT });

  await page.getByTestId('sb-forces').click();
  await page.getByTestId('sb-budget').click();

  // ------------------------------------------------------------------ city, near the ground (satellite must still show)
  log('cidade perto');
  await ev(() => {
    const w = window.__world!;
    const i = w.capitalCityOf('BRA')!, c = w.cities[i];
    window.__ui!.getState().select({ kind: 'city', index: i, id: i, province: c.provinceId, country: 'BRA', lonLat: [c.lon, c.lat] });
  });
  await expect(page.getByTestId('inspector-city')).toBeVisible();
  await noRaw('[data-testid=inspector-city]');
  await ev(() => { const c = window.__world!.cities[window.__world!.capitalCityOf('BRA')!]; void window.__globe!.flyTo(c.lon, c.lat, { height: 2500, durationS: 0.1 }); });
  await tilesSettled();
  await page.screenshot({ path: 'docs/assets/final-city-near.png', ...SHOT });
  await ev(() => window.__ui!.getState().select(null));

  // ------------------------------------------------------------------ war and battle
  log('declarar guerra');
  await page.getByTestId('sb-diplomacy').click();
  const dwin = page.getByTestId('win-diplomacy');
  await dwin.getByTestId('dip-search').fill('Argentina');
  await dwin.locator('tbody tr').first().click();
  await expect(dwin.getByTestId('country-file')).toBeVisible();
  await noRaw('[data-testid=win-diplomacy]', 'ficha do país');
  await dwin.getByTestId('dip-act-improve').click();
  await dwin.getByTestId('dip-declare').click();
  await dwin.getByTestId('dip-declare-confirm').click();
  await expect.poll(() => ev(() => window.__game!.ctx.api.diplomacy.atWar('BRA', 'ARG'))).toBe(true);
  await dwin.getByRole('button', { name: /Guerras/ }).click();
  await expect(dwin.getByTestId('dip-wars')).toBeVisible();
  await noRaw('[data-testid=win-diplomacy]', 'guerras');
  await page.getByTestId('sb-diplomacy').click();

  log('provocar batalha');
  await ev(() => {
    const g = window.__game!;
    const mil = (g.state as any).military;
    const mine = Object.values<any>(mil.forms).find((f) => f.c === 'BRA' && f.d === 'land' && !f.cr);
    const foe = Object.values<any>(mil.forms).find((f) => f.c === 'ARG' && f.d === 'land' && !f.cr);
    foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02];
    foe.rt = null; foe.od = { k: 'idle' };
    for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
  });
  expect(await ev(() => window.__game!.ctx.api.military.battles().length)).toBeGreaterThan(0);
  await clearEvents();
  await page.getByTestId('sb-forces').click();
  await page.getByTestId('battle-row').first().click();
  await expect(page.getByTestId('battle-inspector')).toBeVisible();
  await noRaw('[data-testid=battle-inspector]', 'inspetor de batalha');
  const sbId = await ev(() => window.__game!.ctx.api.military.battles()[0].id as string);

  log('modo tático');
  await page.getByTestId('btn-tac-start').click();
  await expect(page.getByTestId('tac-top')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await noRaw('[data-testid=tac-top]', 'HUD tático');
  await page.getByTestId('tac-ready').click();
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase)).toBe('combat');
  log('ordens táticas');
  await page.getByTestId('tac-squads').locator('[data-testid^="sq-"]').first().click();
  await page.getByTestId('tac-ord-hold').click();
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.squads.some((s: any) => s.side === window.__game!.state.tactical.battle!.player && s.order === 'hold'))).toBe(true);
  await page.getByTestId('tac-ord-form-wedge').click();
  await ev(() => {
    const b = window.__game!.state.tactical.battle!;
    const mine = b.squads.filter((s: any) => s.side === b.player).map((s: any) => s.id);
    window.__game!.dispatch({ type: 'tac.order', country: 'BRA', squads: mine.slice(1), order: { kind: 'attackMove', x: 0, y: 0 } } as never);
  });
  await ev(() => { for (let i = 0; i < 240; i++) window.__game!.ctx.api.tactical.advance(0.5); }); // 2 min of combat, with shots and explosions
  await noRaw('body', 'HUD tático em combate');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/assets/final-tactical.png', ...SHOT });

  log('concluir batalha');
  await page.getByTestId('tac-auto').click();
  const ended = await ev(() => {
    const g = window.__game!;
    let t = 0;
    while (g.state.tactical.battle!.phase !== 'ended' && t < 3600) { g.ctx.api.tactical.advance(0.5); t += 0.5; }
    return { phase: g.state.tactical.battle!.phase, t: g.state.tactical.battle!.t };
  });
  expect(ended.phase).toBe('ended');
  expect(ended.t).toBeLessThanOrEqual(25 * 60);
  await expect(page.getByTestId('tac-result')).toBeVisible();
  await noRaw('[data-testid=tac-result]', 'resultado');
  await page.screenshot({ path: 'docs/assets/final-tactical-result.png', ...SHOT });
  await page.getByTestId('tac-result-ok').click();
  await expect(page.getByTestId('tac-top')).toHaveCount(0);
  await expect(page.getByTestId('sidebar')).toBeVisible();
  const applied = await page.evaluate((id: string) => { const g = window.__game!; const b = g.ctx.api.military.battle(id); return { gone: !b, tactical: b?.tactical ?? false, last: g.state.tactical.last?.strategicBattleId }; }, sbId);
  expect(applied.last).toBe(sbId);
  expect(applied.tactical).toBe(false);

  // ------------------------------------------------------------------ sound actually reached WebAudio
  const audio = await ev(() => (window as unknown as { __audioStats: { decoded: number; failed: number; sources: number } }).__audioStats);
  log(`áudio: ${JSON.stringify(audio)}`);
  expect(audio.failed).toBe(0);
  expect(audio.decoded).toBeGreaterThan(0);
  expect(audio.sources).toBeGreaterThan(0);

  // ------------------------------------------------------------------ save → reload → load
  log('salvar → recarregar → carregar');
  const savedHours = await hours();
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-menu').click();
  await page.getByTestId('pm-save').click();
  await page.getByTestId('save-name').fill('slot-1');
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('slot-slot-1')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-slot-1').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  expect(await hours()).toBe(savedHours);
  expect(await ev(() => window.__game!.ctx.api.diplomacy.atWar('BRA', 'ARG'))).toBe(true);

  const real = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  console.log('erros de recurso ignorados (rede externa):', errors.length - real.length);
  expect(real).toEqual([]);
});
