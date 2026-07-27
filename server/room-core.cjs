"use strict";

const { createHash, randomUUID: nodeRandomUUID } = require("node:crypto");

const ROOM_PATTERN = /^[23456789A-HJ-NP-Z]{6}$/;
const CLIENT_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const SESSION_PATTERN = /^[A-Za-z0-9-]{8,96}$/;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 16;
const DUEL_GRID = 30;
const ROOM_TTL_SECONDS = 45;
const PLAYER_TIMEOUT_MS = 7_000;

const ROOM_SCRIPT = String.raw`
local playersKey = KEYS[1]
local readyKey = KEYS[2]
local dataKey = KEYS[3]
local inputKey = KEYS[4]
local rateKey = KEYS[5]

local now = tonumber(ARGV[1])
local action = ARGV[2]
local clientId = ARGV[3]
local requestedSession = ARGV[4]
local newSession = ARGV[5]
local ready = ARGV[6] == "1"
local events = cjson.decode(ARGV[7] or "[]")
local cutoff = now - ${PLAYER_TIMEOUT_MS}

local rate = redis.call("INCR", rateKey)
if rate == 1 then redis.call("EXPIRE", rateKey, 1) end
if rate > 40 then
  return cjson.encode({ error = "rate_limited" })
end

local function parseMember(member)
  local rawSlot, id, token = string.match(member, "^(%d)|([^|]+)|(.+)$")
  return tonumber(rawSlot), id, token
end

local stale = redis.call("ZRANGEBYSCORE", playersKey, "-inf", cutoff)
for _, member in ipairs(stale) do
  redis.call("HDEL", readyKey, member)
end
redis.call("ZREMRANGEBYSCORE", playersKey, "-inf", cutoff)
if #stale > 0 and redis.call("HEXISTS", dataKey, "countdown") == 1 then
  redis.call("HDEL", dataKey, "countdown")
  redis.call("HINCRBY", dataKey, "countdownRev", 1)
  redis.call("DEL", inputKey)
end

local active = redis.call("ZRANGEBYSCORE", playersKey, cutoff, "+inf")
if #active == 0 then
  redis.call("DEL", readyKey)
  redis.call("DEL", dataKey)
  redis.call("DEL", inputKey)
end

local member = nil
local slot = -1
local role = "spectator"
local session = ""
local duplicateClient = false
local used = {}

local function allPlayersReady()
  local candidates = redis.call("ZRANGEBYSCORE", playersKey, cutoff, "+inf")
  if #candidates ~= 2 then return false end
  for _, candidate in ipairs(candidates) do
    if redis.call("HGET", readyKey, candidate) ~= "1" then return false end
  end
  return true
end

for _, candidate in ipairs(active) do
  local candidateSlot, candidateId, candidateToken = parseMember(candidate)
  used[candidateSlot] = true
  if candidateId == clientId then
    duplicateClient = true
    if requestedSession ~= "" and candidateToken == requestedSession then
      member = candidate
      slot = candidateSlot
      role = "player"
      session = candidateToken
    end
  end
end

if action == "join" and member == nil and not duplicateClient then
  if not used[0] then slot = 0 elseif not used[1] then slot = 1 end
  if slot >= 0 then
    role = "player"
    session = newSession
    member = tostring(slot) .. "|" .. clientId .. "|" .. session
    redis.call("ZADD", playersKey, now, member)
    redis.call("HSET", readyKey, member, "0")
  end
end

if action == "sync" and member ~= nil then
  redis.call("ZADD", playersKey, now, member)
  redis.call("HSET", readyKey, member, ready and "1" or "0")
  if not ready and redis.call("HEXISTS", dataKey, "countdown") == 1 then
    redis.call("HDEL", dataKey, "countdown")
    redis.call("HINCRBY", dataKey, "countdownRev", 1)
    redis.call("DEL", inputKey)
  end

  for _, event in ipairs(events) do
    local eventType = event["type"]
    if slot == 0 and eventType == "countdown" then
      if allPlayersReady() then
        redis.call("DEL", inputKey)
        redis.call("HSET", dataKey, eventType, cjson.encode(event))
        redis.call("HINCRBY", dataKey, eventType .. "Rev", 1)
      end
    elseif slot == 0 and eventType == "state" then
      local inputAck = tonumber(event["state"]["guestInputAck"] or "0")
      if inputAck > 0 then redis.call("ZREMRANGEBYSCORE", inputKey, "-inf", inputAck) end
      redis.call("HSET", dataKey, eventType, cjson.encode(event))
      redis.call("HINCRBY", dataKey, eventType .. "Rev", 1)
    elseif slot == 1 and eventType == "input" then
      local inputSequence = tonumber(event["sequence"])
      redis.call("ZREMRANGEBYSCORE", inputKey, inputSequence, inputSequence)
      redis.call("ZADD", inputKey, inputSequence, cjson.encode(event))
      local inputCount = redis.call("ZCARD", inputKey)
      if inputCount > 32 then redis.call("ZREMRANGEBYRANK", inputKey, 0, inputCount - 33) end
      redis.call("HINCRBY", dataKey, eventType .. "Rev", 1)
    end
  end
end

if action == "leave" and member ~= nil then
  redis.call("ZREM", playersKey, member)
  redis.call("HDEL", readyKey, member)
  if redis.call("HEXISTS", dataKey, "countdown") == 1 then
    redis.call("HDEL", dataKey, "countdown")
    redis.call("HINCRBY", dataKey, "countdownRev", 1)
    redis.call("DEL", inputKey)
  end
  member = nil
  slot = -1
  role = "disconnected"
  session = ""
end

if redis.call("ZCARD", playersKey) == 0 then
  redis.call("DEL", readyKey)
  redis.call("DEL", dataKey)
  redis.call("DEL", inputKey)
end

redis.call("EXPIRE", playersKey, ${ROOM_TTL_SECONDS})
redis.call("EXPIRE", readyKey, ${ROOM_TTL_SECONDS})
redis.call("EXPIRE", dataKey, ${ROOM_TTL_SECONDS})
redis.call("EXPIRE", inputKey, ${ROOM_TTL_SECONDS})

local players = {}
local current = redis.call("ZRANGEBYSCORE", playersKey, cutoff, "+inf")
for _, candidate in ipairs(current) do
  local candidateSlot, candidateId = parseMember(candidate)
  table.insert(players, {
    id = candidateId,
    slot = candidateSlot,
    ready = redis.call("HGET", readyKey, candidate) == "1",
    seenAt = tonumber(redis.call("ZSCORE", playersKey, candidate)) or now
  })
end
table.sort(players, function(first, second) return first.slot < second.slot end)

local function revision(field)
  return tonumber(redis.call("HGET", dataKey, field) or "0")
end

local function payload(field)
  local value = redis.call("HGET", dataKey, field)
  if value then return cjson.decode(value) end
  return cjson.null
end

local inputs = {}
for _, value in ipairs(redis.call("ZRANGE", inputKey, 0, -1)) do
  table.insert(inputs, cjson.decode(value))
end

return cjson.encode({
  role = role,
  slot = slot,
  session = session,
  players = players,
  stateRev = revision("stateRev"),
  inputRev = revision("inputRev"),
  countdownRev = revision("countdownRev"),
  state = payload("state"),
  input = inputs,
  countdown = payload("countdown")
})
`;

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

