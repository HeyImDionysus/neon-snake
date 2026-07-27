"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  PRESENCE_SCRIPT,
  RoomSimulation,
  createRealtimeHub,
  createRedisRestBus,
  decodeSseEvent,
  requestIsSameOrigin,
  validateRealtimeMessage,
} = require("./server/realtime-core.cjs");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.messages = [];
    this.closeCalls = [];
  }

  send(value) {
    this.messages.push(value === "pong" ? value : JSON.parse(value));
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  message(value) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }
}

function request(room, clientId) {
  return {
    url: `/api/realtime?room=${room}&clientId=${clientId}`,
    headers: {
      host: "neon-snake-green-tau.vercel.app",
      origin: "https://neon-snake-green-tau.vercel.app",
      "x-forwarded-host": "neon-snake-green-tau.vercel.app",
      "x-forwarded-proto": "https",
    },
  };
}

function createFakeRedis() {
  const roomState = new Map();
  const roomGeneration = new Map();
  return async function redisCommand(command) {
    assert.equal(command[0], "EVAL");
    assert.equal(command[1], PRESENCE_SCRIPT);
    const room = String(command[3]).match(/realtime:([A-Z0-9]{6})/)?.[1];
    assert.ok(room);
    if (!roomState.has(room)) roomState.set(room, new Map());
    const players = roomState.get(room);
    const timestamp = Number(command[6]);
    const action = command[7];
    const clientId = command[8];
    const connectionId = command[9];
    const ready = command[10] === "1";
    const profile = {
      userId: command[11],
      displayName: command[12],
      avatar: command[13],
    };
    let current = players.get(clientId);
    if (action === "join") {
      const generation = (roomGeneration.get(room) || 0) + 1;
      roomGeneration.set(room, generation);
      const used = new Set([...players.values()].filter((item) => item.slot >= 0).map((item) => item.slot));
      const slot = current?.slot ?? (!used.has(0) ? 0 : !used.has(1) ? 1 : -1);
      current = {
        id: clientId,
        connectionId,
        slot,
        ready: false,
        readyEpoch: 0,
        joinEpoch: generation,
        seenAt: timestamp,
        ...profile,
      };
      players.set(clientId, current);
    } else if (current?.connectionId === connectionId) {
      if (action === "leave") {
        players.delete(clientId);
        current = null;
        players.forEach((player) => {
          player.ready = false;
          player.readyEpoch = 0;
        });
      } else {
        current.seenAt = timestamp;
        if (action === "ready" && current.slot >= 0) {
          current.ready = ready;
          current.readyEpoch = ready ? roomGeneration.get(room) || 0 : 0;
        }
      }
    }
    const roster = [...players.values()]
      .filter((item) => item.slot >= 0)
      .sort((first, second) => first.slot - second.slot);
    return JSON.stringify({
      active: Boolean(current && current.connectionId === connectionId),
      role: current?.slot >= 0 ? "player" : "spectator",
      slot: current?.slot ?? -1,
      joinEpoch: current?.joinEpoch ?? 0,
      players: roster,
    });
  };
}

