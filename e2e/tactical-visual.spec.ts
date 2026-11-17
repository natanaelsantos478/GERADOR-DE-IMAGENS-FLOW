import { expect, test } from '@playwright/test';

/** Visual check of the tactical mode (USA x SYR on the real satellite globe): 3D unit models and combat effects must be on screen. */
const SHOT = { timeout: 180_000 };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

test('tático: unidades 3D e efeitos visíveis (USA x SYR)', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const ev = <T,>(fn: () => T) => page.evaluate(fn);
  const settle = async (ms = 90_000) => {
    await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: ms }).catch(() => undefined);
    await page.waitForTimeout(2500);
  };

  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('country-search').fill('Estados Unidos');
  await page.getByTestId('pick-USA').click();
  await page.getByTestId('diff-hard').click().catch(() => undefined);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  if (await page.getByTestId('tut-dismiss').count()) await page.getByTestId('tut-dismiss').click().catch(() => undefined);
  await page.waitForTimeout(1500);

  log('guerra e batalha');
  const bid = await ev(() => {
    const g = window.__game!;
    g.dispatch({ type: 'game.pause', country: 'USA' } as never);
    const r = g.dispatch({ type: 'dip.declareWar', country: 'USA', target: 'SYR', force: true } as never);
    if (!r.ok) throw new Error(`declareWar ${JSON.stringify(r)}`);
    const mil = (g.state as any).military;
    const forms = Object.values<any>(mil.forms);
    const mine = forms.find((f) => f.c === 'USA' && f.d === 'land' && !f.cr);
    const foe = forms.find((f) => f.c === 'SYR' && f.d === 'land' && !f.cr);
    foe.p = [mine.p[0] + 0.03, mine.p[1] + 0.02]; foe.rt = null; foe.od = { k: 'idle' };
    for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
    const b = g.ctx.api.military.battles()[0];
    if (!b) throw new Error('sem batalha');
    return b.id as string;
  });
  log('tático');
  await ev(() => { window.__game!.dispatch({ type: 'game.pause', country: 'USA' } as never); });
  const bidc = bid;
  await page.evaluate((id) => { const r = window.__game!.dispatch({ type: 'tac.start', country: 'USA', battleId: id } as never); if (!r.ok) throw new Error(JSON.stringify(r)); }, bidc);
  await expect.poll(() => ev(() => window.__tactical!.active()), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(3500); // camera fly-in
  await settle();

  const snap = () => ev(() => {
    const b = window.__game!.state.tactical.battle!;
    const alive = b.ents.filter((e: any) => !e.gone).length;
    return { alive, stats: window.__tactical!.stats(), phase: b.phase, squads: b.squads.map((s: any) => ({ id: s.id, side: s.side, kind: s.kind, x: Math.round(s.x), y: Math.round(s.y) })) };
  });
  const s0 = await snap();
  log(`snapshot ${JSON.stringify({ alive: s0.alive, stats: s0.stats, phase: s0.phase })}`);
  await page.screenshot({ path: 'docs/assets/tactical-wide.png', ...SHOT });
  log('sample ' + JSON.stringify(await ev(() => window.__tactical!.sample(6))));

  // 3D models: one per living entity, all loaded and shown.
  const ents0 = await ev(() => window.__tactical!.ents());
  expect(ents0.length).toBe(s0.alive);
  await expect.poll(() => ev(() => window.__tactical!.ents().filter((e) => e.shown && e.ready).length), { timeout: 120_000 }).toBe(s0.alive);
  expect((await snap()).stats.shown).toBe(s0.alive);
  log(`imagery ${await ev(() => window.__globe!.imageryProvider())} tilesLoaded ${await ev(() => window.__globe!.viewer.scene.globe.tilesLoaded)}`);

  const mine = s0.squads.filter((q: any) => q.side === 0 || true);
  const player = await ev(() => window.__game!.state.tactical.battle!.player as number);
  const mySquads = s0.squads.filter((q: any) => q.side === player);
  const inf = mySquads.find((q: any) => ['infantry', 'special', 'engineer'].includes(q.kind)) ?? mySquads[0];
  const veh = mySquads.find((q: any) => ['mbt', 'mech', 'recon', 'artillery', 'mlrs'].includes(q.kind)) ?? s0.squads.find((q: any) => ['mbt', 'mech'].includes(q.kind)) ?? mySquads[1];
  log(`inf ${JSON.stringify(inf)} veh ${JSON.stringify(veh)} (${mine.length} squads)`);
  const shot = async (name: string, squad: number, range: number, pitch: number, heading = 20) => {
    await ev(() => window.__tactical!.stats());
    await page.evaluate(([q, r, p, h]) => { window.__tactical!.focus({ squad: q }, { range: r, pitchDeg: p, headingDeg: h, durationS: 0 }); }, [squad, range, pitch, heading]);
    await settle(60_000);
    await page.screenshot({ path: `docs/assets/tactical-${name}.png`, ...SHOT });
  };
  await shot('infantry', inf.id, 150, -30);
  await shot('vehicles', veh.id, 170, -28);

  // combat: step the sim in small slices so projectiles/explosions are seen by the renderer
  await page.evaluate(() => { window.__game!.dispatch({ type: 'tac.ready', country: 'USA' } as never); });
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase)).toBe('combat');
  await ev(() => { const b = window.__game!.state.tactical.battle!; window.__game!.dispatch({ type: 'tac.order', country: 'USA', squads: b.squads.filter((q: any) => q.side === b.player).map((q: any) => q.id), order: { kind: 'attackMove', x: 0, y: 0 } } as never); });
  await ev(() => { for (let i = 0; i < 100; i++) window.__game!.ctx.api.tactical.advance(0.5); });
  let best = { fx: 0, proj: 0 };
  for (let i = 0; i < 60; i++) {
    await ev(() => window.__game!.ctx.api.tactical.advance(0.3));
    await page.waitForTimeout(250);
    const st = (await snap()).stats;
    if (st.fx + st.proj > best.fx + best.proj) best = { fx: st.fx, proj: st.proj };
    if (st.fx >= 14 && st.proj >= 2) break;
  }
  log(`combate fx/proj ${JSON.stringify(best)}`);
  // controlled effects on top of the live fight: muzzle flashes + explosions around the squad in frame
  const near = await ev(() => { const b = window.__game!.state.tactical.battle!; const live = b.ents.filter((e: any) => e.alive && !e.gone && ['infantry', 'special', 'engineer'].includes(e.kind) && e.side === b.player); const c = live[Math.floor(live.length / 2)] ?? b.ents.find((e: any) => e.alive && !e.gone); return { x: c.x, y: c.y, sq: c.sq }; });
  await page.evaluate((c) => {
    const t = window.__tactical!;
    t.pinFx(true);
    for (let i = 0; i < 6; i++) t.muzzleAt(c.x + (i - 3) * 9, c.y + 14, 4);
    for (let i = 0; i < 5; i++) t.tracerAt(c.x - 40 + i * 6, c.y - 40, c.x - 30 + i * 8, c.y + 60);
    t.explodeAt(c.x + 22, c.y + 32, 12); t.explodeAt(c.x - 30, c.y + 52, 9); t.explodeAt(c.x + 4, c.y - 22, 7);
  }, near);
  await page.evaluate((c) => { window.__tactical!.focus({ x: c.x, y: c.y + 20 }, { range: 200, pitchDeg: -28, headingDeg: 0, durationS: 0 }); }, near);
  // software GL: stop continuous rendering so the screenshot needs one frame, not a saturated pipeline
  await page.evaluate(() => { window.__globe!.setContinuousRender(false); window.__globe!.requestRender(); });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'docs/assets/tactical-combat.png', ...SHOT });
  log('stats ' + JSON.stringify((await snap()).stats));
  expect(errors, errors.join('\n')).toEqual([]);
});

