"use strict";

require("../public/game-logic.js");

const { randomUUID } = require("node:crypto");
const {
  createSessionReader,
  recordMatchResult,
} = require("./account-core.cjs");
const {
  executeRedisRest,
  redisConfig,
} = require("./room-core.cjs");

const ROOM_PATTERN = /^[23456789A-HJ-NP-Z]{6}$/;
const CLIENT_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const MAX_CONNECTIONS = 12;
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_MESSAGES_PER_SECOND = 40;
const CONNECTION_TTL_MS = 30_000;
const ROOM_TTL_SECONDS = 45;
const DUEL_GRID = 30;
const TICK_DURATION = 138;
const Rules = globalThis.SnakeRules;

if (!Rules?.resolveDuelTick) throw new Error("Shared duel rules are unavailable.");

const PRESENCE_SCRIPT = String.raw`
local presenceKey = KEYS[1]
local metadataKey = KEYS[2]
local generationKey = KEYS[3]
local activePlayersKey = KEYS[4]
local now = tonumber(ARGV[1])
local action = ARGV[2]
local clientId = ARGV[3]
local connectionId = ARGV[4]
local ready = ARGV[5] == "1"
local userId = ARGV[6]
local displayName = ARGV[7]
local avatar = ARGV[8]
local username = ARGV[9]
local callsign = ARGV[10]
local accent = ARGV[11]
local cutoff = now - ${CONNECTION_TTL_MS}

local stale = redis.call("ZRANGEBYSCORE", presenceKey, "-inf", cutoff)
for _, id in ipairs(stale) do redis.call("HDEL", metadataKey, id) end
redis.call("ZREMRANGEBYSCORE", presenceKey, "-inf", cutoff)

local function read(id)
  local raw = redis.call("HGET", metadataKey, id)
  if not raw then return nil end
  return cjson.decode(raw)
end

local current = read(clientId)
if action == "join" then
  local generation = redis.call("INCR", generationKey)
  if not current and redis.call("ZCARD", presenceKey) >= ${MAX_CONNECTIONS} then
    return cjson.encode({ error = "room_full" })
  end
  local slot = current and tonumber(current["slot"]) or -1
  if not current then
    local used = {}
    for _, id in ipairs(redis.call("ZRANGE", presenceKey, 0, -1)) do
      local item = read(id)
      if item and tonumber(item["slot"]) >= 0 then used[tonumber(item["slot"])] = true end
    end
    if not used[0] then slot = 0 elseif not used[1] then slot = 1 end
  end
  current = {
    id = clientId,
    connectionId = connectionId,
    slot = slot,
    ready = false,
    readyEpoch = 0,
    joinEpoch = generation,
    seenAt = now,
    userId = userId,
    displayName = displayName,
    avatar = avatar,
    username = username,
    callsign = callsign,
    accent = accent
  }
  redis.call("ZADD", presenceKey, now, clientId)
  redis.call("HSET", metadataKey, clientId, cjson.encode(current))
elseif current and current["connectionId"] == connectionId then
  if action == "leave" then
    redis.call("ZREM", presenceKey, clientId)
    redis.call("HDEL", metadataKey, clientId)
    current = nil
    for _, id in ipairs(redis.call("ZRANGE", presenceKey, 0, -1)) do
      local item = read(id)
      if item then
        item["ready"] = false
        item["readyEpoch"] = 0
        redis.call("HSET", metadataKey, id, cjson.encode(item))
      end
    end
  else
    current["seenAt"] = now
    if action == "ready" and tonumber(current["slot"]) >= 0 then
      current["ready"] = ready
      current["readyEpoch"] = ready and tonumber(redis.call("GET", generationKey) or "0") or 0
      if not ready then
        for _, id in ipairs(redis.call("ZRANGE", presenceKey, 0, -1)) do
          local item = read(id)
          if item then
            item["ready"] = false
            item["readyEpoch"] = 0
            redis.call("HSET", metadataKey, id, cjson.encode(item))
          end
        end
      end
    elseif action == "authenticate" and userId ~= "" then
      current["userId"] = userId
      current["displayName"] = displayName
      current["avatar"] = avatar
      current["username"] = username
      current["callsign"] = callsign
      current["accent"] = accent
    end
    redis.call("ZADD", presenceKey, now, clientId)
    redis.call("HSET", metadataKey, clientId, cjson.encode(current))
  end
end

if current and tonumber(current["slot"]) >= 0 and current["userId"] and current["userId"] ~= "" then
  redis.call("ZADD", activePlayersKey, now, current["userId"])
  redis.call("EXPIRE", activePlayersKey, ${ROOM_TTL_SECONDS * 3})
end

redis.call("EXPIRE", presenceKey, ${ROOM_TTL_SECONDS})
redis.call("EXPIRE", metadataKey, ${ROOM_TTL_SECONDS})
redis.call("EXPIRE", generationKey, ${ROOM_TTL_SECONDS})

local players = {}
for _, id in ipairs(redis.call("ZRANGE", presenceKey, 0, -1)) do
  local item = read(id)
  if item and tonumber(item["slot"]) >= 0 then table.insert(players, item) end
end
table.sort(players, function(first, second) return tonumber(first["slot"]) < tonumber(second["slot"]) end)

return cjson.encode({
  active = current ~= nil and current["connectionId"] == connectionId,
  role = current and tonumber(current["slot"]) >= 0 and "player" or "spectator",
  slot = current and tonumber(current["slot"]) or -1,
  joinEpoch = current and tonumber(current["joinEpoch"]) or 0,
  players = players
})
`;

