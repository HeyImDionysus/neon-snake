"use strict";

const {
  createHash,
  randomBytes,
  timingSafeEqual,
} = require("node:crypto");
const {
  executeRedisRest,
  requestIsSameOrigin,
} = require("./room-core.cjs");

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_COOKIE = "__Host-neon_session";
const ACTIVITY_SESSION_COOKIE = "__Secure-neon_activity";
const OAUTH_COOKIE = "__Host-neon_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACTIVITY_TTL_SECONDS = 35;
const PROFILE_ACCENTS = new Set(["acid", "cyan", "violet", "magenta", "ember"]);
const PROFILE_MODES = new Set(["classic", "portal", "rush", "canvas", "live"]);
const PROFILE_SNAKES = new Set(["signal", "spectral", "glass", "ember"]);
const MATCH_SCRIPT = String.raw`
local eventKey = KEYS[1]
local leaderboardKey = KEYS[2]
local winnerStatsKey = KEYS[3]
local loserStatsKey = KEYS[4]
local draw = ARGV[1] == "1"
local winner = ARGV[2]
local loser = ARGV[3]
if redis.call("SET", eventKey, "1", "NX", "EX", 604800) == false then
  return 0
end
if winner ~= "" then redis.call("ZADD", leaderboardKey, "NX", 0, winner) end
if loser ~= "" then redis.call("ZADD", leaderboardKey, "NX", 0, loser) end
if draw then
  if winner ~= "" then redis.call("HINCRBY", winnerStatsKey, "draws", 1) end
  if loser ~= "" then redis.call("HINCRBY", loserStatsKey, "draws", 1) end
else
  redis.call("ZINCRBY", leaderboardKey, 1, winner)
  redis.call("HINCRBY", winnerStatsKey, "wins", 1)
  redis.call("HINCRBY", loserStatsKey, "losses", 1)
end
return 1
`;
const LEADERBOARD_SCRIPT = String.raw`
local rows = redis.call("ZREVRANGE", KEYS[1], 0, 49, "WITHSCORES")
local active = redis.call("ZREVRANGEBYSCORE", KEYS[2], ARGV[1], ARGV[2], "LIMIT", 0, 50)
local result = {}
local seen = {}
local rank = 0

local function append(userId, wins, playerRank)
  if seen[userId] then return end
  seen[userId] = true
  local statsKey = "neon-snake:stats:" .. userId
  local activityKey = "neon-snake:activity:" .. userId
  table.insert(result, userId)
  table.insert(result, wins)
  table.insert(result, redis.call("HGET", statsKey, "losses") or "0")
  table.insert(result, redis.call("HGET", statsKey, "draws") or "0")
  table.insert(result, redis.call("GET", activityKey) or "")
  table.insert(result, tostring(playerRank))
end

for index = 1, #rows, 2 do
  local userId = rows[index]
  rank = rank + 1
  append(userId, rows[index + 1], rank)
end

for _, userId in ipairs(active) do
  append(userId, redis.call("ZSCORE", KEYS[1], userId) or "0", 0)
end
return result
`;

function header(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestUrl(request) {
  const protocol = String(header(request, "x-forwarded-proto") || "https").split(",")[0].trim();
  const host = String(header(request, "x-forwarded-host") || header(request, "host") || "").split(",")[0].trim();
  return new URL(request.url || "/", `${protocol}://${host}`);
}

function cookieMap(request) {
  const result = new Map();
  String(header(request, "cookie") || "").split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    result.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
  });
  return result;
}

function cookie(name, value, {
  maxAge = 0,
  httpOnly = true,
} = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "Secure",
    "SameSite=Lax",
    httpOnly ? "HttpOnly" : "",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ].filter(Boolean).join("; ");
}

function activityCookie(value, clientId, {
  maxAge = 0,
} = {}) {
  return [
    `${ACTIVITY_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Domain=${clientId}.discordsays.com`,
    "Secure",
    "HttpOnly",
    "SameSite=None",
    "Partitioned",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ].join("; ");
}

