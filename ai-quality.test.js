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

function codeFromIndex(value) {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += SIGNAL_ALPHABET[
      (value * 17 + index * 11 + value * index) % SIGNAL_ALPHABET.length
    ];
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
  }

  placeFood();
  while (steps < maxSteps && food) {
    const evaluations = rules.evaluateMoves({
      snake,
      direction,
      food,
      mode,
      gridSize: 20,
      candidates: DIRECTIONS,
    });
    const selected = rules.chooseBestMove(evaluations);
    if (!selected) {
      return { code, mode, steps, foods, length: snake.length, outcome: "trapped" };
    }

    const head = rules.nextHead(snake[0], selected.direction, mode, 20);
    const growing = head.x === food.x && head.y === food.y;
    const collision = rules.collisionType(head, snake, growing, mode, 20);
    if (collision) {
      return { code, mode, steps, foods, length: snake.length, outcome: collision };
    }

    snake = [head, ...snake];
    if (growing) {
      foods += 1;
      placeFood();
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
    outcome: food ? "timeout" : "clear",
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
  ["solo AI takes a direct food route only when it can still reach its tail", () => {
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
    assert.equal(selected.strategy, "SAFE FOOD ROUTE");
    assert.equal(selected.routeDistance, 1);
    assert.deepEqual(rules.decisionInsight(evaluations, selected), {
      confidence: "ROUTE",
      reason: "SIGNAL CAPTURE · EXIT PROVEN",
      margin: selected.score - evaluations.find((move) => move.name === "right").score,
      runnerUp: "right",
    });
  }],
  ["duel AI rejects a food line the player can contest next tick", () => {
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
  }],
  ["duel AI does not treat an optional opponent mistake as a forced win", () => {
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
  ["seeded solo benchmark stays alive and collects purposefully", () => {
    const runs = [1, 2, 3, 4].map((index) =>
      simulateSolo(codeFromIndex(index), "classic", 600));
    const totalFoods = runs.reduce((total, run) => total + run.foods, 0);
    runs.forEach((run) => assert.equal(run.outcome, "timeout", JSON.stringify(run)));
    assert.ok(totalFoods >= 160, JSON.stringify(runs));
  }],
  ["planner remains purposeful across Portal, Rush, and Canvas boundaries", () => {
    const runs = ["portal", "rush", "canvas"].map((mode) =>
      simulateSolo("KXBP3F", mode, 600));
    runs.forEach((run) => assert.equal(run.outcome, "timeout", JSON.stringify(run)));
    assert.ok(runs.find((run) => run.mode === "portal").foods >= 55, JSON.stringify(runs));
    assert.ok(runs.find((run) => run.mode === "rush").foods >= 40, JSON.stringify(runs));
    assert.ok(runs.find((run) => run.mode === "canvas").foods >= 55, JSON.stringify(runs));
  }],
  ["the former deterministic trap seed survives beyond its old failure", () => {
    const run = simulateSolo("8RATCV", "classic", 1800);
    assert.equal(run.outcome, "timeout", JSON.stringify(run));
    assert.ok(run.foods >= 60, JSON.stringify(run));
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic AI quality tests passed.\n`);
