"use strict";

const {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require("node:crypto");
const {
  executeRedisRest,
  requestIsSameOrigin,
} = require("./room-core.cjs");

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_COOKIE = "__Host-neon_session";
const OAUTH_COOKIE = "__Host-neon_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const TICKET_TTL_SECONDS = 5 * 60;
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

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signedTicket(payload, secret) {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

function cleanDisplayText(value, fallback = "") {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

function matchSignaturePayload(value) {
  return [
    String(value?.eventId || ""),
    String(value?.firstUserId || ""),
    String(value?.secondUserId || ""),
    value?.winnerUserId === null ? "" : String(value?.winnerUserId || ""),
    String(Number(value?.endedAt) || 0),
  ].join("\n");
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

function avatarUrl(profile) {
  if (!profile?.avatar || !profile?.id) return "";
  const extension = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${extension}?size=128`;
}

function environmentConfig(environment) {
  const clientId = String(environment.DISCORD_CLIENT_ID || "");
  const clientSecret = String(environment.DISCORD_CLIENT_SECRET || "");
  const redirectUri = String(environment.DISCORD_REDIRECT_URI || "");
  const realtimeSecret = String(environment.REALTIME_SHARED_SECRET || "");
  if (!clientId || !clientSecret || !redirectUri || realtimeSecret.length < 32) {
    throw new Error("Account service is not configured.");
  }
  return { clientId, clientSecret, redirectUri, realtimeSecret };
}

function accountAvailable(environment) {
  return Boolean(
    String(environment.DISCORD_CLIENT_ID || "")
    && String(environment.DISCORD_CLIENT_SECRET || "")
    && String(environment.DISCORD_REDIRECT_URI || "")
    && String(environment.REALTIME_SHARED_SECRET || "").length >= 32
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

function hmacHeader(request) {
  return String(header(request, "x-neon-signature") || "");
}

function createAccountHandler({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  redisCommand,
  now = () => Date.now(),
  random = (bytes) => randomBytes(bytes).toString("base64url"),
} = {}) {
  const redisOptions = {
    environment,
    fetchImpl,
    ...(redisCommand ? { fetchImpl: async () => { throw new Error("Unexpected fetch"); } } : {}),
  };
  const runRedis = redisCommand || ((command) => executeRedisRest(command, redisOptions));

  async function getJson(command) {
    const value = await runRedis(command);
    if (value === null || value === undefined || value === "") return null;
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  async function sessionFor(request) {
    const token = cookieMap(request).get(SESSION_COOKIE) || "";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    const session = await getJson(["GET", `neon-snake:session:${digest(token)}`]);
    if (!session?.userId) return null;
    const profile = await getJson(["GET", `neon-snake:profile:${session.userId}`]);
    return profile ? { token, session, profile } : null;
  }

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
        const tokenResponse = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: config.redirectUri,
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!tokenResponse.ok) throw new Error("Discord token exchange failed.");
        const token = await tokenResponse.json();
        if (!token?.access_token || token?.token_type !== "Bearer") throw new Error("Discord token is invalid.");
        const userResponse = await fetchImpl(`${DISCORD_API}/users/@me`, {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (!userResponse.ok) throw new Error("Discord profile lookup failed.");
        const profile = publicProfile(await userResponse.json());
        const sessionToken = random(32);
        const session = {
          userId: profile.id,
          createdAt: now(),
          expiresAt: now() + SESSION_TTL_SECONDS * 1_000,
        };
        await runRedis(["SET", `neon-snake:profile:${profile.id}`, JSON.stringify(profile)]);
        await runRedis([
          "SET",
          `neon-snake:session:${digest(sessionToken)}`,
          JSON.stringify(session),
          "EX",
          SESSION_TTL_SECONDS,
        ]);
        return redirect(response, "/?auth=discord", [
          cookie(OAUTH_COOKIE, "", { maxAge: 0 }),
          cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_TTL_SECONDS }),
        ]);
      }

      if (route === "/api/me") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
        const current = await sessionFor(request);
        return sendJson(response, 200, current
          ? {
            available: true,
            authenticated: true,
            profile: {
              username: current.profile.username,
              displayName: current.profile.displayName,
              avatarUrl: avatarUrl(current.profile),
            },
          }
          : {
            available: accountAvailable(environment),
            authenticated: false,
          });
      }

      if (route === "/api/logout") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
        if (!requestIsSameOrigin(request)) return sendJson(response, 403, { error: "origin_not_allowed" });
        const current = await sessionFor(request);
        if (current) await runRedis(["DEL", `neon-snake:session:${digest(current.token)}`]);
        response.setHeader("Set-Cookie", cookie(SESSION_COOKIE, "", { maxAge: 0 }));
        return sendJson(response, 200, { ok: true });
      }

      if (route === "/api/realtime-ticket") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
        if (!requestIsSameOrigin(request)) return sendJson(response, 403, { error: "origin_not_allowed" });
        const current = await sessionFor(request);
        if (!current) return sendJson(response, 401, { error: "authentication_required" });
        const ticketRequest = await readBody(request);
        const clientId = String(ticketRequest.clientId || "");
        if (!/^[A-Za-z0-9._:-]{8,96}$/.test(clientId)) {
          return sendJson(response, 400, { error: "invalid_client" });
        }
        const config = environmentConfig(environment);
        const issuedAt = now();
        const payload = {
          sub: current.profile.id,
          cid: clientId,
          name: current.profile.displayName,
          avatar: current.profile.avatar,
          iat: issuedAt,
          exp: issuedAt + TICKET_TTL_SECONDS * 1_000,
          jti: random(18),
        };
        return sendJson(response, 200, {
          ticket: signedTicket(payload, config.realtimeSecret),
          expiresAt: payload.exp,
        });
      }

      if (route === "/api/leaderboard") {
        if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
        const rows = await runRedis(["ZREVRANGE", "neon-snake:leaderboard:duel", "0", "49", "WITHSCORES"]);
        const pairs = Array.isArray(rows) ? rows : [];
        const userIds = pairs.filter((_, index) => index % 2 === 0);
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
          return {
            rank: index + 1,
            displayName: profile?.displayName || "Discord Player",
            avatarUrl: profile ? avatarUrl(profile) : "",
            wins: Number(pairs[index * 2 + 1]) || 0,
          };
        });
        return sendJson(response, 200, { entries, verified: true, metric: "server-authoritative-wins" });
      }

      if (route === "/api/match-result") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
        const config = environmentConfig(environment);
        const body = await readBody(request);
        const expected = sign(matchSignaturePayload(body), config.realtimeSecret);
        if (!equalText(expected, hmacHeader(request))) {
          return sendJson(response, 403, { error: "signature_invalid" });
        }
        const eventId = String(body.eventId || "");
        const first = String(body.firstUserId || "");
        const second = String(body.secondUserId || "");
        const winner = body.winnerUserId === null ? "" : String(body.winnerUserId || "");
        const endedAt = Number(body.endedAt);
        if (
          !/^[A-Za-z0-9:_-]{8,160}$/.test(eventId)
          || !/^[0-9]{15,24}$/.test(first)
          || !/^[0-9]{15,24}$/.test(second)
          || first === second
          || (winner && winner !== first && winner !== second)
          || !Number.isSafeInteger(endedAt)
          || endedAt < now() - 15 * 60 * 1_000
          || endedAt > now() + 60 * 1_000
        ) return sendJson(response, 400, { error: "invalid_result" });
        const loser = winner ? (winner === first ? second : first) : second;
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
        return sendJson(response, 200, { ok: true, recorded: Number(updated) === 1 });
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
  MATCH_SCRIPT,
  accountAvailable,
  avatarUrl,
  createAccountHandler,
  digest,
  equalText,
  matchSignaturePayload,
  publicProfile,
  signedTicket,
};
