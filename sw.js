"use strict";

const prefix = "toeic-practice-";
const cacheName = prefix + "6";
const scope = new URL(self.registration.scope);
const shell = ["./", "index.html", "style.css", "app.js", "bank.js", "timings.js",
  "study-data.js", "install.js", "reminders.js", "manifest.webmanifest", "icon-192.png", "icon-512.png",
  "theme/person-1.webp", "theme/person-4.webp",
  ...Array.from({ length: 6 }, (_, index) => "theme/pet-" + (index + 1) + ".webp")];

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
  if (path && !shell.includes(path) && !path.startsWith("material/") && !path.startsWith("theme/")) return;
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

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use the safe default notification. */ }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 40) : "多益每日練習";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 160) : "今天也來練習 10 題吧！";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: new URL("icon-192.png", scope).href, badge: new URL("icon-192.png", scope).href,
    tag: "toeic-daily-reminder", data: { url: new URL("./#units", scope).href }
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL("./#units", scope).href;
  event.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(async windows => {
    const current = windows.find(client => client.url.startsWith(scope.href));
    if (current) { await current.navigate(target); return current.focus(); }
    return clients.openWindow(target);
  }));
});
