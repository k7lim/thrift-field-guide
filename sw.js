/* Field Guide service worker.
 *
 * Offline is the hard requirement (a thrift rack in a basement has no signal),
 * but a deploy must never be masked by a stale shell — so:
 *   - navigations / index.html : network-first, cache as fallback
 *   - everything else          : cache-first, network fills the cache
 * The cache name carries the build hash, so a new build starts a fresh cache
 * and `activate` deletes every older one.
 */
'use strict';

var BUILD = '4aadedcb39ae';
var CACHE = 'fieldguide-' + BUILD;
var SHELL = ['./', 'index.html', 'manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* a missing optional file must not block install */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE && k.indexOf('fieldguide-') === 0) return caches.delete(k);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function isShell(req, url) {
  if (req.mode === 'navigate') return true;
  var p = url.pathname;
  return p.charAt(p.length - 1) === '/' || /index\.html$/.test(p);
}

/* Offline fallback for the shell: the exact request, then either index form. */
function shellFromCache(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return caches.match('index.html').then(function (idx) {
      return idx || caches.match('./');
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (isShell(req, url)) {
    /* network-first: a fresh deploy wins, the cache only covers being offline */
    e.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        })
        .catch(function () { return shellFromCache(req); })
    );
    return;
  }

  /* cache-first for static assets */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    })
  );
});
