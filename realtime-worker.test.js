"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  PRESENCE_SCRIPT,
  DEFAULT_ROOM_CAPACITY,
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

function request(room, clientId, resumeToken = "") {
  return {
    url: `/api/realtime?room=${room}&clientId=${clientId}`,
    headers: {
      host: "neon-snake-green-tau.vercel.app",
      origin: "https://neon-snake-green-tau.vercel.app",
      "x-forwarded-host": "neon-snake-green-tau.vercel.app",
      "x-forwarded-proto": "https",
      "sec-websocket-protocol": resumeToken ? `neon-snake-v1, resume.${resumeToken}` : "neon-snake-v1",
    },
  };
}

function createFakeRedis() {
  const roomState = new Map();
  const roomGeneration = new Map();
  const values = new Map();
  return async function redisCommand(command) {
    if (command[0] === "GET") return values.get(command[1]) ?? null;
    if (command[0] === "SET") {
      values.set(command[1], command[2]);
      return "OK";
    }
    if (command[0] === "DEL") return values.delete(command[1]) ? 1 : 0;
    assert.equal(command[0], "EVAL");
    assert.equal(command[1], PRESENCE_SCRIPT);
    const room = String(command[3]).match(/realtime:([A-Z0-9]{6})/)?.[1];
    assert.ok(room);
    if (!roomState.has(room)) roomState.set(room, new Map());
    const players = roomState.get(room);
    assert.equal(command[2], "4");
    assert.equal(command[6], "neon-snake:players:active");
    const timestamp = Number(command[7]);
    const action = command[8];
    const clientId = command[9];
    const connectionId = command[10];
    const ready = command[11] === "1";
    const profile = {
      userId: command[12],
      displayName: command[13],
      avatar: command[14],
      username: command[15],
      callsign: command[16],
      accent: command[17],
      favoriteMode: command[18],
      snakeStyle: command[19],
    };
    let current = players.get(clientId);
    const resumeHash = command[22];
    if (action === "join") {
      if (current && (!current.resumeHash || current.resumeHash !== resumeHash)) {
        return JSON.stringify({ error: "session_conflict" });
      }
      const generation = (roomGeneration.get(room) || 0) + 1;
      roomGeneration.set(room, generation);
      let slot = current?.slot ?? -1;
      current = {
        id: clientId,
        connectionId,
        slot,
        ready: false,
        readyEpoch: 0,
        joinEpoch: generation,
        seenAt: timestamp,
        resumeHash,
        ...profile,
      };
      players.set(clientId, current);
    } else if (current?.connectionId === connectionId) {
      if (action === "relinquish") {
        // The seat is held briefly rather than freed, so the fake marks the
        // record stale instead of deleting it.
        current.ready = false;
        current.readyEpoch = 0;
        current.seenAt = timestamp - 22_000;
      } else if (action === "leave") {
        const wasSeated = current.slot >= 0;
        players.delete(clientId);
        current = null;
        if (wasSeated) {
          players.forEach((player) => {
            player.ready = false;
            player.readyEpoch = 0;
          });
        }
      } else {
        current.seenAt = timestamp;
        if (action === "ready" && current.slot >= 0) {
          current.ready = ready;
          current.readyEpoch = ready ? roomGeneration.get(room) || 0 : 0;
          if (!ready) {
            players.forEach((player) => {
              player.ready = false;
              player.readyEpoch = 0;
            });
          }
        }
      }
    }
    if (action === "rotate") {
      const losers = [Number(command[20]), Number(command[21])];
      for (const player of players.values()) {
        if (losers.some((slot) => Number(slot) >= 0 && Number(slot) === Number(player.slot))) {
          player.slot = -1;
          player.joinEpoch = (roomGeneration.get(room) || 0) + 1;
          roomGeneration.set(room, player.joinEpoch);
          player.ready = false;
          player.readyEpoch = 0;
        }
        player.ready = false;
        player.readyEpoch = 0;
      }
    }
    const usedAfter = new Set([...players.values()].filter((item) => item.slot >= 0).map((item) => item.slot));
    [...players.values()]
      .filter((item) => item.slot < 0)
      .sort((first, second) => first.joinEpoch - second.joinEpoch)
      .forEach((item) => {
        for (let candidate = 0; candidate < DEFAULT_ROOM_CAPACITY; candidate += 1) {
          if (!usedAfter.has(candidate)) {
            item.slot = candidate;
            usedAfter.add(candidate);
            break;
          }
        }
      });
    const roster = [...players.values()]
      .filter((item) => item.slot >= 0)
      .sort((first, second) => first.slot - second.slot);
    return JSON.stringify({
      left: (action === "leave" && !current) || action === "relinquish",
      active: Boolean(current && current.connectionId === connectionId),
      replaced: Boolean(current && current.connectionId !== connectionId),
      role: current?.slot >= 0 ? "player" : "spectator",
      slot: current?.slot ?? -1,
      joinEpoch: current?.joinEpoch ?? 0,
      players: roster,
      waiting: [...players.values()]
        .filter((item) => item.slot < 0)
        .sort((first, second) => first.joinEpoch - second.joinEpoch)
        .map((item, index) => ({ ...item, position: index + 1 })),
      queuePosition: current?.slot < 0
        ? [...players.values()]
          .filter((item) => item.slot < 0)
          .sort((first, second) => first.joinEpoch - second.joinEpoch)
          .findIndex((item) => item.id === current.id) + 1
        : 0,
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
  // A player rotated out of their seat between sending Ready and its delivery
  // still sends a well-formed frame. Rejecting it told the client its link was
  // unhealthy and closed its countdown gate for the rest of the session.
  assert.deepEqual(
    validateRealtimeMessage({ type: "ready", ready: false }, { slot: -1, allReady: false, now: timestamp }),
    { type: "ready", ready: false },
    "Ready from an unseated participant must be accepted and ignored, not rejected",
  );
  assert.ok(validateRealtimeMessage({
    type: "countdown",
    round: timestamp,
    startsAt: timestamp - 86_400_000,
  }, { slot: 0, allReady: true, now: timestamp }));
  assert.equal(validateRealtimeMessage({
    type: "countdown",
    round: timestamp,
    startsAt: timestamp + 3_200,
  }, { slot: 1, allReady: true, now: timestamp }), null);

  assert.equal(requestIsSameOrigin(request("ABC234", "client-one")), true);
  assert.equal(requestIsSameOrigin({ url: "/api/realtime", headers: {
    host: "127.0.0.1:4179", origin: "http://127.0.0.1:4179",
  } }), true);
  assert.equal(requestIsSameOrigin({ url: "/api/realtime", headers: {
    host: "neon.example.test", origin: "http://neon.example.test",
  } }), false);
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

  const authenticatedCommands = [];
  const authenticatedPresence = createFakeRedis();
  const authenticatedHub = createRealtimeHub({
    redisCommand: async (command) => {
      authenticatedCommands.push(command);
      if (command[0] === "SET") return "OK";
      return authenticatedPresence(command);
    },
    bus: createFakeBus(),
    sessionReader: async () => ({
      profile: {
        id: "123456789012345678",
        username: "signal_player",
        displayName: "Signal Player",
        avatar: "avatar_hash",
        customization: {
          callsign: "Night Viper",
          accent: "magenta",
          favoriteMode: "rush",
          snakeStyle: "spectral",
        },
      },
    }),
    recordMatch: async () => true,
    uuid: () => "authenticated-connection",
    logger: { error() {} },
  });
  const authenticatedSocket = new FakeSocket();
  await authenticatedHub.connect(
    authenticatedSocket,
    request("NENA42", "authenticated-player"),
  );
  await flush();
  const authenticatedJoin = authenticatedCommands.find((command) => command[0] === "EVAL");
  assert.equal(authenticatedJoin[6], "neon-snake:players:active");
  assert.equal(authenticatedJoin[12], "123456789012345678");
  assert.equal(authenticatedJoin[15], "signal_player");
  assert.equal(authenticatedJoin[16], "Night Viper");
  assert.equal(authenticatedJoin[17], "magenta");
  assert.equal(authenticatedJoin[18], "rush");
  assert.equal(authenticatedJoin[19], "spectral");
  assert.ok(authenticatedCommands.some((command) => (
    command[0] === "SET"
    && command[1] === "neon-snake:activity:123456789012345678"
  )));
  assert.match(PRESENCE_SCRIPT, /ZADD", activePlayersKey, now, current\["userId"\]/);
  assert.ok(authenticatedSocket.messages.some((message) => (
    message.type === "welcome"
    && message.players[0]?.profile?.username === "signal_player"
    && message.players[0]?.profile?.callsign === "Night Viper"
    && message.players[0]?.profile?.favoriteMode === "rush"
    && message.players[0]?.profile?.snakeStyle === "spectral"
  )));
  const authenticatedSecond = new FakeSocket();
  await authenticatedHub.connect(
    authenticatedSecond,
    request("NENA42", "authenticated-second"),
  );
  await flush();
  const activityWritesBeforeSpectator = authenticatedCommands.filter((command) => (
    command[0] === "SET"
    && command[1] === "neon-snake:activity:123456789012345678"
  )).length;
  const authenticatedSpectator = new FakeSocket();
  await authenticatedHub.connect(
    authenticatedSpectator,
    request("NENA42", "authenticated-spectator"),
  );
  await flush();
  const spectatorWelcome = authenticatedSpectator.messages.find((message) => message.type === "welcome");
  assert.equal(spectatorWelcome.role, "spectator");
  assert.equal(authenticatedCommands.filter((command) => (
    command[0] === "SET"
    && command[1] === "neon-snake:activity:123456789012345678"
  )).length, activityWritesBeforeSpectator);
  authenticatedHub.close();

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
  const queueFirst = new FakeSocket();
  const queueSecond = new FakeSocket();
  const queueThird = new FakeSocket();
  await firstHub.connect(queueFirst, request("234567", "queue-first"));
  await firstHub.connect(queueSecond, request("234567", "queue-second"));
  await firstHub.connect(queueThird, request("234567", "queue-third"));
  await flush();
  const queueWelcome = queueThird.messages.find((message) => message.type === "welcome");
  assert.equal(queueWelcome.role, "spectator");
  assert.equal(queueWelcome.queuePosition, 1);
  assert.equal(queueWelcome.waiting[0].id, "queue-third");
  queueSecond.emit("close", 1000);
  await flush();
  assert.ok(queueThird.messages.some((message) => (
    message.type === "roster"
    && message.players.some((player) => player.id === "queue-third" && player.slot === 1)
  )), "A seated departure promotes the queue head atomically");
  assert.ok(queueThird.messages.some((message) => message.type === "countdown-cancel"));
  const rotateFirst = new FakeSocket();
  const rotateSecond = new FakeSocket();
  const rotateWaitingOne = new FakeSocket();
  const rotateWaitingTwo = new FakeSocket();
  await firstHub.connect(rotateFirst, request("345678", "rotate-first"));
  await firstHub.connect(rotateSecond, request("345678", "rotate-second"));
  await firstHub.connect(rotateWaitingOne, request("345678", "rotate-waiting-one"));
  await firstHub.connect(rotateWaitingTwo, request("345678", "rotate-waiting-two"));
  await flush();
  assert.equal(firstHub._state.rooms.get("345678").waiting.length, 2);
  await firstHub.rotateRound("345678", {
    winner: "opponent",
    crashes: { player: "wall", opponent: null },
  });
  await flush();
  const rotatedRoster = rotateFirst.messages
    .filter((message) => message.type === "roster")
    .at(-1);
  assert.equal(rotatedRoster.players.find((player) => player.id === "rotate-waiting-one").slot, 0);
  assert.deepEqual(
    rotatedRoster.waiting.map((player) => player.id),
    ["rotate-waiting-two", "rotate-first"],
    "A rotated loser joins behind everyone already waiting",
  );
  first.message({ type: "ready", ready: true });
  second.message({ type: "ready", ready: true });
  await flush();
  assert.equal(firstHub.roomAllReady("ABC234"), true);
  assert.equal(secondHub.roomAllReady("ABC234"), true);

  const requestedRound = Date.now() - 86_400_000;
  first.message({ type: "countdown", round: requestedRound, startsAt: requestedRound });
  await flush();
  const issued = first.messages.find((message) => message.type === "countdown");
  assert.ok(issued);
  assert.ok(second.messages.some((message) => message.type === "countdown" && message.round === issued.round));
  // The round id and start time are the server's, whatever Player 1 asked for.
  const round = issued.round;
  assert.notEqual(round, requestedRound);
  assert.ok(issued.startsAt > Date.now(), "The countdown starts from the server clock");
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
  first.message({ type: "countdown", round: round + 1, startsAt: Date.now() });
  await flush();
  assert.equal(firstHub._state.rooms.get("ABC234").simulation, simulation,
    "A countdown during a live round must not restart it");
  assert.ok(first.messages.some((message) => message.type === "rejected" && message.code === "round_in_progress"));
  // Model the first round ending, which is what allows the next countdown.
  firstHub._state.rooms.get("ABC234").liveRound = null;
  first.message({ type: "countdown", round: round + 1, startsAt: Date.now() });
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
      if (command[8] === "leave" || command[8] === "relinquish") {
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
    details: { stage: "presence", name: "TimeoutError", message: "Redis cleanup timed out." },
  }]);
  cleanupHub.close();

  // Vercel closes a WebSocket when the Function invocation reaches maxDuration.
  // Treating that like a departure handed the seat to whoever was waiting, so a
  // link that was cut keeps its seat for a short reclaim window while a link the
  // client closed deliberately frees it at once.
  const lifetimeRedis = createFakeRedis();
  const lifetimeHub = createRealtimeHub({
    redisCommand: lifetimeRedis,
    bus: createFakeBus(),
    sessionReader: async () => null,
    recordMatch: async () => true,
    uuid: () => `lifetime-${++hubNumber}`,
  });
  const lifetimeActions = [];
  const lifetimeRecording = createRealtimeHub({
    redisCommand: async (command) => {
      lifetimeActions.push(command[8]);
      return lifetimeRedis(command);
    },
    bus: createFakeBus(),
    sessionReader: async () => null,
    recordMatch: async () => true,
    uuid: () => `lifetime-${++hubNumber}`,
  });
  const cutSocket = new FakeSocket();
  await lifetimeRecording.connect(cutSocket, request("456789", "lifetime-cut"));
  await flush();
  const lifetimeWelcome = cutSocket.messages.find((message) => message.type === "welcome");
  assert.ok(
    Number(lifetimeWelcome.expiresAt) > Number(lifetimeWelcome.sentAt),
    "A client must be told when its link expires so it can replace it in time",
  );
  lifetimeActions.length = 0;
  cutSocket.emit("close", 1006);
  await flush();
  assert.equal(lifetimeActions.at(-1), "relinquish",
    "A link that was cut must hold its seat instead of leaving the room");

  const quitSocket = new FakeSocket();
  await lifetimeRecording.connect(quitSocket, request("456789", "lifetime-quit"));
  await flush();
  lifetimeActions.length = 0;
  quitSocket.emit("close", 1000);
  await flush();
  assert.equal(lifetimeActions.at(-1), "leave",
    "A client that closes its own link must free the seat immediately");
  lifetimeHub.close();
  lifetimeRecording.close();

  let reconnectNow = 10_000;
  const reconnectRedis = createFakeRedis();
  let failReconnectLeave = false;
  const reconnectHub = createRealtimeHub({
    redisCommand: async (command) => {
      if (failReconnectLeave && (command[8] === "leave" || command[8] === "relinquish")) {
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
  await reconnectHub.connect(replacementHost, request("GHJ678", "reconnect-host",
    originalHost.messages.find((message) => message.type === "welcome").resumeToken));
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
  assert.equal(
    echoHub.roomAllReady("KLM789"),
    false,
    "One Not Ready action must atomically reset both players",
  );
  assert.ok(echoGuest.messages.some((message) => (
    message.type === "roster"
    && message.players.length === 2
    && message.players.every((player) => !player.ready)
  )), "The remote player must receive the authoritative all-not-ready roster");
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
    clientOwnsSlot: () => true,
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
    playerInputAck: 0,
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
  unitSimulation.game = {
    playerSnake: [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }],
    opponentSnake: [{ x: 16, y: 16 }, { x: 17, y: 16 }, { x: 18, y: 16 }],
    playerDirection: { x: 1, y: 0 },
    opponentDirection: { x: -1, y: 0 },
    playerInputs: [{ sequence: 41, direction: { x: 0, y: -1 } }],
    opponentInputs: [{ sequence: 52, direction: { x: 0, y: 1 } }],
    playerInputAck: 0,
    playerScore: 0,
    opponentScore: 0,
    guestInputAck: 0,
    food: { x: 10, y: 10 },
    over: false,
  };
  unitSimulation.resolveTick();
  assert.equal(unitSimulation.game.playerInputAck, 41);
  assert.equal(unitSimulation.game.guestInputAck, 52);

  const completionFailures = [];
  const completingSimulation = new RoomSimulation({
    publish: async () => {}, roomAllReady: () => true, clientOwnsSlot: () => true,
    recordMatch: async () => {},
    rotateRound: async () => { throw new Error("Redis rotation unavailable"); },
    abortRound: (room, simulation, error) => {
      completionFailures.push(error.message);
      simulation.stop();
    },
  }, "ABC234", "authority");
  completingSimulation.game = {
    ...unitSimulation.game,
    round: 1, sequence: 0,
    playerSnake: [{ x: 29, y: 5 }], opponentSnake: [{ x: 10, y: 10 }],
    playerDirection: { x: 1, y: 0 }, opponentDirection: { x: -1, y: 0 },
  };
  await assert.doesNotReject(() => completingSimulation.tick(),
    "A failed post-match rotation must not escape the authoritative timer");
  assert.deepEqual(completionFailures, ["Redis rotation unavailable"]);

  const securityBus = createFakeBus();
  const securityErrors = [];
  const securityHub = createRealtimeHub({
    redisCommand: createFakeRedis(), bus: securityBus, sessionReader: async () => null,
    logger: { error: (...args) => securityErrors.push(args) },
  });
  try {
    const owner = new FakeSocket();
    const peer = new FakeSocket();
    await securityHub.connect(owner, request("ABC789", "secure-owner"));
    await securityHub.connect(peer, request("ABC789", "secure-peer"));
    const welcome = owner.messages.find((message) => message.type === "welcome");
    assert.match(welcome.resumeToken, /^[a-f0-9-]{36}$/);
    assert.equal(JSON.stringify(welcome.players).includes(welcome.resumeToken), false);
    assert.equal(JSON.stringify(peer.messages).includes(welcome.resumeToken), false);
    const attacker = new FakeSocket();
    await securityHub.connect(attacker, request("ABC789", "secure-owner"));
    assert.equal(attacker.closeCalls.at(-1)?.code, 4003,
      "Copying a roster client id must not take over its occupied seat");
    const resumed = new FakeSocket();
    await securityHub.connect(resumed, request("ABC789", "secure-owner", welcome.resumeToken));
    assert.equal(resumed.messages.find((message) => message.type === "welcome")?.slot, 0);
    resumed.message({ type: "ready", ready: true });
    peer.message({ type: "ready", ready: true });
    await flush();
    resumed.message({ type: "countdown", round: Date.now(), startsAt: Date.now() + 3_200 });
    await flush();
    const resumedSimulation = securityHub._state.rooms.get("ABC789").simulation;
    assert.ok(resumedSimulation);
    const watcher = new FakeSocket();
    await securityHub.connect(watcher, request("ABC789", "secure-watcher"));
    watcher.emit("close");
    await flush();
    assert.equal(securityHub._state.rooms.get("ABC789").simulation, resumedSimulation,
      "A waiting spectator leaving must not cancel the seated players' match");
    owner.emit("close");
    await flush();
    assert.equal(securityHub._state.rooms.get("ABC789").simulation, resumedSimulation,
      "Closing a replaced socket must preserve its replacement's round");
    resumedSimulation.enqueue(0, { round: resumedSimulation.game.round, sequence: 10, direction: { x: 0, y: -1 } });
    resumedSimulation.resolveTick();
    resumedSimulation.enqueue(0, { round: resumedSimulation.game.round, sequence: 11, direction: { x: 1, y: 0 } });
    resumedSimulation.resolveTick();
    resumedSimulation.enqueue(0, { round: resumedSimulation.game.round, sequence: 10, direction: { x: 0, y: -1 } });
    resumedSimulation.resolveTick();
    assert.deepEqual(resumedSimulation.game.playerDirection, { x: 1, y: 0 },
      "Already acknowledged input cannot steer a later tick again");
    securityBus.failPublishing(new Error("Redis relay temporarily unavailable"));
    peer.message({ type: "ready", ready: true });
    await flush();
    assert.equal(peer.closeCalls.at(-1)?.code, 1012);
    assert.ok(securityErrors.some(([message]) => message === "Realtime message failed."));
  } finally {
    securityHub.close();
  }

  // Match integrity: the server owns the round, and leaving after the start
  // concedes it instead of voiding it.
  {
    let clock = 1_000_000;
    const recorded = [];
    const integrityErrors = [];
    const integrityPresence = createFakeRedis();
    const integrityBus = createFakeBus();
    const profiles = new Map([
      ["integrity-host", { id: "111111111111111111", username: "host", displayName: "Host" }],
      ["integrity-guest", { id: "222222222222222222", username: "guest", displayName: "Guest" }],
    ]);
    const integrityHub = createRealtimeHub({
      redisCommand: async (command) => (command[0] === "SET" ? "OK" : integrityPresence(command)),
      bus: integrityBus,
      sessionReader: async (incoming) => ({
        profile: profiles.get(new URL(incoming.url, "https://x").searchParams.get("clientId")),
      }),
      recordMatch: async (match) => { recorded.push(match); return true; },
      now: () => clock,
      logger: { error: (...args) => integrityErrors.push(args) },
    });
    try {
      const host = new FakeSocket();
      const guest = new FakeSocket();
      await integrityHub.connect(host, request("NTR234", "integrity-host"));
      await integrityHub.connect(guest, request("NTR234", "integrity-guest"));
      host.message({ type: "ready", ready: true });
      guest.message({ type: "ready", ready: true });
      await flush();
      host.message({ type: "countdown", round: 5, startsAt: 5 });
      await flush();
      await flush(); await flush();
      const countdown = guest.messages.find((message) => message.type === "countdown");
      assert.ok(countdown.round >= clock, "The round id comes from the server clock, not the client");
      const simulation = integrityHub._state.rooms.get("NTR234").simulation;
      assert.notEqual(simulation.game.signalCursor >>> 0, (simulation.roomSeed() ^ 5) >>> 0,
        "Player 1's requested round must not choose the food seed");

      // Leaving once the round has started concedes it.
      clock = countdown.startsAt + 1_000;
      guest.emit("close", 1000);
      await flush();
      assert.equal(recorded.length, 1, "Leaving after the start records a result");
      assert.equal(recorded[0].winnerUserId, "111111111111111111", "The player who stayed wins by forfeit");
      assert.equal(recorded[0].eventId, `NTR234:${countdown.round}`);
      assert.ok(host.messages.some((message) => (
        message.type === "countdown-cancel" && message.reason === "forfeit" && message.slot === 1
      )), "The remaining player is told the round was forfeited");

      // A late arrival learns about a live round from its welcome.
      const late = new FakeSocket();
      const lateGuest = new FakeSocket();
      await integrityHub.connect(lateGuest, request("NTR234", "integrity-guest"));
      host.message({ type: "ready", ready: true });
      lateGuest.message({ type: "ready", ready: true });
      await flush();
      host.message({ type: "countdown", round: 6, startsAt: 6 });
      await flush();
      const secondCountdown = lateGuest.messages.filter((message) => message.type === "countdown").at(-1);
      assert.ok(secondCountdown.round > countdown.round);
      await integrityHub.connect(late, request("NTR234", "integrity-watcher"));
      assert.ok(late.messages.some((message) => (
        message.type === "countdown" && message.round === secondCountdown.round
      )), "A spectator joining mid-round receives the live round");

      // Un-readying before the start cancels without a result.
      lateGuest.message({ type: "ready", ready: false });
      await flush();
      assert.equal(recorded.length, 1, "A pre-start departure records nothing");
    } finally {
      integrityHub.close();
    }
  }

  // Each Ready change costs a presence script run and a roster relay, so a
  // client toggling it rapidly is capped.
  {
    const presence = createFakeRedis();
    const readyCalls = [];
    const spamHub = createRealtimeHub({
      redisCommand: async (command) => {
        if (command[0] === "EVAL" && command[8] === "ready") readyCalls.push(command[9]);
        return presence(command);
      },
      bus: createFakeBus(), sessionReader: async () => null, now: () => 7_000_000, logger: { error() {} },
    });
    try {
      const spammer = new FakeSocket();
      await spamHub.connect(spammer, request("SPM234", "spam-client"));
      for (let index = 0; index < 20; index += 1) spammer.message({ type: "ready", ready: index % 2 === 0 });
      for (let index = 0; index < 10; index += 1) await flush();
      assert.equal(readyCalls.length, 6, "Only six Ready changes per ten seconds reach Redis");
    } finally {
      spamHub.close();
    }
  }

  // A seated socket that stops talking loses its seat instead of holding it forever.
  {
    let clock = 5_000_000;
    const silentHub = createRealtimeHub({
      redisCommand: createFakeRedis(), bus: createFakeBus(), sessionReader: async () => null,
      now: () => clock, logger: { error() {} },
    });
    const originalSetTimeout = global.setTimeout;
    let heartbeat = null;
    global.setTimeout = (callback, delay) => {
      if (delay === 10_000) { heartbeat = callback; return 0; }
      return originalSetTimeout(callback, delay);
    };
    try {
      const silent = new FakeSocket();
      await silentHub.connect(silent, request("SLN234", "silent-client"));
      clock += 50_000;
      await heartbeat();
      assert.ok(silent.closeCalls.some(({ code }) => code === 4000), "A silent link is closed as cut");
    } finally {
      global.setTimeout = originalSetTimeout;
      silentHub.close();
    }
  }

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
