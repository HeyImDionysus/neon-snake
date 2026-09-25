"use strict";

// Headless solo and duel simulations shared by the Autopilot quality tests.

const assert = require("node:assert/strict");
const rules = require("../public/game-logic.js");

const DIRECTIONS = [
  { name: "up", x: 0, y: -1 },
  { name: "right", x: 1, y: 0 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
];
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CANVAS_BRUSH_LENGTH = 18;
const {
  coreDuration: CORE_DURATION,
  mutationDuration: MUTATION_DURATION,
  rushDuration: RUSH_DURATION,
} = rules.soloTiming();
const PACES = rules.paceProfiles();

function codeFromIndex(value) {
  let state = Math.imul((Number(value) || 0) >>> 0, 0x9e3779b1) & 0x3fffffff;
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += SIGNAL_ALPHABET[state % SIGNAL_ALPHABET.length];
    state = Math.floor(state / SIGNAL_ALPHABET.length);
  }
  return code;
}

function simulateSolo(code, mode = "classic", maxSteps = 600, paceName = "arcade") {
  const pace = PACES[paceName];
  assert.ok(pace, `Unknown pace: ${paceName}`);
  let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  let direction = { x: 1, y: 0 };
  let signalState = rules.signalState(code);
  let food = null;
  let foods = 0;
  let foodCount = 0;
  let coresCollected = 0;
  let coresExpired = 0;
  let mutation = { type: null, expiresAt: 0 };
  let mutationSignature = "";
  let steps = 0;
  let elapsedMs = 0;
  let nextMoveAt = rules.tickDelay(pace, foodCount);
  let reachedRushDeadline = false;
  let recentHeads = [];
  let committedPlan = [];
  let stepsSinceCapture = 0;
  let maxCaptureGap = 0;
  let stepsSinceObjective = 0;
  let maxObjectiveGap = 0;
  let routeSignature = "";
  let canvasCompositionState = null;
  let canvasCompositionBudget = 0;
  let canvasCompositionSteps = 0;
  const canvasCompositionSeed = rules.signalState(code);

  function placeFood(resetCaptureGap = true) {
    const open = [];
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        if (!snake.some((segment) => segment.x === x && segment.y === y)) {
          open.push({ x, y });
        }
      }
    }
    if (!open.length) {
      food = null;
      return;
    }
    const choice = rules.signalIndex(signalState, open.length);
    signalState = choice.state;
    const isCore = foodCount > 0 && foodCount % 5 === 0;
    food = {
      ...open[choice.index],
      kind: isCore ? "core" : "signal",
      expiresAt: isCore ? elapsedMs + CORE_DURATION : 0,
    };
    recentHeads = [];
    committedPlan = [];
    stepsSinceObjective = 0;
    if (resetCaptureGap) stepsSinceCapture = 0;
    if (mode === "canvas") {
      canvasCompositionBudget = 14 + (signalState % 12);
    }
  }

  placeFood();
  while (steps < maxSteps && food) {
    if (mode === "rush" && nextMoveAt >= RUSH_DURATION) {
      elapsedMs = RUSH_DURATION;
      reachedRushDeadline = true;
      break;
    }
    elapsedMs = nextMoveAt;
    if (mutation.type && !rules.mutationTypeAt(mutation, elapsedMs)) {
      mutation = { type: null, expiresAt: 0 };
    }
    if (food.kind === "core" && elapsedMs >= food.expiresAt) {
      foodCount += 1;
      coresExpired += 1;
      placeFood(false);
    }

    let selected = null;
    if (mode === "canvas" && canvasCompositionBudget > 0) {
      let composition = rules.canvasCompositionMove(
        canvasCompositionState,
        direction,
        canvasCompositionSeed,
      );
      if (rules.isReverseDirection(composition.direction, direction)) {
        canvasCompositionState = null;
        composition = rules.canvasCompositionMove(
          null,
          direction,
          canvasCompositionSeed,
        );
      }
      canvasCompositionState = composition.state;
      canvasCompositionBudget -= 1;
      canvasCompositionSteps += 1;
      const option = DIRECTIONS.find((candidate) =>
        candidate.x === composition.direction.x
        && candidate.y === composition.direction.y);
      selected = option
        ? { name: option.name, direction: { ...composition.direction } }
        : null;
    } else if (committedPlan.length) {
      const committed = committedPlan.shift();
      const head = rules.nextHead(snake[0], committed, mode, 20);
      const growing = head.x === food.x && head.y === food.y;
      const collision = rules.isReverseDirection(committed, direction)
        ? "reverse"
        : rules.collisionType(head, snake, growing, mode, 20);
      if (!collision) {
        const option = DIRECTIONS.find((candidate) =>
          candidate.x === committed.x && candidate.y === committed.y);
        selected = option
          ? { name: option.name, direction: { x: option.x, y: option.y } }
          : null;
      } else {
        committedPlan = [];
      }
    }
    if (!selected) {
      const evaluations = rules.evaluateMoves({
        snake,
        direction,
        food,
        mode,
        gridSize: 20,
        candidates: DIRECTIONS,
        recentHeads,
      });
      selected = rules.chooseBestMove(evaluations);
      committedPlan = selected?.route?.slice(1).map((move) => ({ ...move })) || [];
    }
    if (!selected) {
      return {
        code,
        mode,
        pace: paceName,
        steps,
        foods,
        length: snake.length,
        maxCaptureGap,
        maxObjectiveGap,
        routeSignature,
        canvasCompositionSteps,
        elapsedMs,
        foodCount,
        coresCollected,
        coresExpired,
        mutationSignature,
        outcome: "trapped",
      };
    }

    const head = rules.nextHead(snake[0], selected.direction, mode, 20);
    const growing = head.x === food.x && head.y === food.y;
    const collision = rules.collisionType(head, snake, growing, mode, 20);
    if (collision) {
      return {
        code,
        mode,
        pace: paceName,
        steps,
        foods,
        length: snake.length,
        maxCaptureGap,
        maxObjectiveGap,
        routeSignature,
        canvasCompositionSteps,
        elapsedMs,
        foodCount,
        coresCollected,
        coresExpired,
        mutationSignature,
        outcome: collision,
      };
    }

    snake = [head, ...snake];
    recentHeads.push({ ...head });
    if (recentHeads.length > 256) recentHeads.shift();
    stepsSinceCapture += 1;
    stepsSinceObjective += 1;
    maxCaptureGap = Math.max(maxCaptureGap, stepsSinceCapture);
    maxObjectiveGap = Math.max(maxObjectiveGap, stepsSinceObjective);
    if (routeSignature.length < 300) routeSignature += selected.name[0];
    if (growing) {
      foods += 1;
      foodCount += 1;
      if (food.kind === "core") {
        coresCollected += 1;
        const mutationChoice = rules.signalIndex(signalState, 2);
        signalState = mutationChoice.state;
        const type = ["flow", "amplify"][mutationChoice.index];
        mutation = { type, expiresAt: elapsedMs + MUTATION_DURATION };
        mutationSignature += type[0];
      }
      placeFood();
      if (mode === "canvas" && snake.length > CANVAS_BRUSH_LENGTH) snake.pop();
    } else {
      snake.pop();
    }
    direction = { ...selected.direction };
    steps += 1;
    const delay = rules.mutationDelay(
      rules.tickDelay(pace, foodCount),
      mutation.type,
    );
    nextMoveAt = elapsedMs + delay;
  }
  return {
    code,
    mode,
    pace: paceName,
    steps,
    foods,
    length: snake.length,
    maxCaptureGap,
    maxObjectiveGap,
    routeSignature,
    canvasCompositionSteps,
    elapsedMs,
    foodCount,
    coresCollected,
    coresExpired,
    mutationSignature,
    outcome: food ? (reachedRushDeadline ? "deadline" : "timeout") : "clear",
  };
}

