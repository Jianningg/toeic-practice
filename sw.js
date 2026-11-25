"use strict";

const prefix = "toeic-practice-";
const cacheName = prefix + "1";
const scope = new URL(self.registration.scope);
const shell = ["./", "index.html", "style.css", "app.js", "bank.js", "timings.js",
  "study-data.js", "install.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) ||
      request.headers.has("range") || url.pathname.endsWith(".m4a")) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path && !shell.includes(path) && !path.startsWith("material/")) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const key = request.mode === "navigate" ? scope.href : request;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw error;
    }
  }));
});
