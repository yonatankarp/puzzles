/*
 * Offline support.
 *
 * Vite hashes asset filenames, so rather than precaching a list that would go
 * stale on every build, this caches at runtime: the shell is fetched from the
 * network first so a deploy is picked up promptly, and hashed assets are
 * cache-first because their names change whenever their contents do.
 */
/*
 * Stamped by the build. It used to be the fixed string 'puzzles-v1', which
 * quietly turned the cleanup below into dead code: the filter drops caches that
 * are ours AND not the current one, and with a name that never changed there
 * was never such a cache. Every deploy wrote a fresh set of content-hashed
 * assets into the same bucket under new keys and nothing ever took the old ones
 * out, so a browser's store of this app grew with every release until the
 * origin was evicted wholesale. A name that moves with the release is what
 * makes the sweep mean something.
 */
const CACHE = 'puzzles-__BUILD__';

self.addEventListener('install', event => {
  event.waitUntil(
    // Only './index.html': that is the key the navigation handler puts to and
    // matches on, and the './' copy beside it was written once at install,
    // never read, and never refreshed.
    caches.open(CACHE).then(cache => cache.addAll(['./index.html'])).then(() => self.skipWaiting())
  );
});

/*
 * Drop our own superseded caches, and the ones the retired /zip/ app left on
 * this origin. Named prefixes rather than "everything that is not me": caches
 * are per-origin, not per-path, so an unqualified sweep here reaches into any
 * other app published under the same domain -- this one really did delete the
 * old game's cache out from under it.
 */
const MINE = /^(puzzles-|zip-)/;

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE && MINE.test(n)).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Navigations: network first, and deliberately bypassing the HTTP cache.
   * The host serves the shell with max-age=600, so a plain fetch here can hand
   * back a ten-minute-old page -- long enough to be told about a change and not
   * see it. The shell is under 3 KB and the assets it names are content-hashed,
   * so revalidating it on every navigation costs almost nothing.
   */
  if (request.mode === 'navigate') {
    /*
     * A refusal is not only a dropped connection. Without the status check only
     * a network-level failure reached the catch, so while the host was up and
     * erroring -- a Pages incident, a 500, a 404 on the shell -- the error page
     * was passed straight through and the cached shell sat there unused, which
     * is the one situation this whole file exists for. The asset branch below
     * has always checked; this is the same check, on the more important half.
     */
    event.respondWith(
      fetch(request.url, { cache: 'no-cache' })
        .then(response => {
          if (!response.ok) throw new Error(`shell responded ${response.status}`);
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(hit => hit ?? Response.error()))
    );
    return;
  }

  // Everything else is content-addressed by filename, so the cache cannot be stale.
  event.respondWith(
    caches.match(request).then(hit => hit ?? fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
