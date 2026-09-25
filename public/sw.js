"use strict";

const CACHE_NAME = "neon-snake-shell-0dbba60996";
// Pages plus the stamped assets they load. Stamped URLs change whenever their
// content does, so each is immutable. The wallpaper page is packaged for local
// files and loads plain references. The Discord SDK is not here: it only loads
// inside the Activity, where no service worker runs.
const APP_SHELL = [
  "/",
  "/index.html",
  "/duel.html",
  "/downloads.html",
  "/profile.html",
  "/privacy.html",
  "/terms.html",
  "/wallpaper.html",
  "/activity-boot.css?v=0dbba60996",
  "/styles.css?v=0dbba60996",
  "/duel.css?v=0dbba60996",
  "/downloads.css?v=0dbba60996",
  "/profile.css?v=0dbba60996",
  "/legal.css?v=0dbba60996",
  "/wallpaper.css?v=0dbba60996",
  "/activity-boot.js?v=0dbba60996",
  "/activity-redirect.js?v=0dbba60996",
  "/activity-loader.js?v=0dbba60996",
  "/signal-field.js?v=0dbba60996",
  "/site-shell.js?v=0dbba60996",
  "/runtime-config.js?v=0dbba60996",
  "/account.js?v=0dbba60996",
  "/profile-config.js?v=0dbba60996",
  "/profile.js?v=0dbba60996",
  "/downloads.js?v=0dbba60996",
  "/game-logic.js?v=0dbba60996",
  "/wallpaper-engine.js?v=0dbba60996",
  "/wallpaper.js?v=0dbba60996",
  "/room-transport.js?v=0dbba60996",
  "/touch-controls.js?v=0dbba60996",
  "/game.js?v=0dbba60996",
  "/decision-worker.js?v=0dbba60996",
  "/duel.js?v=0dbba60996",
  "/wallpaper.css",
  "/game-logic.js",
  "/wallpaper-engine.js",
  "/wallpaper.js",
  "/manifest.webmanifest",
  "/assets/signal-mark.svg",
  "/assets/icon.svg",
  "/assets/icon-180.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png"
];
const SHELL = new Set(APP_SHELL);
// A flaky connection falls back to the offline copy instead of hanging.
const NAVIGATION_TIMEOUT_MS = 4_000;
const PAGE_FALLBACKS = [
  ["/duel", "/duel.html"],
  ["/downloads", "/downloads.html"],
  ["/profile", "/profile.html"],
  ["/privacy", "/privacy.html"],
  ["/terms", "/terms.html"],
  ["/wallpaper", "/wallpaper.html"],
];

// Vercel's clean URLs answer /duel.html with a redirect to /duel. A redirected
// response cannot answer a navigation, so offline pages failed to open even
// when cached. Pages are stored as plain, redirect-free copies.
async function storable(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error(`Precache failed for ${url}`);
      await cache.put(url, await storable(response));
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const stale = (await caches.keys()).filter((key) => key !== CACHE_NAME);
    await Promise.all(stale.map((key) => caches.delete(key)));
    await self.clients.claim();
    // An open tab keeps running the scripts it loaded, now against newer files
    // and servers; tell it a new version took over so it can offer a reload.
    if (stale.length) {
      const windows = await self.clients.matchAll({ type: "window" });
      windows.forEach((client) => client.postMessage({ type: "neon-snake-updated" }));
    }
  })());
});

function pageFallback(pathname) {
  return PAGE_FALLBACKS.find(([prefix]) => pathname.startsWith(prefix))?.[1] || "/index.html";
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Network timed out")), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);
  if (
    request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith("/api/")
  ) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
        if (response.ok) {
          const key = SHELL.has(requestUrl.pathname) ? requestUrl.pathname : pageFallback(requestUrl.pathname);
          const copy = response.clone();
          // Stored in the background: the page is never held back by the cache.
          event.waitUntil(storable(copy)
            .then((page) => caches.open(CACHE_NAME).then((cache) => cache.put(key, page)))
            .catch(() => {}));
        }
        return response;
      } catch {
        return (await caches.match(requestUrl.pathname)) || (await caches.match(pageFallback(requestUrl.pathname))) || Response.error();
      }
    })());
    return;
  }

  // Only the app shell is served from the cache. Downloads, portal artwork and
  // every other file go straight to the network and are never stored.
  const key = `${requestUrl.pathname}${requestUrl.search}`;
  if (!SHELL.has(key)) return;
  event.respondWith((async () => {
    const cached = await caches.match(key);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(key, copy)).catch(() => {}));
    }
    return response;
  })());
});