function sendJson(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.statusCode = status;
  response.end(JSON.stringify(payload));
}

function redirect(response, location, cookies = []) {
  response.statusCode = 302;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Location", location);
  if (cookies.length) response.setHeader("Set-Cookie", cookies);
  response.end();
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function equalText(first, second) {
  const a = Buffer.from(String(first));
  const b = Buffer.from(String(second));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanDisplayText(value, fallback = "") {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

function cleanProfileText(value, maximum, fallback = "") {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>&]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maximum)
    .trim();
  return cleaned || fallback;
}

function sanitizeProfileCustomization(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const accent = String(source.accent || "").toLowerCase();
  const favoriteMode = String(source.favoriteMode || "").toLowerCase();
  const snakeStyle = String(source.snakeStyle || "").toLowerCase();
  return {
    callsign: cleanProfileText(source.callsign, 24),
    bio: cleanProfileText(source.bio, 120),
    accent: PROFILE_ACCENTS.has(accent) ? accent : "acid",
    favoriteMode: PROFILE_MODES.has(favoriteMode) ? favoriteMode : "classic",
    snakeStyle: PROFILE_SNAKES.has(snakeStyle) ? snakeStyle : "signal",
  };
}

function publicProfile(user) {
  const id = String(user?.id || "");
  if (!/^[0-9]{15,24}$/.test(id)) throw new TypeError("Discord user id is invalid.");
  const username = cleanDisplayText(user?.username);
  const displayName = cleanDisplayText(user?.global_name || username, "Discord Player");
  const avatar = typeof user?.avatar === "string" && /^[A-Za-z0-9_]{8,128}$/.test(user.avatar)
    ? user.avatar
    : "";
  return {
    id,
    username,
    displayName,
    avatar,
    updatedAt: new Date().toISOString(),
  };
}

function storedProfile(user, previous = null) {
  return {
    ...publicProfile(user),
    customization: sanitizeProfileCustomization(previous?.customization),
  };
}

function avatarUrl(profile) {
  if (!profile?.avatar || !profile?.id) return "";
  const extension = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${extension}?size=128`;
}

function statsFromRedis(value) {
  const pairs = Array.isArray(value) ? value : [];
  const stats = {};
  for (let index = 0; index < pairs.length; index += 2) {
    stats[String(pairs[index])] = Number(pairs[index + 1]) || 0;
  }
  const wins = stats.wins || 0;
  const losses = stats.losses || 0;
  const draws = stats.draws || 0;
  return {
    wins,
    losses,
    draws,
    matches: wins + losses + draws,
  };
}

function publicProfileView(profile, {
  stats = { wins: 0, losses: 0, draws: 0, matches: 0 },
  activeAt = 0,
  now = Date.now(),
} = {}) {
  const customization = sanitizeProfileCustomization(profile?.customization);
  return {
    username: cleanProfileText(profile?.username, 32, "player"),
    displayName: cleanDisplayText(profile?.displayName, "Discord Player"),
    avatarUrl: avatarUrl(profile),
    callsign: customization.callsign || cleanDisplayText(profile?.displayName, "Discord Player"),
    bio: customization.bio,
    accent: customization.accent,
    favoriteMode: customization.favoriteMode,
    snakeStyle: customization.snakeStyle,
    stats,
    online: Number(activeAt) > 0 && now - Number(activeAt) <= ACTIVITY_TTL_SECONDS * 1_000,
  };
}

function usernameKey(value) {
  const username = String(value || "").trim().toLowerCase();
  return /^[a-z0-9._]{2,32}$/.test(username) ? username : "";
}

function environmentConfig(environment) {
  const clientId = String(environment.DISCORD_CLIENT_ID || "");
  const clientSecret = String(environment.DISCORD_CLIENT_SECRET || "");
  const redirectUri = String(environment.DISCORD_REDIRECT_URI || "");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Account service is not configured.");
  }
  return { clientId, clientSecret, redirectUri };
}

function requestIsAccountOrigin(request, environment) {
  if (requestIsSameOrigin(request)) return true;
  const clientId = String(environment.DISCORD_CLIENT_ID || "");
  const origin = String(header(request, "origin") || "").toLowerCase();
  return /^[0-9]{15,24}$/.test(clientId)
    && origin === `https://${clientId}.discordsays.com`;
}

function accountAvailable(environment) {
  return Boolean(
    String(environment.DISCORD_CLIENT_ID || "")
    && String(environment.DISCORD_CLIENT_SECRET || "")
    && String(environment.DISCORD_REDIRECT_URI || "")
  );
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 32 * 1024) throw new TypeError("Request is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createRedisRunner({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  redisCommand,
} = {}) {
  return redisCommand || ((command) => executeRedisRest(command, {
    environment,
    fetchImpl,
  }));
}

