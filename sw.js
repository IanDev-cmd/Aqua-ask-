/* AquaAsk PWA service worker — app shell + Web Push */
var CACHE = "aquaask-pwa-v5";
var PRECACHE = [
  "/",
  "/index.html",
  "/modes.js",
  "/pwa.js",
  "/qrcode.min.js",
  "/agent-bridge.js",
  "/site-chrome.js",
  "/manifest.webmanifest",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;

  var isDoc = req.mode === "navigate" || url.pathname === "/" || url.pathname === "/install" || /\.html$/i.test(url.pathname);
  if (isDoc) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("/", copy); });
        return res;
      }).catch(function () {
        return caches.match("/") || caches.match("/index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

self.addEventListener("push", function (event) {
  var payload = { title: "AquaAsk", body: "OneAquaHealth update", url: "/" };
  try {
    if (event.data) {
      var parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload.title = parsed.title || payload.title;
        payload.body = parsed.body || payload.body;
        payload.url = parsed.url || payload.url;
      }
    }
  } catch (err) {
    try { payload.body = event.data.text(); } catch (e2) {}
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/pwa/icon-192.png",
      badge: "/pwa/icon-192.png",
      data: { url: payload.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
