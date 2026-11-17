// Renders the navigation raster (parameters the simulation sees) of the 4 fixture areas to docs/assets/nav-*.png.
// Run: node --import tsx tools/vector/render-nav.mjs   (© OpenStreetMap contributors, OpenFreeMap)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { SURFACE_RULES, USE_RULES } from '../../src/sim/tactical/terrainRules.ts';
import { loadFixture } from '../../src/data/vector/fixtures.test-util.ts';
import { decodeRle } from '../../src/data/vector/nav.ts';
import { navCell, navCenter, navOf, snapCell, mainComp, components } from '../../src/sim/tactical/nav.ts';
import { navPath } from '../../src/sim/tactical/navPath.ts';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/assets');
const SC = 4;
const COL = SURFACE_RULES.map((r) => r.color);
const set = (png, x, y, c, a = 1) => {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const o = (y * png.width + x) * 4;
  for (let k = 0; k < 3; k++) png.data[o + k] = Math.round(png.data[o + k] * (1 - a) + c[k] * a);
  png.data[o + 3] = 255;
};
const line = (png, pts, c, w, toPx) => {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay] = toPx(pts[i], pts[i + 1]), [bx, by] = toPx(pts[i + 2], pts[i + 3]);
    const k = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let q = 0; q <= k; q++) { const x = Math.round(ax + ((bx - ax) * q) / (k || 1)), y = Math.round(ay + ((by - ay) * q) / (k || 1)); for (let j = -w; j <= w; j++) for (let l = -w; l <= w; l++) set(png, x + l, y + j, c); }
  }
};


