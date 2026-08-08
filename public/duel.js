"use strict";

const Rules = window.SnakeRules;
const Transports = window.NeonSnakeTransports;
const activityQuery = new URLSearchParams(location.search);
const activityEmbedded = activityQuery.has("frame_id");
const ACTIVITY_PIXEL_RATIO_CAP = 1.25;
const ACTIVITY_IDLE_FRAME_INTERVAL = 50;
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
const roomLatency = $("#roomLatency");
const aiTraceMove = $("#aiTraceMove");
const aiTraceRisk = $("#aiTraceRisk");
const aiTraceDepth = $("#aiTraceDepth");
const roomSlotOne = $("#roomSlotOne");
const roomSlotTwo = $("#roomSlotTwo");
const roomSlotThree = $("#roomSlotThree");
const roomSlotFour = $("#roomSlotFour");
const roomRoster = $(".room-roster");
const roomModeSelect = $("#roomModeSelect");
const roomModeHelp = $("#roomModeHelp");
const gridReadout = $("#gridReadout");
const roomWaiting = $("#roomWaiting");
const roomQueueState = $("#roomQueueState");
const activityContext = $("#activityContext");
const activityContextTitle = $("#activityContextTitle");
const activityContextDetail = $("#activityContextDetail");
const activityContextRetry = $("#activityContextRetry");

const DUEL_GRID = Rules.duelGridSize(20);
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TICK_DURATION = 138;
const LIVE_ROOM_CAPACITY = 2;
const ARENA_GRID = DUEL_GRID * 2;
const PEER_TIMEOUT = 6000;
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
const DUEL_COLORS = {
  acid: "#adff66",
  cyan: "#66e3ff",
  violet: "#a98bff",
  magenta: "#ff6ed1",
  ember: "#ff7657",
};

let tileSize = canvas.width / DUEL_GRID;
const arenaBackdrop = document.createElement("canvas");
const arenaBackdropContext = arenaBackdrop.getContext("2d");
let arenaBackdropBuilt = false;
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
let playerInputSequences = [];
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
let lastActivityIdleFrame = -ACTIVITY_IDLE_FRAME_INTERVAL;
let resizeFrame = 0;
let roomTransport = null;
let roomSweep = null;
let roomCode = "";
let roomReady = false;
let roomReadyConfirmed = false;
let roomReadyDesired = false;
let roomReadyUpdatePending = false;
let roomConnected = false;
let roomRole = "disconnected";
let roomSlot = -1;
let roomConnectionState = "disconnected";
let roomPlayers = [];
let roomWaitingPlayers = [];
let roomQueuePosition = 0;
let roomMode = "duel";
let roomCapacity = LIVE_ROOM_CAPACITY;
let roomPeers = new Map();
let authoritativeDeparturePending = false;
let liveCountdownTimer = null;
let liveCountdownActive = false;
let pendingCountdownRound = 0;
let pendingCountdownExpiresAt = 0;
let pendingCountdownAttempts = 0;
let liveRoundId = 0;
let liveSequence = 0;
let lastRemoteSequence = -1;
let liveLatencyMs = 0;
let liveClockOffsetMs = null;
let authoritativePlayerSnake = [];
let authoritativeOpponentSnake = [];
let playerPredictionIndex = 0;
let opponentPredictionIndex = 0;
let liveSnakes = [];
let previousLiveSnakes = [];
let liveFoods = [];
let liveGridSize = DUEL_GRID;

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

function networkInterpolationOffset(sentAt, receivedAt, roundTrip, clockOffset = 0) {
  const age = Number(receivedAt) + (Number(clockOffset) || 0) - Number(sentAt);
  const fallback = Math.max(0, Number(roundTrip) || 0) / 2;
  const estimate = Number.isFinite(age) && age >= 0 && age < 5_000
    ? age
    : fallback;
  return Math.min(TICK_DURATION - 16, Math.max(0, estimate));
}

