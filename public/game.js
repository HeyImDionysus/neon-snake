"use strict";

const Rules = window.SnakeRules;
const motionProgress = Rules.motionProgress || ((elapsed, duration) => {
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / duration));
});
const $ = (selector) => document.querySelector(selector);
const canvas = $("#gameCanvas");
const ctx = canvas.getContext("2d");
const boardBackdrop = document.createElement("canvas");
boardBackdrop.width = canvas.width;
boardBackdrop.height = canvas.height;
const boardBackdropCtx = boardBackdrop.getContext("2d");
const canvasPaintLayer = document.createElement("canvas");
canvasPaintLayer.width = canvas.width;
canvasPaintLayer.height = canvas.height;
const canvasPaintLayerCtx = canvasPaintLayer.getContext("2d");
const gameConsole = $(".game-console");
const boardWrap = $("#boardWrap");
const overlay = $("#overlay");
const overlayKicker = $("#overlayKicker");
const overlayTitle = $("#overlayTitle");
const overlayMessage = $("#overlayMessage");
const startButton = $("#startButton");
const startButtonLabel = $("#startButtonLabel");
const demoButton = $("#demoButton");
const demoButtonLabel = $("#demoButtonLabel");
const overlayHint = $(".overlay-hint");
const pauseButton = $("#pauseButton");
const pauseButtonLabel = $("#pauseButtonLabel");
const restartButton = $("#restartButton");
const shareButton = $("#shareButton");
const exportButton = $("#exportButton");
const canvasInstruction = $("#canvasInstruction");
const mobilePause = $("#mobilePause");
const soundButton = $("#soundButton");
const difficultySelect = $("#difficulty");
const signalButton = $("#signalButton");
const signalCode = $("#signalCode");
const lensButton = $("#lensButton");
const lensState = $("#lensState");
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const scoreEl = $("#score");
const levelEl = $("#level");
const comboEl = $("#combo");
const mutationStat = $("#mutationStat");
const mutationName = $("#mutationName");
const echoStat = $("#echoStat");
const echoState = $("#echoState");
const bestEl = $("#best");
const totalRunsEl = $("#totalRuns");
const longestEl = $("#longest");
const timerStat = $("#timerStat");
const rushTimeEl = $("#rushTime");
const modeChip = $("#modeChip");
const statusText = $("#statusText");
const announcement = $("#gameAnnouncement");
const objectiveLabel = $("#objectiveLabel");
const objectiveText = $("#objectiveText");
const objectiveProgress = $("#objectiveProgress");
const comboMeterFill = $("#comboMeter span");
const pickupToast = $("#pickupToast");
const pickupName = $("#pickupName");
const pickupPoints = $("#pickupPoints");
const aiLens = $("#aiLens");
const aiLensLabel = $("#aiLensLabel");
const aiPlan = $("#aiPlan");
const aiReason = $("#aiReason");
const aiEvidence = $("#aiEvidence");
const runRank = $("#runRank");
const rankValue = $("#rankValue");
const decisionReport = $("#decisionReport");
const decisionStyle = $("#decisionStyle");
const decisionMatch = $("#decisionMatch");
const decisionSpace = $("#decisionSpace");
const decisionRisk = $("#decisionRisk");
const decisionSummary = $("#decisionSummary");
const topRunsEl = $("#topRuns");

const GRID = 20;
let TILE = canvas.width / GRID;
const COMBO_WINDOW = 3600;
const OVERDRIVE_DURATION = 5200;
const {
  coreDuration: CORE_DURATION,
  mutationDuration: MUTATION_DURATION,
  rushDuration: RUSH_DURATION,
} = Rules.soloTiming();
const MAX_FRAME_CATCH_UP_STEPS = 3;
const MAX_DEADLINE_DRAIN_STEPS = 8;
const CANVAS_MARK_LIMIT = 1400;
const CANVAS_BRUSH_LENGTH = 18;
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const STARTING_SNAKE = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const DIRECTION_OPTIONS = [
  { name: "up", ...DIRECTIONS.up },
  { name: "right", ...DIRECTIONS.right },
  { name: "down", ...DIRECTIONS.down },
  { name: "left", ...DIRECTIONS.left },
];
const PACES = Rules.paceProfiles();
const CANVAS_PALETTES = [
  { name: "ACID", color: "#adff66", glow: "#adff66" },
  { name: "AURORA", color: "#74e1ff", glow: "#58d6ff" },
  { name: "VIOLET", color: "#a98bff", glow: "#a98bff" },
  { name: "EMBER", color: "#ff7657", glow: "#ff7657" },
  { name: "SOLAR", color: "#ffd166", glow: "#ffd166" },
];

let snake = [];
let previousSnake = [];
let food = null;
let direction = { ...DIRECTIONS.right };
let queuedDirection = { ...direction };
let directionBuffer = [];
let score = 0;
let level = 1;
let foodCount = 0;
let combo = 1;
let lastEatAt = 0;
let comboExpiresAt = 0;
let runState = "ready";
let activeMode = "classic";
let countdownTimer = null;
let countdownStep = 0;
let countdownSuspended = false;
let rushDeadline = 0;
let rushRemaining = RUSH_DURATION;
let rushDrainPending = false;
let pausedAt = 0;
let pausedMotionProgress = 1;
let pausedStepRemaining = 0;
let lastMoveAt = performance.now();
let nextMoveAt = 0;
let stepDuration = PACES.arcade.base;
let overdriveUntil = 0;
let mutation = { type: null, expiresAt: 0 };
let demoMode = false;
let particles = [];
let ripples = [];
let runPath = [];
let ghostPath = [];
let ghostStep = 0;
let echoBeaten = false;
let aiEvaluations = [];
let aiChoice = null;
let aiPlanKey = "";
let aiPlanInsight = null;
let aiPlanDuration = 0;
let autopilotHistory = [];
let autopilotPlan = [];
let autopilotPlanMode = "";
let autopilotPlanTarget = "";
let canvasMarks = [];
let canvasStrokeCount = 0;
let canvasPaletteIndex = 0;
let canvasCompositionState = null;
let canvasCompositionBudget = 0;
let canvasCompositionName = "";
let canvasCompositionActive = false;
let lastFrame = performance.now();
let renderFrame = 0;
let lastGamepadPoll = 0;
let gamepadDirection = "";
let gamepadPausePressed = false;
let soundEnabled = getStored("neon-snake-sound", "true") !== "false";
let lensEnabled = getStored("neon-snake-lens", "false") === "true";
let profile = loadProfile();
let runSignal = "";
let signalRandomState = 0;
let decisionStats = { decisions: 0, matches: 0, spaceRatioTotal: 0, riskTurns: 0 };
let lastDecisionProfile = Rules.decisionProfile();

function getStored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function setStored(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage is optional; gameplay remains fully functional without it.
  }
}

function loadProfile() {
  const legacyBest = Number(getStored("neon-snake-best", "0")) || 0;
  const fallback = { best: legacyBest, runs: 0, longest: 3, topRuns: [], replays: {} };
  try {
    const saved = JSON.parse(localStorage.getItem("neon-snake-profile") || "null");
    if (!saved) return fallback;
    return {
      best: Math.max(legacyBest, Number(saved.best) || 0),
      runs: Number(saved?.runs) || 0,
      longest: Math.max(3, Number(saved?.longest) || 3),
      topRuns: Rules.sortedTopRuns(Array.isArray(saved?.topRuns) ? saved.topRuns : []),
      replays: {
        classic: Rules.normalizeReplay(saved?.replays?.classic, GRID),
        portal: Rules.normalizeReplay(saved?.replays?.portal, GRID),
        rush: Rules.normalizeReplay(saved?.replays?.rush, GRID),
      },
    };
  } catch {
    return fallback;
  }
}

function saveProfile() {
  setStored("neon-snake-profile", JSON.stringify(profile));
}

function formatScore(value) {
  return String(value).padStart(5, "0");
}

function focusWithoutScroll(element) {
  if (!element || element.hidden || element.disabled) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function selectedMode() {
  return modeInputs.find((input) => input.checked)?.value || "classic";
}

function modeLabel(mode = activeMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function updateStartChoices() {
  const label = modeLabel();
  startButtonLabel.textContent = activeMode === "canvas" ? "Play Canvas" : `Play ${label}`;
  demoButtonLabel.textContent = `Watch Autopilot play ${label}`;
}

function createSignalCode() {
  const values = new Uint32Array(6);
  try {
    globalThis.crypto.getRandomValues(values);
  } catch {
    let fallbackState = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
    for (let index = 0; index < values.length; index += 1) {
      const next = Rules.nextSignalRandom(fallbackState);
      fallbackState = next.state;
      values[index] = Math.floor(next.value * 4294967296);
    }
  }
  return [...values].map((value) => SIGNAL_ALPHABET[value % SIGNAL_ALPHABET.length]).join("");
}

function hydrateChallengeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get("mode");
  const requestedPace = params.get("pace");
  const requestedSignal = Rules.normalizeSignalCode(params.get("signal"));

  if (["classic", "portal", "rush", "canvas"].includes(requestedMode)) {
    const input = modeInputs.find((option) => option.value === requestedMode);
    if (input) input.checked = true;
  }
  if (Object.hasOwn(PACES, requestedPace)) difficultySelect.value = requestedPace;
  runSignal = requestedSignal || createSignalCode();
  signalCode.textContent = runSignal;
}

function challengeUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("signal", runSignal);
  url.searchParams.set("mode", activeMode);
  url.searchParams.set("pace", difficultySelect.value);
  return url;
}

function syncChallengeUrl() {
  try {
    history.replaceState(null, "", challengeUrl());
  } catch {
    // A local file can still play and share its visible Signal Code.
  }
}

