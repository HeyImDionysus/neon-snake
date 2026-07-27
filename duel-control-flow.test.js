"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "public", "duel.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public", "duel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "duel.css"), "utf8");

function functionBody(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected function ${name}`);
  const brace = script.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1;
    if (script[index] === "}") depth -= 1;
    if (depth === 0) return script.slice(brace + 1, index);
  }
  throw new Error(`Unclosed function ${name}`);
}

function functionSource(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected function ${name}`);
  const brace = script.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1;
    if (script[index] === "}") depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

function installFunctions(names, context) {
  vm.runInNewContext(
    `${names.map(functionSource).join("\n")}
this.exports = { ${names.join(", ")} };`,
    context,
  );
  return context.exports;
}

const tests = [
  ["duel page IDs are unique", () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, new Set(ids).size);
  }],
  ["both duel types share the expanded logical arena", () => {
    assert.match(script, /const DUEL_GRID = Rules\.duelGridSize\(20\)/);
    assert.match(script, /tileSize = canvas\.width \/ DUEL_GRID/);
    assert.match(html, /30 × 30/);
    assert.match(styles, /\.duel-board/);
  }],
  ["Autopilot duel starts only from an explicit player action", () => {
    assert.match(script, /aiButton\.addEventListener\("click", prepareAiDuel\)/);
    assert.ok(!script.slice(script.lastIndexOf("hydrateRoomCode()")).includes("prepareAiDuel()"));
    assert.match(functionBody("prepareAiDuel"), /beginCountdown/);
  }],
  ["Autopilot decisions account for both snakes", () => {
    const body = functionBody("chooseAiDirection");
    assert.match(body, /Rules\.evaluateDuelMoves/);
    assert.match(body, /opponentSnake: playerSnake/);
    assert.match(body, /score: opponentScore/);
    assert.match(body, /opponentScore: playerScore/);
  }],
  ["the renderer draws both fluid snakes", () => {
    const body = functionBody("render");
    assert.match(body, /drawFluidSnake\(playerSnake/);
    assert.match(body, /drawFluidSnake\(opponentSnake/);
    assert.match(functionBody("drawFluidSnake"), /Rules\.fluidMotionPath/);
  }],
  ["the renderer advances simulation before sampling interpolated motion", () => {
    const body = functionBody("render");
    assert.ok(body.indexOf("advanceGame(now)") < body.indexOf("drawArena(now)"));
  }],
  ["Autopilot and live duels preserve two rapid turns in order", () => {
    const request = functionBody("requestDirection");
    assert.match(request, /Rules\.bufferDirection\(playerInputBuffer, playerDirection, next\)/);
    assert.match(request, /Rules\.bufferDirection\(opponentInputBuffer, opponentDirection, next\)/);
    assert.match(functionBody("tickAi"), /Rules\.consumeDirectionBuffer\(playerInputBuffer, playerDirection\)/);
    assert.match(functionBody("tickLiveHost"), /Rules\.consumeDirectionBuffer\(opponentInputBuffer, opponentDirection\)/);
    assert.match(functionBody("requestDirection"), /sequence: localInputSequence/);
    assert.match(functionBody("requestDirection"), /round: liveRoundId/);
    assert.match(functionBody("broadcastSnapshot"), /guestInputAck/);
    assert.match(functionBody("broadcastSnapshot"), /round: liveRoundId/);
    assert.match(functionBody("applyRemoteSnapshot"), /opponentInputSequences\[0\] <= acknowledged/);
    assert.match(functionBody("handleRoomMessage"), /round !== liveRoundId/);
  }],
  ["live rooms remain waiting until two connected players are ready", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /Rules\.liveRoomPhase\(participants\)/);
    assert.match(body, /phase === "waiting"/);
    assert.match(body, /phase === "ready"/);
    assert.match(body, /phase === "countdown"/);
    assert.match(body, /beginLiveCountdown/);
    const countdown = functionBody("beginLiveCountdown");
    assert.match(countdown, /round <= liveRoundId/);
    assert.match(countdown, /clearInterval\(liveCountdownTimer\)/);
  }],
  ["live countdown requires an authoritative healthy-room gate", () => {
    const context = {
      roomConnected: true,
      roomConnectionState: "connected",
      roomPlayers: [
        { connected: true, ready: true },
        { connected: true, ready: true },
      ],
      Rules: {
        liveRoomPhase(participants) {
          if (participants.length !== 2) return "waiting";
          return participants.every((participant) => participant.ready)
            ? "countdown"
            : "ready";
        },
      },
    };
    const { liveRoomGateOpen } = installFunctions(["liveRoomGateOpen"], context);
    assert.equal(liveRoomGateOpen(), true);
    context.roomConnectionState = "reconnecting";
    assert.equal(liveRoomGateOpen(), false);
    context.roomConnectionState = "connected";
    context.roomPlayers[1].ready = false;
    assert.equal(liveRoomGateOpen(), false);
    context.roomPlayers[1].ready = true;
    context.roomConnected = false;
    assert.equal(liveRoomGateOpen(), false);

    assert.match(functionBody("syncLiveRoom"), /liveRoomGateOpen\(\)/);
    assert.match(functionBody("beginLiveCountdown"), /liveRoomGateOpen\(\)/);
    assert.match(functionBody("startLiveDuel"), /liveRoomGateOpen\(\)/);
  }],
  ["server roster responses reconcile the local Ready signal", () => {
    const context = {
      clientId: "local-player",
      roomReady: true,
      roomReadyConfirmed: true,
      roomRole: "player",
    };
    const { reconcileLocalRoomReady } = installFunctions(
      ["reconcileLocalRoomReady"],
      context,
    );
    reconcileLocalRoomReady([
      { id: "local-player", ready: false },
      { id: "remote-player", ready: true },
    ]);
    assert.equal(context.roomReady, false);
    assert.equal(context.roomReadyConfirmed, false);
    context.roomRole = "spectator";
    reconcileLocalRoomReady([{ id: "local-player", ready: true }]);
    assert.equal(context.roomReady, false);
    assert.equal(context.roomReadyConfirmed, false);
    assert.match(functionBody("roomIdentity"), /ready: roomReadyConfirmed/);
    assert.match(functionBody("handleRoomStatus"), /reconcileLocalRoomReady\(status\.players\)/);
  }],
  ["live-room transport is explicitly identified as public cross-device play", () => {
    assert.match(html, /PUBLIC LIVE ROOM/);
    assert.match(html, /room-transport\.js/);
    assert.match(script, /Transports\.createRemoteRoomTransport/);
    assert.match(script, /async function connectLiveRoom/);
    assert.ok(!script.includes("new BroadcastChannel"));
  }],
  ["server-assigned player slots determine the live-room roster and host", () => {
    assert.match(script, /let roomRole = "disconnected"/);
    assert.match(script, /let roomSlot = -1/);
    assert.match(functionBody("roomIdentity"), /slot: roomSlot/);
    const roster = functionBody("activeRoomRoster");
    assert.match(roster, /first\.slot - second\.slot/);
    assert.match(roster, /roomRole === "player"/);
    assert.match(functionBody("handleRoomMessage"), /slot: Number\.isInteger\(message\.slot\)/);
    assert.match(functionBody("handleRoomMessage"), /message\.seenAt/);
  }],
  ["network recovery is visible and cannot silently masquerade as a healthy room", () => {
    const status = functionBody("handleRoomStatus");
    assert.match(status, /reconnecting/);
    assert.match(status, /ROOM LINK RECONNECTING/);
    assert.match(status, /ROOM UPDATE REJECTED/);
    assert.match(status, /roomConnectionState/);
    assert.match(status, /roomPeers = new Map\(status\.players/);
    assert.match(status, /if \(roomTransport\) syncLiveRoom\(\)/);
    assert.match(functionBody("disconnectLiveRoom"), /roomConnectionState = "disconnected"/);
  }],
  ["live countdown aborts if either player disconnects", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /abortLiveCountdown/);
    assert.match(body, /liveCountdownActive/);
  }],
  ["the transport owns presence cadence without a duplicate page heartbeat", () => {
    const body = functionBody("handleRoomMessage");
    const branch = body.match(/if \(message\.type === "presence" \|\| message\.type === "ready"\) \{([^]*?)\n  \}/);
    assert.ok(branch, "Expected a presence/ready branch");
    assert.ok(!branch[1].includes("announcePresence()"));
    assert.ok(!script.includes("setInterval(announcePresence"));
  }],
  ["connected live players get an accurate ready-gate overlay", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /BOTH CONNECTED/);
    assert.match(body, /READY WHEN<br><em>YOU ARE/);
    assert.match(body, /runState === "ready"/);
  }],
  ["an active live duel replaces the stale countdown room label", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(
      body,
      /phase === "countdown"\)[\s\S]*runState === "running"[\s\S]*\? "LIVE DUEL ACTIVE"/,
    );
    assert.match(functionBody("startLiveDuel"), /roomState\.textContent = "LIVE DUEL ACTIVE"/);
  }],
  ["Autopilot duels expose visible desktop pause and restart controls", () => {
    assert.match(html, /id="duelPauseDesktop"/);
    assert.match(html, /id="duelRestartButton"/);
    const state = functionBody("setRunState");
    assert.match(state, /pauseButton\.disabled = !pausable/);
    assert.match(state, /pauseDesktop\.disabled = !pausable/);
    assert.match(state, /aiButton\.hidden = duelType !== "ai" \|\| state !== "ready"/);
    assert.match(state, /restartButton\.hidden = duelType !== "ai" \|\| state === "ready" \|\| state === "countdown"/);
    assert.match(script, /pauseDesktop\.addEventListener\("click", togglePause\)/);
    assert.match(script, /restartButton\.addEventListener\("click", prepareAiDuel\)/);
  }],
  ["a connected room locks its Signal Code", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /roomCodeInput\.disabled = roomConnected/);
  }],
  ["a third participant is explicitly treated as a spectator", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /ROOM FULL · SPECTATING/);
    assert.match(body, /roomFull/);
    assert.match(body, /SPECTATOR/);
    const hud = functionBody("updateHud");
    assert.match(hud, /PLAYER 1/);
    assert.match(hud, /PLAYER 2/);
  }],
  ["duel tabs support standard arrow-key navigation", () => {
    const body = functionBody("handleTabKey");
    assert.match(body, /ArrowLeft/);
    assert.match(body, /ArrowRight/);
    assert.match(body, /Home/);
    assert.match(body, /End/);
    assert.match(script, /aiTab\.addEventListener\("keydown", handleTabKey\)/);
    assert.match(script, /liveTab\.addEventListener\("keydown", handleTabKey\)/);
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic duel control-flow tests passed.\n`);
