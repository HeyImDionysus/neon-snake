"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("public/duel.js", "utf8");
const handler = source.slice(source.indexOf("function handleRoomStatus("), source.indexOf("function updateAuthoritativeRoomRole("));
for (const code of ["session_conflict", "session_replaced"]) {
  let disconnected = 0;
  let overlay = [];
  const context = {
    roomConnectionState: "connected", roomConnected: true,
    roomState: { textContent: "" }, roomLatency: { textContent: "" },
    announcement: { textContent: "" },
    pendingCountdownRound: 42, pendingCountdownExpiresAt: 50,
    pendingCountdownAttempts: 0, liveCountdownActive: false,
    disconnectLiveRoom() { disconnected += 1; context.roomConnected = false; },
    showOverlay(...args) { overlay = args; },
  };
  vm.runInNewContext(`${handler}; handleRoomStatus({state:"rejected",retryable:false,code:${JSON.stringify(code)}});`, context);
  assert.equal(disconnected, 1, "terminal session rejection must release the broken transport and enable reconnect");
  assert.equal(context.roomConnected, false);
  assert.doesNotMatch(context.roomState.textContent, /RETRYING/);
  assert.match(context.announcement.textContent, /tab|session/i);
  assert.ok(overlay.length, "show a recoverable session error at the game board");
  console.log(`PASS ${code} stops reconnecting and explains how to recover`);
}
