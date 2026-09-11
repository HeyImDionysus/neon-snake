"use strict";

const assert = require("node:assert/strict");
const { randomBytes, createHash } = require("node:crypto");
const { WebSocket } = require("ws");
const { PRESENCE_SCRIPT } = require("./server/realtime-core.cjs");
const { createFixtureServer, redisConnection } = require("./realtime-fixture-server.cjs");
const transports = require("./public/room-transport.js");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(predicate, label, timeout = 7_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}
function roomCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return [...randomBytes(6)].map((value) => alphabet[value % alphabet.length]).join("");
}
function keys(room) {
  return ["presence", "metadata", "generation"].map((name) => `{neon-snake:realtime:${room}}:${name}`);
}

async function main() {
  const redis = redisConnection();
  try {
    await redis.command(["PING"]);
  } catch (error) {
    redis.close();
    if (process.env.REALTIME_REDIS_REQUIRED === "1") throw error;
    console.log("SKIP realtime integration: isolated Redis required on 127.0.0.1:16379; set REALTIME_REDIS_REQUIRED=1 to enforce");
    return;
  }
  const fixture = createFixtureServer({ port: 0 });
  const room = roomCode();
  const expiryRoom = roomCode();
  const clients = [];
  let promotedTransport;
  try {
    await fixture.ready;
    const origin = `http://127.0.0.1:${fixture.server.address().port}`;
    const endpoint = `${origin.replace("http:", "ws:")}/api/realtime`;
    async function connect(id, token = "") {
      const client = { id, messages: [], closed: null };
      const protocols = ["neon-snake-v1"];
      if (token) protocols.push(`resume.${token}`);
      client.socket = new WebSocket(`${endpoint}?room=${room}&clientId=${id}`, protocols, { origin });
      clients.push(client);
      client.socket.on("message", (data) => client.messages.push(JSON.parse(data)));
      client.socket.on("close", (code) => { client.closed = code; });
      client.socket.on("error", (error) => { client.error = error; });
      await waitFor(() => client.messages.find((message) => message.type === "welcome") || client.closed || client.error, `connect ${id}`);
      if (client.error) throw client.error;
      client.welcome = client.messages.find((message) => message.type === "welcome");
      return client;
    }
    function send(client, message) { client.socket.send(JSON.stringify(message)); }
    async function ready(first, second) {
      send(first, { type: "ready", ready: true });
      send(second, { type: "ready", ready: true });
      await waitFor(() => {
        const roster = first.messages.filter((message) => message.type === "roster").at(-1);
        return roster?.players.length === 2 && roster.players.every((player) => player.ready);
      }, "both players ready");
    }
    const host = await connect("qa-owner");
    const peer = await connect("qa-opponent");
    assert.equal(host.welcome?.slot, 0);
    assert.equal(peer.welcome?.slot, 1);
    assert.match(host.welcome.resumeToken, /^[a-f0-9-]{36}$/);
    assert.equal(JSON.stringify(peer.messages).includes(host.welcome.resumeToken), false);
    const storedOwner = JSON.parse(await redis.command(["HGET", keys(room)[1], "qa-owner"]));
    assert.equal(storedOwner.resumeHash, createHash("sha256").update(host.welcome.resumeToken).digest("hex"));
    assert.equal(JSON.stringify(storedOwner).includes(host.welcome.resumeToken), false);
    await ready(host, peer);
    send(host, { type: "countdown", round: Date.now(), startsAt: Date.now() + 3_200 });
    const stateA = await waitFor(() => host.messages.find((message) => message.type === "state"), "host authoritative state");
    const stateB = await waitFor(() => peer.messages.find((message) => message.type === "state"), "cross-instance state");
    assert.deepEqual(stateA.state, stateB.state);
    console.log("PASS actual two-hub WebSockets share authoritative Redis-relayed snapshots");

    const watcher = await connect("qa-watcher");
    assert.equal(watcher.welcome?.role, "spectator");
    const cancellations = peer.messages.filter((message) => message.type === "countdown-cancel").length;
    watcher.socket.close();
    await waitFor(() => watcher.closed, "spectator closes");
    await delay(180);
    assert.equal(peer.messages.filter((message) => message.type === "countdown-cancel").length, cancellations);
    console.log("PASS spectator departure preserves active round");

    const copied = await connect("qa-owner");
    assert.equal(copied.closed, 4003);
    console.log("PASS copied public client id cannot steal an occupied seat");
    const resumed = await connect("qa-owner", host.welcome.resumeToken);
    assert.equal(resumed.welcome?.slot, 0);
    await ready(resumed, peer);
    const secondRound = Date.now();
    send(resumed, { type: "countdown", round: secondRound, startsAt: Date.now() + 3_200 });
    await waitFor(() => resumed.messages.some((message) => message.type === "countdown" && message.round === secondRound), "resumed countdown");
    host.socket.close();
    await waitFor(() => host.closed, "replaced socket closes");
    await waitFor(() => resumed.messages.some((message) => message.type === "state" && message.state.round === secondRound), "replacement round after old close");
    console.log("PASS private resume and old-socket cleanup preserve replacement round");

    const promotionStatuses = [];
    class BrowserSocket extends WebSocket {
      constructor(url, protocols) { super(url, protocols, { origin }); }
    }
    promotedTransport = await transports.createWebSocketRoomTransport({
      code: room, clientId: "qa-next-player", endpoint, WebSocketImpl: BrowserSocket,
      onMessage() {}, onStatus: (status) => promotionStatuses.push(status),
    });
    await waitFor(() => promotionStatuses.some((status) => status.state === "connected" && status.role === "spectator"), "waiting client connects");
    peer.socket.close();
    await waitFor(() => promotionStatuses.some((status) => status.role === "player" && status.slot === 1), "queue promotion");
    assert.equal(promotedTransport.send({ type: "ready", ready: true }), true);
    await waitFor(() => promotionStatuses.at(-1)?.players?.some((player) => player.id === "qa-next-player" && player.ready), "promoted player explicitly readies");
    console.log("PASS actual browser transport promotes queue head and publishes explicit Ready");

    async function lua(action, id, connection, at) {
      return JSON.parse(await redis.command([
        "EVAL", PRESENCE_SCRIPT, 4, ...keys(expiryRoom), `neon-snake:qa:${expiryRoom}:active`,
        at, action, id, connection, "0", "", "", "", "", "", "", "", "", "-1", "-1", `hash-${id}`,
      ]));
    }
    await lua("join", "ttl-host", "ttl-host-connection", 100_000);
    await lua("join", "ttl-peer", "ttl-peer-connection", 100_001);
    await lua("join", "ttl-wait", "ttl-wait-connection", 100_002);
    await lua("touch", "ttl-peer", "ttl-peer-connection", 125_000);
    await lua("touch", "ttl-wait", "ttl-wait-connection", 125_001);
    const promoted = await lua("touch", "ttl-peer", "ttl-peer-connection", 130_001);
    assert.equal(promoted.players.find((player) => player.id === "ttl-wait")?.slot, 0);
    assert.equal(promoted.players.find((player) => player.id === "ttl-wait")?.ready, false);
    console.log("PASS real Lua expiry promotes a waiting participant on heartbeat without another join");

    // A presence record claimed by a newer connection is terminal for the old
    // socket; a record that simply expired must stay recoverable so the client
    // reconnects instead of giving up.
    const resumedSeat = await lua("join", "ttl-peer", "ttl-peer-second", 130_002);
    assert.equal(resumedSeat.error, undefined, "the same credential must resume its own session");
    const superseded = await lua("touch", "ttl-peer", "ttl-peer-connection", 130_003);
    assert.equal(superseded.active, false);
    assert.equal(superseded.replaced, true, "a superseded connection must be told its session was replaced");
    const vanished = await lua("touch", "ttl-absent", "ttl-absent-connection", 130_004);
    assert.equal(vanished.active, false);
    assert.equal(vanished.replaced, false, "an expired record must not be reported as a replacement");
    console.log("PASS real Lua separates a replaced session from an expired one");
  } finally {
    promotedTransport?.close();
    clients.forEach((client) => client.socket.close());
    await fixture.close();
    await redis.command(["DEL", ...keys(room), ...keys(expiryRoom), `neon-snake:qa:${expiryRoom}:active`]);
    redis.close();
  }
  console.log("PASS real Redis and WebSocket integration, with owned sockets and test keys cleaned up");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
