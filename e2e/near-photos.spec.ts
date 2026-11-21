import { expect, test } from '@playwright/test';
import fs from 'node:fs';

/**
 * Close-range battle photos of the detailed view (docs/assets/near-*.png) and the frame-time comparison (docs/assets/near-perf.json):
 *   near-tank.png      detailed tank, turret turned to its target, muzzle flash at the barrel
 *   near-soldiers.png  platoon running / shooting with the rifle clips
 *   near-grass.png     grass tufts on a field, camera at ground level
 *   near-lod-150m.png  a line of tanks receding past the 150 m limit: detailed models up to it, the generic ones beyond
 * Real game on the real satellite globe (Beauce plain, France), software GL: slow (about 30 min). The squads are placed next to each other
 * (state edit, as the other tactical specs do for the formations) so the fight happens within camera reach.
 * Slow, so it only runs on request: NEAR_PHOTOS=1 E2E_PORT=5190 npx playwright test e2e/near-photos.spec.ts   (against `npx vite --port 5190`; the perf step
 * switches the graphics profile through the dev server's module graph, so it needs the dev server).
 */
const LON = 1.65, LAT = 48.25;
/** Subset of the steps (tank,tread,vehicles,soldiers,grass,lod,perf), e.g. `NEAR_STEPS=soldiers,grass`; default all. */
const STEPS = new Set((process.env.NEAR_STEPS ?? 'tank,tread,vehicles,soldiers,grass,lod,perf').split(','));
const log = (m: string) => console.log(`[${new Date().toISOString().slice(14, 19)}] ${m}`);