function previewDirection(direction, queue, index = 0) {
  const pending = queue[index];
  return pending && !Rules.isReverseDirection(pending, direction)
    ? pending
    : direction;
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

function liveRoomRequested() {
  return new URLSearchParams(window.location.search).get("type") === "live";
}

function resetDuel() {
  clearTimeout(countdownTimer);
  countdownTimer = null;
  const spawns = Rules.duelSpawns(DUEL_GRID);
  playerSnake = cloneSnake(spawns.player.snake);
  previousPlayerSnake = cloneSnake(playerSnake);
  authoritativePlayerSnake = cloneSnake(playerSnake);
  opponentSnake = cloneSnake(spawns.opponent.snake);
  previousOpponentSnake = cloneSnake(opponentSnake);
  authoritativeOpponentSnake = cloneSnake(opponentSnake);
  playerDirection = { ...spawns.player.direction };
  playerQueuedDirection = { ...playerDirection };
  opponentDirection = { ...spawns.opponent.direction };
  opponentQueuedDirection = { ...opponentDirection };
  playerInputBuffer = [];
  playerInputSequences = [];
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
  playerPredictionIndex = 0;
  opponentPredictionIndex = 0;
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
  const pixelRatioCap = activityEmbedded ? ACTIVITY_PIXEL_RATIO_CAP : 2;
  const pixelRatio = Math.min(pixelRatioCap, Math.max(1, window.devicePixelRatio || 1));
  const backingSize = Math.max(1, Math.round(cssSize * pixelRatio));
  if (
    canvas.width === backingSize
    && canvas.height === backingSize
    && arenaBackdropBuilt
    && arenaBackdrop.width === backingSize
    && arenaBackdrop.height === backingSize
  ) return;
  canvas.width = backingSize;
  canvas.height = backingSize;
  arenaBackdrop.width = backingSize;
  arenaBackdrop.height = backingSize;
  const grid = typeof duelType === "string" && duelType === "live"
    && typeof liveGridSize === "number"
    ? liveGridSize
    : DUEL_GRID;
  tileSize = canvas.width / grid;
  buildArenaBackdrop();
}

function buildArenaBackdrop() {
  const width = canvas.width;
  const gradient = arenaBackdropContext.createRadialGradient(
    width * .5, width * .5, 0, width * .5, width * .5, width * .72,
  );
  gradient.addColorStop(0, "#0a110d");
  gradient.addColorStop(.62, "#070b09");
  gradient.addColorStop(1, "#030504");
  arenaBackdropContext.fillStyle = gradient;
  arenaBackdropContext.fillRect(0, 0, width, width);
  arenaBackdropContext.save();
  arenaBackdropContext.strokeStyle = "rgba(173, 255, 102, .16)";
  arenaBackdropContext.lineWidth = Math.max(2, width / 360);
  arenaBackdropContext.strokeRect(5, 5, width - 10, width - 10);
  arenaBackdropContext.strokeStyle = "rgba(169, 139, 255, .09)";
  arenaBackdropContext.strokeRect(10, 10, width - 20, width - 20);
  arenaBackdropContext.restore();
  arenaBackdropBuilt = true;
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

function drawFluidSnake(current, previous, direction, color, now, style = "signal", gridSize = liveGridSize) {
  if (!current.length) return;
  const path = Rules.fluidMotionPath(
    previous,
    current,
    currentMotion(now),
    gridSize,
  );
  const groups = Rules.splitFluidPath(path, gridSize);
  const head = pointToPixel(path[0] || current[0]);
  const angle = Math.atan2(direction.y, direction.x);

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.lineWidth = Math.max(7, tileSize * (
    style === "ember" ? .76
      : style === "spectral" ? .58
        : style === "glass" ? .7
          : .67
  ));
  context.shadowColor = color;
  context.shadowBlur = Math.max(
    activityEmbedded ? 4 : 8,
    tileSize * (style === "spectral" ? .45 : activityEmbedded ? .24 : .48),
  );
  context.globalAlpha = style === "spectral" ? .72 : style === "glass" ? .38 : .92;
  if (style === "spectral") context.setLineDash([tileSize * 1.25, tileSize * .3]);
  groups.forEach((group) => {
    context.beginPath();
    traceGroup(group);
    context.stroke();
  });
  if (style === "glass" && !activityEmbedded) {
    context.setLineDash([]);
    context.globalAlpha = .9;
    context.lineWidth = Math.max(2, tileSize * .15);
    groups.forEach((group) => {
      context.beginPath();
      traceGroup(group);
      context.stroke();
    });
  }

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
  context.drawImage(arenaBackdrop, 0, 0);

  context.save();
  context.globalCompositeOperation = "lighter";
  const arenaParticleCount = activityEmbedded ? 10 : 28;
  for (let index = 0; index < arenaParticleCount; index += 1) {
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

function drawLiveFoods(now) {
  liveFoods.forEach((pellet) => {
    const point = pointToPixel(pellet);
    const pulse = 1 + Math.sin(now / 150 + pellet.x) * .1;
    context.save();
    context.translate(point.x, point.y);
    context.scale(pulse, pulse);
    context.fillStyle = "#ffd166";
    context.shadowColor = "#ffd166";
    context.shadowBlur = Math.max(6, tileSize * .7);
    context.beginPath();
    context.arc(0, 0, Math.max(2, tileSize * .18), 0, Math.PI * 2);
    context.fill();
    context.restore();
  });
}

function render(now) {
  frameHandle = null;
  if (document.hidden) return;
  if (
    activityEmbedded
    && runState !== "running"
    && runState !== "countdown"
    && now - lastActivityIdleFrame < ACTIVITY_IDLE_FRAME_INTERVAL
  ) {
    frameHandle = requestAnimationFrame(render);
    return;
  }
  if (activityEmbedded && runState !== "running" && runState !== "countdown") {
    lastActivityIdleFrame = now;
  }
  advanceGame(now);
  drawArena(now);
  if (duelType === "live" && roomMode === "arena") drawLiveFoods(now);
  else drawFood(now);
  if (duelType === "live" && roomMode === "arena" && liveSnakes.length) {
    liveSnakes.forEach((snake) => {
      if (!snake.alive || !snake.body?.length) return;
      const previous = previousLiveSnakes.find((entry) => entry.slot === snake.slot);
      const player = roomPlayers.find((entry) => entry.slot === snake.slot);
      drawFluidSnake(
        snake.body,
        previous?.body || snake.body,
        snake.direction,
        DUEL_COLORS[player?.profile?.accent] || ["#adff66", "#a98bff", "#66e3ff", "#ff6ed1"][snake.slot % 4],
        now,
        player?.profile?.snakeStyle || "signal",
        liveGridSize,
      );
    });
    frameHandle = requestAnimationFrame(render);
    return;
  }
  const firstProfile = duelType === "live" ? roomPlayers[0]?.profile : null;
  const secondProfile = duelType === "live" ? roomPlayers[1]?.profile : null;
  const localIndex = duelType === "live"
    ? roomPlayers.findIndex((player) => player.id === clientId)
    : -1;
  const firstDirection = roomTransport?.authoritative && localIndex === 0
    ? previewDirection(playerDirection, playerInputBuffer, playerPredictionIndex)
    : playerDirection;
  const secondDirection = roomTransport?.authoritative && localIndex === 1
    ? previewDirection(opponentDirection, opponentInputBuffer, opponentPredictionIndex)
    : opponentDirection;
  drawFluidSnake(
    playerSnake,
    previousPlayerSnake,
    firstDirection,
    DUEL_COLORS[firstProfile?.accent] || "#adff66",
    now,
    firstProfile?.snakeStyle || "signal",
  );
  drawFluidSnake(
    opponentSnake,
    previousOpponentSnake,
    secondDirection,
    DUEL_COLORS[secondProfile?.accent] || "#a98bff",
    now,
    secondProfile?.snakeStyle || "signal",
  );
  frameHandle = requestAnimationFrame(render);
}

function startRendering() {
  if (document.hidden || frameHandle !== null) return;
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

function tickPredictedLive(now) {
  const localIndex = roomPlayers.findIndex((player) => player.id === clientId);
  if (localIndex < 0) {
    nextMoveAt = 0;
    return;
  }

  let predictedPlayerDirection = playerDirection;
  let predictedOpponentDirection = opponentDirection;
  if (localIndex === 0) {
    const next = previewDirection(playerDirection, playerInputBuffer, playerPredictionIndex);
    if (next !== playerDirection) playerPredictionIndex += 1;
    predictedPlayerDirection = { ...next };
  } else {
    const next = previewDirection(opponentDirection, opponentInputBuffer, opponentPredictionIndex);
    if (next !== opponentDirection) opponentPredictionIndex += 1;
    predictedOpponentDirection = { ...next };
  }

  const result = Rules.resolveDuelTick({
    players: {
      player: {
        snake: playerSnake,
        direction: predictedPlayerDirection,
        score: playerScore,
      },
      opponent: {
        snake: opponentSnake,
        direction: predictedOpponentDirection,
        score: opponentScore,
      },
    },
    food,
    mode: "classic",
    gridSize: DUEL_GRID,
  });

  previousPlayerSnake = cloneSnake(playerSnake);
  previousOpponentSnake = cloneSnake(opponentSnake);
  playerSnake = cloneSnake(result.players.player.snake);
  opponentSnake = cloneSnake(result.players.opponent.snake);
  playerDirection = { ...result.players.player.direction };
  opponentDirection = { ...result.players.opponent.direction };
  playerScore = result.players.player.score;
  opponentScore = result.players.opponent.score;
  if (result.foodEatenBy) food = null;
  lastMoveAt = now;
  updateHud();
  if (result.over) nextMoveAt = 0;
}

function advanceGame(now) {
  if (runState !== "running" || !nextMoveAt) return;
  if (duelType === "live" && roomTransport?.authoritative) {
    let predictedSteps = 0;
    while (runState === "running" && now >= nextMoveAt && predictedSteps < 2) {
      tickPredictedLive(nextMoveAt);
      if (!nextMoveAt) return;
      nextMoveAt += TICK_DURATION;
      predictedSteps += 1;
    }
    if (predictedSteps === 2 && now >= nextMoveAt) nextMoveAt = now + TICK_DURATION;
    return;
  }
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
    liveRoundId,
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
    setRoomReadyIntent(false);
    postRoomMessage({ type: "ready", ready: false });
    syncLiveRoom();
  }
}

function updateHud() {
  if (duelType === "live" && roomMode === "arena" && liveSnakes.length) {
    const local = liveSnakes.find((snake) => snake.slot === roomSlot);
    leftLabel.textContent = local?.alive === false ? "ELIMINATED" : "YOU";
    leftScore.textContent = String(local?.score || 0).padStart(2, "0");
    const rival = liveSnakes.find((snake) => snake.slot !== roomSlot && snake.alive);
    rightLabel.textContent = rival ? `P${rival.slot + 1}` : "LAST ALIVE";
    rightScore.textContent = String(rival?.score || 0).padStart(2, "0");
    return;
  }
  const localIndex = duelType === "live"
    ? roomPlayers.findIndex((player) => player.id === clientId)
    : 0;
  if (duelType === "live" && roomPlayers.length === LIVE_ROOM_CAPACITY && localIndex < 0) {
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
    if (roomMode === "arena") {
      const localSnake = liveSnakes.find((snake) => snake.slot === roomSlot);
      const currentDirection = localSnake?.direction || DIRECTIONS.right;
      const sent = postRoomMessage({
        type: "input",
        round: liveRoundId,
        sequence: Math.max(localInputSequence + 1, Date.now()),
        direction: next,
      });
      if (sent) localInputSequence = Math.max(localInputSequence + 1, Date.now());
      return;
    }
    if (roomTransport?.authoritative) {
      const currentDirection = localIndex === 0 ? playerDirection : opponentDirection;
      const currentBuffer = localIndex === 0 ? playerInputBuffer : opponentInputBuffer;
      const buffered = Rules.bufferDirection(currentBuffer, currentDirection, next);
      if (buffered.length > currentBuffer.length) {
        localInputSequence = Math.max(localInputSequence + 1, Date.now());
        const sent = postRoomMessage({
          type: "input",
          round: liveRoundId,
          sequence: localInputSequence,
          direction: next,
        });
        if (!sent) return;
        if (localIndex === 0) {
          playerInputBuffer = buffered;
          playerInputSequences.push(localInputSequence);
        } else {
          opponentInputBuffer = buffered;
          opponentInputSequences.push(localInputSequence);
        }
      }
    } else if (localIndex === 0) {
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
  const nextUrl = new URL(window.location.href);
  if (activityEmbedded || nextUrl.searchParams.has("type")) {
    nextUrl.searchParams.set("type", type);
    history.replaceState(null, "", nextUrl);
  }
  document.body.dataset.duelType = type;
  aiTab.setAttribute("aria-selected", String(type === "ai"));
  liveTab.setAttribute("aria-selected", String(type === "live"));
  aiTab.tabIndex = type === "ai" ? 0 : -1;
  liveTab.tabIndex = type === "live" ? 0 : -1;
  aiPanel.hidden = type !== "ai";
  livePanel.hidden = type !== "live";
  resetDuel();
  setRunState("ready", type === "ai" ? "MULTIPLAYER READY" : "LIVE ROOM STANDBY");
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
    profile: globalThis.NeonSnakeAccount?.profile || null,
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
  if (roomReadyUpdatePending) {
    if (authoritativeReady === roomReadyDesired) roomReadyUpdatePending = false;
    roomReady = roomReadyDesired;
    roomReadyConfirmed = roomReadyUpdatePending ? false : authoritativeReady;
    return;
  }
  roomReadyDesired = authoritativeReady;
  roomReady = authoritativeReady;
  roomReadyConfirmed = authoritativeReady;
}

function applyAuthoritativeRoomRoster(players, waiting = [], queuePosition = 0, mode = "duel", capacity = 2) {
  if (!Array.isArray(players)) return;
  const previousMode = typeof roomMode === "string" ? roomMode : "duel";
  roomMode = mode === "arena" ? "arena" : "duel";
  roomCapacity = Number(capacity) || (roomMode === "arena" ? 4 : 2);
  if (
    previousMode !== roomMode
    && typeof announcement !== "undefined"
    && announcement
  ) {
    announcement.textContent = `Room mode changed to ${roomMode.toUpperCase()}.`;
  }
  const duelGrid = typeof DUEL_GRID === "number" ? DUEL_GRID : 30;
  const arenaGrid = typeof ARENA_GRID === "number" ? ARENA_GRID : duelGrid * 2;
  liveGridSize = roomMode === "arena" ? arenaGrid : duelGrid;
  if (typeof scheduleResizeCanvas === "function") scheduleResizeCanvas();
  if (typeof gridReadout !== "undefined" && gridReadout) {
    gridReadout.textContent = `${liveGridSize} × ${liveGridSize}`;
  }
  if (typeof roomModeSelect !== "undefined" && roomModeSelect) roomModeSelect.value = roomMode;
  const previousPlayerCount = (roomRole === "player" ? 1 : 0)
    + [...roomPeers.values()].filter((player) => (
    Number(player.slot) >= 0 && Number(player.slot) < roomCapacity
    )).length;
  const nextPlayerCount = players.filter((player) => (
    Number(player?.slot) >= 0 && Number(player?.slot) < roomCapacity
  )).length;
  authoritativeDeparturePending = previousPlayerCount >= roomCapacity && nextPlayerCount < roomCapacity;
  reconcileLocalRoomReady(players);
  roomWaitingPlayers = Array.isArray(waiting) ? waiting : [];
  roomQueuePosition = Number(queuePosition) || 0;
  roomPeers = new Map(players
    .filter((player) => player?.id && player.id !== clientId)
    .map((player) => [player.id, {
      id: player.id,
      connected: true,
      ready: Boolean(player.ready),
      slot: Number.isInteger(player.slot) ? player.slot : -1,
      seenAt: Number.isFinite(Number(player.seenAt)) ? Number(player.seenAt) : Date.now(),
      profile: player.profile && typeof player.profile === "object" ? player.profile : null,
    }]));
  roomPlayers = activeRoomRoster().slice(0, roomCapacity);
}

function setRoomReadyIntent(nextReady, pending = true) {
  roomReadyDesired = Boolean(nextReady);
  roomReady = roomReadyDesired;
  roomReadyUpdatePending = Boolean(pending);
  if (!roomReadyDesired) roomReadyConfirmed = false;
}

function postRoomMessage(message) {
  return roomTransport?.send(message) || false;
}

function updateRosterSlot(element, player, index) {
  element.classList.toggle("connected", Boolean(player));
  [...element.classList]
    .filter((name) => name.startsWith("accent-") || name.startsWith("snake-"))
    .forEach((name) => element.classList.remove(name));
  element.querySelector("span").textContent = `PLAYER ${index + 1}`;
  if (!player) {
    element.querySelector("strong").textContent = "OPEN";
    return;
  }
  const username = String(player.profile?.username || "").slice(0, 32);
  const name = player.id === clientId
    ? "YOU"
    : String(player.profile?.callsign || player.profile?.displayName || "RIVAL").slice(0, 24).toUpperCase();
  const identity = username ? `${name} · @${username}` : name;
  element.classList.add(`accent-${player.profile?.accent || "acid"}`);
  element.classList.add(`snake-${player.profile?.snakeStyle || "signal"}`);
  const favoriteMode = String(player.profile?.favoriteMode || "classic").toUpperCase();
  const snakeStyle = String(player.profile?.snakeStyle || "signal").toUpperCase();
  element.querySelector("span").textContent = `PLAYER ${index + 1} · ${snakeStyle} · ${favoriteMode}`;
  element.querySelector("strong").textContent = `${identity} · ${player.ready ? "READY" : "CONNECTED"}`;
}

function activeRoomRoster() {
  const peers = [...roomPeers.values()].filter((peer) => (
    roomTransport?.authoritative || Date.now() - peer.seenAt < PEER_TIMEOUT
  ));
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
  const authoritativeDeparture = authoritativeDeparturePending;
  authoritativeDeparturePending = false;
  const roomRoster = activeRoomRoster();
  roomPlayers = roomRoster.slice(0, roomCapacity);
  updateRosterSlot(roomSlotOne, roomPlayers[0], 0);
  updateRosterSlot(roomSlotTwo, roomPlayers[1], 1);
  updateRosterSlot(roomSlotThree, roomPlayers[2], 2);
  updateRosterSlot(roomSlotFour, roomPlayers[3], 3);
  roomRoster?.classList.toggle("room-arena", roomMode === "arena");
  roomModeSelect.disabled = roomRole !== "player" || roomSlot !== 0 || runState === "running";
  roomModeHelp.textContent = roomRole === "player" && roomSlot === 0
    ? "Seat 1 chooses the mode before a round."
    : "Only Seat 1 can change the room mode.";
  if (roomWaiting) {
    roomWaiting.replaceChildren(...roomWaitingPlayers.map((player) => {
      const entry = document.createElement("div");
      entry.textContent = `${Number(player.position) || 0}. ${
        player.id === clientId ? "YOU" : String(
          player.profile?.callsign || player.profile?.displayName || "PLAYER",
        ).toUpperCase()
      }`;
      return entry;
    }));
  }
  if (roomQueueState) {
    roomQueueState.textContent = roomRole === "player"
      ? "YOU'RE IN · READY WHEN YOU ARE"
      : roomQueuePosition === 1
        ? "NEXT UP · WATCHING LIVE"
        : roomQueuePosition > 1
          ? `WAITING LINE · POSITION ${roomQueuePosition}`
          : roomConnected ? "WATCHING LIVE" : "NOT CONNECTED";
  }
  const localIndex = roomPlayers.findIndex((player) => player.id === clientId);
  const participants = roomPlayers.map((player) => ({
    connected: true,
    ready: Boolean(player.ready),
  }));
  const phase = Rules.liveRoomPhase(participants);

  readyRoomButton.disabled = !roomConnected || localIndex < 0 || runState === "running";
  readyRoomButton.setAttribute("aria-pressed", String(roomReady));
  readyRoomButton.querySelector("span").textContent = roomReady ? "Not ready" : "Ready";
  connectRoomButton.querySelector("span").textContent = roomTransport ? "Disconnect" : "Connect room";
  roomCodeInput.disabled = Boolean(roomTransport);

  const queuedViewer = roomConnected && roomRole === "spectator" && roomQueuePosition > 0;
  if (queuedViewer) {
    roomState.textContent = roomQueuePosition === 1
      ? "NEXT UP · WATCHING LIVE"
      : roomQueuePosition > 1
        ? `WAITING LINE · POSITION ${roomQueuePosition}`
        : "WATCHING LIVE";
    readyRoomButton.disabled = true;
    if (runState === "ready" || runState === "over" || runState === "running") {
      if (runState !== "running") {
        setRunState("ready", roomQueuePosition === 1 ? "NEXT UP" : "IN WAITING LINE");
      }
      showOverlay(
        roomQueuePosition === 1 ? "NEXT UP" : "WAITING LINE",
        roomQueuePosition === 1 ? "YOU'RE<br><em>UP NEXT</em>" : `POSITION ${roomQueuePosition}<br><em>IN LINE</em>`,
        "Watching the live room. You will be seated automatically when a seat opens.",
      );
    }
  } else if (phase === "waiting") {
    roomState.textContent = roomConnected ? "WAITING FOR PLAYER 2" : "NOT CONNECTED";
    if (liveCountdownActive) abortLiveCountdown();
    if (runState === "ready" || (runState === "over" && authoritativeDeparture)) {
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
      const now = Date.now();
      const round = now;
      if (pendingCountdownAttempts >= 2) {
        roomState.textContent = "COUNTDOWN REQUEST FAILED · RETRY READY";
        return;
      }
      if (pendingCountdownRound && now < pendingCountdownExpiresAt) return;
      postRoomMessage({
        type: "countdown",
        round,
        startsAt: now + 3_200,
      });
      pendingCountdownRound = round;
      pendingCountdownExpiresAt = now + 1_500;
      pendingCountdownAttempts += 1;
      if (!roomTransport?.authoritative) {
        beginLiveCountdown(Date.now() + 3_200, round);
      }
    }
  }
  if (roomConnectionState === "reconnecting") {
    roomState.textContent = "ROOM LINK RECONNECTING";
  }
  updateHud();
}

function handleRoomStatus(status) {
  if (!status || typeof status !== "object") return;
  if (status.state === "synchronized") {
    updateAuthoritativeRoomRole(status.role, status.slot);
    applyAuthoritativeRoomRoster(status.players, status.waiting, status.queuePosition, status.mode, status.capacity);
    if (roomTransport) syncLiveRoom();
    return;
  }
  if (status.state === "reconnecting") {
    roomConnected = false;
    roomConnectionState = "reconnecting";
    roomLatency.textContent = "REALTIME PING · RECONNECTING";
    if (liveCountdownActive) abortLiveCountdown();
    roomState.textContent = "ROOM LINK RECONNECTING";
    announcement.textContent = status.code === "timeout"
      ? "Room request timed out. Reconnecting."
      : "Room link interrupted. Reconnecting.";
    return;
  }
  if (status.state === "rejected") {
    pendingCountdownRound = 0;
    pendingCountdownExpiresAt = 0;
    roomConnectionState = "degraded";
    if (liveCountdownActive) abortLiveCountdown();
    roomState.textContent = "ROOM UPDATE REJECTED · RETRYING";
    if (pendingCountdownAttempts >= 2) {
      roomState.textContent = "COUNTDOWN REQUEST FAILED · RETRY READY";
    }
    announcement.textContent = "The room service rejected one update. It was discarded instead of retrying forever.";
    return;
  }
  if (status.state === "latency") {
    const latency = Math.max(0, Math.round(Number(status.latency) || 0));
    liveLatencyMs = liveLatencyMs
      ? liveLatencyMs * .7 + latency * .3
      : latency;
    if (Number.isFinite(Number(status.clockOffset))) {
      liveClockOffsetMs = Number(status.clockOffset);
    }
    roomLatency.textContent = `REALTIME PING · ${latency} MS · PREDICTION ON`;
    return;
  }
  if (status.state !== "connected") return;
  roomConnectionState = "connected";
  roomConnected = true;
  roomLatency.textContent = "WEBSOCKET CONNECTED · MEASURING";
  updateAuthoritativeRoomRole(status.role, status.slot);
  applyAuthoritativeRoomRoster(status.players, status.waiting, status.queuePosition, status.mode, status.capacity);
  if (roomTransport) syncLiveRoom();
}

function updateAuthoritativeRoomRole(nextRole, nextSlot) {
  const next = nextRole === "player" ? "player" : "spectator";
  const changed = roomRole !== next;
  roomRole = next;
  roomSlot = next === "player" && Number.isInteger(nextSlot) ? nextSlot : -1;
  if (changed) {
    roomReadyDesired = false;
    roomReady = false;
    roomReadyConfirmed = false;
    roomReadyUpdatePending = false;
    announcement.textContent = next === "player"
      ? "You’re in. Press Ready when you want to play."
      : "You joined the waiting line.";
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
  roomLatency.textContent = "REALTIME PING · OPENING LINK";
  roomPeers = new Map();
  authoritativeDeparturePending = false;
  setRoomReadyIntent(false);
  roomRole = "disconnected";
  roomSlot = -1;
  roomConnectionState = "connecting";

  try {
    const realtimeUrl = globalThis.NEON_SNAKE_CONFIG?.realtimeUrl;
    roomTransport = realtimeUrl
      ? await Transports.createWebSocketRoomTransport({
        code: normalized,
        clientId,
        endpoint: realtimeUrl,
        onMessage: handleRoomMessage,
        onStatus: handleRoomStatus,
      })
      : await Transports.createRemoteRoomTransport({
        code: normalized,
        clientId,
        onMessage: handleRoomMessage,
        onStatus: handleRoomStatus,
      });
    postRoomMessage({ type: "ready", ready: false });
  } catch (error) {
    roomTransport = null;
    roomConnected = false;
    roomRole = "disconnected";
    roomSlot = -1;
    roomConnectionState = "disconnected";
    roomCodeInput.disabled = false;
    connectRoomButton.disabled = false;
    roomState.textContent = "LIVE ROOM SERVICE UNAVAILABLE";
    roomLatency.textContent = "REALTIME PING · UNAVAILABLE";
    announcement.textContent = "The live room service could not connect.";
    console.warn("Live room transport could not start.", {
      name: typeof error?.name === "string" ? error.name : "Error",
    });
    return;
  }

  if (!roomTransport.authoritative) roomConnected = true;
  connectRoomButton.disabled = false;
  roomSweep = setInterval(syncLiveRoom, 700);
  const url = new URL(window.location.href);
  url.search = activityEmbedded ? activityQuery.toString() : "";
  url.searchParams.delete("room");
  url.searchParams.delete("type");
  url.searchParams.set("room", roomCode);
  url.searchParams.set("type", "live");
  history.replaceState(null, "", url);
  syncLiveRoom();
  announcement.textContent = roomConnected
    ? `Connected to room ${roomCode}.`
    : `Opening the realtime link for room ${roomCode}.`;
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
  setRoomReadyIntent(false, false);
  roomConnected = false;
  roomRole = "disconnected";
  roomSlot = -1;
  roomConnectionState = "disconnected";
  liveLatencyMs = 0;
  liveClockOffsetMs = null;
  pendingCountdownRound = 0;
  pendingCountdownExpiresAt = 0;
  pendingCountdownAttempts = 0;
  roomLatency.textContent = "REALTIME PING · NOT MEASURED";
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
  setRoomReadyIntent(!roomReadyDesired);
  postRoomMessage({ type: "ready", ready: roomReady });
  syncLiveRoom();
}

function beginLiveCountdown(startsAt, round) {
  if (!Number.isSafeInteger(round) || round < 1) return;
  if (
    round < liveRoundId
    || runState === "running"
    || (round === liveRoundId && runState !== "ready")
  ) return;
  if (!liveRoomGateOpen()) return;
  if (liveCountdownActive) {
    clearInterval(liveCountdownTimer);
    liveCountdownTimer = null;
    liveCountdownActive = false;
  }
  liveCountdownActive = true;
  pendingCountdownRound = 0;
  pendingCountdownExpiresAt = 0;
  pendingCountdownAttempts = 0;
  resetDuel();
  liveRoundId = round;
  setRunState("countdown", "LIVE DUEL COUNTDOWN");
  aiStartButton.hidden = true;

  let displayedNumber = null;
  const update = () => {
    if (!liveRoomGateOpen()) {
      abortLiveCountdown();
      return;
    }
    const offset = typeof liveClockOffsetMs === "number" ? liveClockOffsetMs : 0;
    const localStartsAt = startsAt - offset;
    const remaining = Math.max(0, localStartsAt - Date.now());
    const number = Math.max(1, Math.ceil(remaining / 1000));
    if (number !== displayedNumber) {
      displayedNumber = number;
      overlay.hidden = false;
      overlayKicker.textContent = "TWO PLAYERS LOCKED";
      overlayTitle.textContent = String(number);
      overlayTitle.classList.add("countdown");
      overlayMessage.textContent = "The room starts only while both remain connected.";
    }
    if (remaining <= 0) {
      clearInterval(liveCountdownTimer);
      liveCountdownTimer = null;
      liveCountdownActive = false;
      startLiveDuel();
    }
  };
  update();
  liveCountdownTimer = setInterval(update, 100);
}

function abortLiveCountdown() {
  clearInterval(liveCountdownTimer);
  liveCountdownTimer = null;
  liveCountdownActive = false;
  pendingCountdownRound = 0;
  pendingCountdownExpiresAt = 0;
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
  nextMoveAt = roomTransport?.authoritative
    ? lastMoveAt + TICK_DURATION
    : roomPlayers[0]?.id === clientId ? lastMoveAt + TICK_DURATION : 0;
  setRunState("running", "LIVE DUEL ACTIVE");
  roomState.textContent = "LIVE DUEL ACTIVE";
  if (!roomTransport?.authoritative && roomPlayers[0]?.id === clientId) {
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
      playerInputAck: 0,
      guestInputAck,
      crashes: result.crashes,
      over: result.over,
      winner: result.winner,
    },
  });
}

function applyRemoteSnapshot(message) {
  if (
    message.sequence <= lastRemoteSequence
    || (!roomTransport?.authoritative && roomPlayers[0]?.id === clientId)
  ) return;
  const state = message.state;
  if (state?.round !== liveRoundId) return;
  if (Array.isArray(state?.snakes) && Number.isInteger(state.gridSize)) {
    previousLiveSnakes = liveSnakes.map((snake) => ({
      ...snake,
      body: cloneSnake(snake.body || []),
    }));
    liveGridSize = state.gridSize;
    roomMode = state.mode === "arena" ? "arena" : roomMode;
    liveSnakes = state.snakes.map((snake) => ({
      slot: Number(snake.slot),
      body: cloneSnake(snake.body || snake.snake || []),
      direction: { ...snake.direction },
      score: Number(snake.score) || 0,
      alive: snake.alive !== false,
    }));
    liveFoods = Array.isArray(state.foods)
      ? state.foods.map((pellet) => ({ ...pellet }))
      : state.food ? [{ ...state.food }] : [];
    const local = liveSnakes.find((snake) => snake.slot === roomSlot);
    if (local) {
      playerSnake = cloneSnake(local.body);
      playerDirection = { ...local.direction };
      playerScore = local.score;
    }
    lastRemoteSequence = message.sequence;
    updateHud();
    if (state.over && runState === "running") endDuel(state.winner, state.crashes);
    return;
  }
  if (!state?.playerSnake?.length || !state?.opponentSnake?.length) return;
  const localIndex = roomPlayers.findIndex((player) => player.id === clientId);
  const localSequences = localIndex === 0 ? playerInputSequences : opponentInputSequences;
  const localBuffer = localIndex === 0 ? playerInputBuffer : opponentInputBuffer;
  const acknowledged = Number(localIndex === 0 ? state.playerInputAck : state.guestInputAck) || 0;
  while (localSequences.length && localSequences[0] <= acknowledged) {
    localSequences.shift();
    localBuffer.shift();
  }
  playerPredictionIndex = 0;
  opponentPredictionIndex = 0;
  lastRemoteSequence = message.sequence;
  previousPlayerSnake = cloneSnake(
    authoritativePlayerSnake.length ? authoritativePlayerSnake : state.playerSnake,
  );
  previousOpponentSnake = cloneSnake(
    authoritativeOpponentSnake.length ? authoritativeOpponentSnake : state.opponentSnake,
  );
  playerSnake = cloneSnake(state.playerSnake);
  opponentSnake = cloneSnake(state.opponentSnake);
  authoritativePlayerSnake = cloneSnake(state.playerSnake);
  authoritativeOpponentSnake = cloneSnake(state.opponentSnake);
  playerDirection = { ...state.playerDirection };
  opponentDirection = { ...state.opponentDirection };
  playerScore = Number(state.playerScore) || 0;
  opponentScore = Number(state.opponentScore) || 0;
  food = state.food ? { ...state.food } : null;
  signalCursor = Number(state.signalCursor) >>> 0;
  const interpolationOffset = networkInterpolationOffset(
    message.sentAt,
    Date.now(),
    liveLatencyMs,
    liveClockOffsetMs,
  );
  const frameNow = performance.now();
  const targetLastMoveAt = frameNow - interpolationOffset;
  const correction = Math.max(-24, Math.min(24, targetLastMoveAt - lastMoveAt));
  lastMoveAt = Math.min(frameNow, lastMoveAt + correction);
  nextMoveAt = Math.max(frameNow + 8, lastMoveAt + TICK_DURATION);
  updateHud();
  if (state.over && runState === "running") endDuel(state.winner, state.crashes);
}

function cancelLiveRound(message) {
  const departedSlot = Number.isInteger(message?.slot) ? message.slot : -1;
  const authoritativeDeparture = departedSlot >= 0 && departedSlot < LIVE_ROOM_CAPACITY;
  if (authoritativeDeparture) {
    roomPeers = new Map([...roomPeers].filter(([, peer]) => peer.slot !== departedSlot));
  }
  const wasActive = liveCountdownActive || runState === "countdown" || runState === "running";
  const completedDeparture = runState === "over" && authoritativeDeparture;
  setRoomReadyIntent(false, false);
  if (liveCountdownActive) abortLiveCountdown();
  nextMoveAt = 0;
  syncLiveRoom();
  if (duelType === "live" && roomRole === "spectator" && roomQueuePosition > 0) {
    setRunState("ready", roomQueuePosition === 1 ? "NEXT UP" : "IN WAITING LINE");
    showOverlay(
      roomQueuePosition === 1 ? "NEXT UP" : "WAITING LINE",
      roomQueuePosition === 1 ? "YOU'RE<br><em>UP NEXT</em>" : `POSITION ${roomQueuePosition}<br><em>IN LINE</em>`,
      "The live round ended. Keep watching while the waiting line advances.",
    );
    announcement.textContent = roomQueuePosition === 1
      ? "A seat opened. You are next up."
      : "The live round ended. You remain in the waiting line.";
    return;
  }
  if (completedDeparture && duelType === "live") {
    setRunState("ready", "WAITING FOR PLAYER 2");
    showOverlay(
      "LIVE ROOM",
      "WAITING FOR<br><em>PLAYER 2</em>",
      "The previous rival disconnected. The completed result was cleared for the next room.",
    );
    announcement.textContent = "The previous rival disconnected. Waiting for Player 2.";
    return;
  }
  if (!wasActive || duelType !== "live") return;
  setRunState("ready", "RIVAL DISCONNECTED");
  roomState.textContent = "ROUND CANCELLED · WAITING FOR PLAYER";
  showOverlay(
    "CONNECTION LOST",
    "LIVE ROUND<br><em>CANCELLED</em>",
    "The server stopped the duel immediately. The room must synchronize both players before another round.",
  );
  announcement.textContent = "Live duel cancelled because a player disconnected.";
}

function handleRoomMessage(message) {
  if (!message || message.room !== roomCode) return;
  if (message.from === clientId && message.type !== "countdown") return;
  if (message.type === "countdown-cancel") {
    pendingCountdownRound = 0;
    pendingCountdownExpiresAt = 0;
    pendingCountdownAttempts = 0;
    cancelLiveRound(message);
    return;
  }
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
      profile: message.profile && typeof message.profile === "object" ? message.profile : null,
    });
    if (roomTransport) syncLiveRoom();
    return;
  }
  if (message.type === "countdown") {
    const startsAt = Number(message.startsAt);
    const round = Number(message.round);
    if (Number.isFinite(startsAt) && Number.isSafeInteger(round)) {
      pendingCountdownRound = 0;
      pendingCountdownExpiresAt = 0;
      pendingCountdownAttempts = 0;
      beginLiveCountdown(startsAt, round);
    }
    return;
  }
  if (
    message.type === "input"
    && !roomTransport?.authoritative
    && roomPlayers[0]?.id === clientId
  ) {
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
  if (globalThis.NeonSnakeActivity?.embedded) {
    try {
      await globalThis.NeonSnakeActivity.invite();
      roomState.textContent = "DISCORD INVITE OPEN";
      announcement.textContent = "Discord invite dialog opened.";
    } catch {
      roomState.textContent = "DISCORD INVITE UNAVAILABLE";
    }
    return;
  }
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
      setRoomReadyIntent(false);
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
  if (activityEmbedded) return;
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
roomModeSelect.addEventListener("change", () => {
  if (roomRole !== "player" || roomSlot !== 0 || runState === "running") {
    roomModeSelect.value = roomMode;
    return;
  }
  postRoomMessage({ type: "set-mode", mode: roomModeSelect.value });
  announcement.textContent = `Room mode requested: ${roomModeSelect.value.toUpperCase()}.`;
});
copyRoomButton.addEventListener("click", copyRoomLink);
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^23456789A-HJ-NP-Z]/g, "").slice(0, 6);
});
globalThis.NeonSnakeTouchControls.bindSwipe(
  board,
  (name) => requestDirection(DIRECTIONS[name]),
);
globalThis.NeonSnakeTouchControls.bindDirectionButtons(
  document,
  "[data-duel-direction]",
  (name) => requestDirection(DIRECTIONS[name]),
);
window.addEventListener("keydown", handleKeyboard);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
  } else {
    startRendering();
  }
});
window.addEventListener("beforeunload", () => {
  if (roomTransport) postRoomMessage({ type: "leave" });
  roomTransport?.close();
  cancelAnimationFrame(frameHandle);
});
window.addEventListener("load", registerServiceWorker, { once: true });
function scheduleResizeCanvas() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resizeCanvas();
  });
}
if ("ResizeObserver" in window) new ResizeObserver(scheduleResizeCanvas).observe(board);
else window.addEventListener("resize", scheduleResizeCanvas);

