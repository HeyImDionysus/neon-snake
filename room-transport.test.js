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
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic room-transport tests passed.\n`);
