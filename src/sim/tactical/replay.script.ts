/** Renders docs/assets/tactical-replay.png: 4 instants of an AI x AI battle on a real map (top view).
 *  Run: npx tsx src/sim/tactical/replay.script.ts [lon lat seed] */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { nodeFetchJson } from '../../data/fetchNode';
import { loadWorldStatic } from '../../data/loadWorld';
import { createBattle, snapshotBattle, stepBattle } from './core';
import { buildMapFromWorld, defaultObjectives } from './mapWorld';
import { scenarioInput } from './scenario.test-util';

const [lon, lat, seed] = [Number(process.argv[2] ?? 7.75), Number(process.argv[3] ?? 46.02), Number(process.argv[4] ?? 42)];
const world = await loadWorldStatic(nodeFetchJson());
const map = buildMapFromWorld(world, lon, lat);
const b = createBattle({ ...scenarioInput(map, 'replay'), objectives: defaultObjectives(map, 0) }, seed);
const P = 500, S = map.sizeM;
const px = (v: number) => ((v + S / 2) / S) * P, py = (v: number) => P - ((v + S / 2) / S) * P;
const hmin = Math.min(...map.heights), hmax = Math.max(...map.heights);
let terrain = '';
const cs = P / map.n;
for (let y = 0; y < map.n; y++) for (let x = 0; x < map.n; x++) {
  const i = y * map.n + x, h = (map.heights[i] - hmin) / Math.max(1, hmax - hmin);
  const dx = (map.heights[i + (x < map.n - 1 ? 1 : 0)] - map.heights[i - (x > 0 ? 1 : 0)]) / 2;
  const shade = Math.max(0, Math.min(1, 0.55 + dx * 0.04 + h * 0.15));
  let rgb = [150 + shade * 70, 160 + shade * 60, 120 + shade * 50];
  if (map.cover[i] === 1) rgb = [rgb[0] * 0.55, rgb[1] * 0.75, rgb[2] * 0.55];
  if (map.cover[i] === 2) rgb = [175, 165, 160];
  if (map.road[i]) rgb = [90, 80, 70];
  if (map.water[i]) rgb = [70, 110, 170];
  terrain += `<rect x="${x * cs}" y="${P - (y + 1) * cs}" width="${cs + 0.5}" height="${cs + 0.5}" fill="rgb(${rgb.map(Math.round)})"/>`;
}
const COL = ['#1f5fd0', '#d0261f'];
const panels: string[] = [];
const marks = [0, 120, 300, 560];
let ended = false;
for (const t of marks) {
  while (!ended && b.t < t && b.phase !== 'ended') stepBattle(b, 0.05);
  const snap = snapshotBattle(b, 1, false);
  let g = terrain;
  for (const o of snap.objectives) g += `<circle cx="${px(o.x)}" cy="${py(o.y)}" r="${(o.r / S) * P}" fill="${o.owner < 0 ? '#ffffff55' : COL[o.owner] + '44'}" stroke="#000" stroke-dasharray="3 3"/>`;
  for (const s of snap.smokes) g += `<circle cx="${px(s.x)}" cy="${py(s.y)}" r="${(s.r / S) * P}" fill="#ddd" opacity=".8"/>`;
  for (const e of snap.entities) {
    const r = e.kind === 'infantry' || e.kind === 'special' || e.kind === 'engineer' ? 1.6 : e.kind === 'artillery' || e.kind === 'mlrs' ? 2.6 : 3;
    g += e.alive
      ? `<circle cx="${px(e.x)}" cy="${py(e.y)}" r="${r}" fill="${COL[e.side]}" stroke="#fff" stroke-width=".5" opacity="${e.suppressed ? 0.6 : 1}"/>`
      : `<text x="${px(e.x)}" y="${py(e.y)}" font-size="5" fill="#222" text-anchor="middle">x</text>`;
  }
  for (const p of snap.projectiles) g += `<line x1="${px(p.x0)}" y1="${py(p.y0)}" x2="${px(p.x1)}" y2="${py(p.y1)}" stroke="#ff0" stroke-width=".8"/>`;
  const a0 = snap.squads.filter((s) => s.side === 0).reduce((a, s) => a + s.alive, 0), a1 = snap.squads.filter((s) => s.side === 1).reduce((a, s) => a + s.alive, 0);
  panels.push(`<div><svg width="${P}" height="${P}" viewBox="0 0 ${P} ${P}">${g}</svg><p>t = ${Math.round(b.t)} s &nbsp; azul ${a0} &nbsp; vermelho ${a1} &nbsp; pontos ${snap.score.join(' / ')}${b.phase === 'ended' ? ` &nbsp; FIM: vencedor ${b.result?.winner === 0 ? 'azul' : 'vermelho'} (${b.result?.reason})` : ''}</p></div>`);
  if (b.phase === 'ended') ended = true;
}
const html = `<html><body style="margin:8px;background:#222;color:#eee;font:13px sans-serif"><div style="display:grid;grid-template-columns:${P}px ${P}px;gap:8px">${panels.join('')}</div></body></html>`;
const out = path.resolve(import.meta.dirname, '../../../docs/assets');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: P * 2 + 24, height: (P + 40) * 2 + 24 } });
await page.setContent(html);
await page.screenshot({ path: path.join(out, 'tactical-replay.png') });
await browser.close();
console.log('ok', b.phase, b.result?.winner, b.result?.reason, b.t);