resizeCanvas();
startRendering();

function renderActivityFailure(error) {
  activityContext.classList.add("is-error");
  activityContextTitle.textContent = "DISCORD LINK OFFLINE · LOCAL DUEL READY";
  activityContextDetail.textContent = `${error?.message || "Discord authentication failed."} Return to Solo or retry the Activity connection.`;
  activityContextRetry.hidden = false;
  activityContextRetry.disabled = false;
  roomState.textContent = "ACTIVITY AUTHENTICATION FAILED";
  connectRoomButton.disabled = true;
  const invited = hydrateRoomCode();
  switchDuelType(invited || liveRoomRequested() ? "live" : "ai");
}

async function initializeDuelSurface() {
  if (globalThis.NeonSnakeActivity?.embedded) {
    activityContext.hidden = false;
    document.body.classList.add("activity-mode");
    try {
      const activity = await globalThis.NeonSnakeActivity.ready;
      activityContext.classList.remove("is-error");
      activityContextTitle.textContent = "CHANNEL INSTANCE CONNECTED";
      activityContextDetail.textContent = `Shared room ${activity.roomCode} · authenticated as @${activity.user.username}`;
      activityContextRetry.hidden = true;
      activityContextRetry.disabled = false;
      connectRoomButton.disabled = false;
      copyRoomButton.textContent = "INVITE";
      roomCodeInput.readOnly = true;
      document.querySelector(".duel-intro .section-kicker").textContent = "DISCORD ACTIVITY";
      document.querySelector("#duelTitle").innerHTML = "Your channel.<br><em>One live board.</em>";
      document.querySelector(".duel-intro > p").textContent = "Everyone in this Activity instance joins the same server-authoritative room. Press Ready when both players appear.";
    } catch (error) {
      renderActivityFailure(error);
      return;
    }
  }
  const invitedToLiveRoom = hydrateRoomCode();
  switchDuelType(invitedToLiveRoom || liveRoomRequested() ? "live" : "ai");
  if (invitedToLiveRoom) await connectLiveRoom();
}

activityContextRetry.addEventListener("click", async () => {
  activityContextRetry.disabled = true;
  activityContextTitle.textContent = "RECONNECTING TO DISCORD…";
  activityContextDetail.textContent = "Local Autopilot remains available while the shared instance reconnects.";
  try {
    await globalThis.NeonSnakeActivity?.retry();
    await initializeDuelSurface();
  } catch (error) {
    renderActivityFailure(error);
  }
});

globalThis.addEventListener("neon-activity-external-error", (event) => {
  if (!activityEmbedded) return;
  activityContext.hidden = false;
  activityContext.classList.add("is-error");
  activityContextTitle.textContent = "ACTIVITY STAYED OPEN";
  activityContextDetail.textContent = `${event.detail?.message || "Discord could not open that page."} Try again after Discord finishes connecting.`;
});

void initializeDuelSurface();
