(function exposeRoomTransports(root) {
  "use strict";

  function broadcastRoomSupported(runtime = root) {
    return typeof runtime?.BroadcastChannel === "function";
  }

  function remoteRoomSupported(runtime = root) {
    return typeof runtime?.fetch === "function";
  }

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
    fetchImpl = root.fetch,
  } = {}) {
    if (typeof code !== "string" || !code.trim()) throw new TypeError("A room code is required.");
    if (typeof clientId !== "string" || !clientId.trim()) throw new TypeError("A client id is required.");
    if (typeof endpoint !== "string" || !/^wss:\/\//i.test(endpoint)) {
      throw new TypeError("A secure realtime endpoint is required.");
    }
    if (typeof onMessage !== "function") throw new TypeError("A message handler is required.");
    if (typeof onStatus !== "function") throw new TypeError("A status handler is required.");
    if (typeof WebSocketImpl !== "function") throw new TypeError("WebSocket is not available.");

    const normalizedCode = code.trim().toUpperCase();
    const baseEndpoint = endpoint.replace(/\/+$/, "");
    let socket = null;
    let closed = false;
    let active = false;
    let ready = false;
    let role = "spectator";
    let slot = -1;
    let roster = [];
    let failures = 0;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let connectionTimer = null;
    let lastPongAt = 0;
    let lastPingAt = 0;
    let identityTicket = "";
    let identityExpiresAt = 0;
    let identityAccepted = false;
    let readySent = false;

    function clearSocketTimers() {
      if (heartbeatTimer !== null) clearTimeoutImpl(heartbeatTimer);
      if (connectionTimer !== null) clearTimeoutImpl(connectionTimer);
      heartbeatTimer = null;
      connectionTimer = null;
    }

    function emitRoster(players) {
      if (!Array.isArray(players)) return;
      roster = players;
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
              avatar: String(player.profile.avatar || "").slice(0, 128),
            }
            : null,
          sentAt: now(),
        });
      });
      onStatus({ state: "synchronized", role, slot, players: roster });
    }

    function scheduleHeartbeat() {
      if (closed) return;
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
          socket.send("ping");
        }
        scheduleHeartbeat();
      }, active ? 5_000 : 15_000);
    }

    function scheduleReconnect() {
      if (closed || reconnectTimer !== null) return;
      clearSocketTimers();
      failures += 1;
      const delay = Math.min(4_000, 250 * 2 ** Math.min(failures - 1, 4));
      onStatus({ state: "reconnecting", role, slot, failures, code: "socket_closed" });
      reconnectTimer = setTimeoutImpl(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }

    function socketUrl() {
      const url = new URL(`${baseEndpoint}/room/${encodeURIComponent(normalizedCode)}`);
      url.searchParams.set("clientId", clientId);
      return url.href;
    }

    async function refreshIdentityTicket() {
      if (typeof fetchImpl !== "function") return;
      try {
        const ticketResponse = await fetchImpl("/api/realtime-ticket", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId }),
        });
        if (!ticketResponse?.ok) return;
        const payload = await ticketResponse.json();
        if (typeof payload?.ticket !== "string") return;
        identityTicket = payload.ticket;
        identityExpiresAt = Number(payload.expiresAt) || 0;
      } catch {
        // Anonymous realtime play remains available if account services are offline.
      }
    }

    async function connect() {
      if (closed) return;
      if (!identityTicket || identityExpiresAt <= now() + 30_000) {
        await refreshIdentityTicket();
      }
      if (closed) return;
      const nextSocket = new WebSocketImpl(socketUrl());
      socket = nextSocket;
      identityAccepted = false;
      readySent = false;
      connectionTimer = setTimeoutImpl(() => {
        connectionTimer = null;
        if (socket === nextSocket) nextSocket.close(4000, "Realtime connection timed out");
      }, 8_000);
      nextSocket.addEventListener("open", () => {
        if (socket !== nextSocket || closed) return;
        failures = 0;
        onStatus({ state: "socket-open", role, slot, players: roster });
        if (identityTicket) {
          nextSocket.send(JSON.stringify({ type: "authenticate", ticket: identityTicket }));
        }
        scheduleHeartbeat();
      });
      nextSocket.addEventListener("message", (event) => {
        if (socket !== nextSocket || closed) return;
        if (event.data === "pong") {
          lastPongAt = now();
          onStatus({
            state: "latency",
            role,
            slot,
            players: roster,
            latency: Math.max(0, lastPongAt - lastPingAt),
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
          if (connectionTimer !== null) clearTimeoutImpl(connectionTimer);
          connectionTimer = null;
          lastPongAt = now();
          role = message.role === "player" ? "player" : "spectator";
          slot = role === "player" && Number.isInteger(message.slot) ? message.slot : -1;
          if (role === "player" && (!identityTicket || identityAccepted)) {
            nextSocket.send(JSON.stringify({ type: "ready", ready }));
            readySent = true;
          }
          emitRoster(message.players);
          onStatus({ state: "connected", role, slot, players: roster });
          return;
        }
        if (message.type === "authenticated") {
          identityAccepted = true;
          if (role === "player" && !readySent) {
            nextSocket.send(JSON.stringify({ type: "ready", ready }));
            readySent = true;
          }
          return;
        }
        if (message.type === "roster") {
          emitRoster(message.players);
          return;
        }
        if (message.type === "pong") {
          lastPongAt = now();
          onStatus({
            state: "latency",
            role,
            slot,
            players: roster,
            latency: Math.max(0, lastPongAt - Number(message.at || lastPongAt)),
          });
          return;
        }
        if (message.type === "countdown-cancel") {
          emitRoster(roster);
          return;
        }
        if (message.type === "rejected") {
          if (
            message.code === "authentication_invalid"
            && role === "player"
            && !readySent
          ) {
            identityTicket = "";
            identityExpiresAt = 0;
            nextSocket.send(JSON.stringify({ type: "ready", ready }));
            readySent = true;
            onStatus({ state: "identity-unavailable", role, slot, players: roster });
            return;
          }
          onStatus({ state: "rejected", role, slot, code: message.code || "invalid_message" });
          return;
        }
        onMessage({
          ...message,
          room: normalizedCode,
        });
      });
      nextSocket.addEventListener("close", () => {
        if (socket !== nextSocket || closed) return;
        socket = null;
        clearSocketTimers();
        scheduleReconnect();
      });
      nextSocket.addEventListener("error", () => {
        if (socket === nextSocket) nextSocket.close();
      });
    }

    await connect();

    return {
      kind: "durable-object-websocket",
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
        socket.send(JSON.stringify(message.type === "presence"
          ? { type: "ready", ready }
          : message));
        return true;
      },
      setActive(nextActive) {
        active = Boolean(nextActive);
        scheduleHeartbeat();
      },
      close() {
        if (closed) return;
        closed = true;
        if (reconnectTimer !== null) clearTimeoutImpl(reconnectTimer);
        reconnectTimer = null;
        clearSocketTimers();
        socket?.close(1000, "Client left room");
        socket = null;
      },
    };
  }

  function createBroadcastRoomTransport({
    code,
    clientId,
    onMessage,
    BroadcastChannelImpl = root.BroadcastChannel,
    now = () => Date.now(),
  } = {}) {
    if (typeof code !== "string" || !code.trim()) {
      throw new TypeError("A room code is required.");
    }
    if (typeof clientId !== "string" || !clientId.trim()) {
      throw new TypeError("A client id is required.");
    }
    if (typeof onMessage !== "function") {
      throw new TypeError("A message handler is required.");
    }
    if (typeof BroadcastChannelImpl !== "function") {
      throw new TypeError("BroadcastChannel is not available.");
    }
    if (typeof now !== "function") {
      throw new TypeError("A clock function is required.");
    }

    const channel = new BroadcastChannelImpl(`neon-snake-duel-${code}`);
    let closed = false;
    const handleMessage = (event) => onMessage(event.data);
    channel.addEventListener("message", handleMessage);

    return {
      kind: "broadcast-channel",
      send(message) {
        if (closed) return false;
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          throw new TypeError("A room message object is required.");
        }
        channel.postMessage({
          ...message,
          from: clientId,
          room: code,
          sentAt: now(),
        });
        return true;
      },
      close() {
        if (closed) return;
        closed = true;
        channel.removeEventListener("message", handleMessage);
        channel.close();
      },
    };
  }

  async function createRemoteRoomTransport({
    code,
    clientId,
    onMessage,
    onStatus = () => {},
    fetchImpl = root.fetch,
    endpoint = "/api/room",
    now = () => Date.now(),
    setTimeoutImpl = root.setTimeout,
    clearTimeoutImpl = root.clearTimeout,
    AbortSignalImpl = root.AbortSignal,
    AbortControllerImpl = root.AbortController,
    requestTimeoutMs = 3_000,
    storage = root.sessionStorage,
  } = {}) {
    if (typeof code !== "string" || !code.trim()) {
      throw new TypeError("A room code is required.");
    }
    if (typeof clientId !== "string" || !clientId.trim()) {
      throw new TypeError("A client id is required.");
    }
    if (typeof onMessage !== "function") {
      throw new TypeError("A message handler is required.");
    }
    if (typeof onStatus !== "function") {
      throw new TypeError("A status handler is required.");
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("Fetch is not available.");
    }
    if (typeof setTimeoutImpl !== "function" || typeof clearTimeoutImpl !== "function") {
      throw new TypeError("Timer functions are required.");
    }
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 500 || requestTimeoutMs > 30_000) {
      throw new TypeError("A request timeout between 500 and 30000 milliseconds is required.");
    }
    if (
      typeof AbortSignalImpl?.timeout !== "function"
      && typeof AbortControllerImpl !== "function"
    ) {
      throw new TypeError("Request cancellation is not available.");
    }

    const normalizedCode = code.trim().toUpperCase();
    const sessionKey = `neon-snake-room-session:${normalizedCode}:${clientId}`;
    const pending = new Map();
    let pendingInputs = [];
    const revisions = {
      state: 0,
      input: 0,
      countdown: 0,
    };
    let session = "";
    let ready = false;
    let role = "spectator";
    let slot = -1;
    let closed = false;
    let active = false;
    let inFlight = false;
    let timer = null;
    let backoffTimer = false;
    let failures = 0;
    let stableResponses = 0;
    let lastResponseFingerprint = "";
    let lastRequestStartedAt = null;
    let roster = [];

    try {
      session = storage?.getItem?.(sessionKey) || "";
    } catch {
      session = "";
    }

    async function request(action, messages = [], keepalive = false) {
      let response;
      let timeoutTimer = null;
      let signal;
      if (action === "join" || action === "sync") lastRequestStartedAt = now();
      if (typeof AbortSignalImpl?.timeout === "function") {
        signal = AbortSignalImpl.timeout(requestTimeoutMs);
      } else {
        const controller = new AbortControllerImpl();
        signal = controller.signal;
        timeoutTimer = setTimeoutImpl(() => controller.abort(), requestTimeoutMs);
      }
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          credentials: "same-origin",
          keepalive,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            room: normalizedCode,
            clientId,
            session,
            ready,
            messages,
          }),
          signal,
        });
        if (!response?.ok) {
          const error = new Error(response?.status === 429
            ? "Room service is busy."
            : "Room service is unavailable.");
          error.status = response?.status;
          error.code = `http_${Number(response?.status) || 0}`;
          error.retryable = response?.status === 429 || response?.status >= 500;
          throw error;
        }
        const data = await response.json();
        if (!data || typeof data !== "object") {
          throw new Error("Room service returned an invalid response.");
        }
        return data;
      } catch (cause) {
        const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
        if (!timedOut && response) throw cause;
        const error = new Error(timedOut
          ? "Room service request timed out."
          : "Room service could not be reached.");
        error.code = timedOut ? "timeout" : "network";
        error.retryable = true;
        throw error;
      } finally {
        if (timeoutTimer !== null) clearTimeoutImpl(timeoutTimer);
      }
    }

    function emitRoster(players) {
      if (!Array.isArray(players)) return;
      players.forEach((player) => {
        if (!player || player.id === clientId) return;
        onMessage({
          type: "presence",
          from: player.id,
          room: normalizedCode,
          ready: Boolean(player.ready),
          slot: Number.isInteger(player.slot) ? player.slot : -1,
          seenAt: Number.isFinite(Number(player.seenAt)) ? Number(player.seenAt) : now(),
          sentAt: now(),
        });
      });
    }

    function responseFingerprint(data) {
      const players = Array.isArray(data.players)
        ? data.players.map((player) => [
          String(player?.id || ""),
          Number.isInteger(player?.slot) ? player.slot : -1,
          Boolean(player?.ready),
        ])
        : [];
      return JSON.stringify([
        data.role === "player" ? "player" : "spectator",
        Number.isInteger(data.slot) ? data.slot : -1,
        Number(data.stateRev) || 0,
        Number(data.inputRev) || 0,
        Number(data.countdownRev) || 0,
        players,
      ]);
    }

    function applyResponse(data, baseline = false, resynchronize = false) {
      const fingerprint = responseFingerprint(data);
      stableResponses = fingerprint === lastResponseFingerprint
        ? Math.min(stableResponses + 1, 3)
        : 0;
      lastResponseFingerprint = fingerprint;
      role = data.role === "player" ? "player" : "spectator";
      slot = role === "player" && Number.isInteger(data.slot) ? data.slot : -1;
      roster = Array.isArray(data.players) ? data.players : [];
      if (role === "player" && typeof data.session === "string" && data.session) {
        session = data.session;
        try {
          storage?.setItem?.(sessionKey, session);
        } catch {
          // Session storage is an optimization; the server still expires abandoned slots.
        }
      }

      onStatus({
        state: "connected",
        role,
        slot,
        players: roster,
      });
      ["countdown", "input", "state"].forEach((type) => {
        const revision = Number(data[`${type}Rev`]) || 0;
        const shouldResynchronize = resynchronize && type === "countdown";
        const shouldEmit = (
          revision > revisions[type] || shouldResynchronize
        ) && data[type] && (!baseline || type === "input");
        if (shouldEmit && type === "input" && Array.isArray(data.input)) {
          data.input.forEach((message) => onMessage(message));
        } else if (shouldEmit) {
          onMessage(data[type]);
        }
        revisions[type] = Math.max(revisions[type], revision);
      });
      emitRoster(data.players);
      onStatus({
        state: "synchronized",
        role,
        slot,
        players: roster,
      });
    }

    function pollDelay() {
      if (active) {
        if (role === "player" && slot === 0) return 70;
        if (role === "player" && slot === 1) return 90;
        return 180;
      }
      if (roster.length >= 2) {
        if (roster.every((player) => Boolean(player?.ready))) return 220;
        return [450, 650, 900, 1_200][stableResponses];
      }
      return [700, 1_000, 1_500, 2_000][stableResponses];
    }

    function remainingPollDelay(delay = pollDelay()) {
      if (!Number.isFinite(lastRequestStartedAt)) return delay;
      return Math.max(0, delay - Math.max(0, now() - lastRequestStartedAt));
    }

    function schedule(delay = remainingPollDelay(), isBackoff = false) {
      if (closed || timer !== null) return;
      backoffTimer = isBackoff;
      timer = setTimeoutImpl(async () => {
        timer = null;
        backoffTimer = false;
        await sync();
      }, delay);
    }

    function reschedule(delay = pollDelay(), isBackoff = false) {
      if (closed) return;
      if (timer !== null) clearTimeoutImpl(timer);
      timer = null;
      backoffTimer = false;
      schedule(delay, isBackoff);
    }

    function hasPendingMessages() {
      return pendingInputs.length > 0 || pending.size > 0;
    }

    async function join(baseline = true) {
      const data = await request("join");
      applyResponse(data, baseline);
      schedule();
    }

    async function sync() {
      if (closed || inFlight) return;
      inFlight = true;
      const outgoing = [...pendingInputs, ...pending.values()];
      pendingInputs = [];
      pending.clear();
      try {
        const data = await request("sync", outgoing);
        const recovered = failures > 0;
        failures = 0;
        if (role === "player" && data.role !== "player") {
          await join(false);
        } else {
          applyResponse(data, false, recovered);
        }
      } catch (error) {
        if (error?.retryable !== false) {
          const existingInputSequences = new Set(pendingInputs.map((message) => message.sequence));
          const retryInputs = outgoing.filter((message) => (
            message.type === "input" && !existingInputSequences.has(message.sequence)
          ));
          pendingInputs = [...retryInputs, ...pendingInputs];
          outgoing.filter((message) => message.type !== "input").forEach((message) => {
            if (!pending.has(message.type)) pending.set(message.type, message);
          });
        }
        failures += 1;
        onStatus({
          state: error?.retryable === false ? "rejected" : "reconnecting",
          role,
          slot,
          failures,
          code: error?.code || "unknown",
        });
        schedule(error?.status === 429
          ? 1_000
          : error?.retryable === false
            ? 1_000
            : Math.min(2_500, 300 * 2 ** failures), true);
      } finally {
        inFlight = false;
        schedule(hasPendingMessages() ? 0 : remainingPollDelay());
      }
    }

    await join(true);

    return {
      kind: "vercel-redis",
      send(message) {
        if (closed) return false;
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          throw new TypeError("A room message object is required.");
        }
        if (message.type === "presence" || message.type === "ready") {
          ready = Boolean(message.ready);
        } else if (message.type === "input") {
          pendingInputs.push(message);
        } else if (message.type !== "leave") {
          pending.set(message.type, message);
        }
        if (!inFlight && !backoffTimer) reschedule(0);
        return true;
      },
      setActive(nextActive) {
        const changed = active !== Boolean(nextActive);
        active = Boolean(nextActive);
        if (changed && !inFlight && !backoffTimer) {
          reschedule(active ? 0 : remainingPollDelay());
        }
      },
      close() {
        if (closed) return;
        closed = true;
        if (timer !== null) clearTimeoutImpl(timer);
        timer = null;
        backoffTimer = false;
        void fetchImpl(endpoint, {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "leave",
            room: normalizedCode,
            clientId,
            session,
            ready: false,
            messages: [],
          }),
        }).catch(() => {});
      },
    };
  }

  const transports = {
    broadcastRoomSupported,
    createBroadcastRoomTransport,
    createRemoteRoomTransport,
    createWebSocketRoomTransport,
    remoteRoomSupported,
    webSocketRoomSupported,
  };

  root.NeonSnakeTransports = transports;
  if (typeof module !== "undefined" && module.exports) module.exports = transports;
})(typeof globalThis !== "undefined" ? globalThis : this);