function resetRun() {
  nextMoveAt = 0;
  clearTimeout(countdownTimer);
  countdownTimer = null;
  countdownStep = 0;
  countdownSuspended = false;
  signalRandomState = Rules.signalState(runSignal);
  snake = STARTING_SNAKE.map((segment) => ({ ...segment }));
  previousSnake = snake.map((segment) => ({ ...segment }));
  direction = { ...DIRECTIONS.right };
  queuedDirection = { ...direction };
  directionBuffer = [];
  score = 0;
  level = 1;
  foodCount = 0;
  combo = 1;
  lastEatAt = 0;
  comboExpiresAt = 0;
  rushRemaining = RUSH_DURATION;
  rushDrainPending = false;
  overdriveUntil = 0;
  mutation = { type: null, expiresAt: 0 };
  pausedMotionProgress = 1;
  pausedStepRemaining = 0;
  lastMoveAt = performance.now();
  stepDuration = getTickDelay();
  particles = [];
  ripples = [];
  runPath = [{ ...snake[0] }];
  ghostStep = 0;
  echoBeaten = false;
  aiEvaluations = [];
  aiChoice = null;
  aiPlanKey = "";
  aiPlanInsight = null;
  aiPlanDuration = 0;
  autopilotHistory = [];
  autopilotPlan = [];
  autopilotPlanMode = "";
  autopilotPlanTarget = "";
  decisionStats = { decisions: 0, matches: 0, spaceRatioTotal: 0, riskTurns: 0 };
  lastDecisionProfile = Rules.decisionProfile();
  decisionReport.hidden = true;
  canvasMarks = [];
  canvasStrokeCount = 0;
  canvasPaintLayerCtx.clearRect(0, 0, canvasPaintLayer.width, canvasPaintLayer.height);
  canvasPaletteIndex = 0;
  canvasCompositionState = null;
  canvasCompositionBudget = 0;
  canvasCompositionName = "";
  canvasCompositionActive = false;
  gameConsole.classList.remove("overdrive", "mutation-flow", "mutation-amplify", "ai-driving");
  gameConsole.classList.toggle("canvas-mode", activeMode === "canvas");
  gameConsole.classList.toggle("ai-active", demoMode);
  aiLens.hidden = true;
  aiPlan.textContent = "SCANNING BOARD";
  aiReason.textContent = "SURVIVAL FIRST";
  aiEvidence.textContent = "NO BOARD SAMPLE";
  placeFood(performance.now());
  updateHud();
}

function openTiles() {
  const result = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!snake.some((segment) => segment.x === x && segment.y === y)) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

function placeFood(now) {
  autopilotHistory = [];
  autopilotPlan = [];
  autopilotPlanMode = "";
  autopilotPlanTarget = "";
  const available = openTiles();
  if (!available.length) {
    food = null;
    return;
  }
  const choice = Rules.signalIndex(signalRandomState, available.length);
  signalRandomState = choice.state;
  const position = available[choice.index];
  const isCore = foodCount > 0 && foodCount % 5 === 0;
  food = {
    ...position,
    kind: isCore ? "core" : "signal",
    expiresAt: isCore ? now + CORE_DURATION : 0,
  };
  if (demoMode && activeMode === "canvas") {
    canvasCompositionBudget = 14 + (signalRandomState % 12);
  }
  updateObjective();
}

function expireCore(now) {
  if (runState !== "running" || !food || food.kind !== "core" || now < food.expiresAt) return;
  foodCount += 1;
  placeFood(now);
  showPickup("CORE LOST", "KEEP MOVING");
  playTone(110, 0.08, "square", 0.025);
}

function buildBoardBackdrop() {
  const gradient = boardBackdropCtx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    0,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * .72,
  );
  gradient.addColorStop(0, "#122019");
  gradient.addColorStop(.58, "#09130e");
  gradient.addColorStop(1, "#040806");
  boardBackdropCtx.fillStyle = gradient;
  boardBackdropCtx.fillRect(0, 0, canvas.width, canvas.height);

  const blooms = [
    { x: .22, y: .28, radius: .42, color: "82, 178, 105", alpha: .075 },
    { x: .78, y: .68, radius: .46, color: "120, 91, 184", alpha: .055 },
    { x: .5, y: .88, radius: .36, color: "40, 112, 83", alpha: .05 },
  ];
  boardBackdropCtx.save();
  boardBackdropCtx.globalCompositeOperation = "lighter";
  blooms.forEach((bloom) => {
    const x = bloom.x * canvas.width;
    const y = bloom.y * canvas.height;
    const radius = bloom.radius * canvas.width;
    const haze = boardBackdropCtx.createRadialGradient(x, y, 0, x, y, radius);
    haze.addColorStop(0, `rgba(${bloom.color}, ${bloom.alpha})`);
    haze.addColorStop(1, `rgba(${bloom.color}, 0)`);
    boardBackdropCtx.fillStyle = haze;
    boardBackdropCtx.fillRect(0, 0, canvas.width, canvas.height);
  });
  boardBackdropCtx.restore();
}

function resizeCanvas() {
  const cssSize = Math.max(1, boardWrap.getBoundingClientRect().width);
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const backingSize = Math.max(1, Math.round(cssSize * pixelRatio));
  if (canvas.width === backingSize && canvas.height === backingSize) return;

  const previousPaintLayer = document.createElement("canvas");
  previousPaintLayer.width = canvasPaintLayer.width;
  previousPaintLayer.height = canvasPaintLayer.height;
  const previousPaintLayerCtx = previousPaintLayer.getContext("2d");
  if (previousPaintLayer.width && previousPaintLayer.height) {
    previousPaintLayerCtx.drawImage(canvasPaintLayer, 0, 0);
  }

  canvas.width = backingSize;
  canvas.height = backingSize;
  boardBackdrop.width = backingSize;
  boardBackdrop.height = backingSize;
  canvasPaintLayer.width = backingSize;
  canvasPaintLayer.height = backingSize;
  TILE = backingSize / GRID;
  particles = [];
  ripples = [];
  buildBoardBackdrop();
  if (canvasMarks.length && previousPaintLayer.width && previousPaintLayer.height) {
    canvasPaintLayerCtx.drawImage(
      previousPaintLayer,
      0,
      0,
      previousPaintLayer.width,
      previousPaintLayer.height,
      0,
      0,
      backingSize,
      backingSize,
    );
  } else {
    rebuildCanvasPaintLayer();
  }
}

function drawBoard(now) {
  ctx.drawImage(boardBackdrop, 0, 0);
  drawBoardAtmosphere(now);

  if (activeMode === "canvas") drawCanvasPaint(now);

  if (activeMode === "portal") drawPortals(now);
  if (activeMode === "canvas") drawCanvasBorder(now);
  if (activeMode === "rush" && runState === "running") drawRushBorder(now);
  if (mutation.type && now < mutation.expiresAt) drawMutationBorder(now);
  if (food) drawFood(now);
  drawGhost(now);
  drawAiForecast(now);
  drawSnake(now);
  drawAiDecision(now);
  drawEffects();
}

function drawBoardAtmosphere(now) {
  const time = now * .00012;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let index = 0; index < 22; index += 1) {
    const x = ((index * 193 + 71) % 701) / 701 * canvas.width;
    const baseY = ((index * 137 + 43) % 683) / 683 * canvas.height;
    const y = (baseY + Math.sin(time * 2 + index) * 5 + canvas.height) % canvas.height;
    const alpha = .035 + (Math.sin(time * 3 + index * 1.7) + 1) * .025;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = index % 5 === 0 ? "#a98bff" : "#d4ffa8";
    const size = index % 4 === 0 ? 2 : 1;
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
  }
  ctx.restore();
}

resizeCanvas();

