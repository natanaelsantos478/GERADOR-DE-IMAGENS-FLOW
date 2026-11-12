import { expect, test } from '@playwright/test';

test('loads the world data, creates a game and advances time without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('./');
  await expect(page.getByTestId('boot-ready')).toBeVisible({ timeout: 120_000 });

  const info = await page.evaluate(() => ({
    countries: window.__world?.countries.length ?? 0,
    provinces: window.__world?.provinces.length ?? 0,
    player: window.__game?.state.meta.playerCountryId,
    hours: window.__game?.state.time.hours,
    cesiumBase: window.CESIUM_BASE_URL,
  }));
  expect(info.countries).toBeGreaterThan(200);
  expect(info.provinces).toBeGreaterThan(4000);
  expect(info.player).toBe('BRA');
  expect(info.hours).toBe(0);
  expect(info.cesiumBase).toMatch(/\/cesium\/$/);

  // Cesium static assets are served next to the page.
  const worker = await page.request.get(new URL('cesium/Assets/approximateTerrainHeights.json', info.cesiumBase!.replace(/cesium\/$/, '')).href);
  expect(worker.ok()).toBe(true);

  await page.evaluate(() => {
    const g = window.__game!;
    g.dispatch({ type: 'game.setSpeed', country: 'BRA', speed: 5 });
    g.dispatch({ type: 'game.resume', country: 'BRA' });
  });
  await expect.poll(() => page.evaluate(() => window.__game!.state.time.hours), { timeout: 15_000 }).toBeGreaterThan(24);
  await expect(page.getByTestId('game-date')).toContainText('2026');

  expect(errors).toEqual([]);
});
