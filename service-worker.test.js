"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const origin = "https://neon-snake.invalid";
const source = fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8");
// The cache-busting stamp is derived from asset content by
// scripts/stamp-assets.mjs; tests read it rather than pinning a literal.
const ASSET_STAMP = (() => {
  const match = source.match(/const CACHE_NAME = "neon-snake-shell-([0-9a-z]+)";/);
  assert.ok(match, "public/sw.js must declare a stamped CACHE_NAME");
  return match[1];
})();

const listeners = new Map();
const stores = new Map();
const posted = [];
let skipWaitingCalls = 0;
let claimCalls = 0;
let rejectCacheWrites = false;

function requestKey(request) {
  const value = typeof request === "string" ? request : request.url;
  return new URL(value, origin).href;
}

class FakeResponse {
  constructor(body, { status = 200, statusText = "", headers = {}, redirected = false } = {}) {
    this.body = body;
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.redirected = redirected;
    this.ok = status >= 200 && status < 300;
  }

  clone() {
    return new FakeResponse(this.body, this);
  }

  async blob() {
    return this.body;
  }

  static error() {
    return new FakeResponse("error", { status: 0 });
  }
}

function cacheFor(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const entries = stores.get(name);
  return {
    async put(request, value) {
      if (rejectCacheWrites) throw new Error("cache write failed");
      entries.set(requestKey(request), value);
    },
    async match(request) {
      return entries.get(requestKey(request));
    },
  };
}

const caches = {
  async open(name) {
    return cacheFor(name);
  },
  async keys() {
    return [...stores.keys()];
  },
  async delete(name) {
    return stores.delete(name);
  },
  async match(request) {
    const key = requestKey(request);
    for (const entries of stores.values()) {
      if (entries.has(key)) return entries.get(key);
    }
    return undefined;
  },
};

// Vercel's clean URLs redirect the .html pages.
const network = async (request) => {
  const url = typeof request === "string" ? request : request.url;
  return new FakeResponse(`network:${url}`, { redirected: /\.html$/.test(url) });
};

