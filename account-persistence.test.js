"use strict";

const assert = require("node:assert/strict");
const { createAccountHandler } = require("./server/account-core.cjs");

const userId = "123456789012345678";
const original = {
  id: userId,
  username: "saved.player",
  displayName: "Saved Player",
  avatar: "",
  customization: {
    callsign: "KEEP ME",
    bio: "Saved biography",
    accent: "magenta",
    favoriteMode: "live",
    snakeStyle: "glass",
  },
};
const environment = {
  DISCORD_CLIENT_ID: "1531235601070686228",
  DISCORD_CLIENT_SECRET: "fixture",
  DISCORD_REDIRECT_URI: "https://fixture.invalid/api/auth/discord/callback",
};

async function authenticate({ failRead = false, corruptProfile = false } = {}) {
  let stored = corruptProfile ? "invalid-json" : JSON.stringify(original);
  const initial = stored;
  const writes = [];
  const handler = createAccountHandler({
    environment,
    random: () => "fixture_token_abcdefghijklmnopqrstuvwxyz0123",
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => url.endsWith("/oauth2/token")
        ? { access_token: "fixture", token_type: "Bearer" }
        : { id: userId, username: "saved.player", global_name: "Saved Player", avatar: null },
    }),
    redisCommand: async ([verb, key, value]) => {
      if (verb === "GET" && key === `neon-snake:profile:${userId}`) {
        if (failRead) throw new Error("Temporary database read failure");
        return stored;
      }
      if (verb === "SET") {
        writes.push(key);
        if (key === `neon-snake:profile:${userId}`) stored = value;
        return "OK";
      }
      throw new Error(`Unexpected command: ${verb}`);
    },
  });
  const response = {
    setHeader() {},
    end(body) { this.body = body; },
  };
  await handler({
    method: "POST",
    url: "/api/activity/token",
    headers: {
      host: "fixture.invalid",
      origin: "https://1531235601070686228.discordsays.com",
      "x-forwarded-proto": "https",
    },
    body: { code: "fixture_authorization_code" },
  }, response);
  return { response, stored, initial, writes };
}

(async () => {
  const normal = await authenticate();
  assert.equal(normal.response.statusCode, 200);
  assert.deepEqual(JSON.parse(normal.stored).customization, original.customization);

  for (const options of [{ failRead: true }, { corruptProfile: true }]) {
    const failure = await authenticate(options);
    assert.equal(failure.response.statusCode, 503, "Unreadable saved profiles must fail sign-in safely");
    assert.equal(failure.stored, failure.initial, "Sign-in must not replace an unreadable saved profile");
    assert.deepEqual(failure.writes, [], "Failed profile retrieval must never publish defaults or a new session");
  }
  process.stdout.write("PASS sign-in preserves customization and fails safely on unreadable saved profiles\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
