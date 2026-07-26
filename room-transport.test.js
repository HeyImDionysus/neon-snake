"use strict";

const assert = require("node:assert/strict");
const transports = require("./public/room-transport.js");

class FakeBroadcastChannel {
  static instances = [];

  constructor(name) {
    this.name = name;
    this.messages = [];
    this.listeners = new Set();
    this.closed = false;
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(type, listener) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  close() {
    this.closed = true;
  }

  emit(data) {
    this.listeners.forEach((listener) => listener({ data }));
  }
}

const tests = [
  ["support detection is explicit", () => {
    assert.equal(transports.broadcastRoomSupported({ BroadcastChannel: FakeBroadcastChannel }), true);
    assert.equal(transports.broadcastRoomSupported({}), false);
  }],
  ["the adapter owns room envelopes and channel naming", () => {
    const received = [];
    const transport = transports.createBroadcastRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: (message) => received.push(message),
      BroadcastChannelImpl: FakeBroadcastChannel,
      now: () => 123456,
    });
    const channel = FakeBroadcastChannel.instances.at(-1);
    assert.equal(transport.kind, "broadcast-channel");
    assert.equal(channel.name, "neon-snake-duel-ABC234");
    assert.equal(transport.send({ type: "ready", ready: true }), true);
    assert.deepEqual(channel.messages, [{
      type: "ready",
      ready: true,
      from: "client-one",
      room: "ABC234",
      sentAt: 123456,
    }]);

    channel.emit({ type: "presence", from: "client-two" });
    assert.deepEqual(received, [{ type: "presence", from: "client-two" }]);
  }],
  ["closing is idempotent and blocks later sends", () => {
    const transport = transports.createBroadcastRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: () => {},
      BroadcastChannelImpl: FakeBroadcastChannel,
    });
    const channel = FakeBroadcastChannel.instances.at(-1);
    transport.close();
    transport.close();
    assert.equal(channel.closed, true);
    assert.equal(channel.listeners.size, 0);
    assert.equal(transport.send({ type: "presence" }), false);
  }],
  ["invalid adapter construction fails closed", () => {
    assert.throws(() => transports.createBroadcastRoomTransport({
      code: "",
      clientId: "client-one",
      onMessage: () => {},
      BroadcastChannelImpl: FakeBroadcastChannel,
    }), /room code/i);
    assert.throws(() => transports.createBroadcastRoomTransport({
      code: "ABC234",
      clientId: "",
      onMessage: () => {},
      BroadcastChannelImpl: FakeBroadcastChannel,
    }), /client id/i);
    assert.throws(() => transports.createBroadcastRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: null,
      BroadcastChannelImpl: FakeBroadcastChannel,
    }), /message handler/i);
    assert.throws(() => transports.createBroadcastRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: () => {},
      BroadcastChannelImpl: null,
    }), /BroadcastChannel/i);

    const transport = transports.createBroadcastRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: () => {},
      BroadcastChannelImpl: FakeBroadcastChannel,
    });
    assert.throws(() => transport.send(null), /message object/i);
  }],
  ["remote support detection requires fetch", () => {
    assert.equal(transports.remoteRoomSupported({ fetch() {} }), true);
    assert.equal(transports.remoteRoomSupported({}), false);
  }],
  ["the remote adapter joins, syncs, and rebuilds server roster events", async () => {
    const requests = [];
    const scheduled = [];
    const received = [];
    const statuses = [];
    let syncCount = 0;
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ body, options });
      if (body.action === "join") {
        return {
          ok: true,
          async json() {
            return {
              role: "player",
              slot: 0,
              session: "session-one",
              players: [
                { id: "client-one", slot: 0, ready: false },
                { id: "client-two", slot: 1, ready: true, seenAt: 120 },
              ],
              stateRev: 4,
              inputRev: 2,
              countdownRev: 1,
            };
          },
        };
      }
      syncCount += 1;
      return {
        ok: true,
        async json() {
          return {
            role: "player",
            slot: 0,
            session: "session-one",
            players: [
              { id: "client-one", slot: 0, ready: true },
              { id: "client-two", slot: 1, ready: true, seenAt: 121 },
            ],
            stateRev: 4,
            inputRev: 3,
            countdownRev: 1,
            input: {
              type: "input",
              direction: { x: 0, y: -1 },
              from: "client-two",
              room: "ABC234",
              sentAt: 123,
            },
          };
        },
      };
    };

    const transport = await transports.createRemoteRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: (message) => received.push(message),
      onStatus: (status) => statuses.push(status),
      fetchImpl,
      setTimeoutImpl: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeoutImpl: () => {},
    });

    assert.equal(transport.kind, "vercel-redis");
    assert.equal(requests[0].body.action, "join");
    assert.equal(requests[0].options.credentials, "same-origin");
    assert.equal(statuses.at(-1).role, "player");
    assert.equal(statuses.at(-1).slot, 0);
    assert.ok(received.some((message) => (
      message.type === "presence"
      && message.from === "client-two"
      && message.slot === 1
      && message.ready
      && message.seenAt === 120
    )));

    transport.send({ type: "ready", ready: true });
    transport.send({ type: "state", sequence: 5, state: { frame: "test" } });
    await scheduled.shift()();

    assert.equal(syncCount, 1);
    assert.equal(requests[1].body.ready, true);
    assert.deepEqual(requests[1].body.messages, [
      { type: "state", sequence: 5, state: { frame: "test" } },
    ]);
    assert.ok(received.some((message) => (
      message.type === "input"
      && message.from === "client-two"
      && message.direction.y === -1
    )));
    transport.close();
  }],
  ["remote close uses a keepalive leave without leaking the session into the URL", async () => {
    const requests = [];
    const transport = await transports.createRemoteRoomTransport({
      code: "ABC234",
      clientId: "client-one",
      onMessage: () => {},
      fetchImpl: async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return {
          ok: true,
          async json() {
            return {
              role: "player",
              slot: 0,
              session: "session-one",
              players: [{ id: "client-one", slot: 0, ready: false }],
              stateRev: 0,
              inputRev: 0,
              countdownRev: 0,
            };
          },
        };
      },
      setTimeoutImpl: () => 1,
      clearTimeoutImpl: () => {},
    });
    transport.close();
    await Promise.resolve();
    const leave = requests.find((entry) => entry.body.action === "leave");
    assert.ok(leave);
    assert.equal(leave.options.keepalive, true);
    assert.ok(!leave.url.includes("session-one"));
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