// 5x7 bitmap font (uppercase, digits, a few symbols): the legend needs no font files
const G = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.', C: '.####/#..../#..../#..../#..../#..../.####', D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....', G: '.####/#..../#..../#.###/#...#/#...#/.####', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.', J: '..###/...#./...#./...#./...#./#..#./.##..', K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#', O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#', S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..', W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.', 2: '.###./#...#/....#/...#./..#../.#.../#####', 3: '####./....#/....#/.###./....#/....#/####.',
  4: '...#./..##./.#.#./#..#./#####/...#./...#.', 5: '#####/#..../####./....#/....#/#...#/.###.', 6: '.###./#..../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.', 9: '.###./#...#/#...#/.####/....#/....#/.###.',
  '.': '...../...../...../...../...../.##../.##..', '-': '...../...../...../#####/...../...../.....', '/': '....#/....#/...#./..#../.#.../#..../#....', ':': '...../.##../.##../...../.##../.##../.....',
  '(': '..#../.#.../#..../#..../#..../.#.../..#..', ')': '..#../...#./....#/....#/....#/...#./..#..', '>': '#..../.#.../..#../...#./..#../.#.../#....', ',': '...../...../...../...../.##../..#../.#...', '+': '...../..#../..#../#####/..#../..#../.....',
};
const text = (png, str, x, y, c, sc = 2) => {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = G[ch];
    if (g) g.split('/').forEach((row, j) => [...row].forEach((v, i) => { if (v === '#') for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) set(png, cx + i * sc + a, y + j * sc + b, c); }));
    cx += 6 * sc;
  }
};
const names = { rio: 'nav-rio', paris: 'nav-paris', rural: 'nav-rural', alpes: 'nav-alpes' };
const SRC = process.argv[2] ?? 'overture';
for (const name of Object.keys(names)) {
  const f = await loadFixture(name, SRC);
  const nav = f.nav, n = nav.n, half = nav.sizeM / 2, cs = nav.sizeM / n;
  const map = { sizeM: nav.sizeM, n: 64, heights: f.heights64, cover: [], road: [], water: [], nav };
  const rt = navOf(map);
  const W = n * SC, png = new PNG({ width: W, height: W });
  const hn = f.hn, hcs = nav.sizeM / hn;
  const hAt = (x, y) => { const fx = Math.min(hn - 1.001, Math.max(0, (x + half) / hcs - 0.5)), fy = Math.min(hn - 1.001, Math.max(0, (y + half) / hcs - 0.5)); const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * hn + x0, h = f.heights; return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - ty) + (h[i + hn] * (1 - tx) + h[i + hn + 1] * tx) * ty; };
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const cx = Math.floor(px / SC), cy = n - 1 - Math.floor(py / SC), c = cy * n + cx, s = rt.surf[c];
    const x = (px / SC) * cs - half, y = (n - py / SC) * cs - half;
    const shade = 1 + Math.max(-0.35, Math.min(0.3, ((hAt(x - 30, y + 30) - hAt(x + 30, y - 30)) / 60) * 1.6));
    let col = COL[s].map((v) => Math.max(0, Math.min(255, v * shade)));
    if (s === 6) { const edge = px % SC === 0 || py % SC === 0; if (!edge) col = COL[6]; }
    set(png, px, py, col);
    const sl = rt.slope[c];
    if (sl > 50) set(png, px, py, [200, 0, 200], 0.5); else if (sl > 38) set(png, px, py, [255, 0, 0], 0.4); else if (sl > 30) set(png, px, py, [255, 90, 0], 0.28);
  }
  // land-use zones: coloured outline tint for protected / military / airport / port ...
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const cx = Math.floor(px / SC), cy = n - 1 - Math.floor(py / SC), u = rt.use[cy * n + cx];
    if (!u) continue;
    const z = Object.values(USE_RULES).find((r) => r.code === u);
    if (z.protected || z.coverBonus || u === 7 || u === 8) set(png, px, py, z.color, 0.35);
  }
  const toPx = (x, y) => [((x + half) / cs) * SC, W - ((y + half) / cs) * SC];
  // test routes between opposite corners of the main component: wheeled (magenta) and infantry (cyan)
  const corner = (mob, fx, fy) => snapCell(rt, mob, navCell(rt, (fx - 0.5) * nav.sizeM * 0.85, (fy - 0.5) * nav.sizeM * 0.85), 120, mainComp(rt, mob));
  const A = corner('wheel', 0, 0), B = corner('wheel', 1, 1);
  const [ax, ay] = navCenter(rt, A), [bx, by] = navCenter(rt, B);
  const wp = navPath(rt, 'wheel', ax, ay, bx, by), tp = navPath(rt, 'track', ax, ay, bx, by), fp = navPath(rt, 'foot', ax + 20, ay, bx, by + 20);
  line(png, tp, [255, 255, 255], 1, toPx); line(png, wp, [255, 0, 200], 1, toPx); line(png, fp, [0, 230, 255], 0, toPx);
  for (const [px, py, c] of [[ax, ay, [0, 120, 0]], [bx, by, [0, 0, 160]]]) { const [qx, qy] = toPx(px, py); for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) set(png, Math.round(qx + i), Math.round(qy + j), c); }
  console.log(name, 'wheel path pts', wp.length / 2, 'foot', fp.length / 2, 'track', tp.length / 2, 'bridge cells on wheel route:', (() => { let k = 0; for (let i = 0; i < wp.length; i += 2) if (rt.surf[navCell(rt, wp[i], wp[i + 1])] === 9) k++; return k; })());
  // structures (square), places of interest (diamond), peaks (triangle)
  const mark = (x, y, c, shape) => { const [qx, qy] = toPx(x, y); for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const on = shape === 'sq' ? Math.max(Math.abs(i), Math.abs(j)) <= 3 : shape === 'di' ? Math.abs(i) + Math.abs(j) <= 4 : j >= -4 && Math.abs(i) <= (j + 4) / 2; if (on) set(png, Math.round(qx + i), Math.round(qy + j), Math.max(Math.abs(i), Math.abs(j)) >= 4 || (shape !== 'tr' && Math.abs(i) + Math.abs(j) >= 5) ? [0, 0, 0] : c); } };
  for (const q of nav.infra) mark(q.x, q.y, [255, 255, 0], 'sq');
  for (const q of nav.pois) mark(q.x, q.y, [0, 255, 120], 'di');
  for (const q of nav.peaks) mark(q.x, q.y, [255, 255, 255], 'tr');
  // legend (all surface classes, land-use zones, markers, routes) rendered with resvg and placed to the right
  const rows = [...SURFACE_RULES.map((r) => [r.color, r.name, 0]), ...Object.values(USE_RULES).filter((r) => r.code).map((r) => [r.color, `use: ${r.name}${r.protected ? ' (protected)' : ''}`, 1]),
    [[255, 255, 0], 'structure (tower / dam / substation)', 2], [[0, 255, 120], 'place of interest (objective)', 2], [[255, 255, 255], 'peak (sight advantage)', 2],
    [[255, 0, 200], 'test route: wheeled', 3], [[255, 255, 255], 'test route: tracked', 3], [[0, 230, 255], 'test route: infantry', 3], [[255, 90, 0], 'slope > 30 deg (wheels blocked)', 4], [[255, 0, 0], 'slope > 38 deg (tracks)', 4], [[200, 0, 200], 'slope > 50 deg (infantry)', 4]];
  const LW = 480, lh = 16;
  const H = Math.max(W, 60 + rows.length * lh), out = new PNG({ width: W + LW, height: H });
  PNG.bitblt(png, out, 0, 0, W, W, 0, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W + LW; x++) if (x >= W || y >= W) set(out, x, y, [20, 24, 31]);
  text(out, `${name} - ${SRC} ${nav.sizeM} M ${nav.n}X${nav.n}`, W + 10, 8, [255, 255, 255]);
  rows.forEach((r, i) => { for (let j = 0; j < 12; j++) for (let k = 0; k < 18; k++) set(out, W + 10 + k, 32 + i * lh + j, j === 0 || j === 11 || k === 0 || k === 17 ? [0, 0, 0] : r[0]); text(out, r[1], W + 36, 32 + i * lh, [232, 232, 232]); });
  text(out, '(C) OPENSTREETMAP CONTRIBUTORS, OVERTURE MAPS FOUNDATION, ESA WORLDCOVER', W + 10, H - 14, [150, 160, 170], 1);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${names[name]}${SRC === 'overture' ? '' : '-ofm'}.png`), PNG.sync.write(out));
}
