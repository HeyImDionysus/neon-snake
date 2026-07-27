"use strict";

const Rules = window.SnakeRules;
const Transports = window.NeonSnakeTransports;
const $ = (selector) => document.querySelector(selector);
const canvas = $("#duelCanvas");
const context = canvas.getContext("2d");
const board = $("#duelBoard");
const overlay = $("#duelOverlay");
const overlayKicker = $("#duelKicker");
const overlayTitle = $("#duelOverlayTitle");
const overlayMessage = $("#duelMessage");
const aiStartButton = $("#aiStartButton");
const aiButton = $("#aiButton");
const aiTab = $("#aiTab");
const liveTab = $("#liveTab");
const aiPanel = $("#aiPanel");
const livePanel = $("#livePanel");
const statusText = $("#duelStatus");
const announcement = $("#duelAnnouncement");
const leftLabel = $("#leftLabel");
const rightLabel = $("#rightLabel");
const leftScore = $("#leftScore");
const rightScore = $("#rightScore");
const pauseButton = $("#duelPauseButton");
const pauseDesktop = $("#duelPauseDesktop");
const restartButton = $("#duelRestartButton");
const roomCodeInput = $("#roomCodeInput");
const copyRoomButton = $("#copyRoomButton");
const connectRoomButton = $("#connectRoomButton");
const readyRoomButton = $("#readyRoomButton");
const roomState = $("#roomState");
const aiTraceMove = $("#aiTraceMove");
const aiTraceRisk = $("#aiTraceRisk");
const aiTraceDepth = $("#aiTraceDepth");
const roomSlotOne = $("#roomSlotOne");
const roomSlotTwo = $("#roomSlotTwo");

const DUEL_GRID = Rules.duelGridSize(20);
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TICK_DURATION = 138;
const PEER_TIMEOUT = 3400;
const DIRECTIONS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const CANDIDATES = Object.entries(DIRECTIONS).map(([name, direction]) => ({
  name,
  ...direction,
}));

let tileSize = canvas.width / DUEL_GRID;
let duelType = "ai";
let runState = "ready";
let playerSnake = [];
let previousPlayerSnake = [];
let opponentSnake = [];
let previousOpponentSnake = [];
let playerDirection = { ...DIRECTIONS.right };
let playerQueuedDirection = { ...DIRECTIONS.right };
let opponentDirection = { ...DIRECTIONS.left };
let opponentQueuedDirection = { ...DIRECTIONS.left };
let playerInputBuffer = [];
let opponentInputBuffer = [];
let opponentInputSequences = [];
let autopilotRecentHeads = [];
let localInputSequence = Date.now();
let lastGuestInputSequence = 0;
let guestInputAck = 0;
let playerScore = 0;
let opponentScore = 0;
let food = null;
let signalCursor = 0;
let lastMoveAt = performance.now();
let nextMoveAt = 0;
let pausedMotion = 1;
let countdownTimer = null;
let frameHandle = null;
let roomTransport = null;
let roomSweep = null;
let roomCode = "";
let roomReady = false;
let roomReadyConfirmed = false;
let roomConnected = false;
let roomRole = "disconnected";
let roomSlot = -1;
let roomConnectionState = "disconnected";
let roomPlayers = [];
let roomPeers = new Map();
let liveCountdownTimer = null;
let liveCountdownActive = false;
let liveRoundId = 0;
let liveSequence = 0;
let lastRemoteSequence = -1;

