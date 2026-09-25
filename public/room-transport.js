(function exposeRoomTransports(root) {
  "use strict";

  // How long before a connection's server-declared expiry the client opens its
  // replacement at the latest. Wide enough to absorb a slow handshake and one retry.
  const ROTATE_LEAD_MS = 45_000;
  // A handover that must happen during a round is left until this close to the
  // platform's hard cut, since the round cannot survive it either way.
  const FORCED_ROTATE_LEAD_MS = 10_000;

  function webSocketRoomSupported(runtime = root) {
    return typeof runtime?.WebSocket === "function";
  }

  async function createWebSocketRoomTransport({
    code,
    clientId,
    endpoint,
    onMessage,
    onStatus = () => {},
    WebSocketImpl = root.WebSocket,
    now = () => Date.now(),
    setTimeoutImpl = root.setTimeout,
    clearTimeoutImpl = root.clearTimeout,
    locationHref = root.location?.href || "https://neon-snake.invalid/",
    storage,
    random = Math.random,
  } = {}) {
    if (typeof code !== "string" || !code.trim()) throw new TypeError("A room code is required.");
    if (typeof clientId !== "string" || !clientId.trim()) throw new TypeError("A client id is required.");
    if (typeof endpoint !== "string" || !endpoint.trim()) throw new TypeError("A realtime endpoint is required.");
    if (typeof onMessage !== "function") throw new TypeError("A message handler is required.");
    if (typeof onStatus !== "function") throw new TypeError("A status handler is required.");
    if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is not available.");

    const normalizedCode = code.trim().toUpperCase();
    const sessionKey = `neon-snake-realtime-session:${normalizedCode}:${clientId}`;
    let resumeToken = "";
    try {
      storage = storage || root.sessionStorage;
      const saved = storage?.getItem?.(sessionKey);
      if (/^[a-f0-9-]{36}$/.test(saved || "")) resumeToken = saved;
    } catch {
      // An open transport retains its credential even when storage is unavailable.
    }
    const baseEndpoint = new URL(endpoint, locationHref);
    if (baseEndpoint.protocol === "https:") baseEndpoint.protocol = "wss:";
    if (baseEndpoint.protocol === "http:") baseEndpoint.protocol = "ws:";
    const localSocket = baseEndpoint.protocol === "ws:"
      && /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(baseEndpoint.hostname);
    if (baseEndpoint.protocol !== "wss:" && !localSocket) {
      throw new TypeError("A secure realtime endpoint is required.");
    }
    let socket = null;
    let closed = false;
    let active = false;
    let ready = false;
    let role = "spectator";
    let slot = -1;
    let roster = [];
    let waiting = [];
    let queuePosition = 0;
    let failures = 0;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let connectionTimer = null;
    let stateTimer = null;
    let lastPongAt = 0;
    let lastPingAt = 0;
    let clockOffset = null;
    const clockSamples = [];
    let readySent = false;
    let lastReadySentAt = 0;
    let activeRound = null;

    function clearSocketTimers() {
      if (heartbeatTimer !== null) clearTimeoutImpl(heartbeatTimer);
      if (connectionTimer !== null) clearTimeoutImpl(connectionTimer);
      if (stateTimer !== null) clearTimeoutImpl(stateTimer);
      heartbeatTimer = null;
      connectionTimer = null;
      stateTimer = null;
    }

    function armStateWatchdog(delay = 13_000) {
      if (stateTimer !== null) clearTimeoutImpl(stateTimer);
      stateTimer = null;
      if (!active || closed) return;
      stateTimer = setTimeoutImpl(() => {
        stateTimer = null;
        if (!active || closed) return;
        onStatus({
          state: "authoritative-timeout",
          role,
          slot,
          players: roster,
          waiting,
          queuePosition,
          code: "state_timeout",
        });
        onMessage({
          type: "countdown-cancel",
          room: normalizedCode,
          slot: -1,
          reason: "state_timeout",
          sentAt: now(),
        });
        socket?.close(1012, "Authoritative state timed out");
      }, delay);
    }

    function sendReady() {
      if (socket?.readyState !== WebSocketImpl.OPEN || role !== "player") return false;
      socket.send(JSON.stringify({ type: "ready", ready }));
      readySent = true;
      lastReadySentAt = now();
      return true;
    }

    function emitRoster(players) {
      if (!Array.isArray(players)) return;
      roster = players;
      const previousRole = role;
      const localPlayer = roster.find((player) => player?.id === clientId);
      role = localPlayer && Number(localPlayer.slot) >= 0 ? "player" : "spectator";
      slot = role === "player" ? Number(localPlayer.slot) : -1;
      if (previousRole !== role) {
        ready = false;
        readySent = false;
        if (role === "player") sendReady();
      }
      players.forEach((player) => {
        if (!player || player.id === clientId) return;
        onMessage({
          type: "presence",
          from: player.id,
          room: normalizedCode,
          ready: Boolean(player.ready),
          slot: Number.isInteger(player.slot) ? player.slot : -1,
          seenAt: Number(player.seenAt) || now(),
          profile: player.profile && typeof player.profile === "object"
            ? {
              displayName: String(player.profile.displayName || "").slice(0, 64),
              username: String(player.profile.username || "").slice(0, 32),
              callsign: String(player.profile.callsign || player.profile.displayName || "").slice(0, 24),
              accent: ["acid", "cyan", "violet", "magenta", "ember"].includes(player.profile.accent)
                ? player.profile.accent
                : "acid",
              favoriteMode: ["classic", "portal", "rush", "canvas", "live"].includes(player.profile.favoriteMode)
                ? player.profile.favoriteMode
                : "classic",
              snakeStyle: ["signal", "spectral", "glass", "ember"].includes(player.profile.snakeStyle)
                ? player.profile.snakeStyle
                : "signal",
              avatar: String(player.profile.avatar || "").slice(0, 128),
            }
            : null,
          sentAt: now(),
        });
      });
      onStatus({
        state: "synchronized",
        role,
        slot,
        players: roster,
        waiting,
        queuePosition,
        roleChanged: previousRole !== role,
      });
      if (
        role === "player"
        && previousRole === "player"
        && localPlayer
        && Boolean(localPlayer.ready) !== ready
        && now() - lastReadySentAt >= 500
      ) sendReady();
    }

    function scheduleHeartbeat(delay = active ? 5_000 : 15_000) {
      if (closed) return;
      // Turn timing needs the round-trip time before the first round (duel.js
      // liveInputTick). Every run-state change reschedules the heartbeat, which
      // used to push the first ping back to 15 s.
      if (!clockSamples.length) delay = Math.min(delay, 750);
      if (heartbeatTimer !== null) clearTimeoutImpl(heartbeatTimer);
      heartbeatTimer = setTimeoutImpl(() => {
        heartbeatTimer = null;
        if (socket?.readyState === WebSocketImpl.OPEN) {
          const staleAfter = active ? 20_000 : 45_000;
          if (lastPongAt && now() - lastPongAt > staleAfter) {
            socket.close(4000, "Realtime heartbeat timed out");
            return;
          }
          lastPingAt = now();
          socket.send(JSON.stringify({ type: "ping", at: lastPingAt }));
        }
        scheduleHeartbeat();
      }, delay);
    }

    function scheduleReconnect() {
      if (closed || reconnectTimer !== null) return;
      clearSocketTimers();
      failures += 1;
      // Jittered so a room full of clients does not reconnect in lockstep.
      const ceiling = Math.min(4_000, 250 * 2 ** Math.min(failures - 1, 4));
      const delay = Math.round(ceiling / 2 + random() * ceiling / 2);
      onStatus({ state: "reconnecting", role, slot, failures, code: "socket_closed" });
      reconnectTimer = setTimeoutImpl(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }

    // Vercel closes a WebSocket when the Function invocation reaches its maximum
    // duration. Reconnecting after that cut frees the seat to whoever is waiting
    // and cancels the round, so the link is replaced before the cut lands: a
    // second socket joins with the same credential, and only once it is welcomed
    // does the old one close. The seat never becomes vacant.
    let pendingSocket = null;
    let rotateTimer = null;
    let connectionExpiresAt = 0;
    let connectionClosesAt = 0;
    let connectionWelcomedAt = 0;
    let rotationDue = false;

    function isCurrentSocket(candidate) {
      return candidate === socket || candidate === pendingSocket;
    }

    function clearRotateTimer() {
      if (rotateTimer !== null) clearTimeoutImpl(rotateTimer);
      rotateTimer = null;
    }

    // The simulation lives on the server instance Player 1 reached, so a handover
    // during a round ends that round. Links are therefore replaced between
    // rounds: once they are halfway through their life while idle, or - only if
    // a round is still running - just before the platform would cut them anyway.
    function rotate() {
      if (closed || pendingSocket) return;
      rotationDue = false;
      void connect({ rotating: true });
    }

    function scheduleRotation() {
      clearRotateTimer();
      rotationDue = false;
      if (closed || !connectionExpiresAt) return;
      const idleAt = Math.min(
        connectionWelcomedAt + (connectionExpiresAt - connectionWelcomedAt) / 2,
        connectionExpiresAt - ROTATE_LEAD_MS,
      );
      rotateTimer = setTimeoutImpl(() => {
        rotateTimer = null;
        if (closed || pendingSocket) return;
        if (!active) {
          rotate();
          return;
        }
        rotationDue = true;
        const forcedAt = (connectionClosesAt || connectionExpiresAt) - FORCED_ROTATE_LEAD_MS;
        rotateTimer = setTimeoutImpl(() => {
          rotateTimer = null;
          if (rotationDue) rotate();
        }, Math.max(0, forcedAt - now()));
      }, Math.max(5_000, idleAt - now()));
    }

    function socketUrl() {
      const url = new URL(baseEndpoint.href);
      url.searchParams.set("room", normalizedCode);
      url.searchParams.set("clientId", clientId);
      return url.href;
    }

    async function connect({ rotating = false } = {}) {
      if (closed) return;
      // A rotation can only replace a link that already has a credential; without
      // one the replacement would be treated as a stranger claiming the seat.
      if (rotating && !resumeToken) return;
      const protocols = ["neon-snake-v1"];
      if (resumeToken) protocols.push(`resume.${resumeToken}`);
      const nextSocket = new WebSocketImpl(socketUrl(), protocols);
      if (rotating) pendingSocket = nextSocket;
      else socket = nextSocket;
      if (!rotating) readySent = false;
      connectionTimer = setTimeoutImpl(() => {
        connectionTimer = null;
        if (nextSocket === pendingSocket) {
          // The replacement never arrived; keep playing on the old link and try
          // again shortly rather than dropping the seat.
          pendingSocket = null;
          nextSocket.close(4000, "Realtime rotation timed out");
          scheduleRotation();
          return;
        }
        if (socket === nextSocket) nextSocket.close(4000, "Realtime connection timed out");
      }, 8_000);
      nextSocket.addEventListener("open", () => {
        if (!isCurrentSocket(nextSocket) || closed) return;
        if (nextSocket === pendingSocket) return;
        // The backoff resets on welcome, not on open: every server-side refusal
        // (room full, presence unavailable) accepts the socket and then closes
        // it, so resetting here kept clients reconnecting every 250 ms forever.
        onStatus({ state: "socket-open", role, slot, players: roster, waiting, queuePosition });
        scheduleHeartbeat();
      });
      nextSocket.addEventListener("message", (event) => {
        if (!isCurrentSocket(nextSocket) || closed) return;
        if (event.data === "pong") {
          if (nextSocket === pendingSocket) return;
          lastPongAt = now();
          onStatus({
            state: "latency",
            role,
            slot,
            players: roster,
            latency: Math.max(0, lastPongAt - lastPingAt),
            clockOffset,
          });
          return;
        }
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "welcome") {
          if (nextSocket === pendingSocket) {
            // The replacement holds the seat now; retire the outgoing link. Its
            // close is a no-op server-side because the room no longer maps the
            // seat to that connection.
            const retiring = socket;
            pendingSocket = null;
            socket = nextSocket;
            retiring?.close(1000, "Realtime link rotated");
          }
          if (Number.isFinite(Number(message.expiresAt)) && Number(message.expiresAt) > 0) {
            const sentAt = Number(message.sentAt || 0);
            connectionWelcomedAt = now();
            connectionExpiresAt = connectionWelcomedAt + Math.max(0, Number(message.expiresAt) - sentAt);
            connectionClosesAt = Number(message.closesAt) > 0
              ? connectionWelcomedAt + Math.max(0, Number(message.closesAt) - sentAt)
              : 0;
            scheduleRotation();
          }
          if (/^[a-f0-9-]{36}$/.test(message.resumeToken || "")) {
            resumeToken = message.resumeToken;
            try {
              storage?.setItem?.(sessionKey, resumeToken);
            } catch {
              // In-memory reconnect remains available without session storage.
            }
          }
          if (connectionTimer !== null) clearTimeoutImpl(connectionTimer);
          connectionTimer = null;
          failures = 0;
          lastPongAt = now();
          role = message.role === "player" ? "player" : "spectator";
          slot = role === "player" && Number.isInteger(message.slot) ? message.slot : -1;
          waiting = Array.isArray(message.waiting) ? message.waiting : [];
          queuePosition = Number(message.queuePosition) || 0;
          if (role === "player") sendReady();
          emitRoster(message.players);
          onStatus({ state: "connected", role, slot, players: roster, waiting, queuePosition });
          scheduleHeartbeat(750);
          if (active) armStateWatchdog(3_000);
          return;
        }
        if (message.type === "authenticated") {
          return;
        }
        if (message.type === "roster") {
          waiting = Array.isArray(message.waiting) ? message.waiting : [];
          queuePosition = Number(message.queuePosition) || (
            waiting.find((entry) => entry?.id === clientId)?.position || 0
          );
          emitRoster(message.players);
          return;
        }
        if (message.type === "pong") {
          const receivedAt = now();
          lastPongAt = receivedAt;
          const sentAt = Number(message.at);
          const serverAt = Number(message.serverAt);
          const latency = Number.isFinite(sentAt) && Number.isFinite(serverAt)
            ? Math.max(0, receivedAt - sentAt)
            : Math.max(0, receivedAt - lastPingAt);
          if (Number.isFinite(sentAt) && Number.isFinite(serverAt)) {
            clockSamples.push({
              latency,
              offset: serverAt - (sentAt + latency / 2),
            });
            clockSamples.sort((first, second) => first.latency - second.latency);
            if (clockSamples.length > 5) clockSamples.length = 5;
            clockOffset = clockSamples.reduce(
              (total, sample) => total + sample.offset,
              0,
            ) / clockSamples.length;
          }
          onStatus({
            state: "latency",
            role,
            slot,
            players: roster,
            waiting,
            queuePosition,
            latency,
            clockOffset,
          });
          return;
        }
        if (message.type === "countdown-cancel") {
          if (stateTimer !== null) clearTimeoutImpl(stateTimer);
          stateTimer = null;
          activeRound = null;
          onMessage({
            type: "countdown-cancel",
            room: normalizedCode,
            slot: Number.isInteger(message.slot) ? message.slot : -1,
            ...(message.reason === "forfeit" ? { reason: "forfeit" } : {}),
            sentAt: Number(message.sentAt) || now(),
          });
          return;
        }
        if (message.type === "rejected") {
          onStatus({ state: "rejected", role, slot, code: message.code || "invalid_message" });
          return;
        }
        onMessage({
          ...message,
          room: normalizedCode,
        });
        if (
          message.type === "countdown"
          && Number.isSafeInteger(Number(message.round))
          && Number(message.round) === activeRound
        ) {
          const startsAt = Number(message.startsAt);
          // startsAt is server time. Comparing it with the raw local clock made a
          // player whose clock ran 3 s fast time out every round before its
          // first snapshot arrived.
          const serverNow = now() + (typeof clockOffset === "number" ? clockOffset : 0);
          armStateWatchdog(Number.isFinite(startsAt)
            ? Math.max(3_000, startsAt - serverNow + 3_000)
            : 13_000);
        } else if (
          message.type === "state"
          && Number.isSafeInteger(Number(message.state?.round))
          && Number(message.state.round) === activeRound
        ) {
          armStateWatchdog(3_000);
        }
      });
      nextSocket.addEventListener("close", (event) => {
        if (nextSocket === pendingSocket) {
          // The replacement failed to establish; the live link is untouched.
          pendingSocket = null;
          if (!socket) {
            // ...unless the server already retired the live link for it.
            scheduleReconnect();
            return;
          }
          scheduleRotation();
          return;
        }
        if (socket !== nextSocket || closed) return;
        socket = null;
        clearSocketTimers();
        // The server tells the outgoing link its session was replaced as soon as
        // the replacement joins, which can beat the replacement's welcome. That
        // is the handover succeeding, not another tab taking the seat.
        if (event.code === 4001 && pendingSocket) return;
        if (event.code === 4001 || event.code === 4003) {
          closed = true;
          onStatus({
            state: "rejected", role, slot, retryable: false,
            code: event.code === 4003 ? "session_conflict" : "session_replaced",
          });
          return;
        }
        scheduleReconnect();
      });
      nextSocket.addEventListener("error", () => {
        if (socket === nextSocket) nextSocket.close();
      });
    }

    await connect();

    return {
      kind: "vercel-websocket",
      authoritative: true,
      send(message) {
        if (closed) return false;
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          throw new TypeError("A room message object is required.");
        }
        if (message.type === "presence" || message.type === "ready") {
          ready = Boolean(message.ready);
          if (!readySent) return false;
        }
        if (message.type === "leave") return true;
        if (socket?.readyState !== WebSocketImpl.OPEN) return false;
        if (message.type === "presence" || message.type === "ready") return sendReady();
        socket.send(JSON.stringify(message));
        return true;
      },
      setActive(nextActive, round = null) {
        const wasActive = active;
        const previousRound = activeRound;
        active = Boolean(nextActive);
        activeRound = active && Number.isSafeInteger(Number(round))
          ? Number(round)
          : null;
        if (!active) armStateWatchdog();
        else if (!wasActive || previousRound !== activeRound) armStateWatchdog();
        else if (stateTimer === null) armStateWatchdog(3_000);
        if (!active && rotationDue) {
          clearRotateTimer();
          rotate();
        }
        scheduleHeartbeat();
      },
      close() {
        if (closed) return;
        closed = true;
        if (reconnectTimer !== null) clearTimeoutImpl(reconnectTimer);
        reconnectTimer = null;
        clearRotateTimer();
        clearSocketTimers();
        pendingSocket?.close(1000, "Client left room");
        pendingSocket = null;
        socket?.close(1000, "Client left room");
        socket = null;
      },
    };
  }

  // Live rooms run over one same-origin WebSocket. The HTTP polling and
  // BroadcastChannel transports that preceded it were unreachable - the
  // realtime endpoint is always configured - and have been removed.
  const transports = {
    createWebSocketRoomTransport,
    webSocketRoomSupported,
  };

  root.NeonSnakeTransports = transports;
  if (typeof module !== "undefined" && module.exports) module.exports = transports;
})(typeof globalThis !== "undefined" ? globalThis : this);
