(function exposeRoomTransports(root) {
  "use strict";

  function broadcastRoomSupported(runtime = root) {
    return typeof runtime?.BroadcastChannel === "function";
  }

  function remoteRoomSupported(runtime = root) {
    return typeof runtime?.fetch === "function";
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

    const normalizedCode = code.trim().toUpperCase();
    const sessionKey = `neon-snake-room-session:${normalizedCode}:${clientId}`;
    const pending = new Map();
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
    let failures = 0;

    try {
      session = storage?.getItem?.(sessionKey) || "";
    } catch {
      session = "";
    }

    async function request(action, messages = [], keepalive = false) {
      const response = await fetchImpl(endpoint, {
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
      });
      if (!response?.ok) {
        const error = new Error(response?.status === 429
          ? "Room service is busy."
          : "Room service is unavailable.");
        error.status = response?.status;
        throw error;
      }
      const data = await response.json();
      if (!data || typeof data !== "object") {
        throw new Error("Room service returned an invalid response.");
      }
      return data;
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

    function applyResponse(data, baseline = false) {
      role = data.role === "player" ? "player" : "spectator";
      slot = role === "player" && Number.isInteger(data.slot) ? data.slot : -1;
      if (role === "player" && typeof data.session === "string" && data.session) {
        session = data.session;
        try {
          storage?.setItem?.(sessionKey, session);
        } catch {
          // Session storage is an optimization; the server still expires abandoned slots.
        }
      }

      emitRoster(data.players);
      ["state", "input", "countdown"].forEach((type) => {
        const revision = Number(data[`${type}Rev`]) || 0;
        if (!baseline && revision > revisions[type] && data[type]) {
          onMessage(data[type]);
        }
        revisions[type] = Math.max(revisions[type], revision);
      });
      onStatus({
        state: "connected",
        role,
        slot,
        players: Array.isArray(data.players) ? data.players : [],
      });
    }

    function schedule(delay = active ? 80 : 600) {
      if (closed || timer !== null) return;
      timer = setTimeoutImpl(async () => {
        timer = null;
        await sync();
      }, delay);
    }

    async function join(baseline = true) {
      const data = await request("join");
      applyResponse(data, baseline);
      schedule();
    }

    async function sync() {
      if (closed || inFlight) return;
      inFlight = true;
      const outgoing = [...pending.values()];
      pending.clear();
      try {
        const data = await request("sync", outgoing);
        failures = 0;
        if (role === "player" && data.role !== "player") {
          await join(false);
        } else {
          applyResponse(data);
        }
      } catch (error) {
        outgoing.forEach((message) => {
          if (!pending.has(message.type)) pending.set(message.type, message);
        });
        failures += 1;
        onStatus({
          state: "reconnecting",
          role,
          slot,
          failures,
        });
        schedule(error?.status === 429 ? 1_000 : Math.min(2_500, 300 * 2 ** failures));
      } finally {
        inFlight = false;
        schedule();
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
        } else if (message.type !== "leave") {
          pending.set(message.type, message);
        }
        schedule(0);
        return true;
      },
      setActive(nextActive) {
        active = Boolean(nextActive);
        if (active) {
          if (timer !== null) clearTimeoutImpl(timer);
          timer = null;
          schedule(0);
        }
      },
      close() {
        if (closed) return;
        closed = true;
        if (timer !== null) clearTimeoutImpl(timer);
        timer = null;
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
    remoteRoomSupported,
  };

  root.NeonSnakeTransports = transports;
  if (typeof module !== "undefined" && module.exports) module.exports = transports;
})(typeof globalThis !== "undefined" ? globalThis : this);
