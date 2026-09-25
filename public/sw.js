"use strict";

const CACHE_NAME = "neon-snake-shell-837fdcc059";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/activity-boot.css",
  "/activity-boot.js",
  "/duel.html",
  "/activity-redirect.js",
  "/activity-sdk.js",
  "/downloads.html",
  "/profile.html",
  "/privacy.html",
  "/terms.html",
  "/wallpaper.html",
  "/duel.css",
  "/site-shell.js",
  "/downloads.css",
  "/downloads.js",
  "/profile.css",
  "/legal.css",
  "/duel.js",
  "/account.js",
  "/profile-config.js",
  "/profile.js",
  "/runtime-config.js",
  "/wallpaper.css",
  "/wallpaper-engine.js",
  "/wallpaper.js",
  "/room-transport.js",
  "/touch-controls.js",
  "/signal-field.js",
  "/game-logic.js",
  "/game.js",
  "/activity-boot.css?v=837fdcc059",
  "/styles.css?v=837fdcc059",
  "/duel.css?v=837fdcc059",
  "/activity-boot.js?v=837fdcc059",
  "/activity-redirect.js?v=837fdcc059",
  "/signal-field.js?v=837fdcc059",
  "/site-shell.js?v=837fdcc059",
  "/runtime-config.js?v=837fdcc059",
  "/activity-sdk.js?v=837fdcc059",
  "/account.js?v=837fdcc059",
  "/game-logic.js?v=837fdcc059",
  "/room-transport.js?v=837fdcc059",
  "/touch-controls.js?v=837fdcc059",
  "/game.js?v=837fdcc059",
  "/duel.js?v=837fdcc059",
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
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith("/api/")
  ) return;

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
          let fallback = "/index.html";
          if (requestUrl.pathname.startsWith("/duel")) fallback = "/duel.html";
          else if (requestUrl.pathname.startsWith("/downloads")) fallback = "/downloads.html";
          else if (requestUrl.pathname.startsWith("/profile")) fallback = "/profile.html";
          else if (requestUrl.pathname.startsWith("/privacy")) fallback = "/privacy.html";
          else if (requestUrl.pathname.startsWith("/terms")) fallback = "/terms.html";
          else if (requestUrl.pathname.startsWith("/wallpaper")) fallback = "/wallpaper.html";
          return caches.match(fallback);
        }
        return Response.error();
      }
    })()
  );
});
