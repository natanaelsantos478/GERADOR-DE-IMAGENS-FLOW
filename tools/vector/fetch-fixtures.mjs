// Downloads the small real-data fixtures used by the vector-map tests (OpenFreeMap z14 tiles + Terrarium heights).
// Cached on disk: re-running never re-downloads. © OpenStreetMap contributors, OpenFreeMap.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { PMTiles } from 'pmtiles';
import { slim } from './mvt-slim.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/data/vector/fixtures');
const UA = { 'User-Agent': 'Meridiano-Game/1.0' };
const Z = 14, SIZE = 3000, HN = 96;
const AREAS = {
  rio: { lon: -43.2, lat: -22.958 },      // Ipanema / Lagoa Rodrigo de Freitas
  paris: { lon: 2.3412, lat: 48.857 },    // Seine, Pont Neuf
  rural: { lon: -0.478, lat: 48.983 },    // Orne river, Thury-Harcourt (Normandy)
  alpes: { lon: 7.7491, lat: 46.0207 },   // Zermatt
};
const tileXY = (lon, lat, z) => [((lon + 180) / 360) * 2 ** z, ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z];
const tileLL = (x, y, z) => [(x / 2 ** z) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI];
const POI = new Set(['hospital', 'police', 'fire_station', 'military', 'school', 'college', 'university', 'place_of_worship', 'townhall', 'courthouse', 'prison', 'embassy', 'bus', 'railway', 'harbor', 'aerodrome', 'helipad', 'dam', 'power', 'communications_tower', 'lighthouse', 'castle', 'museum', 'library', 'cemetery', 'stadium']);
const OFM = {
  building: { props: ['render_height', 'render_min_height'], types: [3] },
  transportation: { props: ['class', 'subclass', 'brunnel', 'surface'] },
  water: { props: ['class'] }, waterway: { props: ['class', 'brunnel'] },
  landcover: { props: ['class', 'subclass'] }, landuse: { props: ['class'] },
  aeroway: { props: ['class'] }, mountain_peak: { props: ['class', 'ele'] },
  poi: { props: ['class', 'subclass'], keep: (p) => POI.has(p.class) || POI.has(p.subclass) },
};
const strip = (buf) => slim(buf, OFM);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => { for (let i = 0; i < 3; i++) { const r = await fetch(url, { headers: UA }); if (r.status === 404 || r.status === 204) return new Uint8Array(0); if (r.ok) return new Uint8Array(await r.arrayBuffer()); await sleep(1500); } throw new Error(url); };

const release = (await (await fetch('https://stac.overturemaps.org/catalog.json', { headers: UA })).json()).latest;
const OV = [
  ['buildings', 14, { building: { props: ['height', 'num_floors', 'class', 'subtype', 'is_underground'], types: [3] } }],
  ['transportation', 14, { segment: { props: ['class', 'subtype', 'road_flags', 'rail_flags'], types: [2] } }],
  ['base', 13, { land_cover: { props: ['subtype'], types: [3] }, land: { props: ['class', 'subtype'], keep: (p) => p.class !== 'tree' },
    infrastructure: { props: ['class', 'subtype'], keep: (p) => ['power', 'communication', 'tower', 'water', 'airport', 'emergency', 'transit', 'utility'].includes(p.subtype) }, land_use: { props: ['subtype'], types: [3] }, water: { props: ['class', 'level'], types: [2, 3] } }],
];
const tpl = (await (await fetch('https://tiles.openfreemap.org/planet', { headers: UA })).json()).tiles[0];
for (const [name, a] of Object.entries(AREAS)) {
  const dir = path.join(OUT, name), ofm = path.join(dir, 'ofm'), ovd = path.join(dir, 'ov');
  fs.mkdirSync(ofm, { recursive: true }); fs.mkdirSync(ovd, { recursive: true });
  const [tx, ty] = tileXY(a.lon, a.lat, Z);
  const [lon, lat] = tileLL(Math.round(tx), Math.round(ty), Z); // centre on a tile corner -> 2x2 tiles
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const [xa, ya] = tileXY(lon - SIZE / 2 / mLon, lat + SIZE / 2 / 111320, Z), [xb, yb] = tileXY(lon + SIZE / 2 / mLon, lat - SIZE / 2 / 111320, Z);
  for (let y = Math.floor(ya); y <= Math.floor(yb); y++) for (let x = Math.floor(xa); x <= Math.floor(xb); x++) {
    const f = path.join(ofm, `${Z}-${x}-${y}.pbf.gz`);
    const raw = fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)) : await get(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
    if (!fs.existsSync(f)) await sleep(300);
    fs.writeFileSync(f, zlib.gzipSync(strip(Buffer.from(raw)), { level: 9 }));
  }
  // Overture (PMTiles range reads), slimmed to the properties the adapter reads
  for (const [file, z, spec] of OV) {
    const pm = new PMTiles(`https://tiles.overturemaps.org/${release}/${file}.pmtiles`);
    const [xa, ya] = tileXY(lon - SIZE / 2 / mLon, lat + SIZE / 2 / 111320, z), [xb, yb] = tileXY(lon + SIZE / 2 / mLon, lat - SIZE / 2 / 111320, z);
    for (let y = Math.floor(ya); y <= Math.floor(yb); y++) for (let x = Math.floor(xa); x <= Math.floor(xb); x++) {
      const f = path.join(ovd, `${file}-${z}-${x}-${y}.pbf.gz`);
      if (fs.existsSync(f)) continue;
      const t = await pm.getZxy(z, x, y);
      fs.writeFileSync(f, zlib.gzipSync(t ? slim(Buffer.from(t.data), spec) : Buffer.alloc(0), { level: 9 }));
    }
  }
  // Terrarium z13 heights (hn*hn from the SW cell centre)
  const tiles = new Map();
  const tile = async (x, y) => {
    const k = `${x}/${y}`;
    if (!tiles.has(k)) tiles.set(k, PNG.sync.read(Buffer.from(await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/${x}/${y}.png`))));
    return tiles.get(k);
  };
  const h = [];
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const lo = lon + (((i + 0.5) * SIZE) / HN - SIZE / 2) / mLon, la = lat + (((j + 0.5) * SIZE) / HN - SIZE / 2) / 111320;
    const [fx, fy] = tileXY(lo, la, 13);
    const png = await tile(Math.floor(fx), Math.floor(fy));
    const px = Math.min(255, Math.floor((fx - Math.floor(fx)) * 256)), py = Math.min(255, Math.floor((fy - Math.floor(fy)) * 256)), o = (py * 256 + px) * 4;
    h.push(Math.max(0, Math.round((png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768) * 10) / 10));
  }
  fs.writeFileSync(path.join(dir, 'area.json'), JSON.stringify({ name, lon, lat, sizeM: SIZE, zoom: Z, hn: HN, heights: h }));
  console.log(name, lon.toFixed(5), lat.toFixed(5), fs.readdirSync(dir).length - 1, 'tiles');
}
