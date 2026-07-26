(function exposeRoomTransports(root) {
  "use strict";

  function broadcastRoomSupported(runtime = root) {
    return typeof runtime?.BroadcastChannel === "function";
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

  const transports = {
    broadcastRoomSupported,
    createBroadcastRoomTransport,
  };

  root.NeonSnakeTransports = transports;
  if (typeof module !== "undefined" && module.exports) module.exports = transports;
})(typeof globalThis !== "undefined" ? globalThis : this);