function createSessionReader(options = {}) {
  const runRedis = createRedisRunner(options);
  return async function sessionFor(request) {
    const cookies = cookieMap(request);
    const token = cookies.get(SESSION_COOKIE) || cookies.get(ACTIVITY_SESSION_COOKIE) || "";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    const sessionValue = await runRedis(["GET", `neon-snake:session:${digest(token)}`]);
    if (sessionValue === null || sessionValue === undefined || sessionValue === "") return null;
    let session;
    try {
      session = typeof sessionValue === "string" ? JSON.parse(sessionValue) : sessionValue;
    } catch {
      return null;
    }
    if (!session?.userId) return null;
    const profileValue = await runRedis(["GET", `neon-snake:profile:${session.userId}`]);
    if (profileValue === null || profileValue === undefined || profileValue === "") return null;
    let profile;
    try {
      profile = typeof profileValue === "string" ? JSON.parse(profileValue) : profileValue;
    } catch {
      return null;
    }
    return profile ? { token, session, profile } : null;
  };
}

async function exchangeDiscordCode(code, {
  config,
  fetchImpl,
  redirectUri = "",
}) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
  });
  if (redirectUri) body.set("redirect_uri", redirectUri);
  const tokenResponse = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!tokenResponse.ok) throw new Error("Discord token exchange failed.");
  const token = await tokenResponse.json();
  if (!token?.access_token || token?.token_type !== "Bearer") {
    throw new Error("Discord token is invalid.");
  }
  const userResponse = await fetchImpl(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!userResponse.ok) throw new Error("Discord profile lookup failed.");
  return {
    accessToken: token.access_token,
    discordUser: await userResponse.json(),
  };
}

async function persistDiscordSession(discordUser, {
  now,
  random,
  runRedis,
}) {
  const provisional = publicProfile(discordUser);
  let previousProfile = null;
  try {
    const previousValue = await runRedis(["GET", `neon-snake:profile:${provisional.id}`]);
    previousProfile = previousValue
      ? (typeof previousValue === "string" ? JSON.parse(previousValue) : previousValue)
      : null;
  } catch {
    previousProfile = null;
  }
  const profile = storedProfile(discordUser, previousProfile);
  const sessionToken = random(32);
  const session = {
    userId: profile.id,
    createdAt: now(),
    expiresAt: now() + SESSION_TTL_SECONDS * 1_000,
  };
  await runRedis(["SET", `neon-snake:profile:${profile.id}`, JSON.stringify(profile)]);
  const indexedUsername = usernameKey(profile.username);
  if (indexedUsername) {
    await runRedis(["SET", `neon-snake:username:${indexedUsername}`, profile.id]);
  }
  await runRedis([
    "SET",
    `neon-snake:session:${digest(sessionToken)}`,
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SECONDS,
  ]);
  return { profile, sessionToken };
}

