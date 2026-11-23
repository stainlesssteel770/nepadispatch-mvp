/* Dispatch MVP service worker — app-shell cache only.
   Static prototype: no push, no background sync, no network calls
   beyond the static assets listed in SHELL. Role checks and privacy
   hiding remain browser-only simulations (see app.js header).
   Versioning: CACHE_NAME carries the build token (?v=). A new build
   ships a new token, so the new worker installs, precaches the new
   shell, and deletes every older cache on activate — updates apply
   cleanly and the old shell can never be served again. */
var VERSION = "20261123-fix3";
var CACHE_NAME = "dispatch-mvp-" + VERSION;
var SHELL = [
  "./",
  "index.html",
  "styles.css?v=20261123-fix3",
  "app.js?v=20261123-fix3",
  "seed.js?v=20261123-fix3",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // Never intercept the worker's own script: the browser's update
  // check must always reach the network, or a new build could never
  // replace this worker.
  if (url.pathname.endsWith("/sw.js")) return;
  // Only same-origin requests are cacheable here.
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Navigations: network first so a fresh deploy reaches the app
    // while online; cache fallback so the installed app still launches
    // offline. The fresh response replaces the cached shell entry.
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match("index.html");
        });
      })
    );
    return;
  }

  // Versioned static assets (css/js with ?v=, manifest, icons):
  // cache first — the ?v= token makes every build a new URL, so a
  // cached entry can never be stale. Network fallback fills the
  // cache for anything not precached.
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
