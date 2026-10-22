/**
 * The service worker.
 *
 * The app's own files are cached as they are fetched - there is no list
 * to keep in step, and nothing goes stale when a file is renamed. The
 * player pool is never cached: it is 3.7MB and it changes when the data
 * is rebuilt, and a stale pool is worse than no pool.
 *
 * The network comes first. A cached file that is never checked again
 * means a deploy is invisible to every player who has been here before,
 * so the cache is what the game falls back to when it cannot reach the
 * network, not what it serves from.
 */

// Bumped so every browser that has the old worker drops its old cache.
// With the network first, later deploys do not need a bump.
const VERSION = 'football-trivia-v2';
const SHELL = `${VERSION}-shell`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== SHELL).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** The pool is never cached, and neither is anything that is not ours. */
function isCacheable(url) {
  if (url.pathname.includes('/data/fixtures/')) return false;
  if (url.pathname.startsWith('/rest/')) return false;
  if (url.pathname.startsWith('/auth/')) return false;
  if (url.pathname.startsWith('/functions/')) return false;
  return url.origin === self.location.origin;
}

/** What the player sees when the game cannot reach the network. */
function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title>'
    + '<body style="font-family:system-ui;padding:24px">'
    + '<h1>You are offline</h1>'
    + '<p>The game needs a connection to play.</p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isCacheable(url)) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      // Only a good response is worth keeping. An error page stored as
      // the shell would be served to everybody afterwards.
      if (fresh.ok) {
        const cache = await caches.open(SHELL);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return offlinePage();
      return new Response('', { status: 504 });
    }
  })());
});
