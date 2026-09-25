"use strict";

const assert = require("node:assert/strict");
const transports = require("./public/room-transport.js");

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.listeners = new Map();
    this.messages = [];
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  send(value) {
    this.messages.push(JSON.parse(value));
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  emit(type, value = {}) {
    if (type === "open") this.readyState = FakeWebSocket.OPEN;
    this.listeners.get(type)?.forEach((listener) => listener(value));
  }

  message(value) {
    this.emit("message", { data: JSON.stringify(value) });
  }
}

function createTimerHarness() {
  let nextId = 1;
  let currentTime = 0;
  const timers = new Map();

  return {
    setTimeout(callback, delay = 0) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    nextDelay() {
      return timers.values().next().value?.delay ?? null;
    },
    now() {
      return currentTime;
    },
    advance(milliseconds) {
      currentTime += milliseconds;
    },
    async runNext() {
      const next = timers.entries().next().value;
      assert.ok(next, "Expected a scheduled room sync");
      const [id, timer] = next;
      timers.delete(id);
      currentTime += timer.delay;
      await timer.callback();
    },
    async runDelay(delay) {
      const next = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(next, `Expected a timer scheduled ${delay} ms out`);
      const [id, timer] = next;
      timers.delete(id);
      currentTime += timer.delay;
      await timer.callback();
    },
    size() {
      return timers.size;
    },
  };
}

