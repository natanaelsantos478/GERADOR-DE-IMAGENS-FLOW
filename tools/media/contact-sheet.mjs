// Renders docs/assets/icons-contact-sheet.png (all icons on dark bg, 48px big + 20px small, with names) via Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pw = process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);
const dir = path.resolve(here, '../../public/icons');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const cells = Object.entries(man).map(([id, m]) => {
  const svg = fs.readFileSync(path.join(dir, m.file), 'utf8');
  return `<div class="c"><div class="big">${svg.replace('width="24" height="24"', 'width="48" height="48"')}</div><div class="sm">${svg.replace('width="24" height="24"', 'width="20" height="20"')}</div><span>${id}</span></div>`;
}).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#d6dde6;font:11px system-ui,sans-serif;padding:12px}
.g{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;width:1500px}
.c{background:#161d27;border-radius:6px;padding:8px 4px;display:flex;flex-direction:column;align-items:center;gap:4px}
.big,.sm{color:#e8eef5;display:flex}.sm{color:#7fd0ff}span{font-size:10px;color:#9fb0c3;text-align:center}
</style><div class="g">${cells}</div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1524, height: 800 }, deviceScaleFactor: 1 });
await p.setContent(html);
fs.mkdirSync(path.resolve(here, '../../docs/assets'), { recursive: true });
await p.screenshot({ path: path.resolve(here, '../../docs/assets/icons-contact-sheet.png'), fullPage: true });
await b.close();
console.log('contact sheet ok');
