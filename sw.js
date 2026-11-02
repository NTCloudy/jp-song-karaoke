// Offline support: the app shell is cached on install; the Japanese dictionary (vendor/) is cached the first time it loads.
const VERSION = "jpk-v5";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/japanese.js", "js/lrc.js", "js/store.js",
  "js/player.js", "js/ai.js", "js/srs.js", "js/demo.js", "js/jp-worker.js", "js/fetchsong.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "jpk-dict").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin && url.pathname.includes("/vendor/kuromoji/")) {
    // dictionary + tokenizer never change for a fixed version: cache first
    e.respondWith(caches.open("jpk-dict").then(async c => (await c.match(e.request)) ||
      fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin === location.origin) {
    // app files: network first (get updates), fall back to cache offline
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
  }
});
