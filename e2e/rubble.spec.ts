import { expect, test } from '@playwright/test';

/**
 * Destructible buildings in the city 3D: a real battle in Paris, artillery on one building until it falls.
 * Photos: standing (rubble-before), mid-collapse with dust (rubble-collapse), rubble heap (rubble-after), marked route (rubble-route).
 */
const SHOT = { timeout: 180_000 };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

test('tático: prédio destruído por artilharia desmorona e vira escombros', async ({ page }) => {
  test.setTimeout(2_400_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const ev = <T,>(fn: () => T) => page.evaluate(fn);
  const frames = async (n: number) => {
    const f0 = await page.evaluate(() => (window.__globe!.viewer.scene as any).frameState.frameNumber);
    await page.waitForFunction((k) => (window.__globe!.viewer.scene as any).frameState.frameNumber > k + 3, f0 + n - 3, { timeout: 240_000 });
  };
  const shot = async (path: string) => {
    // software GL: one frame for the capture, not a saturated pipeline
    await ev(() => { window.__globe!.setContinuousRender(false); window.__globe!.requestRender(); });
    await page.waitForTimeout(5000);
    await page.screenshot({ path, ...SHOT });
    await ev(() => window.__globe!.setContinuousRender(true));
  };
  const settle = async () => {
    await ev(() => (window as any).__city3d.idle(240_000));
    await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: 120_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
  };

  await page.addInitScript(() => { (window as unknown as { __vectorTimeoutMs: number }).__vectorTimeoutMs = 400_000; }); // slow links: let the real vector map finish
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
  await ev(() => window.__globe!.setView(2.3522, 48.8566, { height: 3000, pitchDeg: -50 }));
  await ev(() => window.__tactical!.prefetch());
  await page.evaluate((id) => { const r = window.__game!.dispatch({ type: 'tac.start', country: 'USA', battleId: id } as never); if (!r.ok) throw new Error(JSON.stringify(r)); }, bid);
  await expect.poll(() => ev(() => window.__tactical!.active()), { timeout: 60_000 }).toBe(true);
  expect(await ev(() => !!window.__game!.state.tactical.battle!.map.nav), 'mapa vetorial real').toBe(true);
  await settle();
  await page.evaluate(() => { window.__game!.dispatch({ type: 'tac.ready', country: 'USA' } as never); });
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase)).toBe('combat');
  // nobody shoots or manoeuvres on their own: the only damage is the artillery fired below (the sim clock keeps running; the test adds slices of it)
  await ev(() => { const b = window.__game!.state.tactical.battle!; b.noAi = true; for (const q of b.squads) q.fireFree = false; });

  // target: a small plain building (house / low block) close to the middle of the field
  const target = await ev(() => {
    const b = window.__game!.state.tactical.battle!;
    const bl = (b.map.nav!.buildings as any[]).filter((x) => x.area >= 120 && x.area <= 420 && x.h >= 5 && x.h <= 14 && !x.kind).sort((u, v) => Math.hypot(u.cx, u.cy) - Math.hypot(v.cx, v.cy));
    const t = bl[0];
    return { id: t.id as number, x: t.cx as number, y: t.cy as number, area: t.area as number, h: t.h as number };
  });
  log(`alvo ${JSON.stringify(target)}`);
  // bring two of the player's squads to the street next to the target so the photos frame the building AND units (150-300 m camera)
  const near = await page.evaluate(([x, y]) => {
    const g = window.__game!, b = g.state.tactical.battle!;
    const mine = b.squads.filter((q) => q.side === b.player).slice(0, 2);
    const pts = [[x - 50, y - 38], [x - 22, y - 62]];
    mine.forEach((q, i) => {
      q.x = pts[i][0]; q.y = pts[i][1]; q.ox = q.x; q.oy = q.y; q.path = []; q.pi = 0; q.order = 'idle';
      b.ents.filter((e) => e.sq === q.id && !e.gone).forEach((e, k) => { e.x = q.x + ((k % 4) - 1.5) * 5; e.y = q.y + Math.floor(k / 4) * 5; });
    });
    for (let i = 0; i < 20; i++) g.ctx.api.tactical.advance(0.25);
    return mine.map((q) => ({ id: q.id, x: Math.round(q.x), y: Math.round(q.y) }));
  }, [target.x, target.y] as [number, number]);
  log(`esquadrões perto do alvo: ${JSON.stringify(near)}`);
  const cx = (target.x + near.reduce((a, q) => a + q.x, 0)) / (1 + near.length), cy = (target.y + near.reduce((a, q) => a + q.y, 0)) / (1 + near.length);
  const look = async (range: number, pitch: number, heading: number) => {
    await page.evaluate(([x, y, r, p, h]) => { window.__tactical!.focus({ x, y }, { range: r, pitchDeg: p, headingDeg: h, durationS: 0 }); }, [cx, cy, range, pitch, heading] as [number, number, number, number, number]);
    await settle();
    const h = await ev(() => window.__globe!.cameraHeight());
    expect(h, 'câmera acima de 70 m (árvores somem abaixo disso)').toBeGreaterThan(70);
    return h;
  };
  const camH = await look(250, -38, 25);
  const before = await ev(() => (window as any).__city3d.stats());
  log(`antes: câmera ${Math.round(camH)} m, prédios ${before.buildings}, ruínas ${JSON.stringify(await ev(() => (window as any).__city3d.ruinStats()))}`);
  expect(before.buildings).toBeGreaterThan(100);
  await shot('docs/assets/rubble-before.png');

  // artillery on the building until it falls (the real support mechanism: 8 shells per salvo, 25 s delay, 70 m scatter; a stock of salvos is given when the scenario has none).
  // The sim is advanced in slices and stops the moment the building falls, so the render sees the first instants of the collapse.
  await page.evaluate((id) => { (window as any).__rubTarget = id; }, target.id);
  const res = await page.evaluate(([id, x, y]) => {
    const g = window.__game!, B = () => g.state.tactical.battle!, side = B().player as 0 | 1;
    B().support[side].artillery = Math.max(B().support[side].artillery, 80);
    const fell = () => (B().map.rub ?? []).some((r) => r.id === id);
    let salvos = 0;
    for (let guard = 0; guard < 12 && !fell(); guard++) {
      if (!B().pend.length) for (let k = 0; k < 30; k++) { const r = g.dispatch({ type: 'tac.order', country: 'USA', squads: [], order: { kind: 'artillery', x, y } } as never); if (!r.ok) throw new Error(JSON.stringify(r)); salvos++; }
      for (let i = 0; i < 480 && !fell(); i++) g.ctx.api.tactical.advance(0.25);
    }
    const bt = B(); return { salvos, fell: fell(), t: bt.t, hp: bt.bldHp?.[id] ?? null, left: bt.support[side].artillery, phase: bt.phase, ents: bt.ents.filter((e) => e.alive).length };
  }, [target.id, target.x, target.y] as [number, number, number]);
  const strikes = res.salvos;
  expect(res.fell, `prédio não caiu após ${strikes} salvas: ${JSON.stringify(res)}`).toBe(true);
  const rec = await ev(() => (window.__game!.state.tactical.battle!.map.rub as any[]).find((r: any) => r.id === (window as any).__rubTarget));
  expect(rec.m).toBeTruthy();
  log(`caiu após ${strikes} salvas: ${JSON.stringify(rec)} (b.t ${res.t})`);

  // mid-collapse: let the layer see the first seconds of battle time (dust, falling blocks), freeze the animation at 50 %
  for (let i = 0; i < 4; i++) { await ev(() => window.__game!.ctx.api.tactical.advance(0.25)); await frames(2); }
  await ev(() => (window as any).__city3d.pinRuins(0.5));
  await expect.poll(() => ev(() => (window as any).__city3d.ruinStats().animating), { timeout: 120_000 }).toBeGreaterThan(0);
  await ev(() => window.__tactical!.holdFx(true));
  await frames(4);
  const mid = await ev(() => (window as any).__city3d.ruinStats());
  log(`meio da queda: ${JSON.stringify(mid)} fx ${JSON.stringify(await ev(() => window.__tactical!.stats()))}`);
  await shot('docs/assets/rubble-collapse.png');

  // finished: the rubble heap replaces the building
  await ev(() => { (window as any).__city3d.pinRuins(null); window.__tactical!.holdFx(false); });
  for (let i = 0; i < 24; i++) await ev(() => window.__game!.ctx.api.tactical.advance(0.25));
  await expect.poll(() => ev(() => { const s = (window as any).__city3d.ruinStats(); return s.done >= 1 && s.animating === 0; }), { timeout: 180_000 }).toBe(true);
  await page.waitForTimeout(6000); // dust fades
  await settle();
  const after = await ev(() => (window as any).__city3d.stats());
  const rs = await ev(() => (window as any).__city3d.ruinStats());
  log(`depois: prédios ${after.buildings} (antes ${before.buildings}) ruínas ${JSON.stringify(rs)}`);
  expect(after.buildings, 'o prédio em pé some da cidade 3D').toBeLessThan(before.buildings);
  expect(rs.tris).toBeGreaterThan(50);
  expect(rs.tris, 'escombros baratos').toBeLessThan(2500);
  await shot('docs/assets/rubble-after.png');

  // marked route: dashed line with numbered points for a player squad
  const sq = await ev(() => { const b = window.__game!.state.tactical.battle!; const s = b.squads.find((q: any) => q.side === b.player && ['mech', 'mbt', 'recon', 'infantry'].includes(q.kind))!; return { id: s.id as number, x: s.x as number, y: s.y as number }; });
  await page.evaluate((s) => {
    const r = window.__game!.dispatch({ type: 'tac.order', country: 'USA', squads: [s.id], order: { kind: 'move', x: s.x + 220, y: s.y - 40, via: [s.x + 90, s.y + 60, s.x + 170, s.y + 90] } } as never);
    if (!r.ok) throw new Error(JSON.stringify(r));
    window.__tactical!.focus({ x: s.x + 110, y: s.y + 30 }, { range: 330, pitchDeg: -45, headingDeg: 0, durationS: 0 });
  }, sq);
  await settle();
  await frames(4);
  await shot('docs/assets/rubble-route.png');
  expect(errors, errors.join('\n')).toEqual([]);
});
