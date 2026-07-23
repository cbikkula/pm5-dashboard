/* PM5 Dashboard — minimal service worker.
 *
 * Goals (in order):
 *   1. Make the page eligible for the browser's "Install app" prompt.
 *      Chrome / Edge require a service worker that responds to fetch
 *      events before they'll offer install.
 *   2. Serve the cached shell instantly on revisit — feels native.
 *   3. Stay out of the way of every external request (Drive API,
 *      Google Identity Services, Web Bluetooth — none of those are
 *      cached or proxied).
 *
 * Caching strategy: stale-while-revalidate for the local app shell
 * (HTML + icons + manifest). Network-first with no caching for
 * everything else, so authenticated Drive calls etc. always go live.
 */
// Bump this when you redeploy to force a fresh shell on every client.
const CACHE_VERSION = "pm5-v49";
const SHELL = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./firebase-config.js",
  "./analysis.js",
  "./curves.js",
  "./insights.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Cross-origin (Google APIs, GIS script, etc.) → don't touch.
  if (url.origin !== self.location.origin) return;

  // The HTML document and our JS are network-first, falling back to
  // cache only when offline. This guarantees the latest deploy is
  // picked up on every visit — critical because index.html,
  // analysis.js (v1.20.0 split), and curves.js (v1.21.0) must never be
  // served from different releases in the same page load.
  const isShellDoc = url.pathname.endsWith(".html") || url.pathname === "/" ||
                     url.pathname === "" || req.mode === "navigate" ||
                     url.pathname.endsWith("/analysis.js") ||
                     url.pathname.endsWith("/curves.js") ||
                     url.pathname.endsWith("/insights.js");
  if (isShellDoc) {
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Static assets (manifest, icons): cache-first, refresh in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