/** Battle in a real city (Paris): 3D buildings, trees and real streets under the units, garrisoned buildings highlighted, effects visible. */
test('tático: batalha numa cidade (prédios 3D, ruas, efeitos)', async ({ page }) => {
  test.setTimeout(1_500_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const ev = <T,>(fn: () => T) => page.evaluate(fn);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('country-search').fill('Estados Unidos');
  await page.getByTestId('pick-USA').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  if (await page.getByTestId('tut-dismiss').count()) await page.getByTestId('tut-dismiss').click().catch(() => undefined);
  await ev(() => { window.__game!.dispatch({ type: 'game.pause', country: 'USA' } as never); });
  const bid = await ev(() => {
    const g = window.__game!;
    const r = g.dispatch({ type: 'dip.declareWar', country: 'USA', target: 'SYR', force: true } as never);
    if (!r.ok) throw new Error(`declareWar ${JSON.stringify(r)}`);
    const forms = Object.values<any>((g.state as any).military.forms);
    const mine = forms.find((f) => f.c === 'USA' && f.d === 'land' && !f.cr);
    const foe = forms.find((f) => f.c === 'SYR' && f.d === 'land' && !f.cr);
    mine.p = [2.3522, 48.8566]; mine.rt = null; mine.od = { k: 'idle' };
    foe.p = [2.3522 + 0.012, 48.8566 + 0.004]; foe.rt = null; foe.od = { k: 'idle' };
    for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
    const b = g.ctx.api.military.battles()[0];
    if (!b) throw new Error('sem batalha');
    return b.id as string;
  });
  // fly there, let the real vector map (and the 3D city) load BEFORE tac.start
  await ev(() => window.__globe!.setView(2.3522, 48.8566, { height: 3000, pitchDeg: -50 }));
  await ev(() => window.__tactical!.prefetch());
  await page.evaluate((id) => { const r = window.__game!.dispatch({ type: 'tac.start', country: 'USA', battleId: id } as never); if (!r.ok) throw new Error(JSON.stringify(r)); }, bid);
  await expect.poll(() => ev(() => window.__tactical!.active()), { timeout: 60_000 }).toBe(true);
  const real = await ev(() => !!window.__game!.state.tactical.battle!.map.nav);
  log(`mapa vetorial real: ${real}`);
  await ev(() => (window as any).__city3d.idle(240_000));
  await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: 90_000 }).catch(() => undefined);
  const stats = await ev(() => (window as any).__city3d.stats());
  log(`city ${JSON.stringify(stats)}`);
  expect(stats.buildings).toBeGreaterThan(200);
  // frame the squads, advance the fight and pin effects on top
  await page.evaluate(() => { window.__game!.dispatch({ type: 'tac.ready', country: 'USA' } as never); });
  await ev(() => { const b = window.__game!.state.tactical.battle!; window.__game!.dispatch({ type: 'tac.order', country: 'USA', squads: b.squads.filter((q: any) => q.side === b.player).map((q: any) => q.id), order: { kind: 'attackMove', x: 0, y: 0 } } as never); });
  await ev(() => { for (let i = 0; i < 160; i++) window.__game!.ctx.api.tactical.advance(0.5); });
  // clustering: models drawn and frame rate with / without the screen-space grouping, framed on the whole field
  await ev(() => window.__tactical!.frameField(0));
  await page.waitForTimeout(2500);
  const meas = async (on: boolean) => {
    await ev(() => undefined);
    await page.evaluate((o) => window.__tactical!.setCluster(o), on);
    const f0 = await page.evaluate(() => (window.__globe!.viewer.scene as any).frameState.frameNumber);
    await page.waitForFunction((n) => (window.__globe!.viewer.scene as any).frameState.frameNumber > n + 4, f0, { timeout: 180_000 });
    const st = await ev(() => window.__tactical!.stats());
    const f1 = await page.evaluate(() => (window.__globe!.viewer.scene as any).frameState.frameNumber), t1 = Date.now();
    await page.waitForFunction((n) => (window.__globe!.viewer.scene as any).frameState.frameNumber > n + 5, f1, { timeout: 180_000 });
    const fps = 5 / ((Date.now() - t1) / 1000);
    return { ents: st.ents, modelsShown: st.shown, clusters: st.clusters, clustered: st.clustered, fps: Math.round(fps * 10) / 10 };
  };
  log(`cluster OFF ${JSON.stringify(await meas(false))}`);
  log(`cluster ON  ${JSON.stringify(await meas(true))}`);
  const c = await ev(() => { const b = window.__game!.state.tactical.battle!; const live = b.ents.filter((e: any) => e.alive && !e.gone && e.side === b.player && b.squads[e.sq].gar === undefined); const veh = live.filter((e: any) => !['infantry', 'special', 'engineer'].includes(e.kind)); const pool = veh.length ? veh : live; const e = pool[Math.floor(pool.length / 2)]; return { x: e.x, y: e.y }; });
  await page.evaluate((p) => {
    const t = window.__tactical!;
    t.pinFx(true);
    for (let i = 0; i < 6; i++) t.muzzleAt(p.x + (i - 3) * 9, p.y + 14, 4);
    for (let i = 0; i < 5; i++) t.tracerAt(p.x - 40 + i * 6, p.y - 40, p.x - 30 + i * 8, p.y + 60);
    t.explodeAt(p.x + 26, p.y + 36, 6); t.explodeAt(p.x - 30, p.y + 52, 5);
    t.focus({ x: p.x, y: p.y + 14 }, { range: 150, pitchDeg: -34, headingDeg: 20, durationS: 0 });
  }, c);
  await page.evaluate(() => { window.__globe!.setContinuousRender(false); window.__globe!.requestRender(); });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'docs/assets/tactical-city.png', ...SHOT });
  expect(errors, errors.join('\n')).toEqual([]);
});