function cleanProfile(profile) {
  const userId = String(profile?.id || profile?.userId || "");
  if (!/^[0-9]{15,24}$/.test(userId)) return null;
  const customization = profile?.customization && typeof profile.customization === "object"
    ? profile.customization
    : profile;
  const username = String(profile.username || "").slice(0, 32);
  const displayName = String(profile.displayName || "Discord Player").slice(0, 64);
  const callsign = String(customization.callsign || displayName).slice(0, 24);
  const accent = ["acid", "cyan", "violet", "magenta", "ember"].includes(customization.accent)
    ? customization.accent
    : "acid";
  return {
    userId,
    username,
    displayName,
    callsign,
    accent,
    avatar: String(profile.avatar || "").slice(0, 128),
  };
}

function publicPlayer(value) {
  return {
    id: String(value.id),
    slot: Number(value.slot),
    ready: Boolean(value.ready),
    seenAt: Number(value.seenAt) || Date.now(),
    profile: value.userId
      ? {
        displayName: String(value.displayName || "Discord Player").slice(0, 64),
        username: String(value.username || "").slice(0, 32),
        callsign: String(value.callsign || value.displayName || "Discord Player").slice(0, 24),
        accent: ["acid", "cyan", "violet", "magenta", "ember"].includes(value.accent)
          ? value.accent
          : "acid",
        avatar: String(value.avatar || "").slice(0, 128),
      }
      : null,
  };
}

function validDirection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isInteger(x) && Number.isInteger(y) && Math.abs(x) + Math.abs(y) === 1;
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

function validateRealtimeMessage(value, { slot, allReady, now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.type === "ping") {
    return safeInteger(value.at, 0) ? { type: "ping", at: Number(value.at) } : null;
  }
  if (value.type === "ready" && (slot === 0 || slot === 1)) {
    return { type: "ready", ready: Boolean(value.ready) };
  }
  if (value.type === "input" && (slot === 0 || slot === 1)) {
    if (!safeInteger(value.round, 1) || !safeInteger(value.sequence, 1) || !validDirection(value.direction)) {
      return null;
    }
    return {
      type: "input",
      round: Number(value.round),
      sequence: Number(value.sequence),
      direction: { x: Number(value.direction.x), y: Number(value.direction.y) },
    };
  }
  if (value.type === "countdown" && slot === 0 && allReady) {
    const startsAt = Number(value.startsAt);
    if (
      !safeInteger(value.round, 1)
      || !Number.isFinite(startsAt)
      || startsAt < now - 1_000
      || startsAt > now + 10_000
    ) return null;
    return { type: "countdown", round: Number(value.round), startsAt: Math.round(startsAt) };
  }
  if (value.type === "state" && slot === 0) return { type: "state" };
  return null;
}