const sandbox = {
  URL,
  caches,
  fetch: network,
  Response: FakeResponse,
  setTimeout,
  clearTimeout,
  self: {
    location: { origin },
    clients: {
      async claim() {
        claimCalls += 1;
      },
      async matchAll() {
        return [{ postMessage: (message) => posted.push(message) }];
      },
    },
    skipWaiting() {
      skipWaitingCalls += 1;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  },
};

vm.runInNewContext(source, sandbox, { filename: "public/sw.js" });

async function dispatchWaitUntil(type) {
  let pending;
  listeners.get(type)({
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
}

// Returns the response and, separately, the background work it scheduled.
async function dispatchFetch(request) {
  let pending = null;
  const background = [];
  listeners.get("fetch")({
    request,
    respondWith(promise) {
      pending = promise;
    },
    waitUntil(promise) {
      background.push(promise);
    },
  });
  return { response: pending && await pending, settled: () => Promise.all(background), handled: Boolean(pending) };
}

async function main() {
  await dispatchWaitUntil("install");
  const activeName = `neon-snake-shell-${ASSET_STAMP}`;
  const shell = stores.get(activeName);
  assert.ok(shell, "Expected the shell cache to be named for the current asset stamp");
  assert.equal(skipWaitingCalls, 1);
  ["/", "/index.html", "/duel.html", "/downloads.html", "/profile.html", "/privacy.html", "/terms.html", "/wallpaper.html",
    `/styles.css?v=${ASSET_STAMP}`, `/activity-boot.js?v=${ASSET_STAMP}`, `/activity-loader.js?v=${ASSET_STAMP}`,
    `/game.js?v=${ASSET_STAMP}`, `/duel.js?v=${ASSET_STAMP}`, `/profile.js?v=${ASSET_STAMP}`, "/wallpaper.js",
    "/assets/icon-192.png", "/assets/icon-512.png"].forEach((url) => {
    assert.ok(shell.has(requestKey(url)), `Install omitted ${url}`);
  });
  for (const unwanted of ["/activity-sdk.js", `/activity-sdk.js?v=${ASSET_STAMP}`, "/game.js", "/styles.css"]) {
    assert.equal(shell.has(requestKey(unwanted)), false, `The shell must not precache ${unwanted}`);
  }
  process.stdout.write("PASS install primes the stamped app shell without duplicates or the Discord SDK\n");

  // A redirected response cannot answer a navigation, which is what broke
  // offline pages behind Vercel's clean-URL redirects.
  assert.equal(shell.get(requestKey("/duel.html")).redirected, false);
  assert.equal(shell.get(requestKey("/duel.html")).body, "network:/duel.html");
  process.stdout.write("PASS precached pages are stored as redirect-free copies\n");

  stores.set("neon-snake-shell-stale", new Map());
  await dispatchWaitUntil("activate");
  assert.equal(stores.has("neon-snake-shell-stale"), false);
  assert.equal(claimCalls, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "neon-snake-updated", "Open tabs are told a new version took over");
  process.stdout.write("PASS activation removes stale caches, claims clients and announces the update\n");

  const online = await dispatchFetch({ method: "GET", mode: "navigate", url: `${origin}/duel?room=ONLINE` });
  assert.equal(online.response.body, `network:${origin}/duel?room=ONLINE`);
  await online.settled();
  assert.equal(shell.get(requestKey("/duel.html")).body, `network:${origin}/duel?room=ONLINE`,
    "A fresh page is stored in the background under its page key");
  process.stdout.write("PASS pages are delivered at once and cached in the background\n");

  rejectCacheWrites = true;
  const quota = await dispatchFetch({ method: "GET", mode: "navigate", url: `${origin}/?signal=QUOTA` });
  assert.equal(quota.response.body, `network:${origin}/?signal=QUOTA`);
  await quota.settled();
  rejectCacheWrites = false;
  process.stdout.write("PASS a cache-write failure cannot discard a valid network response\n");

  const download = await dispatchFetch({ method: "GET", mode: "no-cors", url: `${origin}/downloads/v1.1.3/Neon-Snake-Lively-v1.1.3.zip` });
  const portalArt = await dispatchFetch({ method: "GET", mode: "no-cors", url: `${origin}/assets/discord/neon-snake-icon.png` });
  assert.equal(download.handled, false, "Downloads go straight to the network and are never stored");
  assert.equal(portalArt.handled, false);
  process.stdout.write("PASS only the app shell is cached; downloads and artwork are not\n");

  sandbox.fetch = () => new Promise(() => {});
  sandbox.setTimeout = (callback) => setTimeout(callback, 0);
  const slow = await dispatchFetch({ method: "GET", mode: "navigate", url: `${origin}/profile?user=slow` });
  assert.match(slow.response.body, /\/profile\.html$/, "A hanging network falls back to the offline page");
  process.stdout.write("PASS a slow network times out to the offline page\n");

  sandbox.fetch = async () => {
    throw new Error("offline");
  };
  const asset = await dispatchFetch({ method: "GET", mode: "no-cors", url: `${origin}/game.js?v=${ASSET_STAMP}` });
  assert.equal(asset.response.body, `network:/game.js?v=${ASSET_STAMP}`);
  const routes = {
    "/?signal=OFFLINE": "/",
    "/duel?room=OFFLINE": "/duel.html",
    "/wallpaper": "/wallpaper.html",
    "/downloads": "/downloads.html",
    "/privacy": "/privacy.html",
    "/terms": "/terms.html",
  };
  for (const [route, page] of Object.entries(routes)) {
    const offline = await dispatchFetch({ method: "GET", mode: "navigate", url: `${origin}${route}` });
    assert.ok(offline.response.ok, `Offline navigation to ${route} must resolve`);
    assert.equal(offline.response, shell.get(requestKey(page)), `${route} must open the cached ${page}`);
  }
  process.stdout.write("PASS offline navigation preserves game, profile, legal, and wallpaper routes\n");

  process.stdout.write("\n8 deterministic service-worker lifecycle tests passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
