import { expect, test, type Page } from '@playwright/test';

const RAW_KEY = /\b(ui|eco|dip|mil|res|tac|err|tech|ai)\.[a-zA-Z]+(\.[a-zA-Z0-9_]+)*\b/;
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

test('UI-B: diplomacia, pesquisa, forças, produção, inteligência, HUD tático, guia', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const noRaw = async (scope = 'body', label = scope) => {
    const text = await page.locator(scope).innerText();
    expect(text.match(RAW_KEY)?.[0] ?? null, `chave i18n crua em ${label}`).toBeNull();
  };
  const ev = <T,>(fn: () => T) => page.evaluate(fn);

  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('country-search').fill('Brasil');
  await page.getByTestId('pick-BRA').click();
  await page.getByTestId('diff-sandbox').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  await page.waitForTimeout(2500);

  log('tutorial');
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await noRaw('[data-testid=tutorial]', 'tutorial');
  await page.getByTestId('tut-next').click();
  await page.getByTestId('tut-dismiss').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);

  log('painéis novos');
  for (const id of ['diplomacy', 'research', 'forces', 'production', 'intelligence', 'guide']) {
    await page.getByTestId(`sb-${id}`).click();
    await expect(page.getByTestId(`win-${id}`)).toBeVisible();
    await page.waitForTimeout(400);
    await noRaw(`[data-testid=win-${id}]`, id);
  }
  // Encyclopedia tabs
  const guide = page.getByTestId('win-guide');
  for (const tab of ['Construções', 'Tecnologias', 'Recursos', 'Unidades']) { await guide.getByRole('button', { name: tab }).click(); await noRaw('[data-testid=win-guide]', `guia/${tab}`); }
  for (const id of ['guide', 'intelligence', 'production', 'forces', 'research', 'diplomacy']) await page.getByTestId(`sb-${id}`).click();

  log('pesquisa');
  await page.getByTestId('sb-research').click();
  const rwin = page.getByTestId('win-research');
  const q0 = await ev(() => window.__game!.ctx.api.research.progress('BRA').queue.length + (window.__game!.ctx.api.research.progress('BRA').current ? 1 : 0));
  await rwin.locator('[data-testid^="tech-queue-"]').first().click();
  await expect.poll(() => ev(() => window.__game!.ctx.api.research.progress('BRA').queue.length + (window.__game!.ctx.api.research.progress('BRA').current ? 1 : 0))).toBeGreaterThan(q0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'docs/assets/ui-research.png' });
  await page.getByTestId('sb-research').click();

  log('produção');
  await page.getByTestId('sb-production').click();
  const pwin = page.getByTestId('win-production');
  const nq = () => ev(() => ((window.__game!.state as any).military.queue.BRA ?? []).length as number);
  const n0 = await nq();
  await pwin.locator('[data-testid^="produce-"]:not([disabled])').first().click();
  await expect.poll(nq).toBeGreaterThan(n0);
  await expect(pwin.getByTestId('queue-item').first()).toBeVisible();
  await pwin.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect.poll(nq).toBe(n0);
  await page.getByTestId('sb-production').click();

  log('forças: selecionar e mover');
  await page.getByTestId('sb-forces').click();
  const fwin = page.getByTestId('win-forces');
  await expect(fwin.getByTestId('formation-row').first()).toBeVisible();
  await fwin.getByTestId('formation-row').first().click();
  await expect(page.getByTestId('formation-inspector')).toBeVisible();
  await noRaw('[data-testid=formation-inspector]', 'inspetor de formação');
  const fid = await ev(() => window.__ui!.getState().selection!.id as string);
  await page.getByTestId('fm-move').click();
  await expect(page.getByTestId('pick-banner')).toBeVisible();
  // Resolve the destination through the real pick mode: emulate the globe click.
  await ev(() => {
    const f = window.__game!.ctx.api.military.formation(window.__ui!.getState().selection!.id as string)!;
    window.__ui!.getState().pickMode!.onPick({ lonLat: [f.pos[0] + 0.4, f.pos[1] + 0.2], province: null });
    window.__ui!.getState().setPick(null);
  });
  await expect.poll(() => ev(() => window.__game!.ctx.api.military.formation(window.__ui!.getState().selection!.id as string)!.order)).not.toBe('idle');
  log('mover ok ' + fid);

  log('diplomacia: propor acordo e declarar guerra');
  await page.getByTestId('sb-diplomacy').click();
  const dwin = page.getByTestId('win-diplomacy');
  await dwin.getByTestId('dip-search').fill('Argentina');
  await dwin.locator('tbody tr').first().click();
  await expect(dwin.getByTestId('country-file')).toBeVisible();
  await noRaw('[data-testid=win-diplomacy]', 'ficha do país');
  await dwin.getByTestId('dip-act-improve').click();
  await dwin.getByTestId('dip-act-trade').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/assets/ui-diplomacy.png' });
  await dwin.getByTestId('dip-declare').click();
  await dwin.getByTestId('dip-declare-confirm').click();
  await expect.poll(() => ev(() => window.__game!.ctx.api.diplomacy.atWar('BRA', 'ARG'))).toBe(true);
  await dwin.getByRole('button', { name: /Guerras/ }).click();
  await expect(dwin.getByTestId('dip-wars')).toBeVisible();
  await noRaw('[data-testid=win-diplomacy]', 'guerras');
  await dwin.getByRole('button', { name: /Pendências/ }).click();
  await dwin.getByRole('button', { name: 'Assembleia' }).click();
  await noRaw('[data-testid=win-diplomacy]', 'assembleia');
  await page.getByTestId('sb-diplomacy').click();

  log('provocar batalha');
  await ev(() => {
    const g = window.__game!;
    const mil = (g.state as any).military;
    const mine = Object.values<any>(mil.forms).find((f) => f.c === 'BRA' && f.d === 'land' && !f.cr);
    const foe = Object.values<any>(mil.forms).find((f) => f.c === 'ARG' && f.d === 'land' && !f.cr);
    foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02];
    foe.rt = null; foe.od = { k: 'idle' };
    g.dispatch({ type: 'game.setSpeed', country: 'BRA', speed: 3 });
    g.dispatch({ type: 'game.resume', country: 'BRA' });
  });
  await expect.poll(() => ev(() => window.__game!.ctx.api.military.battles().length), { timeout: 120_000 }).toBeGreaterThan(0);
  await ev(() => window.__game!.dispatch({ type: 'game.pause', country: 'BRA' }));
  if (!(await page.getByTestId('win-forces').count())) await page.getByTestId('sb-forces').click();
  await page.getByTestId('battle-row').first().click();
  await expect(page.getByTestId('battle-inspector')).toBeVisible();
  await noRaw('[data-testid=battle-inspector]', 'inspetor de batalha');
  await page.getByTestId('btn-tac-start').click();
  await expect(page.getByTestId('tac-top')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await noRaw('[data-testid=tac-top]', 'HUD tático');
  await expect(page.getByTestId('tac-ready')).toBeVisible();
  await page.getByTestId('tac-ready').click();
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase)).toBe('combat');
  log('ordem tática');
  await page.getByTestId('tac-squads').locator('[data-testid^="sq-"]').first().click();
  await page.getByTestId('tac-ord-hold').click();
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.squads.some((s: any) => s.side === window.__game!.state.tactical.battle!.player && s.order === 'hold'))).toBe(true);
  await page.getByTestId('tac-ord-form-wedge').click();
  await page.waitForTimeout(1500);
  await noRaw('body', 'HUD tático em combate');
  await page.screenshot({ path: 'docs/assets/ui-tactical-hud.png' });
  log('auto-comandar ×4');
  await page.getByTestId('tac-speed-4').click();
  await page.getByTestId('tac-auto').click();
  await expect(page.getByTestId('tac-result')).toBeVisible({ timeout: 600_000 });
  await noRaw('[data-testid=tac-result]', 'resultado');
  await page.screenshot({ path: 'docs/assets/ui-tactical-result.png' });
  await page.getByTestId('tac-result-ok').click();
  await expect(page.getByTestId('tac-top')).toHaveCount(0);
  await expect(page.getByTestId('sidebar')).toBeVisible();

  expect(errors).toEqual([]);
});
