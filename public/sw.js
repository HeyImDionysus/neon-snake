"use strict";

const CACHE_NAME = "neon-snake-shell-v41";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/duel.html",
  "/duel.css",
  "/duel.js",
  "/room-transport.js",
  "/signal-field.js",
  "/game-logic.js",
  "/game.js",
  "/manifest.webmanifest",
  "/assets/signal-mark.svg",
  "/assets/icon.svg",
  "/assets/icon-180.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
          } catch {
            // A quota or unsupported-response failure must not replace a valid network response.
          }
        }
        return response;
      } catch {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const fallback = requestUrl.pathname.startsWith("/duel") ? "/duel.html" : "/index.html";
          return caches.match(fallback);
        }
        return Response.error();
      }
    })()
  );
});
