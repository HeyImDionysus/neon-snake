"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { executeRedisRest, RedisUnavailableError } = require("./server/redis-rest.cjs");
const { createAccountHandler } = require("./server/account-core.cjs");

const environment = {
  STORAGE_KV_REST_API_URL: "https://redis.example.invalid",
  STORAGE_KV_REST_API_TOKEN: "placeholder",
};

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function responseHarness() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = String(body || ""); },
  };
}

const tests = [
  ["scripts are sent by digest and the body only when Redis has not cached it", async () => {
    const script = "return 1";
    const sent = [];
    let cached = false;
    const fetchImpl = async (_url, { body }) => {
      const command = JSON.parse(body);
      sent.push(command[0]);
      if (command[0] === "EVALSHA") {
        assert.equal(command[1], createHash("sha1").update(script).digest("hex"));
        return cached
          ? jsonResponse(200, { result: 1 })
          : jsonResponse(200, { error: "NOSCRIPT No matching script." });
      }
      cached = true;
      return jsonResponse(200, { result: 1 });
    };
    assert.equal(await executeRedisRest(["EVAL", script, "0"], { environment, fetchImpl }), 1);
    assert.deepEqual(sent, ["EVALSHA", "EVAL"], "An unknown script falls back to EVAL once");
    sent.length = 0;
    assert.equal(await executeRedisRest(["EVAL", script, "0"], { environment, fetchImpl }), 1);
    assert.deepEqual(sent, ["EVALSHA"], "A cached script is never re-sent");
  }],
  ["a Redis outage is an unavailable service, not bad input", async () => {
    const unreachable = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(
      executeRedisRest(["GET", "key"], { environment, fetchImpl: unreachable }),
      (error) => error instanceof RedisUnavailableError && !(error instanceof TypeError),
    );
    await assert.rejects(
      executeRedisRest(["GET", "key"], { environment, fetchImpl: async () => jsonResponse(502, {}) }),
      /HTTP 502/,
    );
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args);
    try {
      const handler = createAccountHandler({ environment, fetchImpl: unreachable });
      const response = responseHarness();
      await handler({
        method: "GET",
        url: "/api/leaderboard",
        headers: { host: "neon.example", "x-forwarded-proto": "https" },
      }, response);
      assert.equal(response.statusCode, 503, "An unreachable Redis must not answer 400 invalid_request");
      assert.equal(logged.length, 1, "The outage is logged");
      assert.match(logged[0][1].message, /unreachable/);
    } finally {
      console.error = originalError;
    }
  }],
];

(async () => {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`PASS ${name}\n`);
  }
  process.stdout.write(`\n${tests.length} Redis client tests passed.\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
