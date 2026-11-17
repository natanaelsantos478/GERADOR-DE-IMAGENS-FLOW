/**
 * Phone e2e (Pixel 7, portrait and landscape): menu → new game (BRA) → panels as bottom sheets → touch selection of a
 * formation → tactical HUD → no horizontal page scroll → no console errors. Screenshots in docs/assets/mobile-*.png.
 * Run against the deploy build:  npm run build:deploy && npx vite preview --outDir dist --port 5193 & E2E_PORT=5193 npx playwright test e2e/mobile.spec.ts
 */
import { devices, expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';

const SHOT = { timeout: 180_000 };
const P7 = devices['Pixel 7'];

async function phone(browser: Browser, landscape: boolean) {
  const context = await browser.newContext({
    ...P7,
    viewport: landscape ? { width: 915, height: 412 } : P7.viewport,
    screen: landscape ? { width: 915, height: 412 } : { width: 412, height: 915 },
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 5173}/`,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { context, page, errors };
}

const noHScroll = (page: Page, what: string) =>
  page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth })).then((r) => {
    expect(r.sw, `${what}: scrollWidth ${r.sw} > ${r.iw}`).toBeLessThanOrEqual(r.iw + 1);
    expect(r.bw, `${what}: body scrollWidth`).toBeLessThanOrEqual(r.iw + 1);
  });

async function startBrazil(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await noHScroll(page, 'menu');
}
async function chooseBrazil(page: Page) {
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('country-search').fill('Brasil');
  await page.getByTestId('pick-BRA').tap();
  await noHScroll(page, 'escolha de país');
  await page.getByTestId('start-game').tap();
  await expect(page.getByTestId('topbar')).toBeVisible();
}

async function cdpTouch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Array<{ x: number; y: number }>) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
}

async function checkTargets(page: Page, sel: string, min = 40) {
  const small = await page.evaluate(([s, m]) => [...document.querySelectorAll<HTMLElement>(s as string)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < (m as number) || r.width < (m as number)); }).map((e) => `${e.dataset.testid ?? e.className}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`), [sel, min] as const);
  expect(small, `alvos de toque pequenos (${sel})`).toEqual([]);
}

for (const landscape of [false, true]) {
  test(`mobile ${landscape ? 'paisagem' : 'retrato'}: menu → jogo → gavetas → toque → tático`, async ({ browser }) => {
    test.setTimeout(1_500_000);
    const { context, page, errors } = await phone(browser, landscape);
    const tag = landscape ? 'landscape' : '';
    const ev = <T,>(fn: () => T) => page.evaluate(fn);
    await startBrazil(page);
    expect(await ev(() => document.documentElement.classList.contains('m'))).toBe(true);
    expect(await ev(() => window.__ui!.getState().screen)).toBe('menu');
    if (!landscape) await page.screenshot({ path: 'docs/assets/mobile-menu.png', ...SHOT });

    await chooseBrazil(page);
    // roads reassembled from data/_parts.json (deploy build) and usable
    const roads = await ev(() => ({ n: window.__world!.roads.nodeCount, mb: ((window as unknown as { __dataBytes?: number }).__dataBytes ?? 0) / 1048576 }));
    expect(roads.n).toBeGreaterThan(100_000);
    console.log(`dados baixados: ${roads.mb.toFixed(1)} MB, nós de estrada: ${roads.n}`);
    expect(await ev(() => window.__game?.state.meta.playerCountryId)).toBe('BRA');
    await noHScroll(page, 'HUD');
    await checkTargets(page, '.sidebar .sb-item, .topbar .btn');
    await ev(() => window.__game!.dispatch({ type: 'game.pause', country: 'BRA' }));
    await page.waitForTimeout(1500);
    if (!landscape) await page.screenshot({ path: 'docs/assets/mobile-hud.png', ...SHOT });

    // panels open as sheets and close
    for (const id of ['budget', 'economy', 'forces']) {
      await page.getByTestId(`sb-${id}`).tap();
      const win = page.getByTestId(`win-${id}`);
      await expect(win).toBeVisible();
      const box = (await win.boundingBox())!;
      const vp = page.viewportSize()!;
      if (landscape) expect(box.x + box.width).toBeGreaterThan(vp.width - 2);
      else { expect(box.x).toBeLessThanOrEqual(1); expect(box.width).toBeGreaterThanOrEqual(vp.width - 2); }
      expect(box.height).toBeLessThanOrEqual(landscape ? vp.height : vp.height * 0.86);
      await noHScroll(page, `painel ${id}`);
      if (id === 'economy') await page.screenshot({ path: landscape ? 'docs/assets/mobile-landscape.png' : 'docs/assets/mobile-panel.png', ...SHOT });
      await win.locator('.win-head button').first().tap();
      await expect(win).toHaveCount(0);
    }

    // touch selects a formation
    const f = await ev(() => {
      const g = window.__game!;
      const mil = (g.state as any).military;
      const fm = Object.values<any>(mil.forms).find((x) => x.c === 'BRA' && x.d === 'land');
      void window.__globe!.flyTo(fm.p[0], fm.p[1], { height: 600_000, durationS: 0.05 });
      return { id: fm.id as string, lon: fm.p[0] as number, lat: fm.p[1] as number };
    });
    await page.waitForTimeout(2500);
    const xy = await ev(() => null).then(() => page.evaluate(([lo, la]) => window.__globe!.toScreen(lo as number, la as number), [f.lon, f.lat] as const));
    expect(xy).not.toBeNull();
    await page.touchscreen.tap(xy!.x, xy!.y);
    await expect.poll(() => ev(() => window.__ui!.getState().selection?.kind), { timeout: 15_000 }).toBe('formation');
    await expect(page.getByTestId('formation-inspector')).toBeVisible();
    await noHScroll(page, 'inspetor de formação');
    // inspector is a bottom drawer
    const ib = (await page.getByTestId('inspector-formation').boundingBox())!;
    if (!landscape) expect(ib.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 2);
    await page.getByTestId('insp-close').tap();
    await expect.poll(() => ev(() => window.__ui!.getState().selection)).toBeNull();

    // gestures on the globe: pinch zooms, one-finger drag pans, long press = right click
    const cdp = await context.newCDPSession(page);
    const vp = page.viewportSize()!;
    const cx = vp.width / 2, cy = vp.height / 2;
    const h0 = await ev(() => window.__globe!.cameraHeight());
    await cdpTouch(cdp, 'touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]);
    for (let i = 1; i <= 8; i++) await cdpTouch(cdp, 'touchMove', [{ x: cx - 40 - i * 12, y: cy }, { x: cx + 40 + i * 12, y: cy }]);
    await cdpTouch(cdp, 'touchEnd', []);
    await page.waitForTimeout(1500);
    const h1 = await ev(() => window.__globe!.cameraHeight());
    expect(h1, 'pinça afasta os dedos = aproxima').toBeLessThan(h0 * 0.8);
    const c0 = await ev(() => window.__globe!.cameraState());
    await cdpTouch(cdp, 'touchStart', [{ x: cx, y: cy }]);
    for (let i = 1; i <= 8; i++) await cdpTouch(cdp, 'touchMove', [{ x: cx + i * 14, y: cy + i * 6 }]);
    await cdpTouch(cdp, 'touchEnd', []);
    await page.waitForTimeout(1200);
    const c1 = await ev(() => window.__globe!.cameraState());
    expect(Math.abs(c1.lon - c0.lon) + Math.abs(c1.lat - c0.lat), 'arrastar move o globo').toBeGreaterThan(0.01);
    await ev(() => { (window as any).__rc = 0; window.__globe!.on('rightclick', () => { (window as any).__rc++; }); });
    await cdpTouch(cdp, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(700);
    await cdpTouch(cdp, 'touchEnd', []);
    expect(await ev(() => (window as any).__rc)).toBe(1);
    // box mode: one-finger drag draws a box instead of spinning the globe
    await page.getByTestId('btn-boxmode').tap();
    expect(await ev(() => window.__globe!.isBoxMode())).toBe(true);
    const c2 = await ev(() => window.__globe!.cameraState());
    await ev(() => { (window as any).__box = 0; window.__globe!.on('box', () => { (window as any).__box++; }); });
    await cdpTouch(cdp, 'touchStart', [{ x: cx - 80, y: cy - 60 }]);
    for (let i = 1; i <= 6; i++) await cdpTouch(cdp, 'touchMove', [{ x: cx - 80 + i * 25, y: cy - 60 + i * 18 }]);
    await cdpTouch(cdp, 'touchEnd', []);
    await page.waitForTimeout(500);
    const c3 = await ev(() => window.__globe!.cameraState());
    expect(await ev(() => (window as any).__box)).toBe(1);
    expect(Math.abs(c3.lon - c2.lon) + Math.abs(c3.lat - c2.lat)).toBeLessThan(0.001);
    await page.getByTestId('btn-boxmode').tap();

    // road movement still works with the reassembled graph
    const mv = await ev(() => {
      const g = window.__game!;
      const mil = (g.state as any).military;
      const fm = Object.values<any>(mil.forms).find((x) => x.c === 'BRA' && x.d === 'land' && !x.cr)!;
      const r = g.dispatch({ type: 'mil.move', country: 'BRA', formations: [fm.id], to: [fm.p[0] + 0.5, fm.p[1] + 0.3] } as never);
      const p0 = [...fm.p];
      for (let i = 0; i < 24; i++) g.advanceHours(1);
      return { ok: (r as any).ok, order: fm.od?.k, d: Math.hypot(fm.p[0] - p0[0], fm.p[1] - p0[1]) };
    });
    console.log('mover formação:', JSON.stringify(mv));
    expect(mv.d).toBeGreaterThan(0);

    // tactical HUD
    await ev(() => {
      const g = window.__game!;
      g.dispatch({ type: 'dip.declareWar', country: 'BRA', target: 'ARG' } as never);
      const mil = (g.state as any).military;
      const mine = Object.values<any>(mil.forms).find((x) => x.c === 'BRA' && x.d === 'land' && !x.cr);
      const foe = Object.values<any>(mil.forms).find((x) => x.c === 'ARG' && x.d === 'land' && !x.cr);
      foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02]; foe.rt = null; foe.od = { k: 'idle' };
      for (let i = 0; i < 240 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
    });
    expect(await ev(() => window.__game!.ctx.api.military.battles().length)).toBeGreaterThan(0);
    const bid = await ev(() => window.__game!.ctx.api.military.battles()[0].id as string);
    await ev(() => { window.__ui!.getState().select({ kind: 'battle', id: (window.__game!.ctx.api.military.battles()[0].id as string) }); });
    await expect(page.getByTestId('battle-inspector')).toBeVisible();
    await noHScroll(page, 'inspetor de batalha');
    await page.getByTestId('btn-tac-start').tap();
    await expect(page.getByTestId('tac-top')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('tac-ready').tap();
    await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase)).toBe('combat');
    await ev(() => { for (let i = 0; i < 40; i++) window.__game!.ctx.api.tactical.advance(0.5); });
    await noHScroll(page, 'HUD tático');
    await checkTargets(page, '.tac-bar .btn, .tac-top .btn, .sq-card', 40);
    await page.getByTestId('tac-squads').locator('[data-testid^="sq-"]').first().tap();
    await page.getByTestId('tac-ord-hold').tap();
    await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.squads.some((s: any) => s.side === window.__game!.state.tactical.battle!.player && s.order === 'hold'))).toBe(true);
    await expect(page.getByTestId('tac-pause')).toBeInViewport();
    await expect(page.getByTestId('tac-speed-2')).toBeInViewport();
    await page.waitForTimeout(1200);
    if (!landscape) await page.screenshot({ path: 'docs/assets/mobile-tactical.png', ...SHOT });
    else await page.screenshot({ path: 'docs/assets/mobile-landscape-tactical.png', ...SHOT });
    void bid; void tag;
    expect(errors).toEqual([]);
    await context.close();
  });
}
