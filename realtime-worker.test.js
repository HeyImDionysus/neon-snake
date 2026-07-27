"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  PRESENCE_SCRIPT,
  RoomSimulation,
  createRealtimeHub,
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
  return async function redisCommand(command) {
    assert.equal(command[0], "EVAL");
    assert.equal(command[1], PRESENCE_SCRIPT);
    const room = String(command[3]).match(/realtime:([A-Z0-9]{6})/)?.[1];
    assert.ok(room);
    if (!roomState.has(room)) roomState.set(room, new Map());
    const players = roomState.get(room);
    const timestamp = Number(command[5]);
    const action = command[6];
    const clientId = command[7];
    const connectionId = command[8];
    const ready = command[9] === "1";
    const profile = {
      userId: command[10],
      displayName: command[11],
      avatar: command[12],
    };
    let current = players.get(clientId);
    if (action === "join") {
      const used = new Set([...players.values()].filter((item) => item.slot >= 0).map((item) => item.slot));
      const slot = current?.slot ?? (!used.has(0) ? 0 : !used.has(1) ? 1 : -1);
      current = {
        id: clientId,
        connectionId,
        slot,
        ready: false,
        seenAt: timestamp,
        ...profile,
      };
      players.set(clientId, current);
    } else if (current?.connectionId === connectionId) {
      if (action === "leave") {
        players.delete(clientId);
        current = null;
      } else {
        current.seenAt = timestamp;
        if (action === "ready" && current.slot >= 0) current.ready = ready;
      }
    }
    const roster = [...players.values()]
      .filter((item) => item.slot >= 0)
      .sort((first, second) => first.slot - second.slot);
    return JSON.stringify({
      active: Boolean(current && current.connectionId === connectionId),
      role: current?.slot >= 0 ? "player" : "spectator",
      slot: current?.slot ?? -1,
      players: roster,
    });
  };
}

function createFakeBus() {
  const listeners = new Map();
  return {
    async subscribe(room, handler) {
      if (!listeners.has(room)) listeners.set(room, new Set());
      listeners.get(room).add(handler);
      return () => listeners.get(room)?.delete(handler);
    },
    async publish(room, payload) {
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

  const redisCommand = createFakeRedis();
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
