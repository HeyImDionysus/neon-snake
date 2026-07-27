"use strict";

const assert = require("node:assert/strict");
const {
  createAccountHandler,
  digest,
  sanitizeProfileCustomization,
} = require("./server/account-core.cjs");

function responseHarness() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value);
    },
  };
}

function request(url, {
  method = "GET",
  headers = {},
  body,
} = {}) {
  return {
    method,
    url,
    headers: {
      host: "neon-snake-green-tau.vercel.app",
      origin: "https://neon-snake-green-tau.vercel.app",
      "x-forwarded-host": "neon-snake-green-tau.vercel.app",
      "x-forwarded-proto": "https",
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  };
}

function redisHarness() {
  const values = new Map();
  const hashes = new Map();
  const commands = [];
  const command = async (parts) => {
    commands.push(parts);
    const [verb, key, ...rest] = parts;
    if (verb === "GET") return values.get(key) ?? null;
    if (verb === "SET") {
      values.set(key, rest[0]);
      return "OK";
    }
    if (verb === "MGET") return [key, ...rest].map((entry) => values.get(entry) ?? null);
    if (verb === "HGETALL") return hashes.get(key) || [];
    if (verb === "EVAL" && String(key).includes("ZREVRANGE")) {
      return ["123456789012345678", "7", "3", "2", "1785124800000"];
    }
    throw new Error(`Unsupported fake Redis command: ${verb}`);
  };
  return { command, commands, hashes, values };
}

(async () => {
  const customized = sanitizeProfileCustomization({
    callsign: "  Night Viper  ",
    bio: "Wins quietly.\u0000",
    accent: "magenta",
    favoriteMode: "live",
    snakeStyle: "spectral",
  });
  assert.deepEqual(customized, {
    callsign: "Night Viper",
    bio: "Wins quietly.",
    accent: "magenta",
    favoriteMode: "live",
    snakeStyle: "spectral",
  });
  assert.deepEqual(sanitizeProfileCustomization({
    callsign: "<script>",
    bio: "x".repeat(500),
    accent: "url(javascript:bad)",
    favoriteMode: "unknown",
    snakeStyle: "unknown",
  }), {
    callsign: "script",
    bio: "x".repeat(120),
    accent: "acid",
    favoriteMode: "classic",
    snakeStyle: "signal",
  });

  const redis = redisHarness();
  const sessionToken = "session_token_with_32_safe_characters";
  const userId = "123456789012345678";
  redis.values.set(`neon-snake:session:${digest(sessionToken)}`, JSON.stringify({
    userId,
    createdAt: 1,
    expiresAt: 9_999_999_999_999,
  }));
  redis.values.set(`neon-snake:username:signal_player`, userId);
  redis.values.set(`neon-snake:profile:${userId}`, JSON.stringify({
    id: userId,
    username: "signal_player",
    displayName: "Signal Player",
    avatar: "a_1234567890abcdef",
    customization: customized,
  }));
  redis.values.set(`neon-snake:activity:${userId}`, "1785124800000");
  redis.hashes.set(`neon-snake:stats:${userId}`, [
    "wins", "7",
    "losses", "3",
    "draws", "2",
  ]);

  const handler = createAccountHandler({
    now: () => 1_785_124_800_500,
    environment: {
      DISCORD_CLIENT_ID: userId,
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_REDIRECT_URI: "https://neon-snake-green-tau.vercel.app/api/auth/discord/callback",
    },
    redisCommand: redis.command,
  });

  const publicResponse = responseHarness();
  await handler(request("/api/profile?user=signal_player"), publicResponse);
  assert.equal(publicResponse.statusCode, 200);
  const publicPayload = JSON.parse(publicResponse.body);
  assert.equal(publicPayload.profile.username, "signal_player");
  assert.equal(publicPayload.profile.callsign, "Night Viper");
  assert.equal(publicPayload.profile.online, true);
  assert.deepEqual(publicPayload.profile.stats, {
    wins: 7,
    losses: 3,
    draws: 2,
    matches: 12,
  });
  assert.equal("id" in publicPayload.profile, false);

  const patchResponse = responseHarness();
  await handler(request("/api/profile", {
    method: "PATCH",
    headers: {
      cookie: `__Host-neon_session=${sessionToken}`,
      "content-type": "application/json",
    },
    body: {
      callsign: "Arc Runner",
      bio: "Portal specialist",
      accent: "cyan",
      favoriteMode: "portal",
      snakeStyle: "glass",
    },
  }), patchResponse);
  assert.equal(patchResponse.statusCode, 200);
  const patched = JSON.parse(patchResponse.body).profile;
  assert.equal(patched.callsign, "Arc Runner");
  assert.equal(patched.username, "signal_player");
  assert.equal(patched.accent, "cyan");

  const forbiddenResponse = responseHarness();
  await handler(request("/api/profile", {
    method: "PATCH",
    headers: {
      cookie: `__Host-neon_session=${sessionToken}`,
      origin: "https://attacker.invalid",
    },
    body: {},
  }), forbiddenResponse);
  assert.equal(forbiddenResponse.statusCode, 403);

  const leaderboardResponse = responseHarness();
  await handler(request("/api/leaderboard"), leaderboardResponse);
  assert.equal(leaderboardResponse.statusCode, 200);
  const entry = JSON.parse(leaderboardResponse.body).entries[0];
  assert.equal(entry.username, "signal_player");
  assert.equal(entry.callsign, "Arc Runner");
  assert.equal(entry.online, true);
  assert.deepEqual(entry.record, { wins: 7, losses: 3, draws: 2 });

  process.stdout.write("PASS public profiles, safe customization, visible usernames, activity, and records stay server-backed\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
