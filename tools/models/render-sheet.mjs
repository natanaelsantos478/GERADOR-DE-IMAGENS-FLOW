// usage: node render-sheet.mjs <items.json> <out.png> <glbRoot> [cols]
// items: [{name, file, yawOffsetDeg}]  file relative to glbRoot. Visual only; three.js is used just for this check.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const [,, itemsFile, out, glbRoot, colsArg] = process.argv;
const cols = +(colsArg||4);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary','.json':'application/json'};
const srv = http.createServer((q,s)=>{
  let u = decodeURIComponent(q.url.split('?')[0]); let f;
  if (u.startsWith('/m/')) f = path.join(glbRoot, u.slice(3)); else f = path.join(here, u==='/'?'viewer/viewer.html':u);
  if (!path.resolve(f).startsWith(path.resolve(u.startsWith('/m/')?glbRoot:here))) { s.writeHead(403); return s.end(); }
  fs.readFile(f,(e,d)=>{ if(e){s.writeHead(404);return s.end();} s.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); s.end(d); });
}).listen(0);
const port = srv.address().port;
const items = JSON.parse(fs.readFileSync(itemsFile,'utf8')).map(i=>({...i,url:`/m/${i.file}`}));
const b = await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle']});
const p = await b.newPage({viewport:{width:800,height:600}});
p.on('console',m=>{ if(m.type()==='error') console.log('console:',m.text()); });
await p.goto(`http://localhost:${port}/viewer/viewer.html`); await p.waitForFunction('window.ready');
const data = await p.evaluate(([i,c])=>window.renderSheet(i,c),[items,cols]);
fs.writeFileSync(out, Buffer.from(data.split(',')[1],'base64'));
await b.close(); srv.close(); console.log('wrote',out);
