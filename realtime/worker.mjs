import "../public/game-logic.js";

const CLIENT_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const MAX_CONNECTIONS = 12;
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_MESSAGES_PER_SECOND = 40;
const DUEL_GRID = 30;
const TICK_DURATION = 138;
const Rules = globalThis.SnakeRules;
if (!Rules?.resolveDuelTick) throw new Error("Shared duel rules are unavailable.");

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
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

export function validateRealtimeMessage(value, { slot, allReady, now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.type === "ping") {
    return safeInteger(value.at, 0, Number.MAX_SAFE_INTEGER) ? { type: "ping", at: value.at } : null;
  }
  if (value.type === "authenticate" && typeof value.ticket === "string" && value.ticket.length <= 2_048) {
    return { type: "authenticate", ticket: value.ticket };
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
  if (value.type === "state" && slot === 0) {
    return { type: "state" };
  }
  return null;
}

function attachment(socket) {
  try {
    return socket.deserializeAttachment() || null;
  } catch {
    return null;
  }
}

function publicPlayer(value) {
  return {
    id: value.id,
    slot: value.slot,
    ready: Boolean(value.ready),
    seenAt: value.seenAt,
    profile: value.userId
      ? {
        displayName: value.displayName,
        avatar: value.avatar,
      }
      : null,
  };
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

export async function verifyRealtimeTicket(ticket, secret, now = Date.now()) {
  if (!ticket || typeof secret !== "string" || secret.length < 32 || typeof ticket !== "string") {
    return null;
  }
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const expected = await hmac(parts[0], secret);
  if (expected.length !== parts[1].length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ parts[1].charCodeAt(index);
  }
  if (difference !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    if (
      !/^[0-9]{15,24}$/.test(String(payload.sub || ""))
      || !Number.isFinite(payload.exp)
      || payload.exp < now
      || payload.exp > now + 10 * 60 * 1_000
    ) return null;
    return {
      userId: String(payload.sub),
      clientId: String(payload.cid || ""),
      displayName: String(payload.name || "Discord Player").slice(0, 64),
      avatar: String(payload.avatar || "").slice(0, 128),
      jti: String(payload.jti || ""),
    };
  } catch {
    return null;
  }
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.roomCode = "";
    this.game = null;
    this.tickTimer = null;
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  sockets() {
    return this.ctx.getWebSockets()
      .map((socket) => ({ socket, data: attachment(socket) }))
      .filter((entry) => entry.data);
  }

  roster() {
    return this.sockets()
      .filter((entry) => entry.data.slot === 0 || entry.data.slot === 1)
      .map((entry) => publicPlayer(entry.data))
      .sort((first, second) => first.slot - second.slot);
  }

  allReady() {
    const players = this.roster();
    return players.length === 2 && players.every((player) => player.ready);
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // The close callback will remove dead connections.
    }
  }

  broadcast(payload, except = null) {
    const serialized = JSON.stringify(payload);
    this.ctx.getWebSockets().forEach((socket) => {
      if (socket === except) return;
      try {
        socket.send(serialized);
      } catch {
        // The close callback will remove dead connections.
      }
    });
  }

  broadcastRoster() {
    const players = this.roster();
    this.broadcast({ type: "roster", players, sentAt: Date.now() });
  }

  roomSeed() {
    let state = 2166136261;
    for (const character of this.roomCode) {
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

  startRound(countdown) {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
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
      playerScore: 0,
      opponentScore: 0,
      guestInputAck: 0,
      food: null,
      over: false,
    };
    this.placeFood();
    this.tickTimer = setTimeout(
      () => this.tick(),
      Math.max(0, countdown.startsAt - Date.now()),
    );
  }

  reverse(first, second) {
    return first.x === -second.x && first.y === -second.y;
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
    if (playerInput) game.playerDirection = { ...playerInput.direction };
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
    return {
      crashes: resolved.crashes,
      winner: resolved.winner,
    };
  }

  snapshot(result) {
    const game = this.game;
    game.sequence += 1;
    this.broadcast({
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
        guestInputAck: game.guestInputAck,
        crashes: result.crashes,
        over: game.over,
        winner: result.winner,
      },
      sentAt: Date.now(),
    });
  }

  tick() {
    this.tickTimer = null;
    if (!this.game || this.game.over || !this.allReady()) {
      this.game = null;
      return;
    }
    const result = this.resolveTick();
    this.snapshot(result);
    if (this.game.over) {
      this.ctx.waitUntil(this.recordMatch(result));
      this.sockets().forEach(({ socket, data }) => {
        if (data.slot !== 0 && data.slot !== 1) return;
        data.ready = false;
        socket.serializeAttachment(data);
      });
      this.broadcastRoster();
      this.game = null;
      return;
    }
    this.tickTimer = setTimeout(() => this.tick(), TICK_DURATION);
  }

  async recordMatch(result) {
    const players = this.sockets()
      .filter(({ data }) => (data.slot === 0 || data.slot === 1) && data.userId)
      .sort((first, second) => first.data.slot - second.data.slot);
    if (
      players.length !== 2
      || players[0].data.userId === players[1].data.userId
      || String(this.env.REALTIME_SHARED_SECRET || "").length < 32
      || !this.env.APP_API_ORIGIN
    ) return;
    const first = players[0].data;
    const second = players[1].data;
    const winnerUserId = result.winner === "player"
      ? first.userId
      : result.winner === "opponent" ? second.userId : null;
    const resultPayload = {
      eventId: `${this.roomCode}:${this.game.round}`,
      firstUserId: first.userId,
      secondUserId: second.userId,
      winnerUserId,
      endedAt: Date.now(),
    };
    const body = JSON.stringify(resultPayload);
    const signature = await hmac(
      matchSignaturePayload(resultPayload),
      this.env.REALTIME_SHARED_SECRET,
    );
    await fetch(`${this.env.APP_API_ORIGIN.replace(/\/+$/, "")}/api/match-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Neon-Signature": signature,
      },
      body,
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse(426, { error: "websocket_required" }, { Upgrade: "websocket" });
    }
    const url = new URL(request.url);
    this.roomCode = url.pathname.split("/").pop() || this.roomCode;
    const clientId = url.searchParams.get("clientId") || "";
    if (!CLIENT_PATTERN.test(clientId)) return jsonResponse(400, { error: "invalid_client" });

    const connections = this.sockets();
    if (connections.length >= MAX_CONNECTIONS) return jsonResponse(429, { error: "room_full" });
    if (connections.some((entry) => entry.data.id === clientId)) {
      return jsonResponse(409, { error: "duplicate_client" });
    }

    const occupied = new Set(connections.map((entry) => entry.data.slot));
    const slot = !occupied.has(0) ? 0 : !occupied.has(1) ? 1 : -1;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const data = {
      id: clientId,
      roomCode: this.roomCode,
      slot,
      ready: false,
      seenAt: Date.now(),
      rateWindow: 0,
      rateCount: 0,
      userId: "",
      displayName: "",
      avatar: "",
    };
    server.serializeAttachment(data);
    this.ctx.acceptWebSocket(server);
    this.send(server, {
      type: "welcome",
      role: slot >= 0 ? "player" : "spectator",
      slot,
      players: this.roster(),
      sentAt: Date.now(),
    });
    this.broadcastRoster();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    if (typeof rawMessage !== "string" || new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, "Message too large");
      return;
    }
    const data = attachment(socket);
    if (!data) {
      socket.close(1008, "Missing session");
      return;
    }
    if (!this.roomCode && data.roomCode) this.roomCode = data.roomCode;

    const now = Date.now();
    const rateWindow = Math.floor(now / 1_000);
    if (data.rateWindow === rateWindow) data.rateCount += 1;
    else {
      data.rateWindow = rateWindow;
      data.rateCount = 1;
    }
    data.seenAt = now;
    socket.serializeAttachment(data);
    if (data.rateCount > MAX_MESSAGES_PER_SECOND) {
      socket.close(1008, "Rate limit exceeded");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      this.send(socket, { type: "rejected", code: "invalid_json" });
      return;
    }
    const message = validateRealtimeMessage(parsed, {
      slot: data.slot,
      allReady: this.allReady(),
      now,
    });
    if (!message) {
      this.send(socket, { type: "rejected", code: "invalid_message" });
      return;
    }
    if (message.type === "ping") {
      this.send(socket, { type: "pong", at: message.at, serverAt: now });
      return;
    }
    if (message.type === "authenticate") {
      if (data.userId) {
        this.send(socket, { type: "rejected", code: "already_authenticated" });
        return;
      }
      const identity = await verifyRealtimeTicket(
        message.ticket,
        this.env.REALTIME_SHARED_SECRET,
        now,
      );
      if (!identity || identity.clientId !== data.id) {
        this.send(socket, { type: "rejected", code: "authentication_invalid" });
        return;
      }
      data.userId = identity.userId;
      data.displayName = identity.displayName;
      data.avatar = identity.avatar;
      socket.serializeAttachment(data);
      this.send(socket, { type: "authenticated", profile: publicPlayer(data).profile });
      this.broadcastRoster();
      return;
    }
    if (message.type === "ready") {
      data.ready = message.ready;
      data.seenAt = now;
      socket.serializeAttachment(data);
      this.broadcastRoster();
      if (!message.ready) {
        if (this.tickTimer !== null) clearTimeout(this.tickTimer);
        this.tickTimer = null;
        this.game = null;
        this.broadcast({ type: "countdown-cancel", sentAt: now });
      }
      return;
    }
    if (message.type === "countdown") this.startRound(message);
    if (message.type === "input" && this.game && message.round === this.game.round) {
      const queue = data.slot === 0 ? this.game.playerInputs : this.game.opponentInputs;
      if (!queue.some((input) => input.sequence === message.sequence) && queue.length < 4) {
        queue.push(message);
        queue.sort((first, second) => first.sequence - second.sequence);
      }
      return;
    }
    if (message.type === "state") {
      this.send(socket, { type: "rejected", code: "server_authoritative" });
      return;
    }
    this.broadcast({
      ...message,
      from: data.id,
      sentAt: now,
    });
  }

  async webSocketClose(socket, code, reason) {
    const data = attachment(socket);
    if (data) {
      data.slot = -2;
      data.ready = false;
      try {
        socket.serializeAttachment(data);
      } catch {
        // The socket may already be detached.
      }
    }
    try {
      socket.close(code, reason);
    } catch {
      // New runtimes auto-reply to close frames.
    }
    this.broadcastRoster();
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.game = null;
    this.broadcast({ type: "countdown-cancel", sentAt: Date.now() });
  }

  async webSocketError(socket) {
    const data = attachment(socket);
    if (data) {
      data.slot = -2;
      data.ready = false;
      try {
        socket.serializeAttachment(data);
      } catch {
        // The socket may already be detached.
      }
    }
    try {
      socket.close(1011, "Connection error");
    } catch {
      // Ignore an already-closed socket.
    }
    this.broadcastRoster();
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.game = null;
  }
}

function allowedOrigin(request, expectedOrigin) {
  const origin = request.headers.get("Origin");
  if (!origin || !expectedOrigin) return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return jsonResponse(200, { ok: true, transport: "durable-object-websocket" });
    }
    const match = url.pathname.match(/^\/room\/([23456789A-HJ-NP-Z]{6})$/);
    if (!match) return jsonResponse(404, { error: "not_found" });
    if (!allowedOrigin(request, env.APP_ORIGIN)) {
      return jsonResponse(403, { error: "origin_not_allowed" });
    }
    const id = env.ROOMS.idFromName(match[1]);
    return env.ROOMS.get(id).fetch(request);
  },
};
