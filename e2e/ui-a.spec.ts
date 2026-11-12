import { expect, test, type Page } from '@playwright/test';

const PANELS = ['economy', 'budget', 'energy', 'construction', 'population', 'trade'];
const RAW_KEY = /\b(ui|eco|dip|mil|res|tac|err)\.[a-zA-Z]+(\.[a-zA-Z0-9]+)*\b/;

const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);
const hours = (page: Page) => page.evaluate(() => window.__game!.state.time.hours);

test('UI-A: menu → new game (BRA) → panels → tax → build plant → save → reload → load', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const noRawKeys = async (scope = 'body') => {
    const text = await page.locator(scope).innerText();
    expect(text.match(RAW_KEY)?.[0] ?? null, `chave i18n crua em ${scope}`).toBeNull();
  };

  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await noRawKeys();
  log("await page.getByTestId('menu-new').click");
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('country-pick')).toBeVisible();
  await page.getByTestId('country-search').fill('Brasil');
  await page.getByTestId('pick-BRA').click();
  await expect(page.getByTestId('country-facts')).toContainText('Brasil');
  await noRawKeys();
  await page.waitForTimeout(3500); // let the camera settle on the country
  await page.screenshot({ path: 'docs/assets/ui-newgame.png' });
  log("await page.getByTestId('start-game').cli");
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  expect(await page.evaluate(() => window.__game!.state.meta.playerCountryId)).toBe('BRA');

  // Run ~30 days at speed 5 (96 h/s).
  log("await page.getByTestId('btn-speed-5').cl");
  await page.getByTestId('btn-speed-5').click();
  await expect.poll(() => hours(page), { timeout: 400_000 }).toBeGreaterThan(720);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__game!.state.time.paused)).toBe(true);
  await noRawKeys('[data-testid=topbar]');

  log('// Every panel opens');
  // Every panel opens without raw i18n keys.
  for (const id of PANELS) {
    await page.getByTestId(`sb-${id}`).click();
    await expect(page.getByTestId(`win-${id}`)).toBeVisible();
    await noRawKeys(`[data-testid=win-${id}]`);
  }
  for (const id of PANELS.filter((p) => p !== 'budget' && p !== 'construction')) await page.getByTestId(`sb-${id}`).click();

  log('// Change a tax.');
  // Change a tax.
  const before = await page.evaluate(() => window.__game!.state.economy.c.BRA.tax.income);
  const slider = page.getByTestId('win-budget').locator('input[type=range]').first();
  await slider.fill(before > 0.3 ? '0.15' : '0.35');
  const after = await page.evaluate(() => window.__game!.state.economy.c.BRA.tax.income);
  expect(Math.abs(after - before)).toBeGreaterThan(0.05);

  log('// Start building');
  // Start building a power plant at the default location (capital province).
  const nStruct = () => page.evaluate(() => window.__game!.ctx.api.economy.structures({ country: 'BRA' }).length);
  const n0 = await nStruct();
  const win = page.getByTestId('win-construction');
  await expect(win.locator('[data-testid^="build-"]').first()).toBeVisible();
  const btn = win.locator('[data-testid^="build-powerPlant"]:not([disabled])').first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(nStruct).toBe(n0 + 1);
  await win.getByRole('button', { name: /Fila/ }).click();
  await expect(win.locator('[data-testid^="cancel-"]').first()).toBeVisible();

  log('// Screenshot: HUD');
  // Screenshot: HUD + budget.
  await win.getByRole('button', { name: 'Fechar' }).click();
  await page.getByTestId('win-budget').evaluate((el) => ((el as HTMLElement).style.left = '90px'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/assets/ui-hud-budget.png' });

  log('// City inspector.');
  // City inspector.
  await page.getByTestId('sb-budget').click();
  await page.evaluate(() => {
    const w = window.__world!;
    const i = w.capitalCityOf('BRA')!;
    const c = w.cities[i];
    window.__ui!.getState().select({ kind: 'city', index: i, id: i, province: c.provinceId, country: 'BRA', lonLat: [c.lon, c.lat] });
    void window.__globe!.flyTo(c.lon, c.lat, { height: 600_000, durationS: 0.5 });
  });
  await expect(page.getByTestId('inspector-city')).toBeVisible();
  await noRawKeys('[data-testid=inspector-city]');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: 'docs/assets/ui-city.png' });

  log('// Foreign country');
  // Foreign country inspector.
  await page.evaluate(() => window.__ui!.getState().select({ kind: 'country', country: 'ARG', id: 'ARG' }));
  await expect(page.getByTestId('inspector-country')).toBeVisible();
  await noRawKeys('[data-testid=inspector-country]');

  log('// Save → reload');
  // Save → reload → load.
  const savedHours = await hours(page);
  await page.keyboard.press('Escape'); // closes selection
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
  expect(await hours(page)).toBe(savedHours);
  await expect(page.getByTestId('game-date')).toContainText('2026');

  const real = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  console.log('ignored resource errors:', errors.length - real.length);
  expect(real).toEqual([]);
});
