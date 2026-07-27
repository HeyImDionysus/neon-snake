"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { signedTicket } = require("./server/account-core.cjs");

const root = __dirname;

(async () => {
  const worker = await import(pathToFileURL(path.join(root, "realtime", "worker.mjs")).href);
  const now = 1_785_124_800_000;
  const secret = "test-realtime-secret-with-enough-entropy";

  assert.deepEqual(worker.validateRealtimeMessage({
    type: "input",
    round: now,
    sequence: now + 1,
    direction: { x: 0, y: -1 },
  }, { slot: 0, allReady: true, now }), {
    type: "input",
    round: now,
    sequence: now + 1,
    direction: { x: 0, y: -1 },
  });
  assert.ok(worker.validateRealtimeMessage({
    type: "input",
    round: 4,
    sequence: 10,
    direction: { x: -1, y: 0 },
  }, { slot: 1, allReady: true, now }));
  assert.equal(worker.validateRealtimeMessage({
    type: "input",
    round: 4,
    sequence: 10,
    direction: { x: 2, y: 0 },
  }, { slot: 1, allReady: true, now }), null);

  assert.ok(worker.validateRealtimeMessage({
    type: "countdown",
    round: now,
    startsAt: now + 3_200,
  }, { slot: 0, allReady: true, now }));
  assert.equal(worker.validateRealtimeMessage({
    type: "countdown",
    round: 4,
    startsAt: now + 3_200,
  }, { slot: 0, allReady: false, now }), null);
  assert.equal(worker.validateRealtimeMessage({
    type: "countdown",
    round: 4,
    startsAt: now + 3_200,
  }, { slot: 1, allReady: true, now }), null);

  const ticket = signedTicket({
    sub: "123456789012345678",
    cid: "client-test-1234",
    name: "Neon Player",
    avatar: "",
    iat: now,
    exp: now + 300_000,
    jti: "ticket-id",
  }, secret);
  assert.deepEqual(await worker.verifyRealtimeTicket(ticket, secret, now), {
    userId: "123456789012345678",
    clientId: "client-test-1234",
    displayName: "Neon Player",
    avatar: "",
    jti: "ticket-id",
  });
  assert.equal(await worker.verifyRealtimeTicket(`${ticket}x`, secret, now), null);
  assert.equal(await worker.verifyRealtimeTicket(ticket, "wrong-secret", now), null);
  assert.equal(await worker.verifyRealtimeTicket(ticket, secret, now + 400_000), null);

  globalThis.WebSocketRequestResponsePair = class WebSocketRequestResponsePair {};
  const room = new worker.Room({
    setWebSocketAutoResponse() {},
    getWebSockets() {
      return [];
    },
  }, {});
  room.game = {
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
  assert.deepEqual(room.resolveTick(), {
    crashes: { player: "head-on", opponent: "head-on" },
    winner: null,
  });
  assert.equal(room.game.over, true);

  const source = fs.readFileSync(path.join(root, "realtime", "worker.mjs"), "utf8");
  assert.match(source, /TICK_DURATION = 138/);
  assert.match(source, /resolveTick\(\)/);
  assert.match(source, /Rules\.resolveDuelTick/);
  assert.match(source, /server_authoritative/);
  assert.match(source, /recordMatch\(result\)/);
  assert.match(source, /REALTIME_SHARED_SECRET/);
  assert.match(source, /origin_not_allowed/);
  assert.doesNotMatch(source, /setInterval\(/);

  process.stdout.write("PASS realtime worker validates identities, owns ticks, and signs verified outcomes\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