const tests = [
  ["a promoted waiting participant can explicitly ready without being auto-readied", async () => {
    const timers = createTimerHarness();
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "waiting-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus() {},
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout,
    });
    const socket = FakeWebSocket.instances.at(-1);
    socket.emit("open");
    socket.message({ type: "welcome", role: "spectator", slot: -1, players: [], waiting: [] });
    socket.message({ type: "roster", players: [{ id: "waiting-client", slot: 1, ready: false }] });
    assert.equal(socket.messages.some((message) => message.ready === true), false);
    assert.equal(transport.send({ type: "ready", ready: true }), true);
    assert.deepEqual(socket.messages.at(-1), { type: "ready", ready: true });
    transport.close();
  }],
  ["private resume credentials survive reconnect and session conflicts stop retrying", async () => {
    const timers = createTimerHarness();
    const statuses = [];
    const stored = new Map();
    const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const options = {
      code: "ABC234", clientId: "private-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus: (status) => statuses.push(status),
      storage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) },
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout,
    };
    let transport = await transports.createWebSocketRoomTransport(options);
    let socket = FakeWebSocket.instances.at(-1);
    socket.emit("open");
    socket.message({ type: "welcome", role: "spectator", slot: -1, players: [], resumeToken: token });
    transport.close();
    transport = await transports.createWebSocketRoomTransport(options);
    socket = FakeWebSocket.instances.at(-1);
    assert.deepEqual(socket.protocols, ["neon-snake-v1", `resume.${token}`]);
    assert.equal(socket.url.includes(token), false);
    socket.emit("close", { code: 4003 });
    assert.equal(statuses.at(-1).code, "session_conflict");
    assert.equal(statuses.at(-1).retryable, false);
    assert.equal(timers.size(), 0);
    transport.close();
  }],
  ["the link is replaced before Vercel's maximum duration cuts it", async () => {
    const timers = createTimerHarness();
    const statuses = [];
    const token = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "rotating-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus: (status) => statuses.push(status),
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout, now: timers.now,
    });
    const first = FakeWebSocket.instances.at(-1);
    first.emit("open");
    first.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "rotating-client", slot: 0 }],
      resumeToken: token, sentAt: 0, expiresAt: 240_000,
    });
    const created = FakeWebSocket.instances.length;

    // The replacement opens well before the declared expiry.
    await timers.runNext();
    assert.equal(FakeWebSocket.instances.length, created + 1, "A replacement link must be opened");
    const second = FakeWebSocket.instances.at(-1);
    assert.deepEqual(second.protocols, ["neon-snake-v1", `resume.${token}`],
      "The replacement must present the same credential so it resumes the seat");
    assert.deepEqual(first.closeCalls, [], "The live link must stay open until the replacement is welcomed");
    assert.equal(transport.send({ type: "ready", ready: true }), true);
    assert.deepEqual(first.messages.at(-1), { type: "ready", ready: true },
      "Play continues on the old link during the handover");

    second.emit("open");
    second.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "rotating-client", slot: 0 }],
      resumeToken: token, sentAt: 240_000, expiresAt: 480_000,
    });
    assert.deepEqual(first.closeCalls, [{ code: 1000, reason: "Realtime link rotated" }],
      "The retired link must close deliberately so the server frees nothing");
    assert.equal(transport.send({ type: "ready", ready: false }), true);
    assert.deepEqual(second.messages.at(-1), { type: "ready", ready: false },
      "Play moves to the replacement once it holds the seat");
    assert.equal(statuses.some((status) => status.state === "reconnecting"), false,
      "A planned handover must never look like a dropped connection");
    transport.close();
  }],
  ["a link handover waits for the round to end", async () => {
    // The round's simulation lives on one server instance, so replacing a link
    // mid-round would end it. Rotation is due halfway through the link's life
    // and waits while a round is active.
    const timers = createTimerHarness();
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "patient-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus() {},
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout, now: timers.now,
    });
    const live = FakeWebSocket.instances.at(-1);
    live.emit("open");
    live.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "patient-client", slot: 0 }],
      resumeToken: "aaaaaaaa-bbbb-4ccc-8ddd-bbbbbbbbbbbb", sentAt: 0, expiresAt: 240_000, closesAt: 290_000,
    });
    transport.setActive(true, 77);
    const created = FakeWebSocket.instances.length;
    await timers.runDelay(120_000);
    assert.equal(FakeWebSocket.instances.length, created, "No handover while the round is running");
    transport.setActive(false);
    assert.equal(FakeWebSocket.instances.length, created + 1, "The handover happens as soon as the round ends");
    assert.deepEqual(live.closeCalls, [], "The live link stays open until the replacement is welcomed");
    transport.close();
  }],
  ["a round that outlasts the link is handed over just before the platform cut", async () => {
    const timers = createTimerHarness();
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "long-round-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus() {},
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout, now: timers.now,
    });
    const live = FakeWebSocket.instances.at(-1);
    live.emit("open");
    live.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "long-round-client", slot: 0 }],
      resumeToken: "aaaaaaaa-bbbb-4ccc-8ddd-cccccccccccc", sentAt: 0, expiresAt: 240_000, closesAt: 290_000,
    });
    transport.setActive(true, 78);
    const created = FakeWebSocket.instances.length;
    await timers.runDelay(120_000);
    assert.equal(FakeWebSocket.instances.length, created);
    await timers.runDelay(160_000);
    assert.equal(FakeWebSocket.instances.length, created + 1,
      "The link is replaced 10 s before the declared hard close even mid-round");
    transport.close();
  }],
  ["a replaced-session close during a handover is not terminal", async () => {
    const timers = createTimerHarness();
    const statuses = [];
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "handover-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus: (status) => statuses.push(status),
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout, now: timers.now,
    });
    const live = FakeWebSocket.instances.at(-1);
    live.emit("open");
    live.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "handover-client", slot: 0 }],
      resumeToken: "aaaaaaaa-bbbb-4ccc-8ddd-dddddddddddd", sentAt: 0, expiresAt: 240_000,
    });
    await timers.runDelay(120_000);
    const replacement = FakeWebSocket.instances.at(-1);
    // The server retires the old link before the replacement's welcome lands.
    live.emit("close", { code: 4001 });
    assert.equal(statuses.some((status) => status.code === "session_replaced"), false,
      "The client's own handover must not read as another tab taking the seat");
    replacement.emit("open");
    replacement.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "handover-client", slot: 0 }],
      resumeToken: "aaaaaaaa-bbbb-4ccc-8ddd-dddddddddddd", sentAt: 120_000, expiresAt: 360_000,
    });
    assert.equal(transport.send({ type: "ready", ready: true }), true);
    assert.deepEqual(replacement.messages.at(-1), { type: "ready", ready: true });
    transport.close();
  }],
  ["a server that accepts and then refuses the link is retried with a growing backoff", async () => {
    // Room-full and presence failures accept the socket and then close it, so
    // a backoff that reset on open never grew past 250 ms.
    const timers = createTimerHarness();
    const statuses = [];
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "refused-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus: (status) => statuses.push(status),
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout, now: timers.now,
      random: () => 1,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const socket = FakeWebSocket.instances.at(-1);
      socket.emit("open");
      socket.emit("close", { code: 1013 });
      const reconnectDelay = timers.nextDelay();
      await timers.runDelay(timers.nextDelay() === 8_000 ? 8_000 : reconnectDelay);
    }
    const reconnects = statuses.filter((status) => status.state === "reconnecting").map((status) => status.failures);
    assert.deepEqual(reconnects, [1, 2, 3, 4], "Each refusal counts as another failure");
    transport.close();
  }],
  ["a replacement link that never arrives leaves the live link untouched", async () => {
    const timers = createTimerHarness();
    const statuses = [];
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234", clientId: "resilient-client", endpoint: "https://neon.example.test/api/realtime",
      WebSocketImpl: FakeWebSocket, onMessage() {}, onStatus: (status) => statuses.push(status),
      setTimeoutImpl: timers.setTimeout, clearTimeoutImpl: timers.clearTimeout, now: timers.now,
    });
    const live = FakeWebSocket.instances.at(-1);
    live.emit("open");
    live.message({
      type: "welcome", role: "player", slot: 0, players: [{ id: "resilient-client", slot: 0 }],
      resumeToken: "aaaaaaaa-bbbb-4ccc-8ddd-aaaaaaaaaaaa", sentAt: 0, expiresAt: 240_000,
    });
    await timers.runNext();
    const replacement = FakeWebSocket.instances.at(-1);
    replacement.emit("close", { code: 1006 });
    assert.deepEqual(live.closeCalls, [], "A failed handover must not disturb the live link");
    assert.equal(statuses.some((status) => status.state === "reconnecting"), false);
    assert.equal(transport.send({ type: "ready", ready: true }), true);
    assert.deepEqual(live.messages.at(-1), { type: "ready", ready: true });
    transport.close();
  }],
  ["the realtime adapter sends inputs immediately and trusts only server snapshots", async () => {
    FakeWebSocket.instances.length = 0;
    const received = [];
    const statuses = [];
    const scheduled = new Map();
    let timerId = 0;
    const transport = await transports.createWebSocketRoomTransport({
      code: "abc234",
      clientId: "client-one",
      endpoint: "/api/realtime",
      locationHref: "https://neon.example.test/duel",
      onMessage: (message) => received.push(message),
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeWebSocket,
      now: () => 1_000,
      setTimeoutImpl: (callback, delay) => {
        timerId += 1;
        scheduled.set(timerId, { callback, delay });
        return timerId;
      },
      clearTimeoutImpl: (id) => scheduled.delete(id),
    });
    assert.equal(transport.kind, "vercel-websocket");
    assert.equal(transport.authoritative, true);
    const socket = FakeWebSocket.instances[0];
    const socketUrl = new URL(socket.url);
    assert.equal(socketUrl.protocol, "wss:");
    assert.equal(socketUrl.pathname, "/api/realtime");
    assert.equal(socketUrl.searchParams.get("room"), "ABC234");
    assert.equal(socketUrl.searchParams.get("clientId"), "client-one");
    assert.equal(socketUrl.searchParams.get("ticket"), null);
    assert.equal(transport.send({ type: "ready", ready: true }), false);

    socket.emit("open");
    assert.deepEqual(socket.messages, []);
    assert.equal(statuses.at(-1).state, "socket-open");
    socket.message({
      type: "welcome",
      role: "player",
      slot: 0,
      players: [
        {
          id: "client-one",
          slot: 0,
          ready: true,
          seenAt: 900,
          profile: {
            displayName: "Signal Player",
            avatar: "avatar_hash",
          },
        },
        {
          id: "client-two",
          slot: 1,
          ready: false,
          seenAt: 950,
          profile: {
            displayName: "Night Viper",
            username: "night_viper",
            callsign: "Viper",
            accent: "magenta",
            favoriteMode: "rush",
            snakeStyle: "spectral",
            avatar: "avatar_hash",
          },
        },
      ],
    });
    assert.deepEqual(socket.messages.at(-1), { type: "ready", ready: true });
    assert.equal(statuses.at(-1).state, "connected");
    assert.equal(statuses.at(-1).slot, 0);
    assert.ok(received.some((message) => (
      message.type === "presence"
      && message.from === "client-two"
      && message.slot === 1
      && message.profile?.favoriteMode === "rush"
      && message.profile?.snakeStyle === "spectral"
    )));
    const sentBeforePromotion = socket.messages.length;
    socket.message({
      type: "roster",
      waiting: [],
      players: [
        { id: "client-two", slot: 0, ready: false, seenAt: 980, profile: null },
        { id: "client-one", slot: 1, ready: false, seenAt: 980, profile: null },
      ],
    });
    assert.equal(statuses.at(-1).role, "player");
    assert.equal(statuses.at(-1).slot, 1);
    assert.equal(socket.messages.length, sentBeforePromotion);

    const input = {
      type: "input",
      round: 4,
      sequence: 7,
      direction: { x: 0, y: -1 },
    };
    assert.equal(transport.send(input), true);
    assert.deepEqual(socket.messages.at(-1), input);
    socket.message({
      type: "state",
      sequence: 8,
      state: { round: 4 },
    });
    assert.deepEqual(received.at(-1), {
      type: "state",
      sequence: 8,
      state: { round: 4 },
      room: "ABC234",
    });
    socket.message({
      type: "countdown-cancel",
      slot: 1,
      sentAt: 1_025,
    });
    assert.deepEqual(received.at(-1), {
      type: "countdown-cancel",
      room: "ABC234",
      slot: 1,
      sentAt: 1_025,
    });
    transport.close();
    assert.deepEqual(socket.closeCalls.at(-1), { code: 1000, reason: "Client left room" });
    assert.equal(scheduled.size, 0);
  }],
  ["the realtime adapter times out a silent socket and reconnects with bounded backoff", async () => {
    FakeWebSocket.instances.length = 0;
    const statuses = [];
    const timers = new Map();
    let timerId = 0;
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      endpoint: "wss://neon.example.test",
      onMessage: () => {},
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeWebSocket,
      fetchImpl: null,
      random: () => 1,
      setTimeoutImpl: (callback, delay) => {
        timerId += 1;
        timers.set(timerId, { callback, delay });
        return timerId;
      },
      clearTimeoutImpl: (id) => timers.delete(id),
    });
    const first = FakeWebSocket.instances[0];
    const connectionTimer = [...timers.entries()].find(([, timer]) => timer.delay === 8_000);
    assert.ok(connectionTimer);
    timers.delete(connectionTimer[0]);
    connectionTimer[1].callback();
    assert.equal(first.closeCalls.at(-1).code, 4000);
    first.emit("close");
    assert.equal(statuses.at(-1).state, "reconnecting");
    const reconnect = [...timers.entries()].find(([, timer]) => timer.delay === 250);
    assert.ok(reconnect);
    timers.delete(reconnect[0]);
    await reconnect[1].callback();
    assert.equal(FakeWebSocket.instances.length, 2);
    transport.close();
    assert.equal(timers.size, 0);
  }],
  ["the realtime adapter cancels a stale authoritative round when the shared relay is unavailable", async () => {
    FakeWebSocket.instances.length = 0;
    const received = [];
    const statuses = [];
    const timers = new Map();
    let timerId = 0;
    let timestamp = 1_000;
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      endpoint: "wss://neon.example.test",
      onMessage: (message) => received.push(message),
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeWebSocket,
      now: () => timestamp,
      setTimeoutImpl: (callback, delay) => {
        timerId += 1;
        timers.set(timerId, { callback, delay });
        return timerId;
      },
      clearTimeoutImpl: (id) => timers.delete(id),
    });
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");
    socket.message({
      type: "welcome",
      role: "player",
      slot: 1,
      players: [
        { id: "client-host", slot: 0, ready: true, seenAt: 950 },
        { id: "client-one", slot: 1, ready: true, seenAt: 950 },
      ],
    });
    transport.setActive(true, 1_000);
    socket.message({
      type: "countdown",
      round: 1_000,
      startsAt: 4_200,
    });
    assert.ok([...timers.values()].some((timer) => timer.delay === 6_200));
    socket.message({
      type: "state",
      sequence: 1,
      state: { round: 999 },
    });
    assert.equal(
      [...timers.values()].some((timer) => timer.delay === 3_000),
      false,
      "A snapshot for another round must not mask a stalled active round",
    );
    socket.message({
      type: "state",
      sequence: 2,
      state: { round: 1_000 },
    });
    const watchdog = [...timers.entries()].find(([, timer]) => timer.delay === 3_000);
    assert.ok(watchdog, "A server snapshot must arm the authoritative state watchdog");
    transport.setActive(true, 1_000);
    assert.equal(
      timers.get(watchdog[0]),
      watchdog[1],
      "Starting the accepted round must preserve its three-second watchdog",
    );
    timers.delete(watchdog[0]);
    timestamp += watchdog[1].delay;
    watchdog[1].callback();
    assert.equal(statuses.at(-1).state, "authoritative-timeout");
    assert.deepEqual(received.at(-1), {
      type: "countdown-cancel",
      room: "ABC234",
      slot: -1,
      reason: "state_timeout",
      sentAt: 4_000,
    });
    assert.deepEqual(socket.closeCalls.at(-1), {
      code: 1012,
      reason: "Authoritative state timed out",
    });
    transport.close();
    assert.equal(timers.size, 0);
  }],
  ["an active realtime reconnect rearms the authoritative state watchdog", async () => {
    FakeWebSocket.instances.length = 0;
    const timers = new Map();
    let timerId = 0;
    const transport = await transports.createWebSocketRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      endpoint: "wss://neon.example.test",
      onMessage: () => {},
      onStatus: () => {},
      WebSocketImpl: FakeWebSocket,
      random: () => 1,
      setTimeoutImpl: (callback, delay) => {
        timerId += 1;
        timers.set(timerId, { callback, delay });
        return timerId;
      },
      clearTimeoutImpl: (id) => timers.delete(id),
    });
    const first = FakeWebSocket.instances[0];
    first.emit("open");
    first.message({
      type: "welcome",
      role: "player",
      slot: 1,
      players: [
        { id: "client-host", slot: 0, ready: true },
        { id: "client-one", slot: 1, ready: true },
      ],
    });
    transport.setActive(true, 1_000);
    first.emit("close");
    const reconnect = [...timers.entries()].find(([, timer]) => timer.delay === 250);
    assert.ok(reconnect);
    timers.delete(reconnect[0]);
    await reconnect[1].callback();
    const second = FakeWebSocket.instances[1];
    second.emit("open");
    second.message({
      type: "welcome",
      role: "player",
      slot: 1,
      players: [
        { id: "client-host", slot: 0, ready: true },
        { id: "client-one", slot: 1, ready: true },
      ],
    });
    assert.ok(
      [...timers.values()].some((timer) => timer.delay === 3_000),
      "Welcome on an active replacement socket must rearm the state watchdog",
    );
    transport.close();
    assert.equal(timers.size, 0);
  }],
];

async function main() {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`PASS ${name}\n`);
  }
  process.stdout.write(`\n${tests.length} deterministic room-transport tests passed.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