function drawAiForecast(now) {
  if (!lensVisible() || !aiChoice?.forecast?.length) return;
  const renderedSnake = Rules.fluidMotionPath(
    previousSnake,
    snake,
    currentMotionProgress(now),
    GRID,
  );
  const path = [
    renderedSnake[0] || snake[0],
    snake[0],
    ...aiChoice.forecast,
  ];
  const groups = fluidPixelGroups(path);
  const color = "#74e1ff";

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = demoMode ? .22 : .17;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, TILE * .075);
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  strokeFluidGroups(ctx, groups);

  aiChoice.forecast.slice(1).forEach((point, index, future) => {
    const pixel = canvasPoint(point);
    const fade = 1 - index / Math.max(1, future.length);
    ctx.globalAlpha = (demoMode ? .42 : .32) * fade;
    ctx.beginPath();
    ctx.arc(pixel.x, pixel.y, Math.max(1.6, TILE * .055), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  ctx.restore();
}

function drawAiDecision(now) {
  if (!lensVisible() || !aiEvaluations.length) return;
  const head = snake[0];
  const headX = head.x * TILE + TILE / 2;
  const headY = head.y * TILE + TILE / 2;

  aiEvaluations.forEach((evaluation) => {
    if (!evaluation.head) return;
    const chosen = aiChoice?.name === evaluation.name;
    const x = evaluation.head.x * TILE + TILE / 2;
    const y = evaluation.head.y * TILE + TILE / 2;
    const color = evaluation.legal ? (chosen ? "#adff66" : "#74e1ff") : "#ff7657";
    const pulse = chosen ? .68 + Math.sin(now / 110) * .12 : evaluation.legal ? .3 : .24;

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = chosen ? 4 : 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = chosen ? 20 : 8;
    ctx.beginPath();
    ctx.arc(x, y, TILE * (chosen ? .34 : .29), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = evaluation.legal ? .12 : .08;
    ctx.beginPath();
    ctx.arc(x, y, TILE * (chosen ? .32 : .27), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = .9;
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = `700 ${chosen ? 10 : 8}px Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(evaluation.legal ? String(evaluation.space) : "×", x, y);
    ctx.restore();
  });

  if (aiChoice?.head) {
    const choiceX = aiChoice.head.x * TILE + TILE / 2;
    const choiceY = aiChoice.head.y * TILE + TILE / 2;
    const wraps = Math.abs(aiChoice.head.x - head.x) > 1 || Math.abs(aiChoice.head.y - head.y) > 1;
    if (!wraps) {
      ctx.save();
      ctx.globalAlpha = .55;
      ctx.strokeStyle = "#adff66";
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(
        headX + aiChoice.direction.x * TILE * .38,
        headY + aiChoice.direction.y * TILE * .38,
      );
      ctx.lineTo(
        choiceX - aiChoice.direction.x * TILE * .38,
        choiceY - aiChoice.direction.y * TILE * .38,
      );
      ctx.stroke();
      ctx.restore();
    }
  }
}

function strokeCanvasMark(target, mark, scale = 1) {
  target.save();
  target.lineCap = "round";
  target.lineJoin = "round";
  target.globalCompositeOperation = "lighter";
  const fromX = (mark.from.x * TILE + TILE / 2) * scale;
  const fromY = (mark.from.y * TILE + TILE / 2) * scale;
  const toX = (mark.to.x * TILE + TILE / 2) * scale;
  const toY = (mark.to.y * TILE + TILE / 2) * scale;
  const traceMark = () => {
    target.beginPath();
    if (mark.wraps) {
      target.moveTo(fromX, fromY);
      target.lineTo(
        fromX + mark.direction.x * TILE * .46 * scale,
        fromY + mark.direction.y * TILE * .46 * scale,
      );
      target.moveTo(
        toX - mark.direction.x * TILE * .46 * scale,
        toY - mark.direction.y * TILE * .46 * scale,
      );
      target.lineTo(toX, toY);
    } else {
      target.moveTo(fromX, fromY);
      target.lineTo(toX, toY);
    }
  };

  // A second translucent stroke creates a crisp neon halo without invoking
  // Canvas' expensive software shadow blur on every movement frame.
  target.strokeStyle = mark.glow;
  target.globalAlpha = .1 + mark.energy * .14;
  target.lineWidth = (11 + mark.energy * 7) * scale;
  traceMark();
  target.stroke();

  target.strokeStyle = mark.color;
  target.globalAlpha = .42 + mark.energy * .38;
  target.lineWidth = (4 + mark.energy * 5) * scale;
  traceMark();
  target.stroke();
  target.restore();
}

function rebuildCanvasPaintLayer() {
  canvasPaintLayerCtx.clearRect(0, 0, canvasPaintLayer.width, canvasPaintLayer.height);
  canvasMarks.forEach((mark) => strokeCanvasMark(canvasPaintLayerCtx, mark));
}

function drawCanvasPaint(now, target = ctx, scale = 1) {
  target.drawImage(
    canvasPaintLayer,
    0,
    0,
    canvasPaintLayer.width,
    canvasPaintLayer.height,
    0,
    0,
    canvas.width * scale,
    canvas.height * scale,
  );

  if (target === ctx && canvasMarks.length) {
    const pulse = .08 + Math.sin(now / 250) * .025;
    ctx.fillStyle = `rgba(116, 225, 255, ${pulse})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawCanvasBorder(now) {
  const palette = CANVAS_PALETTES[canvasPaletteIndex];
  const pulse = .28 + Math.sin(now / 180) * .08;
  ctx.strokeStyle = palette.color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.globalAlpha = 1;
}

function drawPortals(now) {
  const glow = .25 + Math.sin(now / 220) * .09;
  ctx.strokeStyle = `rgba(169, 139, 255, ${glow})`;
  ctx.lineWidth = 5;
  const offset = 8;
  ctx.strokeRect(offset, offset, canvas.width - offset * 2, canvas.height - offset * 2);
}

function drawRushBorder(now) {
  const urgency = Math.max(0, 1 - rushRemaining / RUSH_DURATION);
  ctx.strokeStyle = `rgba(255, 118, 87, ${0.15 + urgency * .35 + Math.sin(now / 120) * .05})`;
  ctx.lineWidth = 5;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
}

function drawMutationBorder(now) {
  const colors = { flow: "88, 214, 255", amplify: "255, 209, 102" };
  const color = colors[mutation.type];
  const pulse = .24 + Math.sin(now / 130) * .08;
  ctx.strokeStyle = `rgba(${color}, ${pulse})`;
  ctx.lineWidth = 8;
  const inset = 14 + Math.sin(now / 180) * 3;
  ctx.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
}

function drawFood(now) {
  const x = food.x * TILE + TILE / 2;
  const y = food.y * TILE + TILE / 2;
  const pulse = 1 + Math.sin(now / 150) * .1;
  const core = food.kind === "core";
  const color = core ? "#ffd166" : "#ff7657";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(core ? now / 650 : 0);
  ctx.shadowColor = color;
  ctx.shadowBlur = core ? 32 : 22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = .28;
  ctx.beginPath();
  ctx.arc(0, 0, TILE * .42 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  if (core) {
    const size = TILE * .25 * pulse;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff3ba";
    ctx.fillRect(-2, -2, 4, 4);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, TILE * .2 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function currentMotionProgress(now) {
  if (runState === "paused") return pausedMotionProgress;
  if (runState !== "running") return 1;
  return motionProgress(now - lastMoveAt, stepDuration);
}

function canvasPoint(point, scale = 1) {
  return {
    x: (point.x * TILE + TILE / 2) * scale,
    y: (point.y * TILE + TILE / 2) * scale,
  };
}

function fluidPixelGroups(points, scale = 1) {
  return Rules.splitFluidPath(points, GRID).map((group) =>
    group.map((point) => canvasPoint(point, scale)));
}

function traceFluidPath(target, points) {
  if (!points.length) return;
  target.beginPath();
  target.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    target.lineTo(points[0].x + .01, points[0].y);
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    target.lineTo(points[index].x, points[index].y);
  }
}

function strokeFluidGroups(target, groups) {
  groups.forEach((group) => {
    traceFluidPath(target, group);
    target.stroke();
  });
}

function drawGhost(now) {
  if (!ghostPath.length || demoMode || ghostStep >= ghostPath.length) return;
  const length = Math.min(12, snake.length + 3);
  const currentGhost = Rules.ghostWindow(ghostPath, ghostStep, length).reverse();
  const previousGhost = Rules.ghostWindow(ghostPath, ghostStep - 1, length).reverse();
  const motionPath = Rules.fluidMotionPath(previousGhost, currentGhost, currentMotionProgress(now), GRID);
  const groups = fluidPixelGroups(motionPath);
  ctx.save();
  ctx.globalAlpha = .28;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#74e1ff";
  ctx.lineWidth = TILE * .28;
  ctx.shadowColor = "#74e1ff";
  ctx.shadowBlur = 14;
  strokeFluidGroups(ctx, groups);
  ctx.restore();
}

function drawSnake(now) {
  const isOverdrive = now < overdriveUntil;
  const motionPath = Rules.fluidMotionPath(
    previousSnake,
    snake,
    currentMotionProgress(now),
    GRID,
  );
  if (!motionPath.length) return;

  const groups = fluidPixelGroups(motionPath);
  const stableWidth = (ratio) => Math.max(2, Math.round((TILE * ratio) / 2) * 2);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = .15;
  ctx.strokeStyle = isOverdrive ? "#a98bff" : "#adff66";
  ctx.lineWidth = stableWidth(1.08);
  strokeFluidGroups(ctx, groups);

  ctx.globalAlpha = 1;
  ctx.strokeStyle = isOverdrive ? "#41366d" : "#294b2c";
  ctx.lineWidth = stableWidth(.82);
  strokeFluidGroups(ctx, groups);

  ctx.strokeStyle = isOverdrive ? "#a98bff" : "#8ddd55";
  ctx.lineWidth = stableWidth(.64);
  strokeFluidGroups(ctx, groups);

  ctx.globalAlpha = .2;
  ctx.strokeStyle = "#f2ffdf";
  ctx.lineWidth = stableWidth(.08);
  strokeFluidGroups(ctx, groups);
  ctx.restore();

  drawSnakeHead(canvasPoint(motionPath[0]), now, isOverdrive);
}

function drawSnakeHead(head, now, isOverdrive, target = ctx, scale = 1) {
  const angle = Math.atan2(direction.y, direction.x);
  const tile = TILE * scale;
  const outerRadius = target === ctx ? Math.round(tile * .52) : tile * .52;
  const headRadius = target === ctx ? Math.round(tile * .39) : tile * .39;
  const eyeForward = target === ctx ? Math.round(tile * .16) : tile * .16;
  const eyeSpread = target === ctx ? Math.round(tile * .12) : tile * .12;
  const eyeRadius = target === ctx ? Math.max(1, Math.round(2.5 * scale)) : 2.5 * scale;
  target.save();
  target.translate(head.x, head.y);
  target.rotate(angle);
  target.globalAlpha = .16;
  target.fillStyle = isOverdrive ? "#a98bff" : "#adff66";
  target.beginPath();
  target.arc(0, 0, outerRadius, 0, Math.PI * 2);
  target.fill();
  target.globalAlpha = 1;
  target.fillStyle = isOverdrive ? "#eee7ff" : "#d4ffa8";
  target.beginPath();
  target.arc(0, 0, headRadius, 0, Math.PI * 2);
  target.fill();
  target.fillStyle = "#122015";
  [-1, 1].forEach((side) => {
    target.beginPath();
    target.arc(eyeForward, side * eyeSpread, eyeRadius, 0, Math.PI * 2);
    target.fill();
  });
  target.restore();
}

function drawEffects() {
  ctx.save();
  particles.forEach((particle) => {
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillStyle = particle.color;
    const size = Math.max(1, Math.round(particle.size));
    ctx.fillRect(
      Math.round(particle.x - size / 2),
      Math.round(particle.y - size / 2),
      size,
      size,
    );
  });
  ripples.forEach((ripple) => {
    ctx.globalAlpha = Math.max(0, ripple.life);
    ctx.strokeStyle = ripple.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

function updateEffects(delta) {
  particles.forEach((particle) => {
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.life -= delta * .0017;
  });
  ripples.forEach((ripple) => {
    ripple.radius += delta * .08;
    ripple.life -= delta * .0016;
  });
  particles = particles.filter((particle) => particle.life > 0);
  ripples = ripples.filter((ripple) => ripple.life > 0);
}

function render(now) {
  renderFrame = 0;
  if (document.hidden) return;
  const delta = Math.min(now - lastFrame, 34);
  lastFrame = now;
  updateEffects(delta);
  const moveBefore = activeMode === "rush" && runState === "running"
    ? rushDeadline
    : Infinity;
  const wasRushDrainPending = rushDrainPending;
  rushDrainPending = advanceMovement(Math.min(now, moveBefore), moveBefore);
  if (rushDrainPending !== wasRushDrainPending) updateActionLabels();
  updateRushTimer(now, rushDrainPending);
  const gameplayNow = rushDrainPending ? lastMoveAt : now;
  expireCore(gameplayNow);
  expireMutation(gameplayNow);
  updateTimeSystems(gameplayNow);
  pollGamepad(now);
  const overdriveActive = gameplayNow < overdriveUntil;
  gameConsole.classList.toggle("overdrive", overdriveActive);
  ["flow", "amplify"].forEach((type) => {
    gameConsole.classList.toggle(`mutation-${type}`, mutation.type === type && gameplayNow < mutation.expiresAt);
  });
  drawBoard(gameplayNow);
  renderFrame = requestAnimationFrame(render);
}

function startRendering() {
  if (document.hidden || renderFrame) return;
  lastFrame = performance.now();
  renderFrame = requestAnimationFrame(render);
}

function updateRushTimer(now, drainPending = false) {
  if (activeMode !== "rush" || runState !== "running") return;
  rushRemaining = Math.max(0, rushDeadline - now);
  rushTimeEl.textContent = (rushRemaining / 1000).toFixed(1);
  if (rushRemaining <= 0 && !drainPending) endGame("time");
}

function rushDeadlineReached(now = performance.now()) {
  return activeMode === "rush" && runState === "running" && now >= rushDeadline;
}

function expireMutation(now) {
  if (!mutation.type || runState !== "running" || Rules.mutationTypeAt(mutation, now)) return;
  const endedMutation = mutation.type;
  mutation = { type: null, expiresAt: 0 };
  mutationStat.hidden = true;
  announcement.textContent = `${endedMutation} mutation ended.`;
  showPickup("MUTATION ENDED", endedMutation.toUpperCase());
}

function updateTimeSystems(now) {
  if (runState === "running" && comboExpiresAt) {
    const overdriveRemaining = Math.max(0, overdriveUntil - now);
    const remaining = overdriveRemaining || Math.max(0, comboExpiresAt - now);
    const duration = overdriveRemaining ? OVERDRIVE_DURATION : COMBO_WINDOW;
    comboMeterFill.style.width = `${(remaining / duration) * 100}%`;
    if (!remaining && combo !== 1) {
      combo = 1;
      comboEl.textContent = "×1";
    }
  } else if (!comboExpiresAt) {
    comboMeterFill.style.width = "0%";
  }

  if (food?.kind === "core") {
    const remaining = Math.max(0, food.expiresAt - now);
    objectiveProgress.style.width = `${(remaining / CORE_DURATION) * 100}%`;
  }
}

function getTickDelay(now = performance.now()) {
  const pace = PACES[difficultySelect.value] || PACES.arcade;
  return Rules.mutationDelay(
    Rules.tickDelay(pace, foodCount),
    Rules.mutationTypeAt(mutation, now),
  );
}

function scheduleMove() {
  nextMoveAt = 0;
  if (runState !== "running") return;
  pausedMotionProgress = 1;
  pausedStepRemaining = 0;
  lastMoveAt = performance.now();
  stepDuration = getTickDelay();
  nextMoveAt = lastMoveAt + stepDuration;
}

function advanceMovement(now, moveBefore = Infinity) {
  const drainingCutoff = Number.isFinite(moveBefore) && now >= moveBefore;
  const catchUpLimit = drainingCutoff
    ? MAX_DEADLINE_DRAIN_STEPS
    : MAX_FRAME_CATCH_UP_STEPS;
  let catchUpSteps = 0;
  while (
    runState === "running"
    && nextMoveAt
    && nextMoveAt < moveBefore
    && now >= nextMoveAt
    && catchUpSteps < catchUpLimit
  ) {
    const stepAt = nextMoveAt;
    nextMoveAt = 0;
    expireMutation(stepAt);
    expireCore(stepAt);
    tick(stepAt);
    if (runState === "running" && !nextMoveAt) {
      stepDuration = getTickDelay(stepAt);
      nextMoveAt = stepAt + stepDuration;
    }
    catchUpSteps += 1;
  }

  const pendingCutoffMove = runState === "running"
    && nextMoveAt
    && nextMoveAt < moveBefore
    && now >= nextMoveAt;

  // A finite deadline drains exactly across bounded animation frames. Other
  // long-suspended frames resume without replaying an unbounded backlog.
  if (
    !drainingCutoff
    && pendingCutoffMove
  ) {
    previousSnake = snake.map((segment) => ({ ...segment }));
    lastMoveAt = now;
    stepDuration = getTickDelay(now);
    nextMoveAt = now + stepDuration;
  }
  return drainingCutoff && Boolean(pendingCutoffMove);
}

function addCanvasMark(from, to, now) {
  if (activeMode !== "canvas" || !from || !to) return;
  const palette = CANVAS_PALETTES[canvasPaletteIndex];
  const wraps = Math.abs(to.x - from.x) > 1 || Math.abs(to.y - from.y) > 1;
  canvasMarks.push({
    from: { ...from },
    to: { ...to },
    direction: { ...direction },
    color: palette.color,
    glow: palette.glow,
    wraps,
    energy: Math.min(1, combo / 5 + (now < overdriveUntil ? .35 : 0)),
  });
  strokeCanvasMark(canvasPaintLayerCtx, canvasMarks.at(-1));
  canvasStrokeCount += 1;
  if (canvasMarks.length > CANVAS_MARK_LIMIT) {
    canvasMarks.splice(0, canvasMarks.length - CANVAS_MARK_LIMIT);
  }
}

function tick(now = performance.now()) {
  previousSnake = snake.map((segment) => ({ ...segment }));
  if (demoMode) {
    queuedDirection = chooseDemoDirection();
  } else {
    const buffered = Rules.consumeDirectionBuffer(directionBuffer, direction);
    queuedDirection = buffered.direction;
    directionBuffer = buffered.queue;
  }
  const effectiveMode = Rules.effectiveMode(activeMode, mutation.type);
  if (!demoMode) recordDecision(effectiveMode);
  direction = { ...queuedDirection };
  const head = Rules.nextHead(snake[0], direction, effectiveMode, GRID);

  const growing = food && head.x === food.x && head.y === food.y;
  const collision = Rules.collisionType(head, snake, growing, effectiveMode, GRID);

  if (collision) {
    if (demoMode) {
      restartDemo();
      return;
    }
    endGame(collision);
    return;
  }

  snake.unshift(head);
  if (demoMode) {
    autopilotHistory.push({ ...head });
    if (autopilotHistory.length > 256) autopilotHistory.shift();
  }
  addCanvasMark(previousSnake[0], head, now);
  lastMoveAt = now;
  if (growing) {
    collectFood(lastMoveAt);
    if (activeMode === "canvas" && snake.length > CANVAS_BRUSH_LENGTH) snake.pop();
  } else {
    snake.pop();
  }
  if (!demoMode) {
    if (runPath.length < 2000) runPath.push({ ...head });
    ghostStep += 1;
    if (ghostPath.length && ghostStep >= ghostPath.length && !echoBeaten) {
      echoBeaten = true;
      echoState.textContent = "OUTRUN";
      showPickup("ECHO OUTRUN", "NEW GROUND");
      playSequence([[540, 0], [720, 65], [960, 130]], "triangle", .032);
      announcement.textContent = "Echo outrun. You survived beyond your previous path.";
    }
  }
  const followingCommittedRoute = demoMode && autopilotPlan.length > 0;
  if (
    runState === "running"
    && (demoMode || lensEnabled)
    && !followingCommittedRoute
  ) planAiMove();
}

function recordDecision(effectiveMode) {
  evaluatePlannerState(effectiveMode);
  const comparison = Rules.compareDecision(aiEvaluations, queuedDirection);
  if (!comparison) return;
  decisionStats.decisions += 1;
  decisionStats.matches += comparison.matched ? 1 : 0;
  decisionStats.spaceRatioTotal += comparison.spaceRatio;
  decisionStats.riskTurns += comparison.risk ? 1 : 0;
}

function collectFood(now) {
  const kind = food.kind;
  combo = now < overdriveUntil
    ? 5
    : lastEatAt && now - lastEatAt <= COMBO_WINDOW ? Math.min(combo + 1, 5) : 1;
  lastEatAt = now;
  comboExpiresAt = now + COMBO_WINDOW;
  const earned = Rules.pickupScore(kind, combo) * Rules.mutationScoreMultiplier(mutation.type);
  score += earned;
  foodCount += 1;
  if (activeMode === "canvas") {
    canvasPaletteIndex = (canvasPaletteIndex + 1) % CANVAS_PALETTES.length;
  }
  level = Math.floor(foodCount / 4) + 1;
  scoreEl.textContent = formatScore(score);
  levelEl.textContent = String(level).padStart(2, "0");
  comboEl.textContent = `×${combo}`;
  if (combo === 5) activateOverdrive(now);
  animateScore();
  spawnCollectEffect(food, kind);
  const pickupLabel = activeMode === "canvas"
    ? `INK: ${CANVAS_PALETTES[canvasPaletteIndex].name}`
    : kind === "core" ? "CORE ACQUIRED" : combo > 1 ? `COMBO ×${combo}` : "SIGNAL LOCKED";
  showPickup(pickupLabel, `+${earned}`);
  playPickupSound(kind, combo);
  haptic(kind === "core" ? [18, 20, 30] : 14);
  if (kind === "core") activateMutation(now);

  if (!demoMode && score > profile.best) {
    profile.best = score;
    bestEl.textContent = formatScore(profile.best);
    saveProfile();
  }
  if (!demoMode && activeMode !== "canvas" && snake.length > profile.longest) {
    profile.longest = snake.length;
    longestEl.textContent = String(profile.longest).padStart(3, "0");
  }

  placeFood(now);
  if (!food) endGame("clear");
}

function spawnCollectEffect(position, kind) {
  const x = position.x * TILE + TILE / 2;
  const y = position.y * TILE + TILE / 2;
  const color = kind === "core" ? "#ffd166" : "#ff7657";
  for (let i = 0; i < 18; i += 1) {
    const angle = (Math.PI * 2 * i) / 18;
    const speed = .035 + Math.random() * .035;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 3 + Math.random() * 3,
      color: i % 3 === 0 ? "#adff66" : color,
    });
  }
  ripples.push({ x, y, radius: 8, life: 1, color });
}

function animateScore() {
  const container = scoreEl.closest(".hud-primary");
  container.classList.remove("pop");
  void container.offsetWidth;
  container.classList.add("pop");
}

function showPickup(name, points) {
  pickupName.textContent = name;
  pickupPoints.textContent = points;
  pickupToast.classList.remove("show");
  void pickupToast.offsetWidth;
  pickupToast.classList.add("show");
}

function renderLeaderboard() {
  const runs = Rules.sortedTopRuns(profile.topRuns || [], 5);
  topRunsEl.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement("li");
    empty.className = "empty-run";
    empty.textContent = "Complete a run to enter the board.";
    topRunsEl.append(empty);
    return;
  }
  runs.forEach((run, index) => {
    const item = document.createElement("li");
    const position = document.createElement("span");
    const runScore = document.createElement("strong");
    const mode = document.createElement("span");
    const grade = document.createElement("span");
    position.className = "run-position";
    runScore.className = "run-score";
    mode.className = "run-mode";
    grade.className = "run-grade";
    position.textContent = String(index + 1).padStart(2, "0");
    runScore.textContent = formatScore(run.score);
    mode.textContent = ["classic", "portal", "rush"].includes(run.mode) ? run.mode : "classic";
    grade.textContent = ["S", "A", "B", "C", "D"].includes(run.rank) ? run.rank : Rules.rankForScore(run.score, run.mode);
    item.append(position, runScore, mode, grade);
    topRunsEl.append(item);
  });
}

function updateHud() {
  scoreEl.textContent = formatScore(score);
  levelEl.textContent = String(level).padStart(2, "0");
  comboEl.textContent = `×${combo}`;
  bestEl.textContent = formatScore(profile.best);
  totalRunsEl.textContent = String(profile.runs).padStart(3, "0");
  longestEl.textContent = String(profile.longest).padStart(3, "0");
  modeChip.textContent = demoMode ? `${activeMode.toUpperCase()} · AUTO` : activeMode.toUpperCase();
  timerStat.hidden = activeMode !== "rush";
  mutationStat.hidden = !mutation.type;
  if (mutation.type) mutationName.textContent = mutation.type.toUpperCase();
  echoStat.hidden = demoMode || activeMode === "canvas" || !ghostPath.length;
  echoState.textContent = echoBeaten ? "OUTRUN" : "SYNCED";
  rushTimeEl.textContent = (rushRemaining / 1000).toFixed(1);
  exportButton.hidden = activeMode !== "canvas";
  canvasInstruction.hidden = activeMode !== "canvas";
  gameConsole.classList.toggle("canvas-mode", activeMode === "canvas");
  gameConsole.classList.toggle("ai-active", lensVisible());
  aiLens.hidden = !lensVisible();
  if (lensVisible()) updateAiTelemetry();
  updateObjective();
  renderLeaderboard();
}

function updateObjective() {
  if (!food) return;
  if (food.kind === "core") {
    objectiveLabel.textContent = "BONUS CORE";
    objectiveText.textContent = "Collect before signal loss";
    objectiveProgress.style.width = "100%";
  } else if (activeMode === "canvas") {
    const palette = CANVAS_PALETTES[canvasPaletteIndex];
    objectiveLabel.textContent = "CURRENT INK";
    objectiveText.textContent = `${palette.name} · collect to shift`;
    objectiveProgress.style.width = `${((canvasPaletteIndex + 1) / CANVAS_PALETTES.length) * 100}%`;
  } else {
    const progress = foodCount % 5;
    const remaining = 5 - progress;
    objectiveLabel.textContent = "NEXT CORE";
    objectiveText.textContent = `${remaining} signal${remaining === 1 ? "" : "s"} remaining`;
    objectiveProgress.style.width = `${(progress / 5) * 100}%`;
  }
}

function chooseDemoDirection() {
  if (activeMode === "canvas" && canvasCompositionBudget > 0) {
    let composition = Rules.canvasCompositionMove(
      canvasCompositionState,
      direction,
      Rules.signalState(runSignal),
    );
    if (
      composition.direction.x === -direction.x
      && composition.direction.y === -direction.y
    ) {
      canvasCompositionState = null;
      composition = Rules.canvasCompositionMove(
        null,
        direction,
        Rules.signalState(runSignal),
      );
    }
    canvasCompositionState = composition.state;
    canvasCompositionName = composition.name;
    canvasCompositionBudget -= 1;
    canvasCompositionActive = true;
    return composition.direction;
  }
  canvasCompositionActive = false;
  const effectiveMode = Rules.effectiveMode(activeMode, mutation.type);
  const target = food ? `${food.x},${food.y},${food.kind || "signal"}` : "none";
  const committed = consumeAutopilotPlan(effectiveMode, target);
  if (committed) return committed;

  planAiMove();
  if (aiChoice?.route?.length) {
    autopilotPlanMode = effectiveMode;
    autopilotPlanTarget = target;
    autopilotPlan = aiChoice.route.slice(1).map((move) => ({ ...move }));
  }
  return aiChoice?.direction || direction;
}

function consumeAutopilotPlan(effectiveMode, target) {
  if (autopilotPlanMode !== effectiveMode || autopilotPlanTarget !== target) {
    autopilotPlan = [];
  }
  if (!autopilotPlan.length) return null;

  const committed = autopilotPlan.shift();
  const head = Rules.nextHead(snake[0], committed, effectiveMode, GRID);
  const growing = Boolean(food && head.x === food.x && head.y === food.y);
  if (
    Rules.isReverseDirection(committed, direction)
    || Rules.collisionType(head, snake, growing, effectiveMode, GRID)
  ) {
    autopilotPlan = [];
    return null;
  }

  const route = [committed, ...autopilotPlan];
  const forecast = [];
  let cursor = snake[0];
  route.slice(0, 6).forEach((move) => {
    cursor = Rules.nextHead(cursor, move, effectiveMode, GRID);
    forecast.push({ ...cursor });
  });
  const option = DIRECTION_OPTIONS.find((candidate) =>
    candidate.x === committed.x && candidate.y === committed.y);
  aiChoice = {
    ...aiChoice,
    name: option?.name || "route",
    direction: { ...committed },
    head,
    forecast,
    horizon: forecast.length,
    route: route.map((move) => ({ ...move })),
    legal: true,
  };
  aiEvaluations = [aiChoice];
  updateAiTelemetry();
  return committed;
}

function lensVisible() {
  return demoMode || (lensEnabled && runState === "running");
}

function plannerStateKey(effectiveMode) {
  const body = snake.map((segment) => `${segment.x},${segment.y}`).join(";");
  const target = food ? `${food.x},${food.y},${food.kind || "signal"}` : "none";
  return `${effectiveMode}|${direction.x},${direction.y}|${target}|${body}`;
}

function evaluatePlannerState(effectiveMode = Rules.effectiveMode(activeMode, mutation.type)) {
  const nextKey = plannerStateKey(effectiveMode);
  if (nextKey === aiPlanKey) return;
  const startedAt = performance.now();
  aiEvaluations = Rules.evaluateMoves({
    snake,
    direction,
    food,
    mode: effectiveMode,
    gridSize: GRID,
    candidates: DIRECTION_OPTIONS,
    recentHeads: demoMode ? autopilotHistory : [],
  });
  aiChoice = Rules.chooseBestMove(aiEvaluations);
  aiPlanInsight = Rules.decisionInsight(aiEvaluations, aiChoice);
  aiPlanDuration = Math.max(0, performance.now() - startedAt);
  aiPlanKey = nextKey;
}

function planAiMove() {
  evaluatePlannerState();
  updateAiTelemetry();
}

function updateAiTelemetry() {
  const visible = lensVisible();
  aiLens.hidden = !visible;
  aiLens.classList.toggle("driver", demoMode);
  gameConsole.classList.toggle("ai-active", visible);
  gameConsole.classList.toggle("ai-driving", demoMode && visible);
  aiLensLabel.textContent = demoMode
    ? `AUTOPILOT · ${modeLabel().toUpperCase()}`
    : "DECISION LENS · YOU DRIVE";
  if (visible && demoMode && activeMode === "canvas" && canvasCompositionActive) {
    aiPlan.textContent = `COMPOSE ${canvasCompositionName}`;
    aiReason.textContent = `GENERATIVE MOTIF · ${canvasCompositionBudget} STROKES TO CAPTURE`;
    aiEvidence.textContent = `SIGNAL ${runSignal} · PLOTTER PHASE · INK ${CANVAS_PALETTES[canvasPaletteIndex].name}`;
    return;
  }
  if (!visible || !aiChoice) {
    aiPlan.textContent = "SCANNING BOARD";
    aiReason.textContent = "SURVIVAL FIRST";
    aiEvidence.textContent = "NO BOARD SAMPLE";
    return;
  }
  const insight = aiPlanInsight || Rules.decisionInsight(aiEvaluations, aiChoice);
  aiPlan.textContent = `${demoMode ? "TURN" : "SAFEST"} ${aiChoice.name.toUpperCase()}`;
  aiReason.textContent = `${insight.confidence} · ${insight.reason}`;
  const commitment = autopilotPlan.length ? ` · LOCK ${autopilotPlan.length}` : "";
  if (demoMode && commitment && aiEvaluations.length === 1) {
    aiEvidence.textContent = `PROVEN ROUTE · ${aiChoice.horizon} TURN FORECAST${commitment} · PLANNED ${aiPlanDuration.toFixed(1)}MS`;
  } else {
    const margin = Number.isFinite(insight.margin) ? `Δ${Math.round(insight.margin)}` : "NO ALTERNATE";
    const runnerUp = insight.runnerUp ? `VS ${insight.runnerUp.toUpperCase()}` : "FORCED LINE";
    aiEvidence.textContent = `${runnerUp} · ${margin} · ${aiChoice.horizon} TURN FORECAST${commitment} · ${aiPlanDuration.toFixed(1)}MS`;
  }
}

function prepareDemo() {
  nextMoveAt = 0;
  clearTimeout(countdownTimer);
  demoMode = true;
  activeMode = selectedMode();
  document.body.dataset.mode = activeMode;
  resetRun();
  ghostPath = [];
  runState = "running";
  if (activeMode === "rush") rushDeadline = performance.now() + rushRemaining;
  planAiMove();
  overlay.hidden = true;
  pauseButton.disabled = false;
  setSetupDisabled(true);
  setState("running", `${activeMode.toUpperCase()} AUTOPILOT`);
  updateHud();
  updateActionLabels();
  announcement.textContent = `${activeMode} Autopilot started. Use Stop Autopilot to return to the run choices.`;
  focusWithoutScroll(pauseButton);
  scheduleMove();
}

function restartDemo() {
  if (!demoMode) return;
  nextMoveAt = 0;
  activeMode = selectedMode();
  document.body.dataset.mode = activeMode;
  resetRun();
  ghostPath = [];
  runState = "running";
  if (activeMode === "rush") rushDeadline = performance.now() + rushRemaining;
  planAiMove();
  pauseButton.disabled = false;
  setState("running", `${activeMode.toUpperCase()} AUTOPILOT`);
  updateHud();
  updateActionLabels();
  scheduleMove();
}

function stopDemo() {
  if (!demoMode) return;
  nextMoveAt = 0;
  demoMode = false;
  activeMode = selectedMode();
  document.body.dataset.mode = activeMode;
  runState = "ready";
  resetRun();
  ghostPath = activeMode === "canvas" ? [] : Rules.normalizeReplay(profile.replays?.[activeMode], GRID);
  setSetupDisabled(false);
  pauseButton.disabled = true;
  setState("ready", activeMode === "canvas" ? "CANVAS READY" : "SYSTEM READY");
  updateHud();
  updateActionLabels();
  updateReadyOverlay();
  announcement.textContent = `Autopilot stopped. Choose Play ${modeLabel()} or Watch Autopilot play ${modeLabel()}.`;
  focusWithoutScroll(startButton);
}

function prepareRun(initialDirection = DIRECTIONS.right) {
  if (runState === "countdown") return;
  demoMode = false;
  activeMode = selectedMode();
  document.body.dataset.mode = activeMode;
  resetRun();
  ghostPath = activeMode === "canvas" ? [] : Rules.normalizeReplay(profile.replays?.[activeMode], GRID);
  direction = { ...initialDirection };
  queuedDirection = { ...initialDirection };
  directionBuffer = [];
  runState = "ready";
  updateHud();
  setSetupDisabled(true);
  pauseButton.disabled = true;
  updateActionLabels();
  beginCountdown(3);
  focusWithoutScroll(canvas);
}

function beginCountdown(number) {
  clearTimeout(countdownTimer);
  countdownTimer = null;
  countdownStep = number;
  runState = "countdown";
  if (document.hidden) {
    countdownSuspended = true;
    setState("countdown", "RUN WAITING");
    return;
  }
  countdownSuspended = false;
  setState("countdown", "SYNCING RUN");
  showOverlay("GET READY", String(number), "Lock your direction.", "", true);
  playTone(260 + number * 70, .06, "square", .025);

  if (number > 1) {
    countdownTimer = setTimeout(() => beginCountdown(number - 1), 650);
  } else {
    countdownTimer = setTimeout(startRun, 650);
  }
}

function suspendCountdown() {
  if (runState !== "countdown") return;
  clearTimeout(countdownTimer);
  countdownTimer = null;
  countdownSuspended = true;
  setState("countdown", "RUN WAITING");
  announcement.textContent = "Countdown waiting until the game is visible.";
}

function startRun() {
  countdownTimer = null;
  countdownStep = 0;
  countdownSuspended = false;
  runState = "running";
  profile.runs += 1;
  saveProfile();
  totalRunsEl.textContent = String(profile.runs).padStart(3, "0");
  previousSnake = snake.map((segment) => ({ ...segment }));
  lastMoveAt = performance.now();
  overlay.hidden = true;
  pauseButton.disabled = false;
  setState("running", "RUN ACTIVE");
  updateActionLabels();
  if (activeMode === "rush") {
    rushDeadline = performance.now() + rushRemaining;
  }
  announcement.textContent = `${activeMode} run started.`;
  focusWithoutScroll(canvas);
  playTone(520, .09, "square", .035);
  if (lensEnabled) planAiMove();
  scheduleMove();
}

function endGame(reason) {
  if (demoMode) {
    restartDemo();
    return;
  }
  if (runState === "over") return;
  nextMoveAt = 0;
  clearTimeout(countdownTimer);
  runState = "over";
  pauseButton.disabled = true;
  profile.best = Math.max(profile.best, score);
  profile.longest = Math.max(profile.longest, snake.length);
  profile.replays = profile.replays || {};
  profile.replays[activeMode] = Rules.normalizeReplay(runPath, GRID);
  const rank = Rules.rankForScore(score, activeMode);
  lastDecisionProfile = Rules.decisionProfile(decisionStats);
  profile.topRuns = Rules.sortedTopRuns([
    ...(profile.topRuns || []),
    { score, mode: activeMode, rank, at: new Date().toISOString() },
  ]);
  saveProfile();
  updateHud();
  setSetupDisabled(false);
  setState("over", reason === "time" ? "TIME EXPIRED" : reason === "clear" ? "BOARD CLEARED" : "SIGNAL LOST");

  gameConsole.classList.remove("crash");
  void gameConsole.offsetWidth;
  gameConsole.classList.add("crash");

  const title = reason === "time" ? "TIME." : reason === "clear" ? "PERFECT." : "RUN OVER.";
  const message = reason === "time"
    ? `Rush complete. You banked ${score} points.`
    : reason === "clear"
      ? "Every tile claimed. The board is yours."
      : `${score} points · ${foodCount} signals · level ${level}`;
  showOverlay(`${modeLabel().toUpperCase()} RUN REPORT`, title, message, "Run it back");
  demoButtonLabel.textContent = "Watch Autopilot";
  rankValue.textContent = rank;
  runRank.hidden = false;
  decisionStyle.textContent = lastDecisionProfile.style;
  decisionMatch.textContent = `${lastDecisionProfile.alignment}%`;
  decisionSpace.textContent = `${lastDecisionProfile.spaceKept}%`;
  decisionRisk.textContent = String(lastDecisionProfile.riskTurns).padStart(2, "0");
  decisionSummary.textContent = lastDecisionProfile.summary;
  decisionReport.hidden = false;
  updateActionLabels();
  announcement.textContent = `${title} Final score ${score}. Decision DNA: ${lastDecisionProfile.style}, ${lastDecisionProfile.alignment} percent engine match.`;
  focusWithoutScroll(startButton);
  playCrashSound();
}

function togglePause() {
  if (demoMode) {
    stopDemo();
    return;
  }
  if (rushDrainPending || rushDeadlineReached()) {
    announcement.textContent = "Rush is resolving moves scheduled before time expired.";
    return;
  }
  if (runState !== "running" && runState !== "paused") return;
  if (runState === "running") {
    pausedAt = performance.now();
    pausedMotionProgress = currentMotionProgress(pausedAt);
    pausedStepRemaining = nextMoveAt
      ? Math.max(0, nextMoveAt - pausedAt)
      : Math.max(0, stepDuration * (1 - pausedMotionProgress));
    nextMoveAt = 0;
    if (activeMode === "rush") rushRemaining = Math.max(0, rushDeadline - pausedAt);
    runState = "paused";
    showOverlay("RUN SUSPENDED", "PAUSED.", "Your chain is frozen. Resume when ready.", "Resume");
    setState("paused", "RUN PAUSED");
    announcement.textContent = "Game paused.";
  } else {
    const pauseDuration = performance.now() - pausedAt;
    if (food?.kind === "core") food.expiresAt += pauseDuration;
    if (comboExpiresAt) comboExpiresAt += pauseDuration;
    if (overdriveUntil) overdriveUntil += pauseDuration;
    if (mutation.expiresAt) mutation.expiresAt += pauseDuration;
    runState = "running";
    overlay.hidden = true;
    if (activeMode === "rush") rushDeadline = performance.now() + rushRemaining;
    setState("running", "RUN ACTIVE");
    announcement.textContent = "Game resumed.";
    const resumedAt = performance.now();
    lastMoveAt = resumedAt - pausedMotionProgress * stepDuration;
    nextMoveAt = resumedAt + pausedStepRemaining;
  }
  updateActionLabels();
  focusWithoutScroll(runState === "paused" ? startButton : canvas);
}

function showOverlay(kicker, title, message, buttonLabel, countdown = false) {
  overlayKicker.textContent = kicker;
  overlayTitle.innerHTML = countdown ? title : title.replace(" ", "<br />");
  overlayTitle.classList.toggle("countdown-number", countdown);
  overlayMessage.textContent = message;
  runRank.hidden = true;
  decisionReport.hidden = true;
  startButton.hidden = countdown;
  demoButton.hidden = countdown || runState === "paused";
  overlayHint.hidden = countdown || runState === "paused";
  if (!countdown && runState !== "paused") overlayHint.textContent = "CHOOSE PLAYER OR AUTOPILOT";
  if (!countdown) startButtonLabel.textContent = buttonLabel;
  if (!countdown) demoButtonLabel.textContent = `Watch Autopilot play ${modeLabel()}`;
  overlay.hidden = false;
}

function setState(state, label) {
  document.body.dataset.gameState = state;
  statusText.textContent = label;
}

function setSetupDisabled(disabled) {
  modeInputs.forEach((input) => { input.disabled = disabled; });
  difficultySelect.disabled = disabled;
  signalButton.disabled = disabled;
}

function updateActionLabels() {
  const paused = runState === "paused";
  const aiPlaying = demoMode && runState === "running";
  const canPause = aiPlaying || ((runState === "running" || paused) && !rushDrainPending);
  pauseButton.disabled = !canPause;
  mobilePause.disabled = !canPause;
  pauseButtonLabel.textContent = aiPlaying ? "Stop Autopilot" : paused ? "Resume" : "Pause";
  pauseButton.lastElementChild.textContent = aiPlaying ? "■" : paused ? "▶" : "Ⅱ";
  lensButton.hidden = aiPlaying;
  mobilePause.textContent = aiPlaying ? "STOP" : paused ? "▶" : "●";
  mobilePause.classList.toggle("stop-ai", aiPlaying);
  mobilePause.setAttribute("aria-label", aiPlaying ? "Stop Autopilot" : paused ? "Resume game" : "Pause game");
  restartButton.firstChild.textContent = demoMode ? "Restart Autopilot run " : "Restart current run ";
  restartButton.hidden = runState === "ready" || runState === "countdown";
}

function requestDirection(next) {
  if (demoMode) {
    announcement.textContent = "The Autopilot is driving. Stop it, then choose Play to take control.";
    return;
  }
  if (rushDrainPending || rushDeadlineReached()) {
    announcement.textContent = "Rush is resolving moves scheduled before time expired.";
    return;
  }
  if (runState === "ready" || runState === "over") {
    announcement.textContent = `Choose Play ${modeLabel()} or Watch Autopilot play ${modeLabel()} before moving.`;
    return;
  }
  if (runState === "countdown") {
    directionBuffer = Rules.bufferDirection(directionBuffer, direction, next);
    return;
  }
  if (runState !== "running") return;
  directionBuffer = Rules.bufferDirection(directionBuffer, direction, next);
}

function activateOverdrive(now) {
  const wasInactive = now >= overdriveUntil;
  overdriveUntil = now + OVERDRIVE_DURATION;
  if (wasInactive) {
    showPickup("OVERDRIVE", "×5 ACTIVE");
    playSequence([
      [440, 0],
      [660, 55],
      [880, 110],
    ], "sawtooth", .035);
    haptic([25, 18, 25, 18, 45]);
    announcement.textContent = "Overdrive activated. Five times multiplier.";
  }
}

function activateMutation(now) {
  const options = ["flow", "amplify"];
  const choice = Rules.signalIndex(signalRandomState, options.length);
  signalRandomState = choice.state;
  const type = options[choice.index];
  mutation = { type, expiresAt: now + MUTATION_DURATION };
  const descriptions = {
    flow: "TIME SLOWS",
    amplify: "POINTS ×2",
  };
  mutationName.textContent = type.toUpperCase();
  mutationStat.hidden = false;
  showPickup(`MUTATION: ${type.toUpperCase()}`, descriptions[type]);
  playSequence(
    type === "flow" ? [[520, 0], [390, 70]] : [[620, 0], [780, 60], [930, 120]],
    "sine",
    .04,
  );
  announcement.textContent = `${type} mutation activated. ${descriptions[type].toLowerCase()}.`;
}

function playSequence(notes, type = "sine", volume = .03) {
  if (!soundEnabled) return;
  notes.forEach(([frequency, delay], index) => {
    setTimeout(() => playTone(frequency, index === notes.length - 1 ? .13 : .07, type, volume), delay);
  });
}

function playPickupSound(kind, currentCombo) {
  if (kind === "core") {
    playSequence([[620, 0], [820, 55], [1040, 115]], "sine", .045);
    return;
  }
  const root = 500 + currentCombo * 55;
  playSequence([[root, 0], [root * 1.25, 42]], "sine", .03);
}

function haptic(pattern) {
  try {
    navigator.vibrate?.(pattern);
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    pad?.vibrationActuator?.playEffect?.("dual-rumble", {
      duration: Array.isArray(pattern) ? 70 : Math.max(25, Number(pattern) || 25),
      strongMagnitude: .35,
      weakMagnitude: .55,
    });
  } catch {
    // Haptics are optional and vary by browser and controller.
  }
}

function playTone(frequency, duration, type, volume) {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = playTone.context || (playTone.context = new AudioContextClass());
    if (audio.state === "suspended") audio.resume().catch(() => {});
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  } catch {
    // Audio feedback is non-essential and may be blocked by browser policy.
  }
}

function playCrashSound() {
  playTone(150, .17, "sawtooth", .035);
  setTimeout(() => playTone(82, .22, "sawtooth", .03), 75);
  haptic([45, 30, 70]);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound");
  setStored("neon-snake-sound", soundEnabled);
  if (soundEnabled) playTone(520, .06, "sine", .03);
}

function updateLensControl() {
  lensButton.setAttribute("aria-pressed", String(lensEnabled));
  lensState.textContent = lensEnabled ? "ON ◉" : "OFF ◎";
}

function toggleLens() {
  if (demoMode) {
    showPickup("DECISION LENS", "ALWAYS ON IN AUTOPILOT");
    announcement.textContent = "The Decision Lens is always visible while Autopilot drives.";
    return;
  }
  lensEnabled = !lensEnabled;
  setStored("neon-snake-lens", lensEnabled);
  updateLensControl();
  if (lensVisible()) {
    planAiMove();
  } else {
    aiEvaluations = [];
    aiChoice = null;
    aiPlanKey = "";
    aiPlanInsight = null;
    updateAiTelemetry();
  }
  showPickup("DECISION LENS", lensEnabled ? "LIVE GUIDANCE ON" : "GUIDANCE OFF");
  announcement.textContent = `Decision Lens ${lensEnabled ? "enabled" : "disabled"}. Gameplay and scoring are unchanged.`;
}

async function shareGame() {
  const url = challengeUrl();
  const dna = runState === "over"
    ? ` Decision DNA: ${lastDecisionProfile.style} (${lastDecisionProfile.alignment}% engine match).`
    : "";
  const text = score > 0
    ? `I scored ${score} in ${activeMode.toUpperCase()} mode on Neon Snake.${dna} Beat Signal ${runSignal}.`
    : `Play Neon Snake Signal ${runSignal}—the same code means the same challenge.`;
  const data = {
    title: "Play Neon Snake",
    text,
    url: url.toString(),
  };

  try {
    if (navigator.share) {
      await navigator.share(data);
      showPickup("SHARED", `SIGNAL ${runSignal}`);
      announcement.textContent = `Signal ${runSignal} shared.`;
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${text} ${data.url}`);
      showPickup("LINK COPIED", `SIGNAL ${runSignal}`);
      announcement.textContent = `Signal ${runSignal} link copied.`;
    } else {
      throw new Error("Share APIs unavailable");
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    showPickup("SHARE UNAVAILABLE", "COPY THE PAGE URL");
    announcement.textContent = "Sharing is unavailable in this browser. Copy the page address to share.";
  }
}

function exportCanvasArtwork() {
  if (activeMode !== "canvas" || canvasStrokeCount === 0) {
    showPickup("NO INK YET", "PLAY CANVAS FIRST");
    announcement.textContent = "Move in Canvas mode before saving artwork.";
    return;
  }

  const artwork = document.createElement("canvas");
  artwork.width = 1440;
  artwork.height = 1440;
  const art = artwork.getContext("2d");
  const scale = artwork.width / canvas.width;
  const gradient = art.createRadialGradient(720, 720, 0, 720, 720, 1020);
  gradient.addColorStop(0, "#101b14");
  gradient.addColorStop(1, "#050906");
  art.fillStyle = gradient;
  art.fillRect(0, 0, artwork.width, artwork.height);

  drawCanvasPaint(performance.now(), art, scale);

  const exportPoints = snake.map((segment) => canvasPoint(segment, scale));
  const exportGroups = fluidPixelGroups(snake, scale);
  const exportPalette = CANVAS_PALETTES[canvasPaletteIndex];
  art.save();
  art.globalCompositeOperation = "source-over";
  art.lineCap = "round";
  art.lineJoin = "round";
  art.strokeStyle = "#243c2b";
  art.lineWidth = TILE * scale * .82;
  art.shadowColor = exportPalette.glow;
  art.shadowBlur = 32;
  strokeFluidGroups(art, exportGroups);
  art.strokeStyle = exportPalette.color;
  art.lineWidth = TILE * scale * .64;
  art.shadowBlur = 18;
  strokeFluidGroups(art, exportGroups);
  art.globalAlpha = .25;
  art.strokeStyle = "#f2ffdf";
  art.lineWidth = TILE * scale * .11;
  art.shadowBlur = 0;
  strokeFluidGroups(art, exportGroups);
  art.restore();
  if (exportPoints[0]) drawSnakeHead(exportPoints[0], performance.now(), false, art, scale);

  art.fillStyle = "#050906dd";
  art.fillRect(0, 0, artwork.width, 126);
  art.fillRect(0, artwork.height - 94, artwork.width, 94);
  art.fillStyle = "#adff66";
  art.font = "700 26px Consolas, monospace";
  art.letterSpacing = "5px";
  art.fillText("NEON SNAKE / CANVAS STUDY", 48, 75);
  art.fillStyle = "#8b9b90";
  art.font = "700 18px Consolas, monospace";
  art.fillText(`${formatScore(score)} POINTS  ·  ${canvasStrokeCount} STROKES  ·  ${CANVAS_PALETTES[canvasPaletteIndex].name} INK`, 48, artwork.height - 38);

  const link = document.createElement("a");
  link.href = artwork.toDataURL("image/png");
  link.download = `neon-snake-canvas-${Date.now()}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  showPickup("CANVAS SAVED", "1440 × 1440 PNG");
  announcement.textContent = "Canvas artwork saved as a PNG image.";
}

function registerServiceWorker() {
  const localSecureContext = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || localSecureContext)) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function updateReadyOverlay() {
  const canvasMode = activeMode === "canvas";
  const descriptions = {
    classic: "Walls end the run.",
    portal: "Edges loop the board.",
    rush: "Score as much as possible in 60 seconds.",
    canvas: "Cross freely and leave a permanent light trail.",
  };
  overlayKicker.textContent = `${activeMode.toUpperCase()} READY`;
  overlayTitle.innerHTML = canvasMode ? "DRAW.<br /><em>FOREVER.</em>" : "NEON<br /><em>SNAKE</em>";
  overlayTitle.classList.remove("countdown-number");
  overlayMessage.textContent = `${descriptions[activeMode]} Choose whether you drive or the Autopilot drives.`;
  updateStartChoices();
  startButton.hidden = false;
  demoButton.hidden = false;
  overlayHint.textContent = "THE RUN STARTS ONLY AFTER YOU CHOOSE";
  overlayHint.hidden = false;
  runRank.hidden = true;
  decisionReport.hidden = true;
  overlay.hidden = false;
}

function handleKeyboard(event) {
  if (event.target.matches("button, select, input, textarea")) return;
  const key = event.key.toLowerCase();
  const keyDirections = {
    arrowup: DIRECTIONS.up,
    w: DIRECTIONS.up,
    arrowdown: DIRECTIONS.down,
    s: DIRECTIONS.down,
    arrowleft: DIRECTIONS.left,
    a: DIRECTIONS.left,
    arrowright: DIRECTIONS.right,
    d: DIRECTIONS.right,
  };

  if (keyDirections[key]) {
    event.preventDefault();
    requestDirection(keyDirections[key]);
  } else if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (key === "r") {
    event.preventDefault();
    if (runState === "running" || runState === "paused" || runState === "over") {
      if (demoMode) restartDemo();
      else prepareRun();
    } else if (runState === "ready") {
      announcement.textContent = `Choose Play ${modeLabel()} or Watch Autopilot play ${modeLabel()} first.`;
    }
  } else if (key === "l") {
    event.preventDefault();
    toggleLens();
  } else if (key === "e" && activeMode === "canvas") {
    event.preventDefault();
    exportCanvasArtwork();
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    if (runState === "running" && !demoMode) togglePause();
    else if (runState === "countdown") suspendCountdown();
    return;
  }
  startRendering();
  if (runState === "countdown" && countdownSuspended) beginCountdown(countdownStep);
}

function pollGamepad(now) {
  if (now - lastGamepadPoll < 80 || !navigator.getGamepads) return;
  lastGamepadPoll = now;
  const pad = [...navigator.getGamepads()].find(Boolean);
  if (!pad) return;

  let name = "";
  if (pad.buttons[12]?.pressed || pad.axes[1] < -.55) name = "up";
  else if (pad.buttons[13]?.pressed || pad.axes[1] > .55) name = "down";
  else if (pad.buttons[14]?.pressed || pad.axes[0] < -.55) name = "left";
  else if (pad.buttons[15]?.pressed || pad.axes[0] > .55) name = "right";

  if (name && name !== gamepadDirection) requestDirection(DIRECTIONS[name]);
  gamepadDirection = name;

  const pausePressed = Boolean(pad.buttons[9]?.pressed);
  if (pausePressed && !gamepadPausePressed) {
    if (runState === "ready" || runState === "over") {
      announcement.textContent = `Choose Play ${modeLabel()} or Watch Autopilot play ${modeLabel()} first.`;
    } else {
      togglePause();
    }
  }
  gamepadPausePressed = pausePressed;
}

function handleModeChange() {
  if (runState !== "ready" && runState !== "over") return;
  activeMode = selectedMode();
  document.body.dataset.mode = activeMode;
  runState = "ready";
  resetRun();
  ghostPath = activeMode === "canvas" ? [] : Rules.normalizeReplay(profile.replays?.[activeMode], GRID);
  updateHud();
  modeChip.textContent = activeMode.toUpperCase();
  timerStat.hidden = activeMode !== "rush";
  pauseButton.disabled = true;
  setState("ready", activeMode === "canvas" ? "CANVAS READY" : "SYSTEM READY");
  updateActionLabels();
  updateReadyOverlay();
  syncChallengeUrl();
}

function generateNewSignal() {
  if (runState !== "ready" && runState !== "over") return;
  runSignal = createSignalCode();
  signalCode.textContent = runSignal;
  activeMode = selectedMode();
  document.body.dataset.mode = activeMode;
  runState = "ready";
  resetRun();
  ghostPath = activeMode === "canvas" ? [] : Rules.normalizeReplay(profile.replays?.[activeMode], GRID);
  updateHud();
  modeChip.textContent = activeMode.toUpperCase();
  timerStat.hidden = activeMode !== "rush";
  pauseButton.disabled = true;
  setState("ready", "NEW SIGNAL READY");
  updateActionLabels();
  updateReadyOverlay();
  syncChallengeUrl();
  showPickup("NEW SIGNAL", runSignal);
  announcement.textContent = `New Signal Code ${runSignal}. The challenge sequence has changed.`;
}

startButton.addEventListener("click", () => runState === "paused" ? togglePause() : prepareRun());
demoButton.addEventListener("click", prepareDemo);
pauseButton.addEventListener("click", togglePause);
mobilePause.addEventListener("click", togglePause);
restartButton.addEventListener("click", () => demoMode ? restartDemo() : prepareRun());
shareButton.addEventListener("click", shareGame);
exportButton.addEventListener("click", exportCanvasArtwork);
soundButton.addEventListener("click", toggleSound);
lensButton.addEventListener("click", toggleLens);
signalButton.addEventListener("click", generateNewSignal);
difficultySelect.addEventListener("change", () => {
  syncChallengeUrl();
  scheduleMove();
});
modeInputs.forEach((input) => input.addEventListener("change", handleModeChange));
document.addEventListener("keydown", handleKeyboard);
globalThis.NeonSnakeTouchControls.bindSwipe(
  boardWrap,
  (name) => requestDirection(DIRECTIONS[name]),
);
globalThis.NeonSnakeTouchControls.bindDirectionButtons(
  document,
  "[data-direction]",
  (name) => requestDirection(DIRECTIONS[name]),
);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("gamepadconnected", () => {
  announcement.textContent = "Gamepad connected.";
});
window.addEventListener("load", registerServiceWorker, { once: true });
if ("ResizeObserver" in window) {
  new ResizeObserver(resizeCanvas).observe(boardWrap);
} else {
  window.addEventListener("resize", resizeCanvas);
}

soundButton.setAttribute("aria-pressed", String(soundEnabled));
soundButton.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound");
updateLensControl();
hydrateChallengeFromUrl();
activeMode = selectedMode();
document.body.dataset.mode = activeMode;
resetRun();
ghostPath = Rules.normalizeReplay(profile.replays?.[activeMode], GRID);
updateHud();
setState("ready", activeMode === "canvas" ? "CANVAS READY" : "SYSTEM READY");
updateActionLabels();
updateReadyOverlay();
syncChallengeUrl();
startRendering();
