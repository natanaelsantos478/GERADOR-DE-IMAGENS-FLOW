/* Meridiano service worker: caches the app shell and static build assets only.
 * Never caches game data (data/*.json, several MB), map tiles or any cross-origin request. */
const VERSION = 'v1';
const CACHE = `meridiano-shell-${VERSION}`;
const base = new URL('./', self.location).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png']).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('meridiano-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const rel = (url) => url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
/** Static, small-ish assets that are safe to keep (hashed build output, icons, flags, workers). */
const cacheable = (r) => r !== null && (r.startsWith('assets/') || r.startsWith('icons/') || r.startsWith('pwa/') || r.startsWith('data/flags/') || r.startsWith('cesium/') || r === 'manifest.webmanifest');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles, CDNs: browser handles
  const r = rel(url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return res; }).catch(() => caches.match('./').then((m) => m || Response.error())));
    return;
  }
  if (!cacheable(r) || req.headers.has('range')) return; // data/*.json and everything else: network only
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.status === 200) c.put(req, res.clone());
    return res;
  }));
});
