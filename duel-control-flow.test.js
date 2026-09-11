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
  const brace = script.indexOf(") {", start) + 2;
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
  const brace = script.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = brace; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1;
    if (script[index] === "}") depth -= 1;
    if (depth === 0) return script.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

function constantSource(name) {
  const match = script.match(new RegExp(`^const ${name} = .*;$`, "m"));
  assert.ok(match, `Expected constant ${name}`);
  return match[0];
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
  ["AI duels pause when hidden while live rounds keep server ownership", () => {
    for (const duelType of ["ai", "live"]) {
      const context = {
        document: { hidden: true }, duelType, runState: "running", frameHandle: 5,
        cancelAnimationFrame() {}, togglePause() { context.runState = "paused"; },
      };
      const { handleVisibilityChange } = installFunctions(["handleVisibilityChange"], context);
      handleVisibilityChange();
      assert.equal(context.runState, duelType === "ai" ? "paused" : "running");
      assert.equal(context.frameHandle, null);
    }
  }],
  ["AI duel countdown resumes from its suspended step after the page returns", () => {
    const timers = [];
    const context = {
      document: { hidden: false }, duelType: "ai", runState: "ready", frameHandle: null,
      countdownTimer: null, countdownStep: 0, countdownSuspended: false,
      overlay: {}, aiStartButton: {}, overlayKicker: {}, overlayTitle: { classList: { add() {} } },
      overlayMessage: {}, announcement: {},
      setRunState(state) { context.runState = state; },
      setTimeout(callback) { timers.push(callback); return timers.length; },
      clearTimeout(id) { if (id) timers[id - 1] = null; },
      startAiDuel() { context.runState = "running"; },
      startRendering() {}, cancelAnimationFrame() {},
    };
    const { beginCountdown, handleVisibilityChange } = installFunctions(["beginCountdown", "handleVisibilityChange"], context);
    beginCountdown(2);
    context.document.hidden = true;
    handleVisibilityChange();
    assert.equal(timers[0], null);
    assert.equal(context.countdownSuspended, true);
    assert.equal(context.runState, "countdown");
    context.document.hidden = false;
    handleVisibilityChange();
    assert.equal(context.countdownStep, 2);
    assert.equal(context.countdownSuspended, false);
    timers[1]();
    assert.equal(context.countdownStep, 1);
    timers[2]();
    assert.equal(context.runState, "running");
  }],
  ["live duel results use the local seat and identify spectator winners", () => {
    for (const [clientId, winner, expectedLabel, expectedAnnouncement] of [
      ["seat-one", "player", "YOU WIN", "You won the duel."],
      ["seat-two", "opponent", "YOU WIN", "You won the duel."],
      ["seat-two", "player", "RIVAL WINS", "Your rival won the duel."],
      ["viewer", "opponent", "PLAYER 2 WINS", "Player 2 won the duel."],
    ]) {
      const context = {
        duelType: "live", clientId, roomPlayers: [{ id: "seat-one" }, { id: "seat-two" }],
        liveCountdownTimer: 9, liveCountdownActive: true, clearInterval() {},
        announcement: {}, setRunState(state, label) { context.runState = state; context.label = label; },
        showOverlay() {}, setRoomReadyIntent() {}, postRoomMessage() {}, syncLiveRoom() {},
      };
      const { endDuel } = installFunctions(["endDuel"], context);
      endDuel(winner);
      assert.equal(context.label, expectedLabel);
      assert.equal(context.announcement.textContent, expectedAnnouncement);
      assert.equal(context.liveCountdownActive, false);
      assert.equal(context.liveCountdownTimer, null);
    }
  }],
  ["a rejected frame that is not a countdown request never closes the room gate", () => {
    const base = () => ({
      roomConnected: true,
      roomConnectionState: "connected",
      pendingCountdownRound: 0,
      pendingCountdownExpiresAt: 0,
      pendingCountdownAttempts: 0,
      liveCountdownActive: false,
      roomState: { textContent: "" },
      roomLatency: { textContent: "" },
      announcement: { textContent: "" },
      roomPlayers: [],
      liveLatencyMs: 0,
      liveClockOffsetMs: 0,
      Number, Math, Boolean, Array,
      abortLiveCountdown() { this.liveCountdownActive = false; },
      disconnectLiveRoom() { this.disconnected = true; },
      showOverlay() {},
      updateHud() {},
    });

    // The server rotates the losing player out of their seat, so the Ready that
    // endDuel already sent arrives from a connection that no longer holds one.
    const rotated = base();
    const { handleRoomStatus } = installFunctions(["handleRoomStatus"], rotated);
    handleRoomStatus({ state: "rejected", code: "invalid_message" });
    assert.equal(rotated.roomConnectionState, "connected",
      "a stray rejected frame must not degrade the room link");
    assert.equal(rotated.disconnected, undefined);

    // A rejected countdown request is real information and does gate the room,
    // but it must heal as soon as the server proves the link works.
    const countdown = base();
    countdown.pendingCountdownRound = 7;
    const gate = installFunctions(["handleRoomStatus"], countdown);
    gate.handleRoomStatus({ state: "rejected", code: "invalid_message" });
    assert.equal(countdown.roomConnectionState, "degraded");
    assert.equal(countdown.pendingCountdownRound, 0);
    gate.handleRoomStatus({ state: "latency", latency: 42 });
    assert.equal(countdown.roomConnectionState, "connected",
      "a healthy pong must clear a degraded room");
  }],
  ["duel shortcuts preserve room typing, native controls, and browser commands", () => {
    const calls = [];
    const context = {
      DIRECTIONS: { up: "up", down: "down", left: "left", right: "right" },
      duelType: "ai",
      requestDirection(direction) { calls.push(direction); },
      togglePause() { calls.push("pause"); },
      prepareAiDuel() { calls.push("restart"); },
    };
    vm.runInNewContext(
      [constantSource("TEXT_ENTRY_SELECTOR"), constantSource("NATIVE_ACTIVATION_SELECTOR")]
        .map((declaration) => declaration.replace(/^const /, "this."))
        .join(" "),
      context,
    );
    const { handleKeyboard } = installFunctions(["handleKeyboard"], context);
    // Mirrors Element.closest: a selector list matches when any of its parts
    // names this element's tag.
    const element = (tag) => ({
      closest(selector) {
        return selector.split(",").some((part) => part.trim().split(/[[:.]/)[0] === tag) ? {} : null;
      },
    });
    const event = (key, extra = {}) => ({
      key, target: element("body"),
      preventDefault() { calls.push("prevented"); }, ...extra,
    });

    // Typing a room code must reach the input: the Signal alphabet contains
    // A, D, R, S and W.
    for (const key of ["w", "a", "s", "d", "r", " "]) {
      handleKeyboard(event(key, { target: element("input") }));
    }
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }, { isComposing: true }]) {
      handleKeyboard(event("r", extra));
    }
    handleKeyboard(event("w", { target: { isContentEditable: true, closest() { return null; } } }));
    handleKeyboard(event(" ", { repeat: true }));
    handleKeyboard(event("r", { repeat: true }));
    assert.deepEqual(calls, [], "typing and native shortcuts must not mutate the duel");

    handleKeyboard(event("w"));
    handleKeyboard(event(" "));
    handleKeyboard(event("r"));
    assert.deepEqual(calls, ["prevented", "up", "prevented", "pause", "prevented", "restart"]);

    // Clicking Ready with the mouse leaves that button focused; steering and
    // restart must still work, while Space keeps its native activation.
    calls.length = 0;
    handleKeyboard(event("arrowup", { target: element("button") }));
    handleKeyboard(event("d", { target: element("button") }));
    handleKeyboard(event("r", { target: element("button") }));
    handleKeyboard(event(" ", { target: element("button") }));
    assert.deepEqual(
      calls,
      ["prevented", "up", "prevented", "right", "prevented", "restart"],
      "a focused control must never swallow duel steering",
    );
  }],
  ["repeated Activity authentication failure restores an actionable retry state", () => {
    const context = {
      activityContext: { classList: { add(value) { context.errorClass = value; } } },
      activityContextTitle: { textContent: "" },
      activityContextDetail: { textContent: "" },
      activityContextRetry: { hidden: true, disabled: true },
      roomState: { textContent: "" },
      connectRoomButton: { disabled: false },
      hydrateRoomCode() { return false; },
      liveRoomRequested() { return false; },
      switchDuelType(value) { context.duelType = value; },
    };
    const { renderActivityFailure } = installFunctions(["renderActivityFailure"], context);
    renderActivityFailure(new Error("Synthetic retry failure."));
    assert.equal(context.errorClass, "is-error");
    assert.match(context.activityContextTitle.textContent, /DISCORD LINK OFFLINE/);
    assert.match(context.activityContextDetail.textContent, /Synthetic retry failure/);
    assert.equal(context.activityContextRetry.hidden, false);
    assert.equal(context.activityContextRetry.disabled, false);
    assert.equal(context.connectRoomButton.disabled, true);
    assert.equal(context.duelType, "ai");
    assert.match(script, /catch \(error\) \{\s*renderActivityFailure\(error\);\s*\}\s*\}\);/);
    assert.doesNotMatch(functionBody("initializeDuelSurface"), /addEventListener/);
  }],
  ["Activity authentication failure preserves an explicit Live Room request", () => {
    const context = {
      activityContext: { classList: { add() {} } },
      activityContextTitle: { textContent: "" },
      activityContextDetail: { textContent: "" },
      activityContextRetry: { hidden: true, disabled: true },
      roomState: { textContent: "" },
      connectRoomButton: { disabled: false },
      hydrateRoomCode() { return false; },
      liveRoomRequested() { return true; },
      switchDuelType(value) { context.duelType = value; },
    };
    const { renderActivityFailure } = installFunctions(["renderActivityFailure"], context);
    renderActivityFailure(new Error("Synthetic authentication failure."));
    assert.equal(context.duelType, "live");
    assert.equal(context.roomState.textContent, "ACTIVITY AUTHENTICATION FAILED");
  }],
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
    assert.match(body, /drawFluidSnake\(\s*playerSnake/);
    assert.match(body, /drawFluidSnake\(\s*opponentSnake/);
    assert.match(functionBody("drawFluidSnake"), /Rules\.fluidMotionPath/);
  }],
  ["the renderer advances simulation before sampling interpolated motion", () => {
    const body = functionBody("render");
    assert.ok(body.indexOf("advanceGame(now)") < body.indexOf("drawArena(now)"));
  }],
  ["the first arena draw builds a matching cached backdrop even without a resize", () => {
    const context = {
      DUEL_GRID: 30,
      activityEmbedded: false,
      ACTIVITY_PIXEL_RATIO_CAP: 1.25,
      canvas: { width: 300, height: 150 },
      arenaBackdrop: { width: 300, height: 150 },
      arenaBackdropBuilt: false,
      board: { getBoundingClientRect: () => ({ width: 300 }) },
      window: { devicePixelRatio: 1 },
      tileSize: 0,
      buildCount: 0,
      buildArenaBackdrop() {
        context.buildCount += 1;
        context.arenaBackdropBuilt = true;
      },
    };
    const { resizeCanvas } = installFunctions(["resizeCanvas"], context);
    resizeCanvas();
    assert.equal(context.buildCount, 1);
    assert.equal(context.arenaBackdropBuilt, true);
    assert.equal(context.arenaBackdrop.width, context.canvas.width);
    assert.equal(context.arenaBackdrop.height, context.canvas.height);
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
    assert.match(functionBody("applyRemoteSnapshot"), /state\.playerInputAck/);
    assert.match(functionBody("applyRemoteSnapshot"), /localSequences\[0\] <= acknowledged/);
    assert.match(functionBody("applyRemoteSnapshot"), /networkInterpolationOffset/);
    assert.match(functionBody("advanceGame"), /tickPredictedLive/);
    assert.match(functionBody("render"), /previewDirection/);
    assert.match(functionBody("advanceGame"), /roomTransport\?\.authoritative/);
    assert.match(functionBody("handleRoomMessage"), /round !== liveRoundId/);
  }],
  ["queued viewers apply snapshots and receive results even during a delayed countdown", () => {
    const context = {
      authoritativeOpponentSnake: [],
      authoritativePlayerSnake: [],
      clientId: "queued-viewer",
      cloneSnake(snake) {
        return snake.map((point) => ({ ...point }));
      },
      liveClockOffsetMs: null,
      liveLatencyMs: 0,
      TICK_DURATION: 138,
      lastMoveAt: 900,
      lastRemoteSequence: -1,
      liveRoundId: 7,
      nextMoveAt: 0,
      opponentDirection: { x: -1, y: 0 },
      opponentInputBuffer: [],
      opponentInputSequences: [],
      opponentPredictionIndex: 0,
      opponentScore: 0,
      playerDirection: { x: 1, y: 0 },
      playerInputBuffer: [],
      playerInputSequences: [],
      playerPredictionIndex: 0,
      playerScore: 0,
      roomPlayers: [
        { id: "seat-one", slot: 0 },
        { id: "seat-two", slot: 1 },
      ],
      roomTransport: { authoritative: true },
      runState: "running",
      updateHud() {
        context.updated = true;
      },
      networkInterpolationOffset() {
        return 50;
      },
      performance: { now: () => 1_000 },
      Date: { now: () => 2_000 },
      state: {},
    };
    const { applyRemoteSnapshot } = installFunctions(["applyRemoteSnapshot"], context);
    const snapshot = {
      sequence: 1,
      sentAt: 1_950,
      state: {
        round: 7,
        playerSnake: [{ x: 1, y: 1 }],
        opponentSnake: [{ x: 4, y: 4 }],
        playerDirection: { x: 1, y: 0 },
        opponentDirection: { x: -1, y: 0 },
        playerInputAck: 0,
        guestInputAck: 0,
        playerScore: 2,
        opponentScore: 3,
        food: { x: 8, y: 8 },
        signalCursor: 11,
        over: false,
      },
    };
    applyRemoteSnapshot(snapshot);
    assert.equal(context.lastRemoteSequence, 1);
    assert.equal(context.playerSnake[0].x, 1);
    assert.equal(context.opponentSnake[0].x, 4);
    assert.equal(context.updated, true);
    context.runState = "countdown";
    const endings = [];
    context.endDuel = (winner) => { endings.push(winner); context.runState = "over"; };
    snapshot.sequence = 2;
    snapshot.state.over = true;
    snapshot.state.winner = "opponent";
    applyRemoteSnapshot(snapshot);
    assert.deepEqual(endings, ["opponent"], "an authoritative result must survive throttled countdown timers");
    assert.equal(context.nextMoveAt, 0);
    snapshot.sequence = 3;
    applyRemoteSnapshot(snapshot);
    assert.deepEqual(endings, ["opponent"], "a repeated terminal snapshot must not end the round twice");
  }],
  ["live interpolation subtracts transit time instead of replaying a full delayed tick", () => {
    const context = { TICK_DURATION: 138 };
    const { networkInterpolationOffset } = installFunctions(
      ["networkInterpolationOffset"],
      context,
    );
    assert.equal(networkInterpolationOffset(1_000, 1_060, 180), 60);
    assert.equal(networkInterpolationOffset(2_000, 1_900, 180), 90);
    assert.equal(networkInterpolationOffset(1_000, 2_000, 180), 122);
    assert.match(functionBody("handleRoomStatus"), /PREDICTION ON/);
  }],
  ["authoritative rosters do not expire from a server clock timestamp", () => {
    const context = {
      PEER_TIMEOUT: 6_000,
      roomTransport: { authoritative: true },
      roomConnected: true,
      roomRole: "player",
      roomPeers: new Map([[
        "remote-player",
        { id: "remote-player", connected: true, slot: 1, seenAt: 1 },
      ]]),
      roomIdentity() {
        return { id: "local-player", connected: true, slot: 0 };
      },
    };
    const { activeRoomRoster } = installFunctions(["activeRoomRoster"], context);
    assert.equal(
      Array.from(activeRoomRoster(), (player) => player.id).join(","),
      "local-player,remote-player",
    );
    context.roomTransport = { kind: "broadcast-channel" };
    assert.equal(
      Array.from(activeRoomRoster(), (player) => player.id).join(","),
      "local-player",
    );
  }],
  ["live rooms remain waiting until two connected players are ready", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /Rules\.liveRoomPhase\(participants\)/);
    assert.match(body, /phase === "waiting"/);
    assert.match(body, /phase === "ready"/);
    assert.match(body, /phase === "countdown"/);
    assert.match(body, /beginLiveCountdown/);
    const countdown = functionBody("beginLiveCountdown");
    assert.match(countdown, /round < liveRoundId/);
    assert.match(countdown, /round === liveRoundId && runState !== "ready"/);
    assert.match(countdown, /clearInterval\(liveCountdownTimer\)/);
    const sync = functionBody("syncLiveRoom");
    assert.match(sync, /pendingCountdownRound/);
    assert.match(sync, /pendingCountdownExpiresAt/);
    assert.match(sync, /pendingCountdownAttempts >= 2/);
  }],
  ["an interrupted client can resume the authoritative countdown round", () => {
    const context = {
      aiStartButton: { hidden: false },
      clearInterval() {},
      duelType: "live",
      liveCountdownActive: false,
      liveCountdownTimer: null,
      liveRoundId: 42,
      overlay: { hidden: true },
      overlayKicker: { textContent: "" },
      overlayMessage: { textContent: "" },
      overlayTitle: {
        classList: { add() {} },
        textContent: "",
      },
      resetCount: 0,
      resetDuel() {
        context.resetCount += 1;
      },
      roomConnected: true,
      roomConnectionState: "connected",
      roomPlayers: [
        { connected: true, ready: true },
        { connected: true, ready: true },
      ],
      Rules: {
        liveRoomPhase() {
          return "countdown";
        },
      },
      runState: "ready",
      setInterval() {
        return 7;
      },
      setRunState(state) {
        context.runState = state;
      },
      startLiveDuel() {},
    };
    const { beginLiveCountdown } = installFunctions(
      ["liveRoomGateOpen", "beginLiveCountdown"],
      context,
    );
    beginLiveCountdown(Date.now() + 3_000, 42);
    assert.equal(context.liveRoundId, 42);
    assert.equal(context.liveCountdownActive, true);
    assert.equal(context.runState, "countdown");
    assert.equal(context.resetCount, 1);

    context.liveCountdownActive = false;
    context.runState = "ready";
    beginLiveCountdown(Date.now() + 3_000, 41);
    assert.equal(context.resetCount, 1);
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
      roomReadyDesired: true,
      roomReadyUpdatePending: false,
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
    assert.match(functionBody("handleRoomStatus"), /applyAuthoritativeRoomRoster\(status\.players, status\.waiting, status\.queuePosition\)/);
  }],
  ["synchronized WebSocket rosters acknowledge the local Ready signal", () => {
    const context = {
      clientId: "local-player",
      // A roster arriving over a degraded link is proof the link recovered.
      roomConnected: true,
      roomConnectionState: "degraded",
      roomReady: true,
      roomReadyConfirmed: false,
      roomReadyDesired: true,
      roomReadyUpdatePending: true,
      roomRole: "player",
      roomPeers: new Map(),
      roomPlayers: [],
      activeRoomRoster() {
        return [
          {
            id: "local-player",
            ready: context.roomReadyConfirmed,
            slot: 0,
          },
          ...context.roomPeers.values(),
        ];
      },
    };
    const { applyAuthoritativeRoomRoster } = installFunctions(
      ["reconcileLocalRoomReady", "applyAuthoritativeRoomRoster"],
      context,
    );
    applyAuthoritativeRoomRoster([
      { id: "local-player", ready: true, slot: 0, seenAt: 1 },
      { id: "remote-player", ready: true, slot: 1, seenAt: 1 },
    ]);
    assert.equal(context.roomConnectionState, "connected",
      "an authoritative roster must clear a degraded room link");
    assert.equal(context.roomReadyConfirmed, true);
    assert.equal(context.roomReadyUpdatePending, false);
    assert.equal(context.roomPeers.get("remote-player").ready, true);
    assert.equal(context.roomPlayers.length, 2);
    assert.match(
      functionBody("handleRoomStatus"),
      /status\.state === "synchronized"[\s\S]*applyAuthoritativeRoomRoster\(status\.players, status\.waiting, status\.queuePosition\)/,
    );
  }],
  ["newer local Ready intent wins over stale authoritative responses", () => {
    const context = {
      clientId: "local-player",
      roomReady: false,
      roomReadyConfirmed: false,
      roomReadyDesired: false,
      roomReadyUpdatePending: true,
      roomRole: "player",
    };
    const { reconcileLocalRoomReady } = installFunctions(
      ["reconcileLocalRoomReady"],
      context,
    );
    reconcileLocalRoomReady([{ id: "local-player", ready: true }]);
    assert.equal(context.roomReady, false);
    assert.equal(context.roomReadyConfirmed, false);
    assert.equal(context.roomReadyUpdatePending, true);
    reconcileLocalRoomReady([{ id: "local-player", ready: false }]);
    assert.equal(context.roomReady, false);
    assert.equal(context.roomReadyConfirmed, false);
    assert.equal(context.roomReadyUpdatePending, false);

    context.roomReadyDesired = true;
    context.roomReadyUpdatePending = true;
    reconcileLocalRoomReady([{ id: "local-player", ready: false }]);
    assert.equal(context.roomReady, true);
    assert.equal(context.roomReadyConfirmed, false);
    assert.equal(context.roomReadyUpdatePending, true);
    reconcileLocalRoomReady([{ id: "local-player", ready: true }]);
    assert.equal(context.roomReady, true);
    assert.equal(context.roomReadyConfirmed, true);
    assert.equal(context.roomReadyUpdatePending, false);
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
    assert.match(status, /COUNTDOWN REQUEST REJECTED/);
    assert.match(status, /roomConnectionState/);
    assert.match(functionBody("applyAuthoritativeRoomRoster"), /roomPeers = new Map\(players/);
    assert.match(functionBody("applyAuthoritativeRoomRoster"), /roomPlayers = activeRoomRoster\(\)\.slice\(0, capacity\)/);
    assert.match(status, /status\.state === "synchronized"/);
    assert.match(status, /if \(roomTransport\) syncLiveRoom\(\)/);
    assert.match(functionBody("disconnectLiveRoom"), /roomConnectionState = "disconnected"/);
  }],
  ["each authoritative roster response synchronizes immediately after transport events", () => {
    const status = functionBody("handleRoomStatus");
    assert.ok(
      status.indexOf('status.state === "synchronized"')
        < status.indexOf('status.state === "reconnecting"'),
    );
    assert.match(status, /status\.state === "synchronized"[\s\S]*syncLiveRoom\(\)/);
  }],
  ["initial roster callbacks cannot start a round before transport installation", () => {
    const body = functionBody("handleRoomMessage");
    const branch = body.match(/if \(message\.type === "presence" \|\| message\.type === "ready"\) \{([^]*?)\n  \}/);
    assert.ok(branch, "Expected a presence/ready branch");
    assert.match(branch[1], /if \(roomTransport\) syncLiveRoom\(\)/);
    assert.match(functionBody("connectLiveRoom"), /Transports\.createWebSocketRoomTransport/);
    assert.match(functionBody("connectLiveRoom"), /Transports\.createRemoteRoomTransport/);
    assert.ok(
      functionBody("connectLiveRoom").indexOf("roomTransport = realtimeUrl")
        < functionBody("connectLiveRoom").lastIndexOf("syncLiveRoom()"),
    );
    assert.match(functionBody("connectLiveRoom"), /setRoomReadyIntent\(false\)/);
    assert.match(functionBody("connectLiveRoom"), /postRoomMessage\(\{ type: "ready", ready: false \}\)/);
  }],
  ["a recovering host accepts its own authoritative countdown replay", () => {
    const body = functionBody("handleRoomMessage");
    assert.match(body, /message\.from === clientId && message\.type !== "countdown"/);
    assert.ok(
      body.indexOf('message.from === clientId && message.type !== "countdown"')
        < body.indexOf('message.type === "countdown"'),
    );
  }],
  ["live countdown aborts if either player disconnects", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /abortLiveCountdown/);
    assert.match(body, /liveCountdownActive/);
    assert.match(
      body,
      /runState === "over" && authoritativeDeparture/,
      "Only an authoritative departure may replace a completed-round result",
    );
    const roster = functionBody("applyAuthoritativeRoomRoster");
    assert.match(roster, /previousPlayerCount >= capacity && nextPlayerCount < capacity/);
    const handler = functionBody("handleRoomMessage");
    assert.match(handler, /message\.type === "countdown-cancel"/);
    assert.match(handler, /cancelLiveRound\(message\)/);
    const cancellation = functionBody("cancelLiveRound");
    assert.match(cancellation, /Number\.isInteger\(message\?\.slot\)/);
    assert.match(cancellation, /peer\.slot !== departedSlot/);
    assert.match(cancellation, /runState === "over" && authoritativeDeparture/);
    assert.match(cancellation, /The previous rival disconnected/);
    assert.match(cancellation, /setRoomReadyIntent\(false, false\)/);
    assert.doesNotMatch(cancellation, /postRoomMessage/);
    assert.match(cancellation, /nextMoveAt = 0/);
    assert.match(cancellation, /setRunState\("ready", "RIVAL DISCONNECTED"\)/);
    assert.match(cancellation, /syncLiveRoom\(\)/);
    assert.match(functionBody("setRunState"), /setActive\?\.\([\s\S]*liveRoundId/);
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
    assert.match(body, /roomCodeInput\.disabled = Boolean\(roomTransport\)/);
  }],
  ["a third participant is explicitly shown in the waiting line", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /WAITING LINE/);
    assert.match(body, /roomQueuePosition/);
    assert.match(body, /NEXT UP/);
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