async function recordMatchResult({
  eventId,
  firstUserId,
  secondUserId,
  winnerUserId,
  endedAt,
}, options = {}) {
  const now = options.now || (() => Date.now());
  const first = String(firstUserId || "");
  const second = String(secondUserId || "");
  const winner = winnerUserId === null ? "" : String(winnerUserId || "");
  const timestamp = Number(endedAt);
  if (
    !/^[A-Za-z0-9:_-]{8,160}$/.test(String(eventId || ""))
    || !/^[0-9]{15,24}$/.test(first)
    || !/^[0-9]{15,24}$/.test(second)
    || first === second
    || (winner && winner !== first && winner !== second)
    || !Number.isSafeInteger(timestamp)
    || timestamp < now() - 15 * 60 * 1_000
    || timestamp > now() + 60 * 1_000
  ) {
    throw new TypeError("Match result is invalid.");
  }
  const loser = winner ? (winner === first ? second : first) : second;
  const runRedis = createRedisRunner(options);
  const updated = await runRedis([
    "EVAL",
    MATCH_SCRIPT,
    "4",
    `neon-snake:match:${digest(eventId)}`,
    "neon-snake:leaderboard:duel",
    `neon-snake:stats:${winner || first}`,
    `neon-snake:stats:${loser}`,
    winner ? "0" : "1",
    winner || first,
    loser,
  ]);
  return Number(updated) === 1;
}