const clientId = (() => {
  try {
    const saved = sessionStorage.getItem("neon-snake-duel-client");
    if (saved) return saved;
    const created = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem("neon-snake-duel-client", created);
    return created;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
})();

function cloneSnake(source) {
  return source.map((segment) => ({ ...segment }));
}

function focusWithoutScroll(element) {
  if (!element || element.hidden || element.disabled) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function createSignalCode() {
  const values = new Uint32Array(6);
  try {
    globalThis.crypto.getRandomValues(values);
  } catch {
    let fallback = Date.now() >>> 0;
    for (let index = 0; index < values.length; index += 1) {
      const next = Rules.nextSignalRandom(fallback);
      fallback = next.state;
      values[index] = Math.floor(next.value * 4294967296);
    }
  }
  return [...values].map((value) => SIGNAL_ALPHABET[value % SIGNAL_ALPHABET.length]).join("");
}

function hydrateRoomCode() {
  const params = new URLSearchParams(window.location.search);
  const requested = Rules.normalizeSignalCode(params.get("room"));
  roomCode = requested || createSignalCode();
  roomCodeInput.value = roomCode;
  return Boolean(requested && params.get("type") === "live");
}

function resetDuel() {
  clearTimeout(countdownTimer);
  countdownTimer = null;
  const spawns = Rules.duelSpawns(DUEL_GRID);
  playerSnake = cloneSnake(spawns.player.snake);
  previousPlayerSnake = cloneSnake(playerSnake);
  opponentSnake = cloneSnake(spawns.opponent.snake);
  previousOpponentSnake = cloneSnake(opponentSnake);
  playerDirection = { ...spawns.player.direction };
  playerQueuedDirection = { ...playerDirection };
  opponentDirection = { ...spawns.opponent.direction };
  opponentQueuedDirection = { ...opponentDirection };
  playerInputBuffer = [];
  opponentInputBuffer = [];
  opponentInputSequences = [];
  autopilotRecentHeads = [];
  lastGuestInputSequence = 0;
  guestInputAck = 0;
  playerScore = 0;
  opponentScore = 0;
  signalCursor = Rules.signalState(roomCode);
  lastMoveAt = performance.now();
  nextMoveAt = 0;
  pausedMotion = 1;
  liveSequence = 0;
  lastRemoteSequence = -1;
  placeFood();
  updateHud();
}

function openDuelTiles() {
  const occupied = new Set(
    [...playerSnake, ...opponentSnake].map((segment) => `${segment.x},${segment.y}`),
  );
  const open = [];
  for (let y = 0; y < DUEL_GRID; y += 1) {
    for (let x = 0; x < DUEL_GRID; x += 1) {
      if (!occupied.has(`${x},${y}`)) open.push({ x, y });
    }
  }
  return open;
}

function placeFood() {
  const open = openDuelTiles();
  if (!open.length) {
    food = null;
    return;
  }
  const choice = Rules.signalIndex(signalCursor, open.length);
  signalCursor = choice.state;
  food = { ...open[choice.index] };
}

function resizeCanvas() {
  const cssSize = Math.max(1, board.getBoundingClientRect().width);
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const backingSize = Math.max(1, Math.round(cssSize * pixelRatio));
  if (canvas.width === backingSize && canvas.height === backingSize) return;
  canvas.width = backingSize;
  canvas.height = backingSize;
  tileSize = canvas.width / DUEL_GRID;
}

function currentMotion(now) {
  if (runState === "paused") return pausedMotion;
  if (runState !== "running") return 1;
  return Rules.motionProgress(now - lastMoveAt, TICK_DURATION);
}

function pointToPixel(point) {
  return {
    x: point.x * tileSize + tileSize / 2,
    y: point.y * tileSize + tileSize / 2,
  };
}

function traceGroup(group) {
  if (!group.length) return;
  const first = pointToPixel(group[0]);
  context.moveTo(first.x, first.y);
  for (let index = 1; index < group.length; index += 1) {
    const point = pointToPixel(group[index]);
    context.lineTo(point.x, point.y);
  }
}

function drawFluidSnake(current, previous, direction, color, now) {
  if (!current.length) return;
  const path = Rules.fluidMotionPath(
    previous,
    current,
    currentMotion(now),
    DUEL_GRID,
  );
  const groups = Rules.splitFluidPath(path, DUEL_GRID);
  const head = pointToPixel(path[0] || current[0]);
  const angle = Math.atan2(direction.y, direction.x);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.lineWidth = Math.max(7, tileSize * .67);
  context.shadowColor = color;
  context.shadowBlur = Math.max(8, tileSize * .48);
  context.globalAlpha = .92;
  groups.forEach((group) => {
    context.beginPath();
    traceGroup(group);
    context.stroke();
  });

  context.translate(head.x, head.y);
  context.rotate(angle);
  context.globalAlpha = 1;
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(0, 0, tileSize * .43, tileSize * .36, 0, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#071009";
  const eyeX = tileSize * .17;
  const eyeY = tileSize * .14;
  context.beginPath();
  context.arc(eyeX, -eyeY, Math.max(1.2, tileSize * .055), 0, Math.PI * 2);
  context.arc(eyeX, eyeY, Math.max(1.2, tileSize * .055), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawArena(now) {
  const width = canvas.width;
  const gradient = context.createRadialGradient(
    width * .5,
    width * .5,
    0,
    width * .5,
    width * .5,
    width * .72,
  );
  gradient.addColorStop(0, "#0a110d");
  gradient.addColorStop(.62, "#070b09");
  gradient.addColorStop(1, "#030504");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, width);

  context.save();
  context.globalCompositeOperation = "lighter";
  for (let index = 0; index < 28; index += 1) {
    const x = ((index * 211 + 47) % 719) / 719 * width;
    const baseY = ((index * 149 + 31) % 709) / 709 * width;
    const y = (baseY + Math.sin(now * .00025 + index) * 4 + width) % width;
    context.globalAlpha = .025 + (index % 4) * .008;
    context.fillStyle = index % 3 === 0 ? "#a98bff" : "#adff66";
    context.beginPath();
    context.arc(x, y, Math.max(1, width / 720), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  context.strokeStyle = "rgba(173, 255, 102, .16)";
  context.lineWidth = Math.max(2, width / 360);
  context.strokeRect(5, 5, width - 10, width - 10);
  context.strokeStyle = "rgba(169, 139, 255, .09)";
  context.strokeRect(10, 10, width - 20, width - 20);
  context.restore();
}

function drawFood(now) {
  if (!food) return;
  const point = pointToPixel(food);
  const pulse = 1 + Math.sin(now / 150) * .1;
  context.save();
  context.translate(point.x, point.y);
  context.scale(pulse, pulse);
  context.fillStyle = "#ffd166";
  context.shadowColor = "#ffd166";
  context.shadowBlur = Math.max(10, tileSize * .8);
  context.beginPath();
  context.arc(0, 0, Math.max(3, tileSize * .22), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function render(now) {
  advanceGame(now);
  drawArena(now);
  drawFood(now);
  drawFluidSnake(playerSnake, previousPlayerSnake, playerDirection, "#adff66", now);
  drawFluidSnake(opponentSnake, previousOpponentSnake, opponentDirection, "#a98bff", now);
  frameHandle = requestAnimationFrame(render);
}

function chooseAiDirection() {
  const evaluations = Rules.evaluateDuelMoves({
    snake: opponentSnake,
    direction: opponentDirection,
    opponentSnake: playerSnake,
    opponentDirection: playerDirection,
    score: opponentScore,
    opponentScore: playerScore,
    food,
    mode: "classic",
    gridSize: DUEL_GRID,
    candidates: CANDIDATES,
    seed: signalCursor,
    recentHeads: autopilotRecentHeads,
  });
  const selected = Rules.chooseBestMove(evaluations);
  const insight = Rules.decisionInsight(evaluations, selected);
  aiTraceMove.textContent = selected?.name?.toUpperCase() || "NO SAFE MOVE";
  aiTraceRisk.textContent = selected
    ? `${selected.losingReplies || 0} LOSING · ${selected.drawingReplies || 0} DRAW · ${Math.round(selected.searchValue || 0)} VALUE`
    : "FORCED CRASH";
  aiTraceDepth.textContent = selected
    ? `${selected.searchDepth} PLY · ${selected.searchNodes} NODES · ${insight.confidence}`
    : "0 TURNS";
  return selected?.direction || opponentDirection;
}

function applyDuelResult(result, now) {
  previousPlayerSnake = cloneSnake(playerSnake);
  previousOpponentSnake = cloneSnake(opponentSnake);
  playerSnake = cloneSnake(result.players.player.snake);
  opponentSnake = cloneSnake(result.players.opponent.snake);
  if (duelType === "ai" && opponentSnake[0]) {
    autopilotRecentHeads.push({ ...opponentSnake[0] });
    if (autopilotRecentHeads.length > 192) autopilotRecentHeads.shift();
  }
  playerDirection = { ...result.players.player.direction };
  opponentDirection = { ...result.players.opponent.direction };
  playerScore = result.players.player.score;
  opponentScore = result.players.opponent.score;
  lastMoveAt = now;
  if (result.foodEatenBy) placeFood();
  updateHud();
  if (result.over) endDuel(result.winner, result.crashes);
}

function tickAi(now) {
  const playerTurn = Rules.consumeDirectionBuffer(playerInputBuffer, playerDirection);
  playerQueuedDirection = playerTurn.direction;
  playerInputBuffer = playerTurn.queue;
  opponentQueuedDirection = { ...chooseAiDirection() };
  playerDirection = { ...playerQueuedDirection };
  opponentDirection = { ...opponentQueuedDirection };
  const result = Rules.resolveDuelTick({
    players: {
      player: { snake: playerSnake, direction: playerDirection, score: playerScore },
      opponent: { snake: opponentSnake, direction: opponentDirection, score: opponentScore },
    },
    food,
    mode: "classic",
    gridSize: DUEL_GRID,
  });
  applyDuelResult(result, now);
}

function tickLiveHost(now) {
  const playerTurn = Rules.consumeDirectionBuffer(playerInputBuffer, playerDirection);
  const opponentTurn = Rules.consumeDirectionBuffer(opponentInputBuffer, opponentDirection);
  const opponentTurnConsumed = opponentTurn.queue.length < opponentInputBuffer.length;
  playerQueuedDirection = playerTurn.direction;
  opponentQueuedDirection = opponentTurn.direction;
  playerInputBuffer = playerTurn.queue;
  opponentInputBuffer = opponentTurn.queue;
  if (opponentTurnConsumed) {
    const appliedSequence = opponentInputSequences.shift();
    if (Number.isSafeInteger(appliedSequence)) guestInputAck = Math.max(guestInputAck, appliedSequence);
  }
  playerDirection = { ...playerQueuedDirection };
  opponentDirection = { ...opponentQueuedDirection };
  const result = Rules.resolveDuelTick({
    players: {
      player: { snake: playerSnake, direction: playerDirection, score: playerScore },
      opponent: { snake: opponentSnake, direction: opponentDirection, score: opponentScore },
    },
    food,
    mode: "classic",
    gridSize: DUEL_GRID,
  });
  applyDuelResult(result, now);
  broadcastSnapshot(result);
}

function advanceGame(now) {
  if (runState !== "running" || !nextMoveAt) return;
  const isLiveHost = duelType === "live" && roomPlayers[0]?.id === clientId;
  if (duelType === "live" && !isLiveHost) return;

  let steps = 0;
  while (runState === "running" && now >= nextMoveAt && steps < 3) {
    const stepAt = nextMoveAt;
    if (duelType === "ai") tickAi(stepAt);
    else tickLiveHost(stepAt);
    nextMoveAt += TICK_DURATION;
    steps += 1;
  }
  if (steps === 3 && now >= nextMoveAt) nextMoveAt = now + TICK_DURATION;
}

function setRunState(state, label) {
  runState = state;
  document.body.dataset.duelState = state;
  statusText.textContent = label;
  const pausable = duelType === "ai" && (state === "running" || state === "paused");
  pauseButton.disabled = !pausable;
  pauseDesktop.disabled = !pausable;
  const pauseLabel = state === "paused" ? "Resume" : "Pause";
  pauseDesktop.querySelector("span").textContent = pauseLabel;
  pauseDesktop.setAttribute("aria-label", `${pauseLabel} Autopilot duel`);
  pauseButton.setAttribute("aria-label", `${pauseLabel} duel`);
  aiButton.hidden = duelType !== "ai" || state !== "ready";
  restartButton.hidden = duelType !== "ai" || state === "ready" || state === "countdown";
  roomTransport?.setActive?.(
    duelType === "live" && (state === "countdown" || state === "running"),
  );
}

function showOverlay(kicker, title, message, action = "") {
  overlay.hidden = false;
  overlayKicker.textContent = kicker;
  overlayTitle.innerHTML = title;
  overlayTitle.classList.remove("countdown");
  overlayMessage.textContent = message;
  aiStartButton.hidden = !action;
  if (action) aiStartButton.querySelector("span").textContent = action;
}

function beginCountdown(number = 3) {
  setRunState("countdown", "DUEL COUNTDOWN");
  overlay.hidden = false;
  aiStartButton.hidden = true;
  overlayKicker.textContent = "BOTH SIGNALS LOCKED";
  overlayTitle.textContent = String(number);
  overlayTitle.classList.add("countdown");
  overlayMessage.textContent = "Movement begins after zero.";
  if (number > 1) {
    countdownTimer = setTimeout(() => beginCountdown(number - 1), 650);
  } else {
    countdownTimer = setTimeout(startAiDuel, 650);
  }
}

function prepareAiDuel() {
  if (duelType !== "ai") switchDuelType("ai");
  resetDuel();
  beginCountdown(3);
  announcement.textContent = "Autopilot duel countdown started.";
  focusWithoutScroll(canvas);
}

function startAiDuel() {
  overlay.hidden = true;
  overlayTitle.classList.remove("countdown");
  lastMoveAt = performance.now();
  nextMoveAt = lastMoveAt + TICK_DURATION;
  setRunState("running", "AUTOPILOT DUEL ACTIVE");
  announcement.textContent = "Autopilot duel active. First crash loses.";
  focusWithoutScroll(canvas);
}

function endDuel(winner, crashes = {}) {
  nextMoveAt = 0;
  setRunState("over", winner === "player" ? "YOU WIN" : winner === "opponent" ? "RIVAL WINS" : "DRAW");
  const playerWon = winner === "player";
  const opponentWon = winner === "opponent";
  const title = playerWon ? "SIGNAL<br><em>VICTORIOUS</em>"
    : opponentWon ? "RIVAL<br><em>SURVIVED</em>"
      : "DUAL<br><em>COLLISION</em>";
  const reason = crashes.player || crashes.opponent || "collision";
  showOverlay(
    duelType === "ai" ? "AUTOPILOT DUEL COMPLETE" : "LIVE DUEL COMPLETE",
    title,
    winner ? `First crash: ${reason.replace("-", " ")}.` : "Both signals broke on the same tick.",
    duelType === "ai" ? "Run it back" : "",
  );
  announcement.textContent = winner === "player"
    ? "You won the duel."
    : winner === "opponent"
      ? "Your rival won the duel."
      : "The duel ended in a draw.";
  if (duelType === "ai") focusWithoutScroll(aiStartButton);

  if (duelType === "live") {
    roomReady = false;
    roomReadyConfirmed = false;
    postRoomMessage({ type: "ready", ready: false });
    syncLiveRoom();
  }
}

function updateHud() {
  const localIndex = duelType === "live"
    ? roomPlayers.findIndex((player) => player.id === clientId)
    : 0;
  if (duelType === "live" && roomPlayers.length === 2 && localIndex < 0) {
    leftLabel.textContent = "PLAYER 1";
    rightLabel.textContent = "PLAYER 2";
    leftScore.textContent = String(playerScore).padStart(2, "0");
    rightScore.textContent = String(opponentScore).padStart(2, "0");
    return;
  }
  const localIsOpponent = duelType === "live" && localIndex === 1;
  leftLabel.textContent = localIsOpponent ? "RIVAL" : "YOU";
  rightLabel.textContent = localIsOpponent ? "YOU" : duelType === "ai" ? "AUTOPILOT" : "RIVAL";
  leftScore.textContent = String(playerScore).padStart(2, "0");
  rightScore.textContent = String(opponentScore).padStart(2, "0");
}

function requestDirection(next) {
  if (runState !== "running") return;
  if (duelType === "live") {
    const localIndex = roomPlayers.findIndex((player) => player.id === clientId);
    if (localIndex < 0) return;
    if (localIndex === 0) {
      playerInputBuffer = Rules.bufferDirection(playerInputBuffer, playerDirection, next);
    } else {
      const buffered = Rules.bufferDirection(opponentInputBuffer, opponentDirection, next);
      if (buffered.length > opponentInputBuffer.length) {
        localInputSequence = Math.max(localInputSequence + 1, Date.now());
        opponentInputBuffer = buffered;
        opponentInputSequences.push(localInputSequence);
        postRoomMessage({
          type: "input",
          round: liveRoundId,
          sequence: localInputSequence,
          direction: next,
        });
      }
    }
    return;
  }

  playerInputBuffer = Rules.bufferDirection(playerInputBuffer, playerDirection, next);
}

function togglePause() {
  if (duelType !== "ai") return;
  if (runState === "running") {
    pausedMotion = currentMotion(performance.now());
    nextMoveAt = 0;
    setRunState("paused", "AUTOPILOT DUEL PAUSED");
    showOverlay("SYSTEM HOLD", "PAUSED", "The rival is frozen on the same tick.", "Resume duel");
    focusWithoutScroll(aiStartButton);
    return;
  }
  if (runState === "paused") {
    overlay.hidden = true;
    lastMoveAt = performance.now() - pausedMotion * TICK_DURATION;
    nextMoveAt = performance.now() + Math.max(20, (1 - pausedMotion) * TICK_DURATION);
    setRunState("running", "AUTOPILOT DUEL ACTIVE");
    focusWithoutScroll(canvas);
  }
}

function switchDuelType(type) {
  if (type !== "ai" && type !== "live") return;
  if (runState === "countdown") clearTimeout(countdownTimer);
  if (duelType === "live" && type === "ai") disconnectLiveRoom();
  duelType = type;
  document.body.dataset.duelType = type;
  aiTab.setAttribute("aria-selected", String(type === "ai"));
  liveTab.setAttribute("aria-selected", String(type === "live"));
  aiTab.tabIndex = type === "ai" ? 0 : -1;
  liveTab.tabIndex = type === "live" ? 0 : -1;
  aiPanel.hidden = type !== "ai";
  livePanel.hidden = type !== "live";
  resetDuel();
  setRunState("ready", type === "ai" ? "DUEL LAB READY" : "LIVE ROOM STANDBY");
  if (type === "ai") {
    showOverlay(
      "DUEL PROTOCOL",
      "FACE THE<br><em>PLANNER</em>",
      "You steer the acid signal. The violet rival forecasts both legal move sets, protects future territory, races the shared target, and breaks repeated routes.",
      "Play vs Autopilot",
    );
  } else {
    showOverlay(
      "LIVE ROOM",
      "WAITING FOR<br><em>PLAYER 2</em>",
      "Connect this room, share the Signal Code, then both players Ready up.",
    );
  }
  updateHud();
}

function roomIdentity() {
  return {
    id: clientId,
    connected: roomConnected,
    ready: roomReadyConfirmed,
    slot: roomSlot,
    seenAt: Date.now(),
  };
}

function liveRoomGateOpen(players = roomPlayers) {
  if (!roomConnected || roomConnectionState !== "connected") return false;
  const participants = players.map((player) => ({
    connected: true,
    ready: Boolean(player.ready),
  }));
  return Rules.liveRoomPhase(participants) === "countdown";
}

function reconcileLocalRoomReady(players) {
  const local = Array.isArray(players)
    ? players.find((player) => player?.id === clientId)
    : null;
  const authoritativeReady = roomRole === "player" && Boolean(local?.ready);
  roomReady = authoritativeReady;
  roomReadyConfirmed = authoritativeReady;
}

function postRoomMessage(message) {
  roomTransport?.send(message);
}

function updateRosterSlot(element, player, index) {
  element.classList.toggle("connected", Boolean(player));
  element.querySelector("span").textContent = `PLAYER ${index + 1}`;
  element.querySelector("strong").textContent = player
    ? player.id === clientId
      ? player.ready ? "YOU · READY" : "YOU · CONNECTED"
      : player.ready ? "RIVAL · READY" : "RIVAL · CONNECTED"
    : "OPEN";
}

function activeRoomRoster() {
  const now = Date.now();
  const peers = [...roomPeers.values()].filter((peer) => now - peer.seenAt < PEER_TIMEOUT);
  if (roomTransport?.kind === "broadcast-channel") {
    const localPlayers = roomConnected ? [roomIdentity(), ...peers] : peers;
    return localPlayers
      .filter((player) => player.connected)
      .sort((first, second) => first.id.localeCompare(second.id));
  }
  const all = roomConnected && roomRole === "player"
    ? [roomIdentity(), ...peers]
    : peers;
  return all
    .filter((player) => player.connected)
    .filter((player, index, roster) => roster.findIndex((entry) => entry.id === player.id) === index)
    .sort((first, second) => first.slot - second.slot);
}

function syncLiveRoom() {
  const roomRoster = activeRoomRoster();
  roomPlayers = roomRoster.slice(0, 2);
  updateRosterSlot(roomSlotOne, roomPlayers[0], 0);
  updateRosterSlot(roomSlotTwo, roomPlayers[1], 1);
  const localIndex = roomPlayers.findIndex((player) => player.id === clientId);
  const roomFull = roomConnected && roomRole === "spectator";
  const participants = roomPlayers.map((player) => ({
    connected: true,
    ready: Boolean(player.ready),
  }));
  const phase = Rules.liveRoomPhase(participants);

  readyRoomButton.disabled = !roomConnected || localIndex < 0 || runState === "running";
  readyRoomButton.setAttribute("aria-pressed", String(roomReady));
  readyRoomButton.querySelector("span").textContent = roomReady ? "Not ready" : "Ready";
  connectRoomButton.querySelector("span").textContent = roomConnected ? "Disconnect" : "Connect room";
  roomCodeInput.disabled = roomConnected;

  if (roomFull) {
    roomState.textContent = "ROOM FULL · SPECTATING";
    readyRoomButton.disabled = true;
    if (runState === "ready") {
      setRunState("ready", "ROOM FULL · SPECTATOR");
      showOverlay(
        "TWO PLAYER LIMIT",
        "ROOM FULL<br><em>SPECTATOR</em>",
        "This Signal already has two players. You can watch, but cannot steer or Ready up.",
      );
    }
    updateHud();
    return;
  }

  if (phase === "waiting") {
    roomState.textContent = roomConnected ? "WAITING FOR PLAYER 2" : "NOT CONNECTED";
    if (liveCountdownActive) abortLiveCountdown();
    if (runState === "ready") {
      setRunState("ready", roomConnected ? "WAITING FOR PLAYER 2" : "LIVE ROOM STANDBY");
      showOverlay(
        "LIVE ROOM",
        "WAITING FOR<br><em>PLAYER 2</em>",
        "The countdown cannot exist until a second player connects.",
      );
    }
    if (runState === "running") {
      nextMoveAt = 0;
      setRunState("ready", "RIVAL DISCONNECTED");
      showOverlay(
        "CONNECTION LOST",
        "WAITING FOR<br><em>PLAYER 2</em>",
        "The duel stopped immediately. It cannot continue with one player.",
      );
    }
  } else if (phase === "ready") {
    roomState.textContent = "BOTH CONNECTED · READY UP";
    if (liveCountdownActive) abortLiveCountdown();
    if (runState === "ready") {
      setRunState("ready", "TWO PLAYERS CONNECTED");
      showOverlay(
        "ROOM LOCKED",
        "READY WHEN<br><em>YOU ARE</em>",
        "Both players are connected. The countdown waits for two Ready signals.",
      );
    }
  } else if (phase === "countdown") {
    const gateOpen = liveRoomGateOpen();
    roomState.textContent = !gateOpen
      ? "ROOM LINK RECONNECTING"
      : runState === "running"
        ? "LIVE DUEL ACTIVE"
        : "BOTH READY · COUNTDOWN";
    if (!gateOpen && liveCountdownActive) {
      abortLiveCountdown();
    } else if (
      gateOpen
      && runState !== "running"
      && !liveCountdownActive
      && roomPlayers[0]?.id === clientId
    ) {
      const startsAt = Date.now() + 3200;
      const round = Date.now();
      postRoomMessage({ type: "countdown", round, startsAt });
      beginLiveCountdown(startsAt, round);
    }
  }
  if (roomConnectionState === "reconnecting") {
    roomState.textContent = "ROOM LINK RECONNECTING";
  }
  updateHud();
}

function handleRoomStatus(status) {
  if (!status || typeof status !== "object") return;
  if (status.state === "reconnecting") {
    roomConnectionState = "reconnecting";
    if (liveCountdownActive) abortLiveCountdown();
    roomState.textContent = "ROOM LINK RECONNECTING";
    announcement.textContent = status.code === "timeout"
      ? "Room request timed out. Reconnecting."
      : "Room link interrupted. Reconnecting.";
    return;
  }
  if (status.state === "rejected") {
    roomConnectionState = "degraded";
    if (liveCountdownActive) abortLiveCountdown();
    roomState.textContent = "ROOM UPDATE REJECTED · RETRYING";
    announcement.textContent = "The room service rejected one update. It was discarded instead of retrying forever.";
    return;
  }
  if (status.state !== "connected") return;
  roomConnectionState = "connected";
  roomConnected = true;
  roomRole = status.role === "player" ? "player" : "spectator";
  roomSlot = roomRole === "player" && Number.isInteger(status.slot) ? status.slot : -1;
  if (Array.isArray(status.players)) {
    reconcileLocalRoomReady(status.players);
    roomPeers = new Map(status.players
      .filter((player) => player?.id && player.id !== clientId)
      .map((player) => [player.id, {
        id: player.id,
        connected: true,
        ready: Boolean(player.ready),
        slot: Number.isInteger(player.slot) ? player.slot : -1,
        seenAt: Number.isFinite(Number(player.seenAt)) ? Number(player.seenAt) : Date.now(),
      }]));
    if (roomTransport) syncLiveRoom();
  }
}

async function connectLiveRoom() {
  if (roomTransport) {
    disconnectLiveRoom();
    return;
  }
  const normalized = Rules.normalizeSignalCode(roomCodeInput.value);
  if (!normalized) {
    roomState.textContent = "ENTER A VALID 6-CHARACTER SIGNAL";
    return;
  }
  if (!Transports?.remoteRoomSupported()) {
    roomState.textContent = "LIVE ROOM UNSUPPORTED IN THIS BROWSER";
    return;
  }

  roomCode = normalized;
  roomCodeInput.value = roomCode;
  roomCodeInput.disabled = true;
  connectRoomButton.disabled = true;
  roomState.textContent = "CONNECTING TO LIVE ROOM";
  roomPeers = new Map();
  roomReady = false;
  roomReadyConfirmed = false;
  roomRole = "disconnected";
  roomSlot = -1;
  roomConnectionState = "connecting";

  try {
    roomTransport = await Transports.createRemoteRoomTransport({
      code: normalized,
      clientId,
      onMessage: handleRoomMessage,
      onStatus: handleRoomStatus,
    });
  } catch (error) {
    roomTransport = null;
    roomConnected = false;
    roomRole = "disconnected";
    roomSlot = -1;
    roomConnectionState = "disconnected";
    roomCodeInput.disabled = false;
    connectRoomButton.disabled = false;
    roomState.textContent = "LIVE ROOM SERVICE UNAVAILABLE";
    announcement.textContent = "The live room service could not connect.";
    console.warn("Live room transport could not start.", {
      name: typeof error?.name === "string" ? error.name : "Error",
    });
    return;
  }

  roomConnected = true;
  connectRoomButton.disabled = false;
  roomSweep = setInterval(syncLiveRoom, 700);
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", roomCode);
  url.searchParams.set("type", "live");
  history.replaceState(null, "", url);
  syncLiveRoom();
  announcement.textContent = `Connected to room ${roomCode}.`;
}

function disconnectLiveRoom() {
  if (roomTransport) {
    postRoomMessage({ type: "leave" });
    roomTransport.close();
  }
  clearInterval(roomSweep);
  roomTransport = null;
  roomSweep = null;
  roomPeers = new Map();
  roomPlayers = [];
  roomReady = false;
  roomReadyConfirmed = false;
  roomConnected = false;
  roomRole = "disconnected";
  roomSlot = -1;
  roomConnectionState = "disconnected";
  abortLiveCountdown();
  if (duelType === "live") {
    setRunState("ready", "LIVE ROOM STANDBY");
    showOverlay(
      "LIVE ROOM",
      "WAITING FOR<br><em>PLAYER 2</em>",
      "Connect this room, share the Signal Code, then both players Ready up.",
    );
  }
  syncLiveRoom();
}

function toggleRoomReady() {
  if (!roomConnected || !roomPlayers.some((player) => player.id === clientId)) return;
  roomReady = !roomReady;
  if (!roomReady) roomReadyConfirmed = false;
  postRoomMessage({ type: "ready", ready: roomReady });
  syncLiveRoom();
}

function beginLiveCountdown(startsAt, round) {
  if (!Number.isSafeInteger(round) || round < 1) return;
  if (round <= liveRoundId || runState === "running") return;
  if (!liveRoomGateOpen()) return;
  if (liveCountdownActive) {
    clearInterval(liveCountdownTimer);
    liveCountdownTimer = null;
    liveCountdownActive = false;
  }
  liveCountdownActive = true;
  resetDuel();
  liveRoundId = round;
  setRunState("countdown", "LIVE DUEL COUNTDOWN");
  aiStartButton.hidden = true;

  const update = () => {
    if (!liveRoomGateOpen()) {
      abortLiveCountdown();
      return;
    }
    const remaining = Math.max(0, startsAt - Date.now());
    const number = Math.max(1, Math.ceil(remaining / 1000));
    overlay.hidden = false;
    overlayKicker.textContent = "TWO PLAYERS LOCKED";
    overlayTitle.textContent = String(number);
    overlayTitle.classList.add("countdown");
    overlayMessage.textContent = "The room starts only while both remain connected.";
    if (remaining <= 0) {
      clearInterval(liveCountdownTimer);
      liveCountdownTimer = null;
      liveCountdownActive = false;
      startLiveDuel();
    }
  };
  update();
  liveCountdownTimer = setInterval(update, 50);
}

function abortLiveCountdown() {
  clearInterval(liveCountdownTimer);
  liveCountdownTimer = null;
  liveCountdownActive = false;
  if (runState === "countdown" && duelType === "live") {
    setRunState("ready", "LIVE ROOM WAITING");
    showOverlay(
      "LIVE ROOM",
      "WAITING FOR<br><em>BOTH READY</em>",
      "Countdown cancelled because the two-player gate is no longer satisfied.",
    );
  }
}

function startLiveDuel() {
  if (!liveRoomGateOpen()) {
    abortLiveCountdown();
    return;
  }
  overlay.hidden = true;
  overlayTitle.classList.remove("countdown");
  lastMoveAt = performance.now();
  nextMoveAt = roomPlayers[0]?.id === clientId ? lastMoveAt + TICK_DURATION : 0;
  setRunState("running", "LIVE DUEL ACTIVE");
  roomState.textContent = "LIVE DUEL ACTIVE";
  if (roomPlayers[0]?.id === clientId) {
    broadcastSnapshot({ crashes: { player: null, opponent: null }, over: false, winner: null });
  }
  announcement.textContent = "Live duel active. Both players connected.";
}

function broadcastSnapshot(result) {
  liveSequence += 1;
  postRoomMessage({
    type: "state",
    sequence: liveSequence,
    state: {
      playerSnake,
      opponentSnake,
      playerDirection,
      opponentDirection,
      playerScore,
      opponentScore,
      food,
      signalCursor,
      round: liveRoundId,
      guestInputAck,
      crashes: result.crashes,
      over: result.over,
      winner: result.winner,
    },
  });
}

function applyRemoteSnapshot(message) {
  if (message.sequence <= lastRemoteSequence || roomPlayers[0]?.id === clientId) return;
  const state = message.state;
  if (state?.round !== liveRoundId) return;
  if (!state?.playerSnake?.length || !state?.opponentSnake?.length) return;
  const localIndex = roomPlayers.findIndex((player) => player.id === clientId);
  if (localIndex === 1) {
    const acknowledged = Number(state.guestInputAck) || 0;
    while (opponentInputSequences.length && opponentInputSequences[0] <= acknowledged) {
      opponentInputSequences.shift();
      opponentInputBuffer.shift();
    }
  }
  lastRemoteSequence = message.sequence;
  previousPlayerSnake = cloneSnake(playerSnake);
  previousOpponentSnake = cloneSnake(opponentSnake);
  playerSnake = cloneSnake(state.playerSnake);
  opponentSnake = cloneSnake(state.opponentSnake);
  playerDirection = { ...state.playerDirection };
  opponentDirection = { ...state.opponentDirection };
  playerScore = Number(state.playerScore) || 0;
  opponentScore = Number(state.opponentScore) || 0;
  food = state.food ? { ...state.food } : null;
  signalCursor = Number(state.signalCursor) >>> 0;
  lastMoveAt = performance.now();
  updateHud();
  if (state.over && runState === "running") endDuel(state.winner, state.crashes);
}

function handleRoomMessage(message) {
  if (!message || message.room !== roomCode || message.from === clientId) return;
  if (message.type === "leave") {
    roomPeers.delete(message.from);
    syncLiveRoom();
    return;
  }
  if (message.type === "presence" || message.type === "ready") {
    roomPeers.set(message.from, {
      id: message.from,
      connected: true,
      ready: Boolean(message.ready),
      slot: Number.isInteger(message.slot) ? message.slot : -1,
      seenAt: Number.isFinite(Number(message.seenAt)) ? Number(message.seenAt) : Date.now(),
    });
    syncLiveRoom();
    return;
  }
  if (message.type === "countdown") {
    const startsAt = Number(message.startsAt);
    const round = Number(message.round);
    if (Number.isFinite(startsAt) && Number.isSafeInteger(round)) beginLiveCountdown(startsAt, round);
    return;
  }
  if (message.type === "input" && roomPlayers[0]?.id === clientId) {
    const next = message.direction;
    const round = Number(message.round);
    const sequence = Number(message.sequence);
    if (
      !next
      || round !== liveRoundId
      || !Number.isSafeInteger(sequence)
      || sequence <= lastGuestInputSequence
    ) return;
    if (CANDIDATES.some((candidate) => candidate.x === next.x && candidate.y === next.y)) {
      const buffered = Rules.bufferDirection(opponentInputBuffer, opponentDirection, next);
      if (buffered.length > opponentInputBuffer.length) {
        opponentInputBuffer = buffered;
        opponentInputSequences.push(sequence);
        lastGuestInputSequence = sequence;
      }
    }
    return;
  }
  if (message.type === "state") applyRemoteSnapshot(message);
}

async function copyRoomLink() {
  const code = Rules.normalizeSignalCode(roomCodeInput.value) || roomCode;
  const url = new URL("duel.html", window.location.href);
  url.searchParams.set("room", code);
  url.searchParams.set("type", "live");
  try {
    await navigator.clipboard.writeText(url.href);
    roomState.textContent = "INVITE LINK COPIED";
    announcement.textContent = `Room ${code} invite copied.`;
  } catch {
    window.prompt("Copy this room invite:", url.href);
  }
}

function handleKeyboard(event) {
  const key = event.key.toLowerCase();
  const keyMap = {
    arrowup: DIRECTIONS.up,
    w: DIRECTIONS.up,
    arrowright: DIRECTIONS.right,
    d: DIRECTIONS.right,
    arrowdown: DIRECTIONS.down,
    s: DIRECTIONS.down,
    arrowleft: DIRECTIONS.left,
    a: DIRECTIONS.left,
  };
  if (keyMap[key]) {
    event.preventDefault();
    requestDirection(keyMap[key]);
    return;
  }
  if (key === " ") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (key === "r") {
    event.preventDefault();
    if (duelType === "ai") prepareAiDuel();
    else if (roomConnected) {
      roomReady = false;
      roomReadyConfirmed = false;
      postRoomMessage({ type: "ready", ready: false });
      syncLiveRoom();
    }
  }
}

function handleTabKey(event) {
  let type = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    type = duelType === "ai" ? "live" : "ai";
  } else if (event.key === "Home") {
    type = "ai";
  } else if (event.key === "End") {
    type = "live";
  }
  if (!type) return;
  event.preventDefault();
  switchDuelType(type);
  (type === "ai" ? aiTab : liveTab).focus();
}

function registerServiceWorker() {
  const localSecureContext = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || localSecureContext)) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

aiButton.addEventListener("click", prepareAiDuel);
aiStartButton.addEventListener("click", () => {
  if (runState === "paused") togglePause();
  else prepareAiDuel();
});
aiTab.addEventListener("click", () => switchDuelType("ai"));
liveTab.addEventListener("click", () => switchDuelType("live"));
aiTab.addEventListener("keydown", handleTabKey);
liveTab.addEventListener("keydown", handleTabKey);
pauseButton.addEventListener("click", togglePause);
pauseDesktop.addEventListener("click", togglePause);
restartButton.addEventListener("click", prepareAiDuel);
connectRoomButton.addEventListener("click", connectLiveRoom);
readyRoomButton.addEventListener("click", toggleRoomReady);
copyRoomButton.addEventListener("click", copyRoomLink);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^23456789A-HJ-NP-Z]/g, "").slice(0, 6);
});
document.querySelectorAll("[data-duel-direction]").forEach((button) => {
  button.addEventListener("click", () => requestDirection(DIRECTIONS[button.dataset.duelDirection]));
});
window.addEventListener("keydown", handleKeyboard);
window.addEventListener("beforeunload", () => {
  if (roomTransport) postRoomMessage({ type: "leave" });
  roomTransport?.close();
  cancelAnimationFrame(frameHandle);
});
window.addEventListener("load", registerServiceWorker, { once: true });
if ("ResizeObserver" in window) new ResizeObserver(resizeCanvas).observe(board);
else window.addEventListener("resize", resizeCanvas);

const invitedToLiveRoom = hydrateRoomCode();
switchDuelType(invitedToLiveRoom ? "live" : "ai");
resizeCanvas();
if (invitedToLiveRoom) connectLiveRoom();
frameHandle = requestAnimationFrame(render);
