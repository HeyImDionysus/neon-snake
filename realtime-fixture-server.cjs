"use strict";

const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const { createRealtimeHub } = require("./server/realtime-core.cjs");

function parse(buffer, offset = 0) {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]);
  const value = buffer.toString("utf8", offset + 1, end);
  let cursor = end + 2;
  if (type === "+") return { value, cursor };
  if (type === "-") return { value: new Error(value), cursor };
  if (type === ":") return { value: Number(value), cursor };
  if (type === "$") {
    const length = Number(value);
    if (length < 0) return { value: null, cursor };
    if (buffer.length < cursor + length + 2) return null;
    return { value: buffer.toString("utf8", cursor, cursor + length), cursor: cursor + length + 2 };
  }
  if (type === "*") {
    const values = [];
    for (let index = 0; index < Number(value); index += 1) {
      const child = parse(buffer, cursor);
      if (!child) return null;
      values.push(child.value);
      cursor = child.cursor;
    }
    return { value: values, cursor };
  }
  throw new Error("Unexpected Redis protocol response");
}

function redisConnection(onPush) {
  const socket = net.createConnection({ host: "127.0.0.1", port: 16379 });
  const pending = [];
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const result = parse(buffer);
      if (!result) break;
      buffer = buffer.subarray(result.cursor);
      if (Array.isArray(result.value) && result.value[0] === "message") onPush?.(result.value);
      else {
        const waiter = pending.shift();
        if (result.value instanceof Error) waiter?.reject(result.value);
        else waiter?.resolve(result.value);
      }
    }
  });
  socket.on("error", (error) => {
    while (pending.length) pending.shift().reject(error);
  });
  socket.on("close", () => {
    while (pending.length) pending.shift().reject(new Error("Redis test connection closed"));
  });
  return {
    command(values) {
      if (socket.destroyed) return Promise.reject(new Error("Redis test connection is closed"));
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        const chunks = [Buffer.from(`*${values.length}\r\n`)];
        for (const value of values) {
          const bytes = Buffer.from(String(value));
          chunks.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n"));
        }
        socket.write(Buffer.concat(chunks));
      });
    },
    close() { socket.destroy(); },
  };
}

function createFixtureServer({ port = 4179 } = {}) {
  const redis = redisConnection();
  const connections = [];
  function bus() {
    return {
      async subscribe(room, handler) {
        const subscriber = redisConnection((message) => handler(JSON.parse(message[2])));
        connections.push(subscriber);
        await subscriber.command(["SUBSCRIBE", `neon-snake:qa:${room}`]);
        return () => subscriber.close();
      },
      publish(room, payload) {
        return redis.command(["PUBLISH", `neon-snake:qa:${room}`, JSON.stringify(payload)]);
      },
    };
  }
  const hubs = [0, 1].map(() => createRealtimeHub({
    redisCommand: (command) => redis.command(command), bus: bus(), sessionReader: async () => null,
  }));
  let nextHub = 0;
  const publicRoot = path.resolve(__dirname, "public");
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const pathname = new URL(request.url, "http://127.0.0.1:4179").pathname;
    if (pathname === "/api/realtime") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, authority: "server", qa: "two-hub-real-redis" }));
      return;
    }
    let filename = path.resolve(publicRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.extname(filename)) filename += ".html";
    if (!filename.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(filename)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", mime[path.extname(filename)] || "application/octet-stream");
    fs.createReadStream(filename).pipe(response);
  });
  const webSockets = new WebSocketServer({ server });
  webSockets.on("connection", (socket, request) => {
    void hubs[nextHub++ % hubs.length].connect(socket, request);
  });
  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  async function close() {
    webSockets.clients.forEach((socket) => socket.terminate());
    const deadline = Date.now() + 5_000;
    const unfinished = () => hubs.some((hub) => hub._state.connections.size || hub._state.rooms.size);
    while (unfinished() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const cleanupFailed = unfinished();
    hubs.forEach((hub) => hub.close());
    connections.forEach((connection) => connection.close());
    redis.close();
    await new Promise((resolve) => server.close(resolve));
    if (cleanupFailed) throw new Error("Realtime fixture did not finish disconnect cleanup");
  }
  
  return { ready, close, server, redis };
}

if (require.main === module) {
  const fixture = createFixtureServer();
  fixture.ready.then(() => console.log(`QA two-hub server http://127.0.0.1:${fixture.server.address().port}`));
  process.on("SIGINT", () => void fixture.close());
  process.on("SIGTERM", () => void fixture.close());
}
module.exports = { createFixtureServer, redisConnection };
