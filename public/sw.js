// Service worker of the web version: the game works offline after the first visit (the game data itself is kept in
// IndexedDB, see src/platform/gameData.ts). Pages and the list of the mods that come with the game are fetched network
// first; hashed build assets, HD artwork bundles and those mods' packages (asked for by their fingerprint) cache
// first; everything else is served from the cache while it is refreshed in the background. Media streamed in parts
// (the credits' song) is left to the network: offline, the credits play the game's own music.
const CACHE = 'omf2097r-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function put(req, res) {
  // Hosts that answer missing files with the page itself (single-page fallback) must not fill the cache with copies.
  const fallback = req.mode !== 'navigate' && (res.headers.get('content-type') ?? '').startsWith('text/html');
  // (whole files only: the cache refuses a part of one, 206, and the request would fail)
  if (res.status === 200 && res.type === 'basic' && !fallback) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Media streams in parts (the credits' song, 63 MB): straight from the network, as the browser asks for it.
  if (req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/__')) return;
  if (req.mode === 'navigate' || /\/mods\/index\.json$/.test(url.pathname)) {
    event.respondWith(fetch(req).then((res) => put(req, res)).catch(async () => (await caches.match(req)) ?? (await caches.match('./'))));
    return;
  }
  // (HD files are named by their content; their indexes, index.json and the menu's layers.json, are not)
  const immutable = /\/assets\//.test(url.pathname) || (/\/hd\//.test(url.pathname) && !/(index|layers)\.json$/.test(url.pathname)) ||
    (/\/mods\//.test(url.pathname) && url.search.length > 1);
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit && immutable) return hit;
    const refresh = fetch(req).then((res) => put(req, res));
    if (hit) {
      event.waitUntil(refresh.catch(() => undefined));
      return hit;
    }
    return refresh;
  })());
});
