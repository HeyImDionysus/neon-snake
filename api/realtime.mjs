import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import realtimeCore from "../server/realtime-core.cjs";

export const config = {
  maxDuration: 300,
};

const hub = realtimeCore.createRealtimeHub();
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "GET") {
    response.statusCode = 200;
    response.end(JSON.stringify({
      ok: true,
      transport: "vercel-native-websocket",
      authority: "server",
    }));
    return;
  }
  response.statusCode = 405;
  response.setHeader("Allow", "GET");
  response.end(JSON.stringify({ error: "method_not_allowed" }));
});

const webSockets = new WebSocketServer({
  server,
  maxPayload: realtimeCore.MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
  verifyClient(info, done) {
    if (!realtimeCore.requestIsAllowedOrigin(info.req, process.env)) {
      done(false, 403, "Origin not allowed");
      return;
    }
    done(true);
  },
});

webSockets.on("connection", (socket, request) => {
  void hub.connect(socket, request);
});

export default server;