function parseRoomRequest(request) {
  const host = String(request.headers?.["x-forwarded-host"] || request.headers?.host || "")
    .split(",")[0]
    .trim();
  const protocol = String(request.headers?.["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const url = new URL(request.url || "/api/realtime", `${protocol}://${host}`);
  const room = String(url.searchParams.get("room") || "").toUpperCase();
  const clientId = String(url.searchParams.get("clientId") || "");
  return { url, room, clientId, host };
}

function requestIsSameOrigin(request) {
  const { host } = parseRoomRequest(request);
  const origin = String(request.headers?.origin || "");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.host === host;
  } catch {
    return false;
  }
}

function roomKeys(room) {
  const tag = `{neon-snake:realtime:${room}}`;
  return [`${tag}:presence`, `${tag}:metadata`, `${tag}:generation`];
}

function roomChannel(room) {
  return `neon-snake:realtime:${room}:events`;
}

function decodeSseEvent(rawEvent) {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  if (data.startsWith("subscribe,")) return { type: "subscribed" };
  if (!data.startsWith("message,")) return null;
  const first = data.indexOf(",");
  const second = data.indexOf(",", first + 1);
  if (second < 0) return null;
  try {
    return { type: "message", payload: JSON.parse(data.slice(second + 1)) };
  } catch {
    return null;
  }
}

function createRedisRestBus({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  redisCommand,
  onError = () => {},
} = {}) {
  const subscriptions = new Map();
  const runRedis = redisCommand || ((command) => executeRedisRest(command, {
    environment,
    fetchImpl,
  }));

  async function stream(entry) {
    let failures = 0;
    while (!entry.closed && entry.handlers.size) {
      const controller = new AbortController();
      entry.controller = controller;
      try {
        const config = redisConfig(environment);
        const response = await fetchImpl(
          `${config.url}/subscribe/${encodeURIComponent(entry.channel)}`,
          {
            method: "POST",
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${config.token}`,
            },
            signal: controller.signal,
          },
        );
        if (!response.ok || !response.body) throw new Error("Redis event stream is unavailable.");
        failures = 0;
        entry.markReady();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!entry.closed && entry.handlers.size) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Redis event stream closed.");
          buffer += decoder.decode(chunk.value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() || "";
          for (const rawEvent of events) {
            const event = decodeSseEvent(rawEvent);
            if (event?.type !== "message") continue;
            entry.handlers.forEach((handler) => handler(event.payload));
          }
        }
      } catch (error) {
        if (entry.closed || controller.signal.aborted || !entry.handlers.size) break;
        failures += 1;
        onError(error, entry.room);
        // Redis's SSE transport may rotate an otherwise healthy subscription.
        // Reconnect the relay without throwing every live WebSocket out of the room.
        await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, failures * 250)));
      }
    }
  }

  return {
    async subscribe(room, handler) {
      let entry = subscriptions.get(room);
      if (!entry) {
        let readyResolve;
        const ready = new Promise((resolve) => {
          readyResolve = resolve;
        });
        entry = {
          room,
          channel: roomChannel(room),
          handlers: new Set(),
          controller: null,
          closed: false,
          ready,
          markReady: readyResolve,
        };
        subscriptions.set(room, entry);
      }
      entry.handlers.add(handler);
      if (!entry.controller) void stream(entry);
      let timeout;
      try {
        await Promise.race([
          entry.ready,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Redis event subscription timed out.")),
              5_000,
            );
          }),
        ]);
      } catch (error) {
        entry.handlers.delete(handler);
        if (!entry.handlers.size) {
          entry.closed = true;
          entry.controller?.abort();
          subscriptions.delete(room);
        }
        throw error;
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      return () => {
        entry.handlers.delete(handler);
        if (entry.handlers.size) return;
        entry.closed = true;
        entry.controller?.abort();
        subscriptions.delete(room);
      };
    },
    async publish(room, payload) {
      await runRedis(["PUBLISH", roomChannel(room), JSON.stringify(payload)]);
    },
    close() {
      subscriptions.forEach((entry) => {
        entry.closed = true;
        entry.controller?.abort();
      });
      subscriptions.clear();
    },
  };
}

class RoomSimulation {
  constructor(hub, room, authorityConnectionId) {
    this.hub = hub;
    this.room = room;
    this.authorityConnectionId = authorityConnectionId;
    this.game = null;
    this.tickTimer = null;
    this.nextTickAt = 0;
  }

  roomSeed() {
    let state = 2166136261;
    for (const character of this.room) {
      state ^= character.charCodeAt(0);
      state = Math.imul(state, 16777619);
    }
    return state >>> 0;
  }

  nextRandom() {
    let value = this.game.signalCursor || 0x6d2b79f5;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.game.signalCursor = value >>> 0;
    return this.game.signalCursor / 4294967296;
  }

  placeFood() {
    const occupied = new Set([
      ...this.game.playerSnake,
      ...this.game.opponentSnake,
    ].map((point) => `${point.x},${point.y}`));
    const free = [];
    for (let y = 0; y < DUEL_GRID; y += 1) {
      for (let x = 0; x < DUEL_GRID; x += 1) {
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    this.game.food = free.length
      ? free[Math.floor(this.nextRandom() * free.length)]
      : null;
  }

  start(countdown) {
    this.stop();
    const seed = this.roomSeed() ^ Number(countdown.round);
    this.game = {
      round: countdown.round,
      startsAt: countdown.startsAt,
      sequence: 0,
      signalCursor: seed >>> 0,
      playerSnake: [{ x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }],
      opponentSnake: [{ x: 22, y: 19 }, { x: 23, y: 19 }, { x: 24, y: 19 }],
      playerDirection: { x: 1, y: 0 },
      opponentDirection: { x: -1, y: 0 },
      playerInputs: [],
      opponentInputs: [],
      playerInputAck: 0,
      playerScore: 0,
      opponentScore: 0,
      guestInputAck: 0,
      food: null,
      over: false,
    };
    this.placeFood();
    this.nextTickAt = countdown.startsAt;
    this.tickTimer = setTimeout(
      () => void this.tick(),
      Math.max(0, countdown.startsAt - Date.now()),
    );
  }

  stop() {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.nextTickAt = 0;
    this.game = null;
  }

  reverse(first, second) {
    return first.x === -second.x && first.y === -second.y;
  }

  enqueue(slot, message) {
    if (!this.game || message.round !== this.game.round) return;
    const queue = slot === 0 ? this.game.playerInputs : this.game.opponentInputs;
    if (queue.some((input) => input.sequence === message.sequence) || queue.length >= 4) return;
    queue.push(message);
    queue.sort((first, second) => first.sequence - second.sequence);
  }

  consumeInput(queue, currentDirection) {
    while (queue.length) {
      const input = queue.shift();
      if (!this.reverse(input.direction, currentDirection)) return input;
    }
    return null;
  }

  resolveTick() {
    const game = this.game;
    const playerInput = this.consumeInput(game.playerInputs, game.playerDirection);
    const opponentInput = this.consumeInput(game.opponentInputs, game.opponentDirection);
    if (playerInput) {
      game.playerDirection = { ...playerInput.direction };
      game.playerInputAck = Math.max(game.playerInputAck, playerInput.sequence);
    }
    if (opponentInput) {
      game.opponentDirection = { ...opponentInput.direction };
      game.guestInputAck = Math.max(game.guestInputAck, opponentInput.sequence);
    }
    const resolved = Rules.resolveDuelTick({
      players: {
        player: {
          snake: game.playerSnake,
          direction: game.playerDirection,
          score: game.playerScore,
        },
        opponent: {
          snake: game.opponentSnake,
          direction: game.opponentDirection,
          score: game.opponentScore,
        },
      },
      food: game.food,
      mode: "classic",
      gridSize: DUEL_GRID,
    });
    game.playerSnake = resolved.players.player.snake;
    game.opponentSnake = resolved.players.opponent.snake;
    game.playerScore = resolved.players.player.score;
    game.opponentScore = resolved.players.opponent.score;
    game.over = resolved.over;
    if (resolved.foodEatenBy && !resolved.over) this.placeFood();
    if (!game.food) game.over = true;
    return { crashes: resolved.crashes, winner: resolved.winner };
  }

  async tick() {
    this.tickTimer = null;
    if (
      !this.game
      || this.game.over
      || !this.hub.roomAllReady(this.room)
      || !this.hub.connectionOwnsSlot(this.room, this.authorityConnectionId, 0)
    ) {
      this.stop();
      return;
    }
    const result = this.resolveTick();
    const game = this.game;
    game.sequence += 1;
    const publishing = this.hub.publish(this.room, {
      kind: "state",
      payload: {
        type: "state",
        from: "server",
        sequence: game.sequence,
        state: {
          playerSnake: game.playerSnake,
          opponentSnake: game.opponentSnake,
          playerDirection: game.playerDirection,
          opponentDirection: game.opponentDirection,
          playerScore: game.playerScore,
          opponentScore: game.opponentScore,
          food: game.food,
          signalCursor: game.signalCursor,
          round: game.round,
          playerInputAck: game.playerInputAck,
          guestInputAck: game.guestInputAck,
          crashes: result.crashes,
          over: game.over,
          winner: result.winner,
        },
        sentAt: Date.now(),
      },
    });
    try {
      await publishing;
    } catch (error) {
      this.hub.abortRound(this.room, this, error);
      return;
    }
    if (game.over) {
      await this.hub.recordMatch(this.room, game.round, result);
      await this.hub.resetReady(this.room);
      this.stop();
      return;
    }
    this.nextTickAt += TICK_DURATION;
    this.tickTimer = setTimeout(
      () => void this.tick(),
      Math.max(0, this.nextTickAt - Date.now()),
    );
  }
}

function createRealtimeHub({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  redisCommand,
  bus,
  sessionReader,
  recordMatch = recordMatchResult,
  now = () => Date.now(),
  uuid = randomUUID,
  logger = console,
} = {}) {
  const instanceId = uuid();
  const connections = new Map();
  const rooms = new Map();
  const runRedis = redisCommand || ((command) => executeRedisRest(command, {
    environment,
    fetchImpl,
  }));
  const eventBus = bus || createRedisRestBus({
    environment,
    fetchImpl,
    redisCommand: runRedis,
    onError(error, room) {
      logger.error("Realtime event relay failed.", {
        room,
        name: typeof error?.name === "string" ? error.name : "Error",
      });
    },
  });
  const readSession = sessionReader || createSessionReader({
    environment,
    fetchImpl,
    redisCommand: runRedis,
  });
  let heartbeatTimer = null;

  function stateFor(room) {
    let state = rooms.get(room);
    if (!state) {
      state = {
        players: [],
        simulation: null,
        unsubscribe: null,
        subscription: null,
      };
      rooms.set(room, state);
    }
    return state;
  }

  function localConnections(room) {
    return [...connections.values()].filter((connection) => connection.room === room);
  }

  function send(connection, payload) {
    try {
      if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(payload));
    } catch {
      // The close callback owns cleanup.
    }
  }

  function sendRaw(connection, payload) {
    try {
      if (connection.socket.readyState === 1) connection.socket.send(payload);
    } catch {
      // The close callback owns cleanup.
    }
  }

  function broadcast(room, payload) {
    localConnections(room).forEach((connection) => send(connection, payload));
  }

  function setRoster(room, players) {
    const state = stateFor(room);
    state.players = Array.isArray(players) ? players : [];
    broadcast(room, {
      type: "roster",
      players: state.players.map(publicPlayer),
      sentAt: now(),
    });
    if (state.simulation && !roomAllReady(room)) {
      state.simulation.stop();
      state.simulation = null;
      broadcast(room, { type: "countdown-cancel", sentAt: now() });
    }
  }

  function abortRound(room, simulation, error) {
    const state = stateFor(room);
    if (state.simulation !== simulation) return;
    simulation.stop();
    state.simulation = null;
    broadcast(room, {
      type: "countdown-cancel",
      slot: -1,
      reason: "relay_unavailable",
      sentAt: now(),
    });
    logger.error("Realtime authoritative relay failed.", {
      room,
      name: typeof error?.name === "string" ? error.name : "Error",
    });
    localConnections(room).forEach((connection) => {
      connection.socket.close(1012, "Realtime relay unavailable");
    });
  }

  function roomAllReady(room, minimumReadyEpoch = 0) {
    const players = stateFor(room).players;
    return players.length === 2 && players.every((player) => (
      player.ready && Number(player.readyEpoch) >= minimumReadyEpoch
    ));
  }

  function connectionOwnsSlot(room, connectionId, slot) {
    return stateFor(room).players.some((player) => (
      Number(player.slot) === slot && player.connectionId === connectionId
    ));
  }

  function dispatch(room, envelope) {
    if (!envelope || envelope.room !== room) return;
    if (envelope.origin === instanceId) return;
    const state = stateFor(room);
    if (envelope.kind === "roster") {
      setRoster(room, envelope.players);
      return;
    }
    if (envelope.kind === "input" && state.simulation) {
      if (connectionOwnsSlot(room, envelope.connectionId, envelope.slot)) {
        state.simulation.enqueue(envelope.slot, envelope.payload);
      }
      return;
    }
    if (envelope.kind === "countdown") {
      broadcast(room, envelope.payload);
      return;
    }
    if (envelope.kind === "state") {
      broadcast(room, envelope.payload);
      return;
    }
    if (envelope.kind === "cancel") {
      state.simulation?.stop();
      state.simulation = null;
      broadcast(room, {
        type: "countdown-cancel",
        slot: Number(envelope.slot),
        sentAt: now(),
      });
    }
  }

  async function ensureSubscription(room) {
    const state = stateFor(room);
    if (!state.subscription) {
      state.subscription = eventBus.subscribe(room, (event) => dispatch(room, event))
        .then((unsubscribe) => {
          state.unsubscribe = unsubscribe;
        });
    }
    await state.subscription;
  }

  async function presence(connection, action, {
    ready = false,
    profile = connection.profile,
  } = {}) {
    const clean = cleanProfile(profile);
    const result = await runRedis([
      "EVAL",
      PRESENCE_SCRIPT,
      "4",
      ...roomKeys(connection.room),
      "neon-snake:players:active",
      String(now()),
      action,
      connection.clientId,
      connection.connectionId,
      ready ? "1" : "0",
      clean?.userId || "",
      clean?.displayName || "",
      clean?.avatar || "",
      clean?.username || "",
      clean?.callsign || "",
      clean?.accent || "acid",
    ]);
    const payload = typeof result === "string" ? JSON.parse(result) : result;
    if (!payload || typeof payload !== "object") throw new Error("Invalid realtime presence response.");
    if (clean?.userId && action !== "leave" && payload.role === "player") {
      try {
        await runRedis([
          "SET",
          `neon-snake:activity:${clean.userId}`,
          String(now()),
          "EX",
          "35",
        ]);
      } catch (error) {
        logger.error("Realtime profile activity refresh failed.", {
          name: typeof error?.name === "string" ? error.name : "Error",
        });
      }
    }
    return payload;
  }

  async function publish(room, event) {
    const envelope = {
      ...event,
      room,
      origin: instanceId,
      sentAt: now(),
    };
    if (event.kind === "roster") setRoster(room, event.players);
    else if (event.kind === "input") {
      const simulation = stateFor(room).simulation;
      if (
        simulation
        && connectionOwnsSlot(room, event.connectionId, event.slot)
      ) simulation.enqueue(event.slot, event.payload);
    } else if (event.kind === "countdown" || event.kind === "state") {
      broadcast(room, event.payload);
    } else if (event.kind === "cancel") {
      const state = stateFor(room);
      state.simulation?.stop();
      state.simulation = null;
      broadcast(room, {
        type: "countdown-cancel",
        slot: Number(event.slot),
        sentAt: now(),
      });
    }
    await eventBus.publish(room, envelope);
  }

  async function publishRoster(room, players) {
    await publish(room, { kind: "roster", players });
  }

  async function refresh(connection, action = "touch", options = {}) {
    const result = await presence(connection, action, options);
    if (!result.active && action !== "leave") {
      connection.socket.close(4001, "Realtime session replaced");
      return result;
    }
    await publishRoster(connection.room, result.players || []);
    return result;
  }

  async function resetReady(room) {
    const players = [...stateFor(room).players];
    for (const player of players) {
      await presence({
        room,
        clientId: player.id,
        connectionId: player.connectionId,
        profile: player,
      }, "ready", { ready: false, profile: player });
    }
    const observer = localConnections(room)[0];
    if (!observer) return;
    const result = await presence(observer, "touch");
    await publishRoster(room, result.players || []);
  }

  async function recordCompletedMatch(room, round, result) {
    const players = stateFor(room).players
      .filter((player) => (Number(player.slot) === 0 || Number(player.slot) === 1) && player.userId)
      .sort((first, second) => Number(first.slot) - Number(second.slot));
    if (players.length !== 2 || players[0].userId === players[1].userId) return;
    const winnerUserId = result.winner === "player"
      ? players[0].userId
      : result.winner === "opponent" ? players[1].userId : null;
    try {
      await recordMatch({
        eventId: `${room}:${round}`,
        firstUserId: players[0].userId,
        secondUserId: players[1].userId,
        winnerUserId,
        endedAt: now(),
      }, {
        environment,
        fetchImpl,
        redisCommand: runRedis,
        now,
      });
    } catch (error) {
      logger.error("Realtime match recording failed.", {
        name: typeof error?.name === "string" ? error.name : "Error",
      });
    }
  }

  async function closeConnection(connection) {
    if (!connections.has(connection.socket)) return;
    connections.delete(connection.socket);
    const reportFailure = (stage, error) => {
      logger.error("Realtime disconnect cleanup failed.", {
        stage,
        name: typeof error?.name === "string" ? error.name : "Error",
      });
    };
    const cancelTask = connection.slot === 0 || connection.slot === 1
      ? publish(connection.room, {
        kind: "cancel",
        slot: connection.slot,
      }).catch((error) => {
        reportFailure("cancel", error);
      })
      : Promise.resolve();
    let players = null;
    try {
      const result = await presence(connection, "leave");
      players = result.players || [];
    } catch (error) {
      reportFailure("presence", error);
    }
    if (players) {
      try {
        await publishRoster(connection.room, players);
      } catch (error) {
        reportFailure("roster", error);
      }
    }
    await cancelTask;
    if (!localConnections(connection.room).length) {
      const state = stateFor(connection.room);
      state.simulation?.stop();
      state.unsubscribe?.();
      rooms.delete(connection.room);
    }
    if (!connections.size && heartbeatTimer !== null) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function handleMessage(connection, raw) {
    if (!connections.has(connection.socket)) return;
    const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw?.byteLength;
    if (!Number.isFinite(size) || size > MAX_MESSAGE_BYTES) {
      connection.socket.close(1009, "Message too large");
      return;
    }
    const timestamp = now();
    const window = Math.floor(timestamp / 1_000);
    if (connection.rateWindow === window) connection.rateCount += 1;
    else {
      connection.rateWindow = window;
      connection.rateCount = 1;
    }
    if (connection.rateCount > MAX_MESSAGES_PER_SECOND) {
      connection.socket.close(1008, "Rate limit exceeded");
      return;
    }
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    if (text === "ping") {
      sendRaw(connection, "pong");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      send(connection, { type: "rejected", code: "invalid_json" });
      return;
    }
    if (parsed?.type === "authenticate") {
      if (connection.profile) {
        send(connection, {
          type: "authenticated",
          profile: publicPlayer({
            ...connection.profile,
            id: connection.clientId,
            slot: connection.slot,
            seenAt: timestamp,
          }).profile,
        });
      } else {
        send(connection, { type: "rejected", code: "authentication_unavailable" });
      }
      return;
    }
    const message = validateRealtimeMessage(parsed, {
      slot: connection.slot,
      allReady: roomAllReady(connection.room),
      now: timestamp,
    });
    if (!message) {
      send(connection, { type: "rejected", code: "invalid_message" });
      return;
    }
    if (message.type === "ping") {
      send(connection, { type: "pong", at: message.at, serverAt: timestamp });
      return;
    }
    if (message.type === "ready") {
      const wasReady = stateFor(connection.room).players.some((player) => (
        player.connectionId === connection.connectionId && player.ready
      ));
      const result = await refresh(connection, "ready", { ready: message.ready });
      if (!message.ready && wasReady && result.active) {
        await publish(connection.room, { kind: "cancel" });
      }
      return;
    }
    if (message.type === "countdown") {
      const result = await refresh(connection, "touch");
      setRoster(connection.room, result.players || []);
      if (
        !roomAllReady(connection.room, connection.joinEpoch)
        || !connectionOwnsSlot(connection.room, connection.connectionId, 0)
      ) {
        send(connection, { type: "rejected", code: "room_not_ready" });
        return;
      }
      const state = stateFor(connection.room);
      state.simulation?.stop();
      state.simulation = new RoomSimulation(
        {
          publish,
          abortRound,
          roomAllReady,
          connectionOwnsSlot,
          recordMatch: recordCompletedMatch,
          resetReady,
        },
        connection.room,
        connection.connectionId,
      );
      state.simulation.start(message);
      await publish(connection.room, {
        kind: "countdown",
        payload: { ...message, from: connection.clientId, sentAt: timestamp },
      });
      return;
    }
    if (message.type === "input") {
      await publish(connection.room, {
        kind: "input",
        slot: connection.slot,
        connectionId: connection.connectionId,
        payload: message,
      });
      return;
    }
    send(connection, { type: "rejected", code: "server_authoritative" });
  }

  function scheduleHeartbeat() {
    if (heartbeatTimer !== null || !connections.size) return;
    heartbeatTimer = setTimeout(async () => {
      heartbeatTimer = null;
      const byRoom = new Map();
      for (const connection of connections.values()) {
        try {
          const result = await presence(connection, "touch");
          if (!result.active) {
            connection.socket.close(4001, "Realtime session replaced");
          } else {
            byRoom.set(connection.room, result.players || []);
          }
        } catch {
          connection.socket.close(1012, "Realtime presence unavailable");
        }
      }
      for (const [room, players] of byRoom) {
        try {
          await publishRoster(room, players);
        } catch {
          localConnections(room).forEach((connection) => {
            connection.socket.close(1012, "Realtime relay unavailable");
          });
        }
      }
      scheduleHeartbeat();
    }, 10_000);
  }

  async function connect(socket, request) {
    if (!requestIsSameOrigin(request)) {
      socket.close(1008, "Origin not allowed");
      return;
    }
    const { room, clientId } = parseRoomRequest(request);
    if (!ROOM_PATTERN.test(room) || !CLIENT_PATTERN.test(clientId)) {
      socket.close(1008, "Invalid room request");
      return;
    }
    const connection = {
      socket,
      room,
      clientId,
      connectionId: uuid(),
      joinEpoch: 0,
      slot: -1,
      profile: null,
      rateWindow: 0,
      rateCount: 0,
    };
    connections.set(socket, connection);
    socket.on("message", (raw) => void handleMessage(connection, raw));
    const close = () => void closeConnection(connection);
    socket.on("close", close);
    socket.on("error", close);
    try {
      await ensureSubscription(room);
      const current = await readSession(request);
      connection.profile = cleanProfile(current?.profile);
      const result = await presence(connection, "join", { profile: connection.profile });
      if (result.error === "room_full") {
        socket.close(1013, "Room connection limit reached");
        return;
      }
      connection.slot = Number(result.slot);
      connection.joinEpoch = Number(result.joinEpoch) || 0;
      stateFor(room).players = result.players || [];
      send(connection, {
        type: "welcome",
        role: result.role === "player" ? "player" : "spectator",
        slot: connection.slot,
        players: (result.players || []).map(publicPlayer),
        sentAt: now(),
      });
      if (connection.profile) {
        send(connection, {
          type: "authenticated",
          profile: publicPlayer({
            ...connection.profile,
            id: clientId,
            slot: connection.slot,
            seenAt: now(),
          }).profile,
        });
      }
      await publishRoster(room, result.players || []);
      scheduleHeartbeat();
    } catch (error) {
      logger.error("Realtime connection failed.", {
        name: typeof error?.name === "string" ? error.name : "Error",
      });
      connections.delete(socket);
      if (!localConnections(room).length) {
        const state = rooms.get(room);
        state?.unsubscribe?.();
        rooms.delete(room);
      }
      socket.close(1013, "Realtime service unavailable");
    }
  }

  return {
    connect,
    close() {
      if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
      rooms.forEach((state) => {
        state.simulation?.stop();
        state.unsubscribe?.();
      });
      rooms.clear();
      eventBus.close?.();
    },
    connectionOwnsSlot,
    publish,
    resetReady,
    roomAllReady,
    recordMatch: recordCompletedMatch,
    _state: { connections, rooms, instanceId },
  };
}

module.exports = {
  CONNECTION_TTL_MS,
  DUEL_GRID,
  MAX_CONNECTIONS,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  PRESENCE_SCRIPT,
  RoomSimulation,
  TICK_DURATION,
  cleanProfile,
  createRealtimeHub,
  createRedisRestBus,
  decodeSseEvent,
  parseRoomRequest,
  publicPlayer,
  requestIsSameOrigin,
  validateRealtimeMessage,
};
