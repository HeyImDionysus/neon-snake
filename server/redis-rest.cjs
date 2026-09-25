"use strict";

// The Upstash Redis REST client shared by the account API and the realtime
// hub. Credentials are read only here, on the server.

const { createHash } = require("node:crypto");

function redisConfig(environment = process.env) {
  const url = environment.STORAGE_KV_REST_API_URL
    || environment.KV_REST_API_URL
    || environment.UPSTASH_REDIS_REST_URL;
  const token = environment.STORAGE_KV_REST_API_TOKEN
    || environment.KV_REST_API_TOKEN
    || environment.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("The room database is not configured.");
  }
  return {
    url: String(url).replace(/\/+$/, ""),
    token: String(token),
  };
}

// Network failures reach callers as this error rather than fetch's TypeError,
// which the API handlers reserve for bad input: a Redis outage used to answer
// every request with 400 invalid_request and was never logged.
class RedisUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RedisUnavailableError";
  }
}

const scriptDigests = new Map();

function scriptDigest(script) {
  let digest = scriptDigests.get(script);
  if (!digest) {
    digest = createHash("sha1").update(script).digest("hex");
    scriptDigests.set(script, digest);
  }
  return digest;
}

async function redisRestCall(command, { environment, fetchImpl }) {
  const config = redisConfig(environment);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new RedisUnavailableError(`Redis unreachable: ${error?.name || "Error"}.`, { cause: error });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (/^NOSCRIPT/.test(String(payload?.error || ""))) return { noScript: true };
    throw new RedisUnavailableError(`Redis request failed (HTTP ${response.status}).`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new RedisUnavailableError("Redis returned an unreadable response.", { cause: error });
  }
  if (/^NOSCRIPT/.test(String(payload?.error || ""))) return { noScript: true };
  if (payload?.error) throw new Error("Redis command failed.");
  return { result: payload?.result };
}

async function executeRedisRest(command, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  // Scripts are sent by digest. Re-sending a multi-kilobyte Lua body on every
  // heartbeat and roster change was pure bandwidth; the body is sent again
  // only when Redis reports it has not seen the script.
  if (command[0] === "EVAL" && typeof command[1] === "string") {
    const cached = await redisRestCall(["EVALSHA", scriptDigest(command[1]), ...command.slice(2)], {
      environment,
      fetchImpl,
    });
    if (!cached.noScript) return cached.result;
  }
  const outcome = await redisRestCall(command, { environment, fetchImpl });
  if (outcome.noScript) throw new Error("Redis command failed.");
  return outcome.result;
}

module.exports = {
  RedisUnavailableError,
  executeRedisRest,
  redisConfig,
};
