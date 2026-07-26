"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const origin = "https://neon-snake.invalid";
const source = fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8");
const listeners = new Map();
const stores = new Map();
let skipWaitingCalls = 0;
let claimCalls = 0;
let rejectCacheWrites = false;

function requestKey(request) {
  const value = typeof request === "string" ? request : request.url;
  return new URL(value, origin).href;
}

function response(body, ok = true) {
  return {
    body,
    ok,
    clone() {
      return response(body, ok);
    },
  };
}

function cacheFor(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const entries = stores.get(name);
  return {
    async addAll(urls) {
      urls.forEach((url) => entries.set(requestKey(url), response(`shell:${url}`)));
    },
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

const sandbox = {
  URL,
  caches,
  fetch: async (request) => response(`network:${request.url}`),
  Response: { error: () => response("error", false) },
  self: {
    location: { origin },
    clients: {
      async claim() {
        claimCalls += 1;
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

async function dispatchFetch(request) {
  let pending;
  listeners.get("fetch")({
    request,
    respondWith(promise) {
      pending = promise;
    },
  });
  return pending;
}

async function main() {
  await dispatchWaitUntil("install");
  const activeName = [...stores.keys()].find((name) => name.startsWith("neon-snake-shell-v"));
  const shell = stores.get(activeName);
  assert.ok(activeName, "Expected a versioned shell cache");
  assert.equal(skipWaitingCalls, 1);
  ["/index.html", "/duel.html", "/assets/icon-192.png", "/assets/icon-512.png"].forEach((url) => {
    assert.ok(shell.has(requestKey(url)), `Install omitted ${url}`);
  });
  process.stdout.write("PASS install primes the complete versioned app shell\n");

  assert.match(source, /neon-snake-shell-v41/);
  process.stdout.write("PASS Signal Cartography ships behind a fresh shell cache version\n");

  stores.set("neon-snake-shell-stale", new Map());
  await dispatchWaitUntil("activate");
  assert.equal(stores.has("neon-snake-shell-stale"), false);
  assert.equal(claimCalls, 1);
  process.stdout.write("PASS activation removes stale caches and claims clients\n");

  const onlineRequest = {
    method: "GET",
    mode: "navigate",
    url: `${origin}/?signal=ONLINE`,
  };
  const onlineResponse = await dispatchFetch(onlineRequest);
  assert.equal(onlineResponse.body, `network:${onlineRequest.url}`);
  assert.equal(shell.get(onlineRequest.url)?.body, `network:${onlineRequest.url}`);
  process.stdout.write("PASS successful responses finish caching before delivery\n");

  rejectCacheWrites = true;
  const uncachedRequest = {
    method: "GET",
    mode: "navigate",
    url: `${origin}/?signal=QUOTA`,
  };
  const uncachedResponse = await dispatchFetch(uncachedRequest);
  assert.equal(uncachedResponse.body, `network:${uncachedRequest.url}`);
  rejectCacheWrites = false;
  process.stdout.write("PASS cache-write failure cannot discard a valid network response\n");

  sandbox.fetch = async () => {
    throw new Error("offline");
  };
  const soloFallback = await dispatchFetch({
    method: "GET",
    mode: "navigate",
    url: `${origin}/?signal=OFFLINE`,
  });
  const duelFallback = await dispatchFetch({
    method: "GET",
    mode: "navigate",
    url: `${origin}/duel?room=OFFLINE`,
  });
  assert.equal(soloFallback.body, "shell:/index.html");
  assert.equal(duelFallback.body, "shell:/duel.html");
  process.stdout.write("PASS offline navigation preserves solo and Duel routes\n");

  process.stdout.write("\n6 deterministic service-worker lifecycle tests passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
