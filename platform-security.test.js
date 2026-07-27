"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  accountAvailable,
  createAccountHandler,
  publicProfile,
  recordMatchResult,
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
      "x-forwarded-proto": "https",
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  };
}

(async () => {
  const profile = publicProfile({
    id: "123456789012345678",
    username: "signal_player",
    global_name: "Signal Player",
    avatar: "a_1234567890abcdef",
    email: "must-not-be-stored@example.com",
  });
  assert.deepEqual({
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    avatar: profile.avatar,
  }, {
    id: "123456789012345678",
    username: "signal_player",
    displayName: "Signal Player",
    avatar: "a_1234567890abcdef",
  });
  assert.equal("email" in profile, false);
  assert.throws(() => publicProfile({ id: "not-a-snowflake" }), /invalid/i);

  const commands = [];
  const environment = {
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_CLIENT_SECRET: "discord-secret",
    DISCORD_REDIRECT_URI: "https://neon-snake-green-tau.vercel.app/api/auth/discord/callback",
  };
  const handler = createAccountHandler({
    environment,
    random: () => "state_token_with_32_safe_characters_1234",
    redisCommand: async (command) => {
      commands.push(command);
      return command[0] === "SET" ? "OK" : null;
    },
  });
  assert.equal(accountAvailable(environment), true);
  assert.equal(accountAvailable({}), false);
  const startResponse = responseHarness();
  await handler(request("/api/auth/discord/start"), startResponse);
  assert.equal(startResponse.statusCode, 302);
  assert.match(startResponse.headers.location, /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  const authorization = new URL(startResponse.headers.location);
  assert.equal(authorization.searchParams.get("scope"), "identify");
  assert.equal(authorization.searchParams.get("state"), "state_token_with_32_safe_characters_1234");
  assert.match(String(startResponse.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(startResponse.headers["set-cookie"]), /Secure/);
  assert.match(String(startResponse.headers["set-cookie"]), /SameSite=Lax/);
  assert.deepEqual(commands[0].slice(0, 2), ["SET", commands[0][1]]);
  assert.equal(commands[0].at(-2), "EX");
  assert.equal(commands[0].at(-1), 600);

  const invalidCallback = responseHarness();
  await handler(request("/api/auth/discord/callback?code=forged&state=wrong", {
    headers: { cookie: "__Host-neon_oauth=expected" },
  }), invalidCallback);
  assert.equal(invalidCallback.statusCode, 302);
  assert.equal(invalidCallback.headers.location, "/?auth=invalid");

  const matchBody = {
    eventId: "ABC234:1785124800000",
    firstUserId: "123456789012345678",
    secondUserId: "223456789012345678",
    winnerUserId: "123456789012345678",
    endedAt: 1_785_124_800_000,
  };
  const matchCommands = [];
  const recorded = await recordMatchResult(matchBody, {
    now: () => matchBody.endedAt,
    redisCommand: async (command) => {
      matchCommands.push(command);
      return 1;
    },
  });
  assert.equal(recorded, true);
  assert.equal(matchCommands[0][0], "EVAL");
  assert.match(matchCommands[0][1], /ZADD", leaderboardKey, "NX", 0, winner/);
  assert.match(matchCommands[0][1], /ZADD", leaderboardKey, "NX", 0, loser/);
  await assert.rejects(
    recordMatchResult({ ...matchBody, winnerUserId: "999456789012345678" }, {
      now: () => matchBody.endedAt,
      redisCommand: async () => 1,
    }),
    /invalid/i,
  );
  assert.equal(fs.existsSync(path.join(__dirname, "api", "match-result.mjs")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "api", "realtime-ticket.mjs")), false);

  const accountClient = fs.readFileSync(path.join(__dirname, "public", "account.js"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(__dirname, "public", "sw.js"), "utf8");
  assert.doesNotMatch(accountClient, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(accountClient, /textContent/);
  assert.match(serviceWorker, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);

  process.stdout.write("PASS Discord OAuth, server-side sessions, profiles, and private match writes enforce secure boundaries\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