function createFakeBus() {
  const listeners = new Map();
  const published = [];
  let publishError = null;
  let stateGate = null;
  return {
    published,
    failPublishing(error) {
      publishError = error;
    },
    deferNextState() {
      let resolve;
      let reject;
      const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      stateGate = { promise, resolve, reject };
      return stateGate;
    },
    async subscribe(room, handler) {
      if (!listeners.has(room)) listeners.set(room, new Set());
      listeners.get(room).add(handler);
      return () => listeners.get(room)?.delete(handler);
    },
    async publish(room, payload) {
      if (payload.kind === "state" && stateGate) {
        const gate = stateGate;
        stateGate = null;
        await gate.promise;
      }
      if (publishError) throw publishError;
      published.push({ room, payload });
      listeners.get(room)?.forEach((handler) => handler(payload));
    },
    close() {},
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const timestamp = Date.now();
  assert.deepEqual(validateRealtimeMessage({
    type: "input",
    round: timestamp,
    sequence: timestamp + 1,
    direction: { x: 0, y: -1 },
  }, { slot: 0, allReady: true, now: timestamp }), {
    type: "input",
    round: timestamp,
    sequence: timestamp + 1,
    direction: { x: 0, y: -1 },
  });
  assert.equal(validateRealtimeMessage({
    type: "input",
    round: 4,
    sequence: 10,
    direction: { x: 2, y: 0 },
  }, { slot: 1, allReady: true, now: timestamp }), null);
  assert.ok(validateRealtimeMessage({
    type: "countdown",
    round: timestamp,
    startsAt: timestamp + 3_200,
  }, { slot: 0, allReady: true, now: timestamp }));
  assert.equal(validateRealtimeMessage({
    type: "countdown",
    round: timestamp,
    startsAt: timestamp + 3_200,
  }, { slot: 1, allReady: true, now: timestamp }), null);

  assert.equal(requestIsSameOrigin(request("ABC234", "client-one")), true);
  assert.equal(requestIsSameOrigin({
    ...request("ABC234", "client-one"),
    headers: {
      ...request("ABC234", "client-one").headers,
      origin: "https://attacker.example",
    },
  }), false);
  assert.deepEqual(
    decodeSseEvent('data: message,neon-snake:realtime:ABC234:events,{"kind":"input","sequence":2}\n\n'),
    { type: "message", payload: { kind: "input", sequence: 2 } },
  );

  let relayAttempts = 0;
  let relayErrors = 0;
  const relayEvents = [];
  const relay = createRedisRestBus({
    environment: {
      STORAGE_KV_REST_API_URL: "https://redis.example",
      STORAGE_KV_REST_API_TOKEN: "test-token",
    },
    redisCommand: async () => 1,
    fetchImpl: async () => {
      relayAttempts += 1;
      return {
        ok: true,
        body: {
          getReader() {
            return {
              read: relayAttempts === 1
                ? async () => ({ done: true })
                : async () => new Promise(() => {}),
            };
          },
        },
      };
    },
    onError() {
      relayErrors += 1;
    },
  });
  const stopRelay = await relay.subscribe("ABC234", (event) => relayEvents.push(event));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(relayAttempts >= 2);
  assert.ok(relayErrors >= 1);
  assert.deepEqual(relayEvents, []);
  stopRelay();
  relay.close();

  const healthyRedis = createFakeRedis();
  let redisError = null;
  const redisCommand = async (command) => {
    if (redisError) throw redisError;
    return healthyRedis(command);
  };
  const bus = createFakeBus();
  let hubNumber = 0;
  const createHub = () => createRealtimeHub({
    redisCommand,
    bus,
    sessionReader: async () => null,
    recordMatch: async () => true,
    uuid: () => `server-or-connection-${++hubNumber}`,
    logger: { error() {} },
  });
  const firstHub = createHub();
  const secondHub = createHub();
  const first = new FakeSocket();
  const second = new FakeSocket();
  await firstHub.connect(first, request("ABC234", "client-one"));
  await secondHub.connect(second, request("ABC234", "client-two"));
  await flush();

  assert.equal(first.messages.find((message) => message.type === "welcome").slot, 0);
  assert.equal(second.messages.find((message) => message.type === "welcome").slot, 1);
  assert.ok(first.messages.some((message) => (
    message.type === "roster" && message.players.length === 2
  )));

  first.message({ type: "ready", ready: true });
  second.message({ type: "ready", ready: true });
  await flush();
  assert.equal(firstHub.roomAllReady("ABC234"), true);
  assert.equal(secondHub.roomAllReady("ABC234"), true);

  const round = Date.now();
  first.message({ type: "countdown", round, startsAt: round + 5_000 });
  await flush();
  assert.ok(first.messages.some((message) => message.type === "countdown"));
  assert.ok(second.messages.some((message) => message.type === "countdown"));
  const simulation = firstHub._state.rooms.get("ABC234").simulation;
  assert.ok(simulation, "Player 1's Vercel Function must own the simulation");

  second.message({
    type: "input",
    round,
    sequence: 1,
    direction: { x: 0, y: -1 },
  });
  await flush();
  assert.equal(simulation.game.opponentInputs.length, 1);
  assert.deepEqual(simulation.game.opponentInputs[0].direction, { x: 0, y: -1 });

  first.message({ type: "state", state: { forged: true } });
  await flush();
  assert.ok(first.messages.some((message) => (
    message.type === "rejected" && message.code === "server_authoritative"
  )));

  const delayedState = bus.deferNextState();
  clearTimeout(simulation.tickTimer);
  simulation.tickTimer = null;
  const oldTick = simulation.tick();
  await flush();
  const replacementRound = round + 1;
  first.message({
    type: "countdown",
    round: replacementRound,
    startsAt: replacementRound + 5_000,
  });
  await flush();
  const replacementSimulation = firstHub._state.rooms.get("ABC234").simulation;
  assert.notEqual(replacementSimulation, simulation);
  delayedState.reject(Object.assign(new Error("Old relay publish timed out."), {
    name: "TimeoutError",
  }));
  await oldTick;
  assert.equal(
    firstHub._state.rooms.get("ABC234").simulation,
    replacementSimulation,
    "A late rejection from an obsolete simulation must not cancel its replacement",
  );

  const relayOutage = new Error("Redis relay timed out.");
  relayOutage.name = "TimeoutError";
  redisError = relayOutage;
  bus.failPublishing(relayOutage);
  second.emit("close");
  await flush();
  clearTimeout(replacementSimulation.tickTimer);
  replacementSimulation.tickTimer = null;
  await replacementSimulation.tick();
  assert.equal(
    firstHub._state.rooms.get("ABC234").simulation,
    null,
    "The authoritative instance must stop its cached simulation when the shared relay fails",
  );
  assert.ok(first.messages.some((message) => (
    message.type === "countdown-cancel"
    && message.reason === "relay_unavailable"
  )), "The authority-side survivor must be cancelled when cross-instance Redis delivery is unavailable");
  assert.ok(first.closeCalls.some(({ code, reason }) => (
    code === 1012 && reason === "Realtime relay unavailable"
  )), "The authority socket must reconnect so a recovered Redis join clears stale Ready state");
  redisError = null;

  const cleanupRedis = createFakeRedis();
  const cleanupBus = createFakeBus();
  const cleanupErrors = [];
  const cleanupHub = createRealtimeHub({
    redisCommand: async (command) => {
      if (command[7] === "leave") {
        const error = new Error("Redis cleanup timed out.");
        error.name = "TimeoutError";
        throw error;
      }
      return cleanupRedis(command);
    },
    bus: cleanupBus,
    sessionReader: async () => null,
    recordMatch: async () => true,
    uuid: () => `cleanup-${++hubNumber}`,
    logger: {
      error(message, details) {
        cleanupErrors.push({ message, details });
      },
    },
  });
  const cleanupSocket = new FakeSocket();
  const cleanupPeer = new FakeSocket();
  await cleanupHub.connect(cleanupSocket, request("DEF567", "cleanup-client"));
  await cleanupHub.connect(cleanupPeer, request("DEF567", "cleanup-peer"));
  cleanupSocket.emit("close");
  await flush();
  assert.ok(cleanupBus.published.some(({ room, payload }) => (
    room === "DEF567" && payload.kind === "cancel" && payload.slot === 0
  )), "A timed-out presence cleanup must not suppress the room cancellation");
  assert.ok(cleanupPeer.messages.some((message) => (
    message.type === "countdown-cancel" && message.slot === 0
  )), "The surviving client must receive the departed slot without waiting for a fresh roster");
  assert.deepEqual(cleanupErrors, [{
    message: "Realtime disconnect cleanup failed.",
    details: { stage: "presence", name: "TimeoutError" },
  }]);
  cleanupHub.close();

  let reconnectNow = 10_000;
  const reconnectRedis = createFakeRedis();
  let failReconnectLeave = false;
  const reconnectHub = createRealtimeHub({
    redisCommand: async (command) => {
      if (failReconnectLeave && command[7] === "leave") {
        throw Object.assign(new Error("Redis leave timed out."), {
          name: "TimeoutError",
        });
      }
      return reconnectRedis(command);
    },
    bus: createFakeBus(),
    sessionReader: async () => null,
    recordMatch: async () => true,
    now: () => {
      reconnectNow += 1;
      return reconnectNow;
    },
    uuid: () => `reconnect-${++hubNumber}`,
    logger: { error() {} },
  });
  const originalHost = new FakeSocket();
  const reconnectGuest = new FakeSocket();
  await reconnectHub.connect(originalHost, request("GHJ678", "reconnect-host"));
  await reconnectHub.connect(reconnectGuest, request("GHJ678", "reconnect-guest"));
  originalHost.message({ type: "ready", ready: true });
  reconnectGuest.message({ type: "ready", ready: true });
  await flush();
  failReconnectLeave = true;
  originalHost.emit("close");
  await flush();
  failReconnectLeave = false;
  const replacementHost = new FakeSocket();
  await reconnectHub.connect(replacementHost, request("GHJ678", "reconnect-host"));
  replacementHost.message({ type: "ready", ready: true });
  await flush();
  replacementHost.message({
    type: "countdown",
    round: reconnectNow,
    startsAt: reconnectNow + 3_200,
  });
  await flush();
  assert.ok(replacementHost.messages.some((message) => (
    message.type === "rejected" && message.code === "room_not_ready"
  )), "A reconnected authority must require the remote player to opt in again after its join");
  reconnectHub.close();

  const echoBus = createFakeBus();
  const echoHub = createRealtimeHub({
    redisCommand: createFakeRedis(),
    bus: echoBus,
    sessionReader: async () => null,
    recordMatch: async () => true,
    uuid: () => `echo-${++hubNumber}`,
    logger: { error() {} },
  });
  const echoHost = new FakeSocket();
  const echoGuest = new FakeSocket();
  await echoHub.connect(echoHost, request("KLM789", "echo-host"));
  await echoHub.connect(echoGuest, request("KLM789", "echo-guest"));
  echoHost.message({ type: "ready", ready: true });
  echoGuest.message({ type: "ready", ready: true });
  await flush();
  echoHost.message({ type: "ready", ready: false });
  await flush();
  const firstCancelCount = echoBus.published.filter(({ payload }) => payload.kind === "cancel").length;
  assert.equal(firstCancelCount, 1);
  echoHost.message({ type: "ready", ready: false });
  await flush();
  assert.equal(
    echoBus.published.filter(({ payload }) => payload.kind === "cancel").length,
    firstCancelCount,
    "Repeating an already-false Ready update must not republish cancellation",
  );
  echoHub.close();

  const unitSimulation = new RoomSimulation({
    publish: async () => {},
    roomAllReady: () => true,
    connectionOwnsSlot: () => true,
    recordMatch: async () => {},
    resetReady: async () => {},
  }, "ABC234", "authority");
  unitSimulation.game = {
    playerSnake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
    opponentSnake: [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }],
    playerDirection: { x: 1, y: 0 },
    opponentDirection: { x: -1, y: 0 },
    playerInputs: [],
    opponentInputs: [],
    playerScore: 0,
    opponentScore: 0,
    guestInputAck: 0,
    food: { x: 20, y: 20 },
    over: false,
  };
  assert.deepEqual(unitSimulation.resolveTick(), {
    crashes: { player: "head-on", opponent: "head-on" },
    winner: null,
  });

  firstHub.close();
  secondHub.close();
  const source = fs.readFileSync(path.join(__dirname, "server", "realtime-core.cjs"), "utf8");
  const entry = fs.readFileSync(path.join(__dirname, "api", "realtime.mjs"), "utf8");
  assert.match(source, /TICK_DURATION = 138/);
  assert.match(source, /Rules\.resolveDuelTick/);
  assert.match(source, /server_authoritative/);
  assert.match(source, /createSessionReader/);
  assert.match(source, /recordMatchResult/);
  assert.match(entry, /WebSocketServer/);
  assert.doesNotMatch(source + entry, /Cloudflare|Durable Object|REALTIME_SHARED_SECRET|WebSocketPair/);

  process.stdout.write("PASS Vercel WebSockets own authoritative ticks, relay cross-instance input, and keep identity server-side\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