function direction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (Math.abs(x) + Math.abs(y) !== 1) return null;
  return { x, y };
}

function point(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a point.`);
  }
  const x = Number(value.x);
  const y = Number(value.y);
  if (
    !Number.isInteger(x)
    || !Number.isInteger(y)
    || x < 0
    || y < 0
    || x >= DUEL_GRID
    || y >= DUEL_GRID
  ) {
    throw new TypeError(`${label} is outside the duel arena.`);
  }
  return { x, y };
}

function snake(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DUEL_GRID * DUEL_GRID) {
    throw new TypeError(`${label} has an invalid length.`);
  }
  return value.map((segment, index) => point(segment, `${label} segment ${index}`));
}

function score(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new TypeError(`${label} is invalid.`);
  }
  return parsed;
}

function inputSequence(value, label, allowZero = false) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return parsed;
}

function crash(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[a-z-]{1,32}$/.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function sanitizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("State payload is required.");
  }
  const playerDirection = direction(value.playerDirection);
  const opponentDirection = direction(value.opponentDirection);
  if (!playerDirection || !opponentDirection) {
    throw new TypeError("State directions are invalid.");
  }
  const winner = value.winner === null || value.winner === undefined
    ? null
    : String(value.winner);
  if (winner !== null && winner !== "player" && winner !== "opponent") {
    throw new TypeError("State winner is invalid.");
  }
  const signalCursor = Number(value.signalCursor);
  if (!Number.isInteger(signalCursor) || signalCursor < 0 || signalCursor > 0xffffffff) {
    throw new TypeError("State signal cursor is invalid.");
  }
  return {
    playerSnake: snake(value.playerSnake, "Player snake"),
    opponentSnake: snake(value.opponentSnake, "Opponent snake"),
    playerDirection,
    opponentDirection,
    playerScore: score(value.playerScore, "Player score"),
    opponentScore: score(value.opponentScore, "Opponent score"),
    food: value.food === null || value.food === undefined ? null : point(value.food, "Food"),
    signalCursor,
    round: inputSequence(value.round, "Round"),
    guestInputAck: inputSequence(value.guestInputAck ?? 0, "Guest input acknowledgement", true),
    crashes: {
      player: crash(value.crashes?.player, "Player crash"),
      opponent: crash(value.crashes?.opponent, "Opponent crash"),
    },
    over: Boolean(value.over),
    winner,
  };
}

function sanitizeMessages(messages, { room, clientId, now }) {
  if (messages === undefined) return [];
  if (!Array.isArray(messages)) throw new TypeError("Room messages must be an array.");
  if (messages.length > MAX_MESSAGES) throw new TypeError("Too many room messages.");

  return messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new TypeError("Each room message must be an object.");
    }
    let payload;
    if (message.type === "input") {
      const next = direction(message.direction);
      if (!next) throw new TypeError("Input direction is invalid.");
      const round = inputSequence(message.round, "Input round");
      const sequence = inputSequence(message.sequence, "Input sequence");
      payload = { type: "input", round, sequence, direction: next };
    } else if (message.type === "countdown") {
      const startsAt = Number(message.startsAt);
      if (!Number.isFinite(startsAt) || startsAt < now - 1_000 || startsAt > now + 10_000) {
        throw new TypeError("Countdown time is invalid.");
      }
      const round = inputSequence(message.round, "Countdown round");
      payload = { type: "countdown", round, startsAt: Math.round(startsAt) };
    } else if (message.type === "state") {
      const sequence = Number(message.sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 1_000_000_000) {
        throw new TypeError("State sequence is invalid.");
      }
      payload = {
        type: "state",
        sequence,
        state: sanitizeState(message.state),
      };
    } else {
      throw new TypeError("Unsupported room message type.");
    }
    return {
      ...payload,
      from: clientId,
      room,
      sentAt: now,
    };
  });
}

function header(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestIsSameOrigin(request) {
  const origin = header(request, "origin");
  const forwardedHost = header(request, "x-forwarded-host");
  const host = String(forwardedHost || header(request, "host") || "").split(",")[0].trim();
  const forwardedProtocol = header(request, "x-forwarded-proto");
  const protocol = String(forwardedProtocol || (host.startsWith("localhost") ? "http" : "https"))
    .split(",")[0]
    .trim();
  const fetchSite = header(request, "sec-fetch-site");
  if (!origin || !host || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function requestRateId(request) {
  const forwarded = header(request, "x-vercel-forwarded-for")
    || header(request, "x-forwarded-for")
    || header(request, "x-real-ip")
    || "unknown";
  const address = String(forwarded).split(",")[0].trim().slice(0, 128);
  return createHash("sha256").update(address).digest("hex").slice(0, 24);
}

async function requestBody(request) {
  if (request.body !== undefined && request.body !== null) {
    const serialized = typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);
    if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) {
      throw new TypeError("Room request is too large.");
    }
    return typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new TypeError("Room request is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function roomKeys(room, rateId) {
  const tag = `{${room}}`;
  return [
    `neon-snake:${tag}:players`,
    `neon-snake:${tag}:ready`,
    `neon-snake:${tag}:data`,
    `neon-snake:${tag}:inputs`,
    `neon-snake:rate:${rateId}`,
  ];
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("A JSON room request is required.");
  }
  const action = String(body.action || "");
  if (!["join", "sync", "leave"].includes(action)) {
    throw new TypeError("Room action is invalid.");
  }
  const room = String(body.room || "").toUpperCase();
  const clientId = String(body.clientId || "");
  const session = body.session ? String(body.session) : "";
  if (!ROOM_PATTERN.test(room)) throw new TypeError("Room code is invalid.");
  if (!CLIENT_PATTERN.test(clientId)) throw new TypeError("Client id is invalid.");
  if (session && !SESSION_PATTERN.test(session)) throw new TypeError("Room session is invalid.");
  if ((action === "sync" || action === "leave") && body.ready !== undefined && typeof body.ready !== "boolean") {
    throw new TypeError("Ready state is invalid.");
  }
  return {
    action,
    room,
    clientId,
    session,
    ready: Boolean(body.ready),
    messages: body.messages,
  };
}

async function executeRedisRest(command, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = redisConfig(environment);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");
  const response = await fetchImpl(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Redis request failed.");
  const payload = await response.json();
  if (payload?.error) throw new Error("Redis command failed.");
  return payload?.result;
}

function sendJson(response, statusCode, payload) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (typeof response.status === "function" && typeof response.json === "function") {
    return response.status(statusCode).json(payload);
  }
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
  return response;
}

function createRoomHandler({
  now = () => Date.now(),
  randomUUID = nodeRandomUUID,
  redisCommand,
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const runRedis = redisCommand || ((command) => executeRedisRest(command, {
    environment,
    fetchImpl,
  }));

  return async function roomHandler(request, response) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return sendJson(response, 405, { error: "method_not_allowed" });
    }
    if (!requestIsSameOrigin(request)) {
      return sendJson(response, 403, { error: "origin_not_allowed" });
    }
    const contentType = String(header(request, "content-type") || "");
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return sendJson(response, 415, { error: "content_type_not_supported" });
    }

    try {
      const input = validateBody(await requestBody(request));
      const timestamp = now();
      const messages = input.action === "sync"
        ? sanitizeMessages(input.messages, {
          room: input.room,
          clientId: input.clientId,
          now: timestamp,
        })
        : [];
      const command = [
        "EVAL",
        ROOM_SCRIPT,
        "5",
        ...roomKeys(input.room, requestRateId(request)),
        String(timestamp),
        input.action,
        input.clientId,
        input.session,
        randomUUID(),
        input.ready ? "1" : "0",
        JSON.stringify(messages),
      ];
      const result = await runRedis(command);
      const payload = typeof result === "string" ? JSON.parse(result) : result;
      if (!payload || typeof payload !== "object") throw new Error("Invalid room response.");
      if (payload.error === "rate_limited") {
        response.setHeader("Retry-After", "1");
        return sendJson(response, 429, { error: "rate_limited" });
      }
      return sendJson(response, 200, payload);
    } catch (error) {
      if (error instanceof TypeError || error instanceof SyntaxError) {
        return sendJson(response, 400, { error: "invalid_request" });
      }
      console.error("Room API request failed.", {
        name: typeof error?.name === "string" ? error.name : "Error",
      });
      return sendJson(response, 503, { error: "room_service_unavailable" });
    }
  };
}

module.exports = {
  ROOM_SCRIPT,
  createRoomHandler,
  executeRedisRest,
  redisConfig,
  requestIsSameOrigin,
  requestRateId,
  sanitizeMessages,
  sanitizeState,
};
