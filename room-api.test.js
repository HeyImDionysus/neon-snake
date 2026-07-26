"use strict";

const assert = require("node:assert/strict");
const core = require("./server/room-core.cjs");

function request(body, headers = {}) {
  return {
    method: "POST",
    body,
    headers: {
      host: "neon-snake.example",
      origin: "https://neon-snake.example",
      "content-type": "application/json",
      "x-forwarded-host": "neon-snake.example",
      "x-forwarded-proto": "https",
      ...headers,
    },
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function runHandler(handler, body, headers) {
  const output = response();
  await handler(request(body, headers), output);
  return output;
}

async function main() {
  {
    const calls = [];
    const handler = core.createRoomHandler({
      now: () => 1_725_000_000_000,
      randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      redisCommand: async (command) => {
        calls.push(command);
        return JSON.stringify({
          role: "player",
          slot: 0,
          session: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          players: [{ id: "client-one", slot: 0, ready: false }],
          stateRev: 0,
          inputRev: 0,
          countdownRev: 0,
        });
      },
    });
    const result = await runHandler(handler, {
      action: "join",
      room: "ABC234",
      clientId: "client-one",
    }, { "x-forwarded-for": "203.0.113.9" });

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.equal(result.payload.role, "player");
    assert.equal(result.payload.slot, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "EVAL");
    assert.equal(calls[0][2], "4");
    assert.ok(calls[0].some((value) => String(value).includes("{ABC234}")));
    assert.ok(calls[0].some((value) => String(value).startsWith("neon-snake:rate:")));
    assert.ok(!JSON.stringify(calls[0]).includes("203.0.113.9"));
    assert.ok(!JSON.stringify(calls[0]).includes("STORAGE_KV_REST_API_TOKEN"));
    process.stdout.write("PASS join executes one atomic room command without exposing configuration\n");
  }

  {
    const sanitized = core.sanitizeMessages([
      {
        type: "input",
        from: "spoofed-player",
        room: "WRONG1",
        sentAt: 1,
        direction: { x: 0, y: -1 },
        ignored: "value",
      },
      {
        type: "countdown",
        startsAt: 1_725_000_003_000,
      },
    ], {
      room: "ABC234",
      clientId: "client-two",
      now: 1_725_000_000_000,
    });

    assert.deepEqual(sanitized, [
      {
        type: "input",
        direction: { x: 0, y: -1 },
        from: "client-two",
        room: "ABC234",
        sentAt: 1_725_000_000_000,
      },
      {
        type: "countdown",
        startsAt: 1_725_000_003_000,
        from: "client-two",
        room: "ABC234",
        sentAt: 1_725_000_000_000,
      },
    ]);
    assert.throws(
      () => core.sanitizeMessages([{ type: "input", direction: { x: 1, y: 1 } }], {
        room: "ABC234",
        clientId: "client-two",
        now: 1_725_000_000_000,
      }),
      /direction/i,
    );
    assert.throws(
      () => core.sanitizeMessages(new Array(17).fill({ type: "input", direction: { x: 1, y: 0 } }), {
        room: "ABC234",
        clientId: "client-two",
        now: 1_725_000_000_000,
      }),
      /too many/i,
    );
    process.stdout.write("PASS client envelopes are rebuilt and invalid gameplay payloads fail closed\n");
  }

  {
    const calls = [];
    const handler = core.createRoomHandler({
      redisCommand: async (command) => {
        calls.push(command);
        return JSON.stringify({
          role: "player",
          slot: 1,
          session: "session-two",
          players: [],
          stateRev: 0,
          inputRev: 1,
          countdownRev: 0,
        });
      },
    });
    const result = await runHandler(handler, {
      action: "sync",
      room: "ABC234",
      clientId: "client-two",
      session: "session-two",
      ready: true,
      messages: [{ type: "input", direction: { x: -1, y: 0 } }],
    });
    assert.equal(result.statusCode, 200);
    const messages = JSON.parse(calls[0].at(-1));
    assert.equal(messages[0].type, "input");
    assert.equal(messages[0].from, "client-two");
    assert.doesNotMatch(JSON.stringify(calls[0]), /STORAGE_|rediss:|Bearer /);
    process.stdout.write("PASS sync accepts only sanitized room messages\n");
  }

  {
    let redisCalled = false;
    const handler = core.createRoomHandler({
      redisCommand: async () => {
        redisCalled = true;
        throw new Error("should not run");
      },
    });
    const crossOrigin = await runHandler(handler, {
      action: "join",
      room: "ABC234",
      clientId: "client-one",
    }, { origin: "https://attacker.example" });
    assert.equal(crossOrigin.statusCode, 403);

    const malformed = await runHandler(handler, {
      action: "join",
      room: "bad-room",
      clientId: "x",
    });
    assert.equal(malformed.statusCode, 400);
    const wrongContentType = await runHandler(handler, {
      action: "join",
      room: "ABC234",
      clientId: "client-one",
    }, { "content-type": "text/plain" });
    assert.equal(wrongContentType.statusCode, 415);
    assert.equal(redisCalled, false);
    process.stdout.write("PASS cross-origin, content-type, and malformed requests are rejected before Redis\n");
  }

  {
    const handler = core.createRoomHandler({
      redisCommand: async () => JSON.stringify({ error: "rate_limited" }),
    });
    const result = await runHandler(handler, {
      action: "sync",
      room: "ABC234",
      clientId: "client-one",
      session: "session-one",
      ready: false,
      messages: [],
    });
    assert.equal(result.statusCode, 429);
    assert.deepEqual(result.payload, { error: "rate_limited" });
    process.stdout.write("PASS room-level rate limits produce an explicit retryable response\n");
  }

  {
    const script = core.ROOM_SCRIPT;
    assert.match(script, /ZREMRANGEBYSCORE/);
    assert.match(script, /slot == 0 and \(eventType == "state" or eventType == "countdown"\)/);
    assert.match(script, /slot == 1 and eventType == "input"/);
    assert.match(script, /role = "spectator"/);
    assert.match(script, /ZSCORE/);
    assert.match(script, /EXPIRE/);
    assert.match(script, /rate_limited/);
    process.stdout.write("PASS atomic script enforces expiry, capacity, rate, and role boundaries\n");
  }

  {
    const config = core.redisConfig({
      STORAGE_KV_REST_API_URL: "https://example.invalid",
      STORAGE_KV_REST_API_TOKEN: "placeholder",
    });
    assert.deepEqual(config, {
      url: "https://example.invalid",
      token: "placeholder",
    });
    assert.throws(() => core.redisConfig({}), /not configured/i);
    process.stdout.write("PASS Vercel Storage environment names are resolved server-side\n");
  }

  process.stdout.write("\n7 deterministic room API tests passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
