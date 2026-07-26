"use strict";

const assert = require("node:assert/strict");
const rules = require("./public/game-logic.js");

const DIRECTIONS = [
  { name: "up", x: 0, y: -1 },
  { name: "right", x: 1, y: 0 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
];
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CANVAS_BRUSH_LENGTH = 18;

function codeFromIndex(value) {
  let state = Math.imul((Number(value) || 0) >>> 0, 0x9e3779b1) & 0x3fffffff;
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += SIGNAL_ALPHABET[state % SIGNAL_ALPHABET.length];
    state = Math.floor(state / SIGNAL_ALPHABET.length);
  }
  return code;
}

function simulateSolo(code, mode = "classic", maxSteps = 600) {
  let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  let direction = { x: 1, y: 0 };
  let signalState = rules.signalState(code);
  let food = null;
  let foods = 0;
  let steps = 0;
  let recentHeads = [];
  let committedPlan = [];
  let stepsSinceFood = 0;
  let maxFoodGap = 0;
  let routeSignature = "";
  let canvasCompositionState = null;
  let canvasCompositionBudget = 0;
  let canvasCompositionSteps = 0;
  const canvasCompositionSeed = rules.signalState(code);

  function placeFood() {
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
    food = open[choice.index];
    recentHeads = [];
    committedPlan = [];
    stepsSinceFood = 0;
    if (mode === "canvas") {
      canvasCompositionBudget = 14 + (signalState % 12);
    }
  }

  placeFood();
  while (steps < maxSteps && food) {
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
        steps,
        foods,
        length: snake.length,
        maxFoodGap,
        routeSignature,
        canvasCompositionSteps,
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
        steps,
        foods,
        length: snake.length,
        maxFoodGap,
        routeSignature,
        canvasCompositionSteps,
        outcome: collision,
      };
    }

    snake = [head, ...snake];
    recentHeads.push({ ...head });
    if (recentHeads.length > 256) recentHeads.shift();
    stepsSinceFood += 1;
    maxFoodGap = Math.max(maxFoodGap, stepsSinceFood);
    if (routeSignature.length < 300) routeSignature += selected.name[0];
    if (growing) {
      foods += 1;
      placeFood();
      if (mode === "canvas" && snake.length > CANVAS_BRUSH_LENGTH) snake.pop();
    } else {
      snake.pop();
    }
    direction = { ...selected.direction };
    steps += 1;
  }
  return {
    code,
    mode,
    steps,
    foods,
    length: snake.length,
    maxFoodGap,
    routeSignature,
    canvasCompositionSteps,
    outcome: food ? "timeout" : "clear",
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

const tests = [
  ["the safety cycle covers every cell exactly once with legal joins", () => {
    const cycle = rules.hamiltonianCycle(20);
    assert.equal(cycle.length, 400);
    assert.equal(new Set(cycle.map((point) => `${point.x},${point.y}`)).size, 400);
    cycle.forEach((point, index) => {
      const next = cycle[(index + 1) % cycle.length];
      assert.equal(rules.gridDistance(point, next, "classic", 20), 1);
    });
    assert.deepEqual(rules.hamiltonianCycle(19), []);
  }],
  ["solo Autopilot takes a cycle-safe shortcut without surrendering the completion invariant", () => {
    const evaluations = rules.evaluateMoves({
      snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
      direction: { x: 1, y: 0 },
      food: { x: 10, y: 11 },
      mode: "classic",
      gridSize: 20,
      candidates: DIRECTIONS,
    });
    const selected = rules.chooseBestMove(evaluations);
    assert.equal(selected.name, "down");
    assert.equal(selected.strategy, "SAFE SHORTCUT");
    assert.equal(selected.cycleSafe, true);
    assert.deepEqual(rules.decisionInsight(evaluations, selected), {
      confidence: "ROUTE",
      reason: "SIGNAL CAPTURE · TAIL SAFE",
      margin: selected.score - evaluations.find((move) => move.name === "right").score,
      runnerUp: "right",
    });
  }],
  ["duel Autopilot rejects a food line the player can contest next tick", () => {
    const evaluations = rules.evaluateDuelMoves({
      snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }],
      direction: { x: 0, y: -1 },
      opponentSnake: [{ x: 5, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 3 }],
      opponentDirection: { x: 1, y: 0 },
      food: { x: 5, y: 0 },
      mode: "classic",
      gridSize: 12,
      candidates: DIRECTIONS,
    });
    const contested = evaluations.find((move) => move.name === "up");
    const selected = rules.chooseBestMove(evaluations);
    assert.equal(contested.strategy, "CONTESTED");
    assert.equal(contested.drawingReplies, 1);
    assert.notEqual(selected.name, "up");
    assert.equal(selected.drawingReplies, 0);
    assert.equal(selected.searchDepth, 2);
    assert.ok(selected.searchNodes > 0);
  }],
  ["duel Autopilot does not treat an optional opponent mistake as a forced win", () => {
    const evaluations = rules.evaluateDuelMoves({
      snake: [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
      direction: { x: 0, y: -1 },
      opponentSnake: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      opponentDirection: { x: 1, y: 0 },
      food: { x: 5, y: 1 },
      mode: "classic",
      gridSize: 8,
      candidates: DIRECTIONS,
    });
    const withMistakeAvailable = evaluations.find((move) =>
      move.legal && move.winningReplies > 0 && move.openReplies > 0);
    assert.ok(withMistakeAvailable);
    assert.equal(withMistakeAvailable.forcedWin, false);
    assert.notEqual(withMistakeAvailable.strategy, "TACTICAL WIN");
  }],
  ["duel search keeps the visible food target throughout its forecast", () => {
    const spawns = rules.duelSpawns(12);
    const first = rules.evaluateDuelMoves({
      snake: spawns.opponent.snake,
      direction: spawns.opponent.direction,
      opponentSnake: spawns.player.snake,
      opponentDirection: spawns.player.direction,
      food: { x: 6, y: 0 },
      mode: "classic",
      gridSize: 12,
      candidates: DIRECTIONS,
    }).find((move) => move.name === "left");
    const second = rules.evaluateDuelMoves({
      snake: spawns.opponent.snake,
      direction: spawns.opponent.direction,
      opponentSnake: spawns.player.snake,
      opponentDirection: spawns.player.direction,
      food: { x: 8, y: 0 },
      mode: "classic",
      gridSize: 12,
      candidates: DIRECTIONS,
    }).find((move) => move.name === "left");
    assert.equal(first.distance, second.distance);
    assert.notEqual(first.searchValue, second.searchValue);
  }],
  ["duel Autopilot adapts to seeded maps against a direct human food racer", () => {
    const runs = ["KXBP3F", "8RATCV", "F8ZUNJ"].map((code) =>
      simulateDuel(code, "greedy", 240));
    assert.equal(
      runs.filter((run) => run.winner === "player").length,
      0,
      JSON.stringify(runs),
    );
    assert.ok(
      runs.filter((run) => run.winner === "opponent").length >= 2,
      JSON.stringify(runs),
    );
    assert.equal(
      new Set(runs.map((run) => run.routeSignature)).size,
      runs.length,
      JSON.stringify(runs),
    );
  }],
  ["duel loop recovery breaks short pursuit cycles", () => {
    const run = simulateDuel("KXBP3F", "hunter", 300);
    assert.notEqual(run.winner, "player", JSON.stringify(run));
    assert.ok(run.distinctHeads >= 100, JSON.stringify(run));
  }],
  ["seeded solo benchmark stays alive and collects purposefully", () => {
    const runs = Array.from({ length: 16 }, (_, index) =>
      simulateSolo(codeFromIndex(index), "classic", 600));
    const totalFoods = runs.reduce((total, run) => total + run.foods, 0);
    runs.forEach((run) => assert.equal(run.outcome, "timeout", JSON.stringify(run)));
    assert.equal(
      new Set(runs.map((run) => run.code)).size,
      runs.length,
      JSON.stringify(runs),
    );
    assert.equal(
      new Set(runs.map((run) => run.routeSignature)).size,
      runs.length,
      JSON.stringify(runs),
    );
    runs.forEach((run) => assert.ok(run.foods >= 15, JSON.stringify(run)));
    assert.ok(totalFoods >= 280, JSON.stringify(runs));
  }],
  ["planner remains purposeful across Portal, Rush, and Canvas boundaries", () => {
    const runs = ["portal", "rush", "canvas"].map((mode) =>
      simulateSolo("KXBP3F", mode, 600));
    runs.forEach((run) => assert.equal(run.outcome, "timeout", JSON.stringify(run)));
    assert.ok(runs.find((run) => run.mode === "portal").foods >= 55, JSON.stringify(runs));
    assert.ok(runs.find((run) => run.mode === "rush").foods >= 40, JSON.stringify(runs));
    assert.ok(runs.find((run) => run.mode === "canvas").foods >= 18, JSON.stringify(runs));
  }],
  ["the former deterministic trap seed survives beyond its old failure", () => {
    const run = simulateSolo("8RATCV", "classic", 1800);
    assert.equal(run.outcome, "timeout", JSON.stringify(run));
    assert.ok(run.foods >= 60, JSON.stringify(run));
  }],
  ["Signal Codes produce distinct adaptive route signatures", () => {
    const first = simulateSolo("KXBP3F", "classic", 300);
    const second = simulateSolo("8RATCV", "classic", 300);
    assert.notEqual(first.routeSignature, second.routeSignature);
  }],
  ["unique Signal Codes stay purposeful and non-repeating across solo modes", () => {
    const codes = Array.from({ length: 8 }, (_, index) => codeFromIndex(index + 32));
    assert.equal(new Set(codes).size, codes.length);
    const expectations = {
      classic: { foods: 45, maxFoodGap: 140 },
      portal: { foods: 100, maxFoodGap: 180 },
      rush: { foods: 45, maxFoodGap: 140 },
      canvas: { foods: 40, maxFoodGap: 80 },
    };
    for (const [mode, expectation] of Object.entries(expectations)) {
      const runs = codes.map((code) => simulateSolo(code, mode, 2000));
      runs.forEach((run) => {
        assert.equal(run.outcome, "timeout", JSON.stringify(run));
        assert.ok(run.foods >= expectation.foods, JSON.stringify(run));
        assert.ok(run.maxFoodGap <= expectation.maxFoodGap, JSON.stringify(run));
        if (mode === "canvas") {
          assert.equal(run.length, CANVAS_BRUSH_LENGTH, JSON.stringify(run));
          assert.ok(run.canvasCompositionSteps >= 800, JSON.stringify(run));
        }
      });
      assert.equal(
        new Set(runs.map((run) => run.routeSignature)).size,
        runs.length,
        JSON.stringify(runs),
      );
    }
  }],
  ["Classic Autopilot completes the entire 20 by 20 board across seeded maps", () => {
    const runs = ["KXBP3F", "8RATCV", "F8ZUNJ"].map((code) =>
      simulateSolo(code, "classic", 120_000));
    runs.forEach((run) => {
      assert.equal(run.outcome, "clear", JSON.stringify(run));
      assert.equal(run.length, 400, JSON.stringify(run));
      assert.equal(run.foods, 397, JSON.stringify(run));
      assert.ok(run.maxFoodGap <= 400, JSON.stringify(run));
    });
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic AI quality tests passed.\n`);