test('batalha detalhada: fotos de perto (veículo, soldados, grama, troca de LOD) e custo por quadro', async ({ page }) => {
  test.skip(process.env.NEAR_PHOTOS !== '1', 'slow (about 45 min in software GL): NEAR_PHOTOS=1 to run');
  test.setTimeout(3_000_000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const ev = <T,>(fn: () => T) => page.evaluate(fn);
  const settle = async (ms = 100_000) => {
    await page.waitForFunction(() => window.__globe!.viewer.scene.globe.tilesLoaded, null, { timeout: ms }).catch(() => undefined);
    await page.waitForTimeout(2500);
  };
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 200_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('country-search').fill('Estados Unidos');
  await page.getByTestId('pick-USA').click();
  await page.getByTestId('diff-hard').click().catch(() => undefined);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('topbar')).toBeVisible();
  if (await page.getByTestId('tut-dismiss').count()) await page.getByTestId('tut-dismiss').click().catch(() => undefined);
  await page.waitForTimeout(1500);

  log('guerra e batalha');
  const bid = await page.evaluate(([lon, lat]) => {
    const g = window.__game!;
    g.dispatch({ type: 'game.pause', country: 'USA' } as never);
    const r = g.dispatch({ type: 'dip.declareWar', country: 'USA', target: 'SYR', force: true } as never);
    if (!r.ok) throw new Error(`declareWar ${JSON.stringify(r)}`);
    const forms = Object.values<any>((g.state as any).military.forms);
    const mine = forms.find((f) => f.c === 'USA' && f.d === 'land' && !f.cr);
    const foe = forms.find((f) => f.c === 'SYR' && f.d === 'land' && !f.cr);
    mine.p = [lon, lat]; mine.rt = null; mine.od = { k: 'idle' };
    foe.p = [lon + 0.012, lat + 0.004]; foe.rt = null; foe.od = { k: 'idle' };
    for (let i = 0; i < 24 * 10 && !g.ctx.api.military.battles().length; i++) g.advanceHours(1);
    const b = g.ctx.api.military.battles()[0];
    if (!b) throw new Error('sem batalha');
    return b.id as string;
  }, [LON, LAT]);
  await page.evaluate(([lon, lat]) => window.__globe!.setView(lon, lat, { height: 3000, pitchDeg: -50 }), [LON, LAT]);
  await ev(() => window.__tactical!.prefetch());
  await page.evaluate((id) => { const r = window.__game!.dispatch({ type: 'tac.start', country: 'USA', battleId: id } as never); if (!r.ok) throw new Error(JSON.stringify(r)); }, bid);
  await expect.poll(() => ev(() => window.__tactical!.active()), { timeout: 90_000 }).toBe(true);
  await ev(() => (window as any).__city3d.idle(300_000));
  log(`tactical + cidade prontos: ${JSON.stringify(await ev(() => ({ tiles: (window as any).__city3d.stats().ready, grass: (window as any).__city3d.grass.stats() })))}`);

  // ---- stage: the squads next to each other (state edit), then fight until the tanks have targets
  await ev(() => { document.querySelector<HTMLElement>('.ui-root')!.style.display = 'none'; });
  await page.evaluate(() => { window.__game!.dispatch({ type: 'tac.ready', country: 'USA' } as never); });
  await expect.poll(() => ev(() => window.__game!.state.tactical.battle!.phase), { timeout: 60_000 }).toBe('combat');
  const base = await ev(() => {
    const g = window.__game!, b = g.state.tactical.battle as any;
    const sq = (side: number, kind: string) => b.squads.find((q: any) => q.side === side && q.kind === kind && q.n0 > 0);
    const mbt = sq(0, 'mbt'), base = { x: mbt.x, y: mbt.y };
    const mv = (q: any, x: number, y: number) => { if (!q) return; const dx = x - q.x, dy = y - q.y; q.x = x; q.y = y; q.ox = x; q.oy = y; q.path = []; for (const e of b.ents) if (e.sq === q.id) { e.x += dx; e.y += dy; } };
    mv(sq(0, 'infantry'), base.x - 60, base.y - 40); mv(sq(0, 'mech'), base.x + 50, base.y - 30); mv(sq(0, 'engineer'), base.x - 30, base.y + 40);
    mv(sq(1, 'infantry'), base.x + 260, base.y + 90); mv(sq(1, 'mbt'), base.x + 330, base.y + 20); mv(sq(1, 'mech'), base.x + 280, base.y - 110); mv(sq(1, 'engineer'), base.x + 240, base.y + 150);
    for (const q of b.squads) if (['infantry', 'mbt', 'mech', 'engineer'].includes(q.kind)) { q.order = 'amove'; q.ox = q.side === 0 ? base.x + 330 : base.x - 20; q.oy = q.side === 0 ? base.y + 40 : base.y; q.path = []; q.fireFree = true; }
    for (let i = 0; i < 8; i++) g.ctx.api.tactical.advance(0.5);
    return base;
  });
  const fight = () => ev(() => {
    const g = window.__game!;
    for (let k = 0; k < 90; k++) {
      for (let i = 0; i < 4; i++) g.ctx.api.tactical.advance(0.5);
      const b = g.state.tactical.battle as any;
      const t = b.ents.filter((e: any) => e.alive && e.side === 0 && e.kind === 'mbt' && e.tg[0] >= 0);
      if (t.length >= 2 && b.proj.length >= 2) return { t: b.t, tanks: t.length };
    }
    return null;
  });
  let fought = await fight();
  for (let tries = 0; !fought && tries < 3; tries++) { // no contact: pull the enemy squads closer and look again
    await ev(() => { const b = window.__game!.state.tactical.battle as any; for (const e of b.ents) if (e.side === 1) e.x -= 120; for (const q of b.squads) if (q.side === 1) { q.x -= 120; q.ox -= 120; } });
    fought = await fight();
  }
  log(`combate ${JSON.stringify(fought)} base ${JSON.stringify(base)}`);
  const clean = () => ev(() => { const b = window.__game!.state.tactical.battle as any; b.smokes.length = 0; window.__tactical!.slowFx(1); });
  const pausedSim = () => ev(() => { window.__game!.dispatch({ type: 'tac.pause', country: 'USA', paused: true } as never); });
  await pausedSim();
  await clean();

  const near = (ids: number[], ms = 420_000) => page.waitForFunction((l) => {
    window.__globe!.requestRender();
    const m = new Map(window.__tactical!.lod().map((e) => [e.id, e]));
    return (l as number[]).every((i) => { const e = m.get(i); return !e || (e.near && e.ready); });
  }, ids, { timeout: ms, polling: 5000 }).catch(() => undefined);
  /** The first flash / smoke sprites of a session are still uploading to the billboard atlas when a single frame is captured: fire once, let them load, hide, fire again. */
  const warmFx = async (ids: number[]) => {
    await page.evaluate((l) => { window.__tactical!.pinFx(true); (l as number[]).forEach((i) => window.__tactical!.fireAt(i)); window.__globe!.requestRender(); }, ids);
    await page.waitForTimeout(12_000);
    await page.evaluate((l) => { window.__tactical!.pinFx(true); (l as number[]).forEach((i) => window.__tactical!.fireAt(i)); }, ids);
  };
  const shot = async (file: string, pre?: () => Promise<unknown>) => {
    await settle();
    await pre?.(); // e.g. the muzzle flash, fired right before the frame is taken (its sprites were loaded by warmFx)
    await ev(() => { window.__globe!.setContinuousRender(false); window.__globe!.requestRender(); });
    await page.screenshot({ path: `docs/assets/${file}`, timeout: 600_000 });
    log(`foto ${file}`);
  };

  // ---- 1) tank: turret toward its target + muzzle flash
  const tank = await ev(() => {
    const b = window.__game!.state.tactical.battle as any;
    // the engaged tank whose turret has to turn the most (largest angle between hull heading and bearing to its target)
    const rel = (e: any) => { const t = b.ents[e.tg[0]]; const d = (((Math.atan2(t.x - e.x, t.y - e.y) - e.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI); return Math.abs(d); };
    const c = b.ents.filter((e: any) => e.alive && e.side === 0 && e.kind === 'mbt' && e.tg[0] >= 0 && b.ents[e.tg[0]]?.alive).sort((x: any, y: any) => rel(y) - rel(x));
    const e = c[0] ?? b.ents.find((x: any) => x.alive && x.side === 0 && x.kind === 'mbt'), t = b.ents[e.tg[0] >= 0 ? e.tg[0] : 0];
    return { id: e.id as number, brg: (Math.atan2(t.x - e.x, t.y - e.y) * 180) / Math.PI, hd: (e.h * 180) / Math.PI, rng: Math.hypot(t.x - e.x, t.y - e.y) };
  });
  log(`tanque ${JSON.stringify(tank)}`);
  if (STEPS.has('tank')) {
    await page.evaluate((t) => window.__tactical!.focus({ ent: t.id }, { range: 24, pitchDeg: -11, headingDeg: (t.brg + 115) % 360, durationS: 0 }), tank);
    await near([tank.id]);
    await page.waitForTimeout(4000);
    const turret = await ev(() => null).then(() => page.evaluate((id) => window.__tactical!.lod().find((e) => e.id === id)?.turret, tank.id));
    log(`torre ${turret} graus (relativo ao casco; alvo a ${Math.round(tank.brg - tank.hd)} graus)`);
    await warmFx([tank.id]);
    await shot('near-tank.png', async () => log(`tiro ${JSON.stringify(await page.evaluate((id) => { window.__tactical!.pinFx(true); return { ok: window.__tactical!.fireAt(id), lod: window.__tactical!.lod().find((e) => e.id === id) }; }, tank.id))}`));
  }

  // ---- 1b) tread: the same tank from the side at 8 m, tread scroll 0 vs half a cleat: the track band of the two frames must differ (grass off so the wind does not)
  if (STEPS.has('tread')) {
    await page.evaluate((t) => window.__tactical!.focus({ ent: t.id }, { range: 14, pitchDeg: -8, headingDeg: (t.hd + 90) % 360, durationS: 0 }), tank);
    await ev(() => { (window as any).__city3d.grass.setEnabled(false); });
    await near([tank.id]);
    await page.waitForTimeout(3000);
    const clip = { x: 300, y: 560, width: 1000, height: 320 };
    const frames: Buffer[] = [];
    for (const sc of [0, 0.085]) {
      await page.evaluate(([id, v]) => { window.__tactical!.pinFx(true); window.__tactical!.rigSet(id as number, { scroll: v as number }); window.__globe!.requestRender(); }, [tank.id, sc]);
      await page.waitForTimeout(8000);
      await ev(() => { window.__globe!.setContinuousRender(false); window.__globe!.requestRender(); });
      frames.push(await page.screenshot({ clip, timeout: 600_000 }));
    }
    fs.writeFileSync('docs/assets/near-tread-a.png', frames[0]); fs.writeFileSync('docs/assets/near-tread-b.png', frames[1]);
    const diff = await page.evaluate(async ([a, b]) => {
      const load = async (x: string) => { const i = new Image(); i.src = `data:image/png;base64,${x}`; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d')!; g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const da = await load(a), db = await load(b); let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) n++;
      return { changed: n, of: da.length / 4 };
    }, [frames[0].toString('base64'), frames[1].toString('base64')]);
    log(`esteira: pixels diferentes ${JSON.stringify(diff)}`);
    expect.soft(diff.changed, 'the track band must change with the scroll').toBeGreaterThan(300);
    await ev(() => { (window as any).__city3d.grass.setEnabled(true); });
  }

  // ---- 1c) every near vehicle type in a row (IFV, APC, SPG, truck, SAM stand-in, MBT)
  if (STEPS.has('vehicles')) {
    const row = await ev(() => {
      const b = window.__game!.state.tactical.battle as any, t0 = b.ents[b.ents.find((e: any) => e.alive && e.side === 0 && e.kind === 'mbt').id];
      const kinds = ['mech', 'recon', 'artillery', 'logistics', 'sam', 'mbt'], ids: number[] = [];
      kinds.forEach((k, i) => { const e = b.ents.find((x: any) => x.alive && x.side === 0 && x.kind === k && !ids.includes(x.id)); if (!e) return; ids.push(e.id); e.x = t0.x + 18; e.y = t0.y + (i - 2.5) * 8; e.h = Math.PI / 2 + 0.35; e.moving = false; e.tg = e.tg.map(() => -1); });
      return { ids, cx: t0.x + 18, cy: t0.y };
    });
    await page.evaluate((r) => window.__tactical!.focus({ x: r.cx, y: r.cy }, { range: 36, pitchDeg: -8, headingDeg: 270, durationS: 0 }), row);
    await near(row.ids);
    await page.waitForTimeout(4000);
    log(`fila ${JSON.stringify(await page.evaluate((r) => window.__tactical!.lod().filter((e) => (r.ids as number[]).includes(e.id)).map((e) => `${e.kind}:${e.model}:${e.near}`), row))}`);
    await page.evaluate(() => window.__tactical!.pinFx(true));
    await shot('near-vehicles.png');
  }

  // ---- 2) soldiers: a squad running (order "move"), regrouped around one soldier so the whole squad is within a few metres of the camera; some hold the firing pose
  await ev(() => { window.__game!.dispatch({ type: 'tac.pause', country: 'USA', paused: false } as never); });
  const sold = await ev(() => {
    const g = window.__game!, b = g.state.tactical.battle as any;
    const q = b.squads.find((s: any) => s.side === b.player && s.kind === 'infantry' && s.n0 > 0);
    g.dispatch({ type: 'tac.order', country: 'USA', squads: [q.id], order: { kind: 'move', x: q.x + 120, y: q.y + 60 } } as never);
    for (let i = 0; i < 14; i++) g.ctx.api.tactical.advance(0.5);
    const es = b.ents.filter((e: any) => e.sq === q.id && e.alive);
    return { sq: q.id as number, ids: es.map((e: any) => e.id as number), moving: es.filter((e: any) => e.moving).length };
  });
  await pausedSim();
  await clean();
  if (STEPS.has('soldiers')) {
    // a loose file: the soldiers a few metres apart behind the first one (all keep their state: running)
    await ev(() => null);
    const c0 = await page.evaluate((s: { ids: number[] }) => {
      const b = window.__game!.state.tactical.battle as any, es = s.ids.map((i) => b.ents[i]), lead = es[0];
      es.forEach((e: any, i: number) => { e.x = lead.x - Math.sin(lead.h) * i * 2.6 + Math.cos(lead.h) * (i % 2 ? 2.4 : -2.4); e.y = lead.y - Math.cos(lead.h) * i * 2.6 - Math.sin(lead.h) * (i % 2 ? 2.4 : -2.4); e.h = lead.h; });
      return { x: lead.x, y: lead.y, hd: (lead.h * 180) / Math.PI };
    }, sold);
    log(`pelotão ${JSON.stringify({ n: sold.ids.length, moving: sold.moving })}`);
    await page.evaluate(([id, hd]) => window.__tactical!.focus({ ent: id as number }, { range: 12, pitchDeg: -9, headingDeg: ((hd as number) + 100) % 360, durationS: 0 }), [sold.ids[Math.floor(sold.ids.length / 2)], c0.hd]);
    await near(sold.ids);
    await page.waitForTimeout(4000);
    const shooters = sold.ids.filter((_: number, i: number) => i % 3 === 1);
    await warmFx(shooters);
    await shot('near-soldiers.png', () => page.evaluate((l) => { window.__tactical!.pinFx(true); (l as number[]).forEach((i) => window.__tactical!.fireAt(i)); }, shooters));
    log(`esqueletos ${JSON.stringify(await ev(() => window.__tactical!.stats()))}`);
  }

  // ---- 3) grass: camera near the ground on an open field, away from the units
  if (STEPS.has('grass')) {
    const spot = await page.evaluate(() => {
      const b = window.__game!.state.tactical.battle as any, c = (window as any).__city3d, m = 111320 * Math.cos((b.center[1] * Math.PI) / 180);
      const cam = (window as any).__globe.viewer.camera.positionCartographic, lon0 = (cam.longitude * 180) / Math.PI, lat0 = (cam.latitude * 180) / Math.PI;
      const alive = b.ents.filter((e: any) => e.alive);
      for (const sp of c.grass.findGrass(150, { lon: lon0, lat: lat0 })) {
        const x = (sp.lon - b.center[0]) * m, y = (sp.lat - b.center[1]) * 111320;
        if (alive.every((e: any) => Math.hypot(e.x - x, e.y - y) > 40)) return { x, y, cover: sp.cover };
      }
      return null;
    });
    log(`campo ${JSON.stringify(spot)}`);
    if (spot) {
      await page.evaluate((s) => window.__tactical!.focus({ x: s.x, y: s.y }, { range: 8, pitchDeg: -9, headingDeg: 70, durationS: 0 }), spot);
      await page.waitForFunction(() => (window as any).__city3d.grass.stats().tufts > 0, null, { timeout: 240_000, polling: 4000 }).catch(() => undefined);
      await page.waitForTimeout(8000);
      log(`grama ${JSON.stringify(await ev(() => (window as any).__city3d.grass.stats()))}`);
      await page.evaluate(() => window.__tactical!.pinFx(true));
      await shot('near-grass.png');
    }
  }

  // ---- 4) frame time: near LOD + grass off vs on, desktop (high) and phone (mobile) profile; sim paused, camera on the platoon
  const perf: Record<string, unknown> = {};
  /** Per frame: wall interval between frames, and the main-thread time of scene.render() (command building, culling, animation, skinning, draw submission). */
  const measure = (frames: number) => page.evaluate(async (n) => {
    const g = window.__globe!, sc = g.viewer.scene as any, wall: number[] = [], js: number[] = [], cmds: number[] = [];
    g.setContinuousRender(false);
    let last = performance.now();
    for (let i = 0; i < (n as number); i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now(); sc.render(); const t1 = performance.now();
      js.push(t1 - t0); wall.push(t0 - last); last = t1; cmds.push(sc.frameState?.commandList?.length ?? 0);
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor((s.length - 1) / 2)] * 10) / 10; };
    return { frames: js.length, jsMedMs: med(js), wallMedMs: med(wall), cmds: med(cmds) };
  }, frames);
  if (STEPS.has('perf')) {
    // software GL is noisy and every frame takes seconds: the two configurations are interleaved twice and the medians averaged
    await page.setViewportSize({ width: 960, height: 540 });
    await page.evaluate((s) => window.__tactical!.focus({ squad: s.sq }, { range: 40, pitchDeg: -16, headingDeg: 205, durationS: 0 }), sold);
    const cfgs = [['base', 0, false], ['near+grass', 150, true]] as const;
    for (const profile of ['high', 'mobile'] as const) {
      await page.evaluate(async (p) => { const path = '/src/render/globe/quality.ts'; const q = await import(/* @vite-ignore */ path); q.setQuality(p); }, profile).catch(() => undefined);
      const runs: Record<string, { jsMedMs: number; wallMedMs: number; cmds: number }[]> = {};
      for (let round = 0; round < 2; round++) for (const [name, range, grass] of cfgs) {
        await page.evaluate(([r, g]) => { window.__tactical!.setNearRange(r as number); (window as any).__city3d.grass.setEnabled(g as boolean); }, [range, grass]);
        await page.waitForTimeout(45_000);
        const r = await measure(10);
        (runs[name] ??= []).push(r);
        log(`perf ${profile}/${name} #${round} ${JSON.stringify(r)} ${JSON.stringify(await ev(() => window.__tactical!.stats()))}`);
      }
      const avg = (a: number[]) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
      perf[profile] = Object.fromEntries(cfgs.map(([n]) => [n, { jsMedMs: avg(runs[n].map((r) => r.jsMedMs)), wallMedMs: avg(runs[n].map((r) => r.wallMedMs)), cmds: avg(runs[n].map((r) => r.cmds)), runs: runs[n] }]));
      perf[`${profile}-stats`] = { lod: await ev(() => window.__tactical!.stats()), grass: await ev(() => (window as any).__city3d.grass.stats()) };
    }
    fs.writeFileSync('docs/assets/near-perf.json', JSON.stringify(perf, null, 1));
  }
  // ---- 5) LOD hand-over (last: it hides every other unit for a clean frame): a line of tanks receding from the camera past 150 m
  if (STEPS.has('lod')) {
    const line = await ev(() => {
      const b = window.__game!.state.tactical.battle as any;
      const tanks = b.ents.filter((e: any) => e.alive && e.side === 0 && e.kind === 'mbt').slice(0, 8);
      const cx = b.ents[tanks[0].id].x, cy = b.ents[tanks[0].id].y, ds = [30, 60, 95, 125, 175, 205, 240, 285];
      tanks.forEach((e: any, i: number) => { e.x = cx + ds[i]; e.y = cy + (i % 2 ? 6 : -6); e.h = Math.PI / 2; e.moving = false; e.tg = e.tg.map(() => -1); });
      const keep = new Set(tanks.map((e: any) => e.id));
      for (const e of b.ents) if (!keep.has(e.id)) e.gone = true; // a clean frame: only the line of tanks
      return { ids: tanks.map((e: any) => e.id as number), cx, cy, ds };
    });
    await page.evaluate((l) => window.__tactical!.focus({ x: l.cx + 80, y: l.cy }, { range: 92, pitchDeg: -5, headingDeg: 90, durationS: 0 }), line);
    await page.evaluate(() => window.__tactical!.setNearRange(150));
    await near(line.ids.slice(0, 4));
    await page.waitForTimeout(4000);
    const lods = await page.evaluate((l) => window.__tactical!.lod().filter((e) => (l.ids as number[]).includes(e.id)).map((e) => ({ id: e.id, dist: e.dist, near: e.near, model: e.model })), line);
    log(`linha de tanques ${JSON.stringify(lods)}`);
    await page.evaluate(() => window.__tactical!.pinFx(true));
    await shot('near-lod-150m.png');
  }

  expect(errors.filter((e) => !/Failed to load resource|net::ERR|ERR_|Canvas2D/i.test(e)), errors.join('\n')).toEqual([]);
});
