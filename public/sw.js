"use strict";

const CACHE_NAME = "neon-snake-shell-835f956b50";
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
  "/activity-boot.css?v=835f956b50",
  "/styles.css?v=835f956b50",
  "/duel.css?v=835f956b50",
  "/activity-boot.js?v=835f956b50",
  "/activity-redirect.js?v=835f956b50",
  "/signal-field.js?v=835f956b50",
  "/site-shell.js?v=835f956b50",
  "/runtime-config.js?v=835f956b50",
  "/activity-sdk.js?v=835f956b50",
  "/account.js?v=835f956b50",
  "/game-logic.js?v=835f956b50",
  "/room-transport.js?v=835f956b50",
  "/touch-controls.js?v=835f956b50",
  "/game.js?v=835f956b50",
  "/duel.js?v=835f956b50",
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
