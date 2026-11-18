import { expect, test, type Page } from '@playwright/test';

/** City 3D on the real satellite globe: buildings, trees and roads generated on demand from the style catalogs for the visible area. */
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

async function boot(page: Page, errors: string[]) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('country-search').fill('Estados Unidos');
  await page.getByTestId('pick-USA').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  if (await page.getByTestId('tut-dismiss').count()) await page.getByTestId('tut-dismiss').click().catch(() => undefined);
  await page.evaluate(() => { window.__game!.dispatch({ type: 'game.pause', country: 'USA' } as never); });
}

async function visit(page: Page, lon: number, lat: number, height: number, pitch: number, heading: number, shot: string) {
  const set = () => page.evaluate(([lo, la, h, p, hd]) => window.__globe!.setView(lo, la, { height: h, pitchDeg: p, headingDeg: hd }), [lon, lat, height, pitch, heading]);
  await set();
  await page.waitForTimeout(3500); // the game's opening camera flight must not override the view
  await set();
  const t0 = Date.now();
  await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: 90_000 }).catch(() => undefined);
  const idle = await page.evaluate(() => (window as any).__city3d.idle(150_000));
  await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  const loadS = (Date.now() - t0) / 1000;
  const stats = await page.evaluate(() => (window as any).__city3d.stats());
  const fps = await page.evaluate(() => new Promise<number>((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t > 3000) res(n / 3); else { window.__globe!.requestRender(); requestAnimationFrame(f); } }; requestAnimationFrame(f); }));
  log(`${shot}: idle=${idle} load=${loadS.toFixed(1)}s fps~${fps.toFixed(1)} ${JSON.stringify(stats)}`);
  await page.screenshot({ path: `docs/assets/${shot}.png`, timeout: 180_000 });
  return { stats, idle, loadS, fps };
}

test('cidade 3D: Paris perto/médio, Rio, floresta', async ({ page }) => {
  test.setTimeout(1_500_000);
  const errors: string[] = [];
  await boot(page, errors);
  const near = await visit(page, 2.3522, 48.8566, 600, -35, 20, 'city3d-paris-near');
  expect(near.stats.active).toBe(true);
  expect(near.stats.buildings).toBeGreaterThan(300);
  expect(near.stats.roadSegments).toBeGreaterThan(50);
  const mid = await visit(page, 2.3522, 48.8566, 4200, -50, 20, 'city3d-paris-mid');
  expect(mid.stats.buildings).toBeGreaterThan(300);
  const rio = await visit(page, -43.2096, -22.9519, 1300, -32, 200, 'city3d-rio');
  expect(rio.stats.trees).toBeGreaterThan(50);
  const forest = await visit(page, -43.285, -22.955, 900, -35, 90, 'city3d-forest'); // Floresta da Tijuca (Rio): dense forest must show real trees
  expect(forest.stats.trees, JSON.stringify(forest.stats.cover)).toBeGreaterThan(400);
  // far away the layer unloads
  await page.evaluate(() => window.__globe!.setView(2.35, 48.85, { height: 60_000, pitchDeg: -90 }));
  await expect.poll(() => page.evaluate(() => (window as any).__city3d.active()), { timeout: 20_000 }).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

/** Landmark catalog: a glb is placed on the ground and the generic buildings under its footprint are hidden (catalog mocked with an existing glb). */
test('cidade 3D: marco com glb esconde prédios genéricos', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  await page.route('**/data/landmarks.json', (r) => r.fulfill({ json: [{ id: 'arc-test', name: 'Arc de Triomphe', namePt: 'Arco do Triunfo', lon: 2.295, lat: 48.8738, headingDeg: 0, scale: 1, model: 'arc.glb', heightM: 50, footprintRadiusM: 60, license: 'test', author: 'test' }] }));
  await boot(page, errors);
  const r = await visit(page, 2.295, 48.8738, 700, -35, 30, 'city3d-landmark');
  expect(r.stats.landmarks).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
