// Service worker of the web version: the game works offline after the first visit (the game data itself is kept in
// IndexedDB, see src/platform/gameData.ts). Pages and the JSON indexes (the HD artwork's, the menu layers', the mods
// that come with the game) are fetched network first; hashed build assets, HD artwork named by its content or asked for
// by its bundle's signature (?v=), and those mods' packages (asked for by their fingerprint) cache first, a new version
// replacing the old one in the cache; everything else is served from the cache while it is refreshed in the
// background. Media streamed in parts (the credits' song) is left to the network: offline, the credits play the game's
// own music. What the page loaded before this worker ran (the first visit) is kept when the page sends its list.
const CACHE = 'omf2097r-v5';
/** This game's caches (the origin is shared with the account's other GitHub Pages sites: theirs are left alone). */
const PREFIX = 'omf2097r-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

/** How a request is cached: `immutable` (cache first), `versioned` (replaces its older versions). */
function kind(url) {
  // (HD files named by their content, e.g. ARENA0.12fc773543.webp, or asked for by their bundle's signature)
  const hdVersioned = /\/hd\//.test(url.pathname) && (url.searchParams.has('v') || /\.[0-9a-f]{8,}\.[a-z0-9]+$/i.test(url.pathname));
  const modVersioned = /\/mods\//.test(url.pathname) && url.search.length > 1;
  return {
    immutable: /\/assets\//.test(url.pathname) || hdVersioned || modVersioned,
    versioned: (hdVersioned && url.searchParams.has('v')) || modVersioned,
  };
}

/**
 * Caches a response (a copy: the page has the original at once); `versioned`: a file asked for by its version, whose
 * older versions it replaces; `page`: a page (HTML expected). A cache that cannot take it (no room left) is let go: the
 * game goes on from the network.
 */
async function put(req, res, versioned = false, page = false) {
  // Hosts that answer missing files with the page itself (single-page fallback) must not fill the cache with copies.
  const fallback = !page && req.mode !== 'navigate' && (res.headers.get('content-type') ?? '').startsWith('text/html');
  // (whole files only: the cache refuses a part of one, 206)
  if (res.status !== 200 || res.type !== 'basic' || fallback) return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(req, res);
    // (the versions before it go: a bundle's pictures, a mod package of 27 MB; never a page's other addresses)
    if (versioned) {
      for (const old of await cache.keys(req, { ignoreSearch: true })) if (old.url !== req.url) await cache.delete(old);
    }
  } catch {
    // (no room in the cache)
  }
}

/** From the network, a copy into the cache meanwhile. */
async function fromNetwork(event, req, versioned = false) {
  const res = await fetch(req);
  event.waitUntil(put(req, res.clone(), versioned));
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Media streams in parts (the credits' song, 63 MB): straight from the network, as the browser asks for it.
  if (req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/__')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fromNetwork(event, req).catch(async () => (await caches.match(req)) ?? (await caches.match('./')) ?? Response.error()));
    return;
  }
  // The indexes, fresh (past the browser's own cache too): an old one would name pictures that changed since.
  if (/\.json$/.test(url.pathname)) {
    event.respondWith(fromNetwork(event, new Request(req, { cache: 'no-cache' })).catch(async () => (await caches.match(req)) ?? Response.error()));
    return;
  }
  const { immutable, versioned } = kind(url);
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit && immutable) return hit;
    if (hit) {
      event.waitUntil(fetch(req).then((res) => put(req, res, versioned)).catch(() => undefined));
      return hit;
    }
    return fromNetwork(event, req, versioned);
  })());
});

// The first visit: the files the page loaded before this worker took over (the page, the game's code and data...).
self.addEventListener('message', (event) => {
  const urls = event.data?.keep;
  if (!Array.isArray(urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const scope = self.registration.scope;
    for (const u of [scope, ...urls.slice(0, 500)]) {
      try {
        const url = new URL(u, scope);
        if (url.origin !== self.location.origin || url.pathname.includes('/__') || url.pathname.endsWith('/sw.js')) continue;
        // (the page is kept as the scope's root, the offline fallback)
        if (u !== scope && url.href.split(/[?#]/)[0] === scope) continue;
        const req = new Request(url.href);
        if (await cache.match(req)) continue;
        // (mostly from the browser's own cache: it was just loaded)
        await put(req, await fetch(req), kind(url).versioned, u === scope || url.pathname.endsWith('.html'));
      } catch {
        // (one that cannot be had now comes with a later visit)
      }
    }
  })());
});
