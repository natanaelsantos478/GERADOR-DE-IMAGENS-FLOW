import { expect, test } from '@playwright/test';

/**
 * Controlled proof that city 3D walls are opaque: a bright magenta box is hidden INSIDE a tall building (lower than its walls and roof)
 * and the camera looks at the facade from outside. Photo 1 = material as it was before the fix (Cesium blended pass), photo 2 = as shipped.
 * If the magenta shows through the facade the surface is translucent; if not, it is opaque.
 */
const SHOT = { timeout: 180_000 };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

test('cidade 3D: fachadas e telhados são opacos (objeto escondido dentro do prédio)', async ({ page }) => {
  test.setTimeout(1_500_000);
  const errors: string[] = [];
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
  // La Defense (Paris): glass towers
  const set = () => page.evaluate(() => window.__globe!.setView(2.2385, 48.8920, { height: 700, pitchDeg: -45, headingDeg: 0 }));
  await set(); await page.waitForTimeout(3500); await set();
  await page.evaluate(() => (window as any).__city3d.idle(240_000));
  const tall = await page.evaluate(() => (window as any).__city3d.tall(8));
  log(`prédios altos: ${JSON.stringify(tall.slice(0, 3))}`);
  expect(tall.length).toBeGreaterThan(0);
  const b = tall[0];
  await page.evaluate((t) => (window as any).__city3d.hiddenProbe(t), b);
  const settle = async () => {
    await page.evaluate(() => (window as any).__city3d.idle(240_000));
    await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: 120_000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
    await page.evaluate(() => { window.__globe!.setContinuousRender(false); window.__globe!.requestRender(); });
    await page.waitForTimeout(5000);
  };
  const magenta = () => page.evaluate(async () => {
    // count pure magenta pixels in the canvas (the hidden box)
    const sc = window.__globe!.viewer.scene; sc.render();
    const c = sc.canvas, tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const g = tmp.getContext('2d')!; g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] > 200) n++;
    return n;
  });
  await page.evaluate(() => (window as any).__city3d.legacyBlend(true));
  await settle();
  const before = await magenta();
  await page.screenshot({ path: 'docs/assets/opacity-check-before.png', ...SHOT });
  await page.evaluate(() => (window as any).__city3d.legacyBlend(false));
  await settle();
  const after = await magenta();
  await page.screenshot({ path: 'docs/assets/opacity-check.png', ...SHOT });
  log(`magenta visível: antes do ajuste ${before} px, material atual ${after} px`);
  expect(after, 'o objeto escondido dentro do prédio não pode aparecer através das paredes').toBe(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