function createAccountHandler({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  redisCommand,
  now = () => Date.now(),
  random = (bytes) => randomBytes(bytes).toString("base64url"),
} = {}) {
  const storeOptions = {
    environment,
    fetchImpl,
    redisCommand,
  };
  const runRedis = createRedisRunner(storeOptions);
  const sessionFor = createSessionReader(storeOptions);

  return async function accountHandler(request, response) {
    const url = requestUrl(request);
    const route = url.pathname;
    try {
      if (route === "/api/auth/discord/start") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
        const config = environmentConfig(environment);
        const state = random(32);
        await runRedis(["SET", `neon-snake:oauth:${digest(state)}`, "1", "EX", OAUTH_TTL_SECONDS]);
        const authorization = new URL("https://discord.com/oauth2/authorize");
        authorization.searchParams.set("response_type", "code");
        authorization.searchParams.set("client_id", config.clientId);
        authorization.searchParams.set("scope", "identify");
        authorization.searchParams.set("state", state);
        authorization.searchParams.set("redirect_uri", config.redirectUri);
        authorization.searchParams.set("prompt", "consent");
        return redirect(response, authorization.href, [
          cookie(OAUTH_COOKIE, state, { maxAge: OAUTH_TTL_SECONDS }),
        ]);
      }

      if (route === "/api/auth/discord/callback") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
        const config = environmentConfig(environment);
        const state = url.searchParams.get("state") || "";
        const expectedState = cookieMap(request).get(OAUTH_COOKIE) || "";
        const code = url.searchParams.get("code") || "";
        if (!state || !code || !equalText(state, expectedState)) {
          return redirect(response, "/?auth=invalid", [cookie(OAUTH_COOKIE, "", { maxAge: 0 })]);
        }
        const stateRecord = await runRedis(["GETDEL", `neon-snake:oauth:${digest(state)}`]);
        if (stateRecord !== "1" && stateRecord !== 1) {
          return redirect(response, "/?auth=expired", [cookie(OAUTH_COOKIE, "", { maxAge: 0 })]);
        }
        const { discordUser } = await exchangeDiscordCode(code, {
          config,
          fetchImpl,
          redirectUri: config.redirectUri,
        });
        const { sessionToken } = await persistDiscordSession(discordUser, {
          now,
          random,
          runRedis,
        });
        return redirect(response, "/?auth=discord", [
          cookie(OAUTH_COOKIE, "", { maxAge: 0 }),
          cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_TTL_SECONDS }),
        ]);
      }

      if (route === "/api/activity/token") {
        if (request.method !== "POST") {
          return sendJson(response, 405, { error: "method_not_allowed" });
        }
        const config = environmentConfig(environment);
        if (!requestIsAccountOrigin(request, environment)) {
          return sendJson(response, 403, { error: "origin_not_allowed" });
        }
        const body = await readBody(request);
        const code = String(body.code || "");
        if (!/^[A-Za-z0-9._~-]{8,512}$/.test(code)) {
          return sendJson(response, 400, { error: "invalid_code" });
        }
        const { accessToken, discordUser } = await exchangeDiscordCode(code, {
          config,
          fetchImpl,
        });
        const { sessionToken } = await persistDiscordSession(discordUser, {
          now,
          random,
          runRedis,
        });
        response.setHeader("Set-Cookie", activityCookie(
          sessionToken,
          config.clientId,
          { maxAge: SESSION_TTL_SECONDS },
        ));
        return sendJson(response, 200, { access_token: accessToken });
      }

      if (route === "/api/me") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
        const current = await sessionFor(request);
        if (!current) {
          return sendJson(response, 200, {
            available: accountAvailable(environment),
            authenticated: false,
          });
        }
        const [statsValue, activeAt] = await Promise.all([
          runRedis(["HGETALL", `neon-snake:stats:${current.profile.id}`]),
          runRedis(["GET", `neon-snake:activity:${current.profile.id}`]),
        ]);
        return sendJson(response, 200, {
          available: true,
          authenticated: true,
          profile: publicProfileView(current.profile, {
            stats: statsFromRedis(statsValue),
            activeAt,
            now: now(),
          }),
        });
      }

      if (route === "/api/logout") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
        if (!requestIsAccountOrigin(request, environment)) {
          return sendJson(response, 403, { error: "origin_not_allowed" });
        }
        const current = await sessionFor(request);
        if (current) await runRedis(["DEL", `neon-snake:session:${digest(current.token)}`]);
        const clearCookies = [cookie(SESSION_COOKIE, "", { maxAge: 0 })];
        const clientId = String(environment.DISCORD_CLIENT_ID || "");
        if (/^[0-9]{15,24}$/.test(clientId)) {
          clearCookies.push(activityCookie("", clientId, { maxAge: 0 }));
        }
        response.setHeader("Set-Cookie", clearCookies);
        return sendJson(response, 200, { ok: true });
      }

      if (route === "/api/profile") {
        if (request.method === "GET") {
          const current = await sessionFor(request);
          const requestedUsername = usernameKey(url.searchParams.get("user"));
          let profile = current?.profile || null;
          if (requestedUsername) {
            let userId = await runRedis(["GET", `neon-snake:username:${requestedUsername}`]);
            if (!userId && usernameKey(current?.profile?.username) === requestedUsername) {
              userId = current.profile.id;
            }
            if (!userId) {
              const leaderboardIds = await runRedis([
                "ZREVRANGE",
                "neon-snake:leaderboard:duel",
                "0",
                "49",
              ]);
              const candidates = Array.isArray(leaderboardIds) && leaderboardIds.length
                ? await runRedis([
                  "MGET",
                  ...leaderboardIds.map((id) => `neon-snake:profile:${id}`),
                ])
                : [];
              const matchIndex = candidates.findIndex((candidate) => {
                try {
                  const parsed = candidate
                    ? (typeof candidate === "string" ? JSON.parse(candidate) : candidate)
                    : null;
                  return usernameKey(parsed?.username) === requestedUsername;
                } catch {
                  return false;
                }
              });
              userId = matchIndex >= 0 ? leaderboardIds[matchIndex] : null;
              if (userId) {
                await runRedis(["SET", `neon-snake:username:${requestedUsername}`, userId]);
              }
            }
            const profileValue = userId
              ? await runRedis(["GET", `neon-snake:profile:${userId}`])
              : null;
            profile = profileValue
              ? (typeof profileValue === "string" ? JSON.parse(profileValue) : profileValue)
              : null;
          }
          if (!profile) return sendJson(response, 404, { error: "profile_not_found" });
          const [statsValue, activeAt] = await Promise.all([
            runRedis(["HGETALL", `neon-snake:stats:${profile.id}`]),
            runRedis(["GET", `neon-snake:activity:${profile.id}`]),
          ]);
          return sendJson(response, 200, {
            profile: publicProfileView(profile, {
              stats: statsFromRedis(statsValue),
              activeAt,
              now: now(),
            }),
            editable: Boolean(current && current.profile.id === profile.id),
          });
        }
        if (request.method === "PATCH") {
          if (!requestIsAccountOrigin(request, environment)) {
            return sendJson(response, 403, { error: "origin_not_allowed" });
          }
          const current = await sessionFor(request);
          if (!current) return sendJson(response, 401, { error: "authentication_required" });
          const customization = sanitizeProfileCustomization(await readBody(request));
          const profile = {
            ...current.profile,
            customization,
            updatedAt: new Date(now()).toISOString(),
          };
          await runRedis(["SET", `neon-snake:profile:${profile.id}`, JSON.stringify(profile)]);
          const [statsValue, activeAt] = await Promise.all([
            runRedis(["HGETALL", `neon-snake:stats:${profile.id}`]),
            runRedis(["GET", `neon-snake:activity:${profile.id}`]),
          ]);
          return sendJson(response, 200, {
            profile: publicProfileView(profile, {
              stats: statsFromRedis(statsValue),
              activeAt,
              now: now(),
            }),
          });
        }
        return sendJson(response, 405, { error: "method_not_allowed" });
      }

      if (route === "/api/leaderboard") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
        const rows = await runRedis([
          "EVAL",
          LEADERBOARD_SCRIPT,
          "2",
          "neon-snake:leaderboard:duel",
          "neon-snake:players:active",
          String(now()),
          String(now() - ACTIVITY_TTL_SECONDS * 1_000),
        ]);
        const pairs = Array.isArray(rows) ? rows : [];
        const stride = 6;
        const userIds = pairs.filter((_, index) => index % stride === 0);
        const profiles = userIds.length
          ? await runRedis(["MGET", ...userIds.map((id) => `neon-snake:profile:${id}`)])
          : [];
        const entries = userIds.map((id, index) => {
          let profile = null;
          try {
            profile = profiles?.[index] ? JSON.parse(profiles[index]) : null;
          } catch {
            profile = null;
          }
          const customization = sanitizeProfileCustomization(profile?.customization);
          const wins = Number(pairs[index * stride + 1]) || 0;
          const losses = Number(pairs[index * stride + 2]) || 0;
          const draws = Number(pairs[index * stride + 3]) || 0;
          const activeAt = Number(pairs[index * stride + 4]) || 0;
          const rank = Number(pairs[index * stride + 5]) || null;
          return {
            rank,
            displayName: profile?.displayName || "Discord Player",
            username: profile?.username || "player",
            avatarUrl: profile ? avatarUrl(profile) : "",
            callsign: customization.callsign || profile?.displayName || "Discord Player",
            accent: customization.accent,
            favoriteMode: customization.favoriteMode,
            snakeStyle: customization.snakeStyle,
            wins,
            record: { wins, losses, draws },
            online: activeAt > 0 && now() - activeAt <= ACTIVITY_TTL_SECONDS * 1_000,
          };
        });
        return sendJson(response, 200, { entries, verified: true, metric: "server-authoritative-wins" });
      }

      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof TypeError || error instanceof SyntaxError) {
        return sendJson(response, 400, { error: "invalid_request" });
      }
      console.error("Account API request failed.", {
        route,
        name: typeof error?.name === "string" ? error.name : "Error",
      });
      return sendJson(response, 503, { error: "account_service_unavailable" });
    }
  };
}

module.exports = {
  ACTIVITY_TTL_SECONDS,
  LEADERBOARD_SCRIPT,
  MATCH_SCRIPT,
  accountAvailable,
  avatarUrl,
  createAccountHandler,
  createSessionReader,
  digest,
  equalText,
  publicProfileView,
  publicProfile,
  recordMatchResult,
  sanitizeProfileCustomization,
  statsFromRedis,
};