function simulateDuel(code, policy = "greedy", maxSteps = 240) {
  let signalState = rules.signalState(code);
  const spawns = rules.duelSpawns(30);
  let humanSnake = spawns.player.snake.map((point) => ({ ...point }));
  let humanDirection = { ...spawns.player.direction };
  let autopilotSnake = spawns.opponent.snake.map((point) => ({ ...point }));
  let autopilotDirection = { ...spawns.opponent.direction };
  let humanScore = 0;
  let autopilotScore = 0;
  let food = null;
  const recentHeads = [];
  const visitedHeads = [];
  let routeSignature = "";

  function random() {
    const next = rules.nextSignalRandom(signalState);
    signalState = next.state;
    return next.value;
  }

  function placeFood() {
    const occupied = new Set(
      [...humanSnake, ...autopilotSnake].map((point) => `${point.x},${point.y}`),
    );
    const open = [];
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) {
        if (!occupied.has(`${x},${y}`)) open.push({ x, y });
      }
    }
    food = open[Math.floor(random() * open.length)];
  }

  function humanMove() {
    const legal = DIRECTIONS.filter((move) => {
      if (
        move.x === -humanDirection.x
        && move.y === -humanDirection.y
      ) return false;
      const head = rules.nextHead(humanSnake[0], move, "classic", 30);
      const growing = head.x === food.x && head.y === food.y;
      if (rules.collisionType(head, humanSnake, growing, "classic", 30)) return false;
      return !autopilotSnake.slice(0, -1).some(
        (segment) => segment.x === head.x && segment.y === head.y,
      );
    });
    if (!legal.length) return { ...humanDirection };
    if (policy === "random") return legal[Math.floor(random() * legal.length)];
    const target = policy === "hunter" ? autopilotSnake[0] : food;
    return legal.slice().sort((first, second) =>
      rules.gridDistance(
        rules.nextHead(humanSnake[0], first, "classic", 30),
        target,
        "classic",
        30,
      ) - rules.gridDistance(
        rules.nextHead(humanSnake[0], second, "classic", 30),
        target,
        "classic",
        30,
      ))[0];
  }

  placeFood();
  for (let step = 0; step < maxSteps; step += 1) {
    const evaluations = rules.evaluateDuelMoves({
      snake: autopilotSnake,
      direction: autopilotDirection,
      opponentSnake: humanSnake,
      opponentDirection: humanDirection,
      food,
      mode: "classic",
      gridSize: 30,
      candidates: DIRECTIONS,
      seed: signalState,
      recentHeads,
    });
    const selected = rules.chooseBestMove(evaluations);
    assert.ok(selected, `Autopilot had no move at step ${step}`);
    const result = rules.resolveDuelTick({
      players: {
        player: {
          snake: humanSnake,
          direction: humanMove(),
          score: humanScore,
        },
        opponent: {
          snake: autopilotSnake,
          direction: selected.direction,
          score: autopilotScore,
        },
      },
      food,
      mode: "classic",
      gridSize: 30,
    });

    humanSnake = result.players.player.snake;
    humanDirection = result.players.player.direction;
    humanScore = result.players.player.score;
    autopilotSnake = result.players.opponent.snake;
    autopilotDirection = result.players.opponent.direction;
    autopilotScore = result.players.opponent.score;
    recentHeads.push({ ...autopilotSnake[0] });
    if (recentHeads.length > 192) recentHeads.shift();
    visitedHeads.push(`${autopilotSnake[0].x},${autopilotSnake[0].y}`);
    if (routeSignature.length < 160) routeSignature += selected.name[0];

    if (result.over) {
      return {
        code,
        policy,
        steps: step + 1,
        winner: result.winner,
        humanScore,
        autopilotScore,
        routeSignature,
        distinctHeads: new Set(visitedHeads).size,
      };
    }
    if (result.foodEatenBy) placeFood();
  }
  return {
    code,
    policy,
    steps: maxSteps,
    winner: "timeout",
    humanScore,
    autopilotScore,
    routeSignature,
    distinctHeads: new Set(visitedHeads).size,
  };
}


module.exports = { CANVAS_BRUSH_LENGTH, DIRECTIONS, PACES, codeFromIndex, rules, simulateDuel, simulateSolo };
