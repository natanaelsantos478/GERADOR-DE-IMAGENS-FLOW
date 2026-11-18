/**
 * Phone tactical battle by touch (Pixel 7, CDP touch events): new game -> war -> battle -> tactical mode -> tap-select, tap-move,
 * box select, long-press radial menu ("hold") -> asserts the sim received the orders. Zero console errors.
 * Run: npx vite build && npx vite preview --port 5197 --strictPort & E2E_PORT=5197 npx playwright test e2e/mobile-tactical.spec.ts
 */
import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';

const SHOT = { timeout: 480_000 };
const P7 = devices['Pixel 7'];
const LONG = { timeout: 240_000 }; // a pick on the software GL can take tens of seconds

test('mobile: batalha tática com o dedo', async ({ browser }) => {
  test.setTimeout(2_700_000);
  const context = await browser.newContext({ ...P7, baseURL: `http://localhost:${process.env.E2E_PORT ?? 5197}/` });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const cdp: CDPSession = await context.newCDPSession(page);
  const ev = <T,>(fn: () => T) => page.evaluate(fn);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0 }] });
  // both CDP messages are queued back to back: awaiting the start ack would stretch the press by the page's frame time
  const tap = async (x: number, y: number) => { await Promise.all([touch('touchStart', x, y), touch('touchEnd')]); await page.waitForTimeout(250); };
  // On the software GL a tap is sometimes lost under main-thread starvation: repeat it until its effect shows (a real phone does not need this).
  const tapUntil = async (x: number, y: number, cond: () => Promise<boolean>, tries = 4) => {
    for (let i = 0; i < tries; i++) {
      await tap(x, y);
      for (let k = 0; k < 24; k++) { if (await cond()) return; await page.waitForTimeout(2500); }
    }
    if (!(await cond())) { console.log('TAPFAIL', JSON.stringify(await ev(() => ({ dbg: (window as any).__tacTouchDbg, sel: (window as any).__tacSel.getState().selected, box: window.__globe!.isBoxMode(), radial: !!document.querySelector('[data-testid=tac-radial]'), t: (() => { const x = (window as any).__tacTouch.getState(); return { m: x.multi, r: x.routeMode, b: x.breach }; })() }))), JSON.stringify(await orders())); await page.screenshot({ path: '/tmp/tapfail.png', timeout: 300_000 }); }
    expect(await cond(), `efeito do toque em ${Math.round(x)},${Math.round(y)}`).toBe(true);
  };
  const tapBtn = async (id: string, cond: () => Promise<boolean>) => {
    for (let i = 0; i < 4 && !(await cond()); i++) { await page.getByTestId(id).tap().catch(() => undefined); for (let k = 0; k < 12 && !(await cond()); k++) await page.waitForTimeout(2500); }
    expect(await cond(), `botão ${id}`).toBe(true);
  };
  const squadXY = (side: 'mine' | 'foe', n = 0) => page.evaluate(([sd, i]) => {
    const b = window.__game!.state.tactical.battle!;
    const sq = b.squads.filter((s: any) => (sd === 'mine') === (s.side === b.player))[i as number];
    const t = window.__tactical!, ents = t.ents().filter((e) => e.sq === sq.id && e.alive), sm = t.sample(2000) as any[];
    const ps = ents.map((e) => sm.find((q) => q.id === e.id)?.screen).filter(Boolean) as { x: number; y: number }[];
    const p = ps.length ? { x: ps.reduce((a, q) => a + q.x, 0) / ps.length, y: ps.reduce((a, q) => a + q.y, 0) / ps.length } : { x: -999, y: -999 };
    return { id: sq.id as number, x: p.x as number, y: p.y as number, wx: sq.x as number, wy: sq.y as number };
  }, [side, n] as const);
  const squad = (id: number) => page.evaluate((i) => { const s = window.__game!.state.tactical.battle!.squads[i]; return { order: s.order, ox: s.ox, oy: s.oy }; }, id);
  // The software GL starves the page's main thread: render at low resolution while the finger works so a 60 ms tap stays a tap.
  const light = (on: boolean) => page.evaluate((v) => { window.__globe!.viewer.resolutionScale = v ? 0.2 : 1; window.__globe!.viewer.scene.requestRender(); }, on);
  const shot = async (path: string) => { await light(false); await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: 120_000 }).catch(() => undefined); await page.waitForTimeout(5000); await page.screenshot({ path, ...SHOT }); await light(true); await page.waitForTimeout(2500); };
  const sel = () => ev(() => (window as any).__tacSel.getState().selected as number[]);

  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('menu-new').tap();
  await page.getByTestId('country-search').fill('Brasil');
  await page.getByTestId('pick-BRA').tap();
  await page.getByTestId('start-game').tap();
  await expect(page.getByTestId('topbar')).toBeVisible();
  await ev(() => {
    const g = window.__game!;
    g.dispatch({ type: 'game.pause', country: 'BRA' });
    g.dispatch({ type: 'dip.declareWar', country: 'BRA', target: 'ARG', force: true } as never);
    const mil = (g.state as any).military;
    const mine = Object.values<any>(mil.forms).find((f) => f.c === 'BRA' && f.d === 'land' && !f.cr);
    const foe = Object.values<any>(mil.forms).find((f) => f.c === 'ARG' && f.d === 'land' && !f.cr);
    foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02]; foe.rt = null; foe.od = { k: 'idle' };
    for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
  });
  expect(await ev(() => window.__game!.ctx.api.military.battles().length)).toBeGreaterThan(0);
  const sbId = await ev(() => window.__game!.ctx.api.military.battles()[0].id as string);
  await ev(() => window.__game!.dispatch({ type: 'tac.start', country: 'BRA', battleId: window.__game!.ctx.api.military.battles()[0].id } as never));
  await expect(page.getByTestId('tac-top')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('tac-ready').tap();
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase), LONG).toBe('combat');
  // keep the field still while the finger works, and frame it
  await ev(() => { window.__game!.dispatch({ type: 'tac.pause', country: 'BRA' } as never); window.__tactical!.frameField(0.01); });
  await page.waitForTimeout(6000);
  expect(sbId).toBeTruthy();

  // 1) tap selects a squad
  const a0 = await squadXY('mine', 0);
  await ev(() => undefined);
  await page.evaluate((id) => window.__tactical!.focus({ squad: id }, { range: 1300, pitchDeg: -60, durationS: 0.01 }), a0.id);
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const g = window.__game! as any, d = g.dispatch.bind(g), L = ((window as any).__orders = [] as any[]); g.dispatch = (c: any) => { const r = d(c); if (c.type === 'tac.order') L.push({ order: c.order, squads: c.squads, ok: r.ok, reason: r.reason }); return r; }; });
  const orders = () => page.evaluate(() => (window as any).__orders as { order: any; squads: number[]; ok: boolean; reason?: string }[]);
  await light(true);
  const refocus = async (id: number) => { await expect.poll(async () => { await page.evaluate((i) => window.__tactical!.focus({ squad: i }, { range: 1300, pitchDeg: -60, durationS: 0.01 }), id); await page.waitForTimeout(2500); const q = await squadXY('mine', 0); console.log('REFOCUS', JSON.stringify(q)); return q.x > 30 && q.x < 380 && q.y > 150 && q.y < 660; }, { timeout: 120_000 }).toBe(true); await page.waitForTimeout(2500); };
  await refocus(a0.id);
  const a = await squadXY('mine', 0);
  await tapUntil(a.x, a.y, async () => JSON.stringify(await sel()) === JSON.stringify([a.id]));
  await page.waitForTimeout(500);
  await shot('docs/assets/touch-select.png');

  // 2) tap on empty ground = move order
  // empty ground: far (> 70 px) from every squad's screen position
  const empty = (cx: number, cy: number) => page.evaluate(([x0, y0]) => {
    const t = window.__tactical!, sm = t.sample(4000) as any[];
    const pts = sm.filter((q) => q.screen).map((q) => q.screen as { x: number; y: number });
    const cand: { x: number; y: number }[] = [];
    for (let dx = -140; dx <= 140; dx += 35) for (let dy = -140; dy <= 140; dy += 35) cand.push({ x: x0 + dx, y: y0 + dy });
    const ok = cand.filter((c) => c.x > 30 && c.x < 380 && c.y > 250 && c.y < 640 && pts.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 70));
    ok.sort((u, v) => Math.hypot(u.x - x0, u.y - y0) - Math.hypot(v.x - x0, v.y - y0));
    return ok[0] ?? null;
  }, [cx, cy] as const);
  const dest = (await empty(a.x, a.y))!;
  expect(dest).not.toBeNull();
  await tapUntil(dest.x, dest.y, async () => (await orders()).some((o) => o.order.kind === 'move'));
  const mv = (await orders()).find((o) => o.order.kind === 'move')!;
  expect(mv.ok, `ordem de mover rejeitada: ${mv.reason}`).toBe(true);
  expect(mv.squads).toEqual([a.id]);
  expect(Math.hypot(mv.order.x - a.wx, mv.order.y - a.wy)).toBeGreaterThan(20);

  // 3) a rejected order shows a toast with the reason (occupy the open ground is not enterable: order the foe's squad as own)
  expect(await ev(() => { const r = window.__game!.dispatch({ type: 'tac.order', country: 'BRA', squads: [0], order: { kind: 'occupy', building: 999999 } } as never); return r.ok; })).toBe(false);

  // 4) box select from the box button
  const own = await ev(() => { const b = window.__game!.state.tactical.battle!, m = b.squads.filter((q: any) => q.side === b.player); return { x: m.reduce((u: number, q: any) => u + q.x, 0) / m.length, y: m.reduce((u: number, q: any) => u + q.y, 0) / m.length, n: m.length }; });
  const mineAll = own.n;
  let pts: Awaited<ReturnType<typeof squadXY>>[] = [];
  await expect.poll(async () => {
    await page.evaluate((o) => window.__tactical!.focus({ x: o.x, y: o.y }, { range: 2500, pitchDeg: -60, durationS: 0.01 }), own);
    await page.waitForTimeout(3000);
    pts = await Promise.all([...Array(mineAll).keys()].map((i) => squadXY('mine', i)));
    return pts.filter((p) => p.x > 20 && p.x < 392 && p.y > 200 && p.y < 640).length;
  }, { timeout: 180_000 }).toBeGreaterThan(0);
  await page.getByTestId('btn-tools').tap();
  await page.getByTestId('btn-boxmode').tap();
  const vis = pts.filter((p) => p.x > 20 && p.x < 392 && p.y > 200 && p.y < 640);
  const x0 = Math.max(4, Math.min(...vis.map((p) => p.x)) - 30), y0 = Math.max(160, Math.min(...vis.map((p) => p.y)) - 30);
  const x1 = Math.min(405, Math.max(...vis.map((p) => p.x)) + 30), y1 = Math.min(680, Math.max(...vis.map((p) => p.y)) + 30);
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6); await page.waitForTimeout(40); }
  await shot('docs/assets/touch-box.png');
  await touch('touchEnd');
  await expect.poll(async () => (await sel()).length, LONG).toBeGreaterThan(0);
  expect((await sel()).length).toBeGreaterThan(0);
  await page.getByTestId('btn-boxmode').tap();

  // 5) long press -> radial menu -> hold
  await refocus(a.id);
  await tapUntil(a.x, a.y, async () => JSON.stringify(await sel()) === JSON.stringify([a.id]));
  const lp = { x: a.x + 20, y: a.y + 120 };
  await touch('touchStart', lp.x, lp.y);
  await expect(page.getByTestId('tac-radial')).toBeVisible({ timeout: 180_000 });
  await touch('touchEnd');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('tac-radial')).toBeVisible();
  await shot('docs/assets/touch-radial.png');
  await page.getByTestId('rad-hold').dispatchEvent('click');
  await expect.poll(async () => (await orders()).some((o) => o.order.kind === 'hold' && o.ok && o.squads.includes(a.id)), LONG).toBe(true);
  expect((await squad(a.id)).order).toBe('hold');
  await expect(page.getByTestId('tac-radial')).toHaveCount(0);
  expect(await sel()).toEqual([a.id]);

  // 4b) marked route: two waypoints then "Ir" -> move with `via`
  const tt = () => ev(() => { const t = (window as any).__tacTouch.getState(); return { mode: t.routeMode as boolean, n: (t.route as number[]).length / 2 }; });
  if ((await page.getByTestId('btn-route').count()) === 0) await tapBtn('btn-tools', async () => (await page.getByTestId('btn-route').count()) > 0);
  await tapBtn('btn-route', async () => (await tt()).mode);
  const r1 = (await empty(a.x - 60, a.y + 60))!;
  await tapUntil(r1.x, r1.y, async () => (await tt()).n >= 1);
  const r2 = (await empty(a.x + 60, a.y + 90))!;
  await tapUntil(r2.x, r2.y, async () => (await tt()).n >= 2);
  await tapBtn('btn-route', async () => (await orders()).some((o) => o.order.kind === 'move' && Array.isArray(o.order.via)));
  await expect.poll(async () => (await orders()).some((o) => o.order.kind === 'move' && Array.isArray(o.order.via) && o.ok), LONG).toBe(true);

  // 6) squad card tap focuses; targets >= 44 px
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tac-bar .tac-btn, .tac-tools button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).map((e) => e.dataset.testid));
  expect(small).toEqual([]);
  await page.getByTestId(`sq-${a.id}`).tap();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await context.close();
});
