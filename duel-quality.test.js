"use strict";

const assert = require("node:assert/strict");
const rules = require("./public/game-logic.js");

const GRID = 30;
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIRECTIONS = [
  { name: "up", x: 0, y: -1 },
  { name: "right", x: 1, y: 0 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
];

function codeFromIndex(index) {
  let value = Math.max(0, Number(index) || 0);
  let code = "";
  for (let position = 0; position < 6; position += 1) {
    code = SIGNAL_ALPHABET[value % SIGNAL_ALPHABET.length] + code;
    value = Math.floor(value / SIGNAL_ALPHABET.length);
  }
  return code;
}

function swapWinner(winner) {
  if (winner === "player") return "opponent";
  if (winner === "opponent") return "player";
  return null;
}

function swapEater(eater) {
  if (eater === "player") return "opponent";
  if (eater === "opponent") return "player";
  return null;
}

function straightSnake(head, direction, length = 3) {
  return Array.from({ length }, (_, index) => ({
    x: head.x - direction.x * index,
    y: head.y - direction.y * index,
  }));
}

function inside(point, size) {
  return point.x >= 0 && point.y >= 0 && point.x < size && point.y < size;
}

function assertSymmetricTick(players, food, gridSize) {
  const result = rules.resolveDuelTick({
    players,
    food,
    mode: "classic",
    gridSize,
  });
  const swapped = rules.resolveDuelTick({
    players: {
      player: players.opponent,
      opponent: players.player,
    },
    food,
    mode: "classic",
    gridSize,
  });

  assert.deepEqual(swapped.players.player, result.players.opponent);
  assert.deepEqual(swapped.players.opponent, result.players.player);
  assert.equal(swapped.crashes.player, result.crashes.opponent);
  assert.equal(swapped.crashes.opponent, result.crashes.player);
  assert.equal(swapped.over, result.over);
  assert.equal(swapped.winner, swapWinner(result.winner));
  assert.equal(swapped.foodEatenBy, swapEater(result.foodEatenBy));
}

function legalPolicyMoves({
  humanSnake,
  aiSnake,
  humanDirection,
  aiMove,
  food,
  gridSize = GRID,
}) {
  const aiHead = rules.nextHead(aiSnake[0], aiMove, "classic", gridSize);
  const aiGrowing = aiHead.x === food.x && aiHead.y === food.y;
  const rivalBody = aiGrowing ? aiSnake : aiSnake.slice(0, -1);
  return DIRECTIONS.filter((move) => {
    if (rules.isReverseDirection(move, humanDirection)) return false;
    const head = rules.nextHead(humanSnake[0], move, "classic", gridSize);
    const growing = head.x === food.x && head.y === food.y;
    if (rules.collisionType(head, humanSnake, growing, "classic", gridSize)) return false;
    return !rivalBody.some((segment) => segment.x === head.x && segment.y === head.y);
  });
}

function simulateDuel(code, aiRole, policy, maxSteps = 300) {
  let signalState = rules.signalState(code);
  const spawns = rules.duelSpawns(GRID);
  const snakes = {
    player: spawns.player.snake.map((point) => ({ ...point })),
    opponent: spawns.opponent.snake.map((point) => ({ ...point })),
  };
  const directions = {
    player: { ...spawns.player.direction },
    opponent: { ...spawns.opponent.direction },
  };
  const scores = { player: 0, opponent: 0 };
  const humanRole = aiRole === "player" ? "opponent" : "player";
  const recentHeads = [];
  const visitedHeads = [];
  let food = null;
  let routeSignature = "";
  let avoidableImmediateLosses = 0;

  function random() {
    const next = rules.nextSignalRandom(signalState);
    signalState = next.state;
    return next.value;
  }

  function placeFood() {
    const occupied = new Set(
      [...snakes.player, ...snakes.opponent].map((point) => `${point.x},${point.y}`),
    );
    const open = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (!occupied.has(`${x},${y}`)) open.push({ x, y });
      }
    }
    const choice = rules.signalIndex(signalState, open.length);
    signalState = choice.state;
    food = open[choice.index];
  }

  function humanMove(aiMove) {
    const humanSnake = snakes[humanRole];
    const aiSnake = snakes[aiRole];
    const humanDirection = directions[humanRole];
    const legal = legalPolicyMoves({
      humanSnake,
      aiSnake,
      humanDirection,
      aiMove,
      food,
    });
    if (!legal.length) return { ...humanDirection };

    const target = policy === "hunter" ? aiSnake[0] : food;
    const ranked = legal.map((move, order) => {
      const head = rules.nextHead(humanSnake[0], move, "classic", GRID);
      const distance = rules.gridDistance(head, target, "classic", GRID);
      const edgeRoom = Math.min(head.x, head.y, GRID - head.x - 1, GRID - head.y - 1);
      return {
        move,
        rank: policy === "evader"
          ? distance * 20 + edgeRoom
          : -distance * 20 + edgeRoom,
        order,
      };
    }).sort((first, second) =>
      second.rank - first.rank || first.order - second.order);
    return ranked[0].move;
  }

  placeFood();
  for (let step = 0; step < maxSteps; step += 1) {
    const evaluations = rules.evaluateDuelMoves({
      snake: snakes[aiRole],
      direction: directions[aiRole],
      opponentSnake: snakes[humanRole],
      opponentDirection: directions[humanRole],
      score: scores[aiRole],
      opponentScore: scores[humanRole],
      food,
      mode: "classic",
      gridSize: GRID,
      candidates: DIRECTIONS,
      seed: signalState,
      recentHeads,
    });
    const selected = rules.chooseBestMove(evaluations);
    assert.ok(selected, `No AI move for ${code}/${aiRole}/${policy} at ${step}`);
    if (
      selected.losingReplies > 0
      && evaluations.some((candidate) => candidate.legal && candidate.losingReplies === 0)
    ) {
      avoidableImmediateLosses += 1;
    }

    const moves = {
      [aiRole]: selected.direction,
      [humanRole]: humanMove(selected.direction),
    };
    const result = rules.resolveDuelTick({
      players: {
        player: {
          snake: snakes.player,
          direction: moves.player,
          score: scores.player,
        },
        opponent: {
          snake: snakes.opponent,
          direction: moves.opponent,
          score: scores.opponent,
        },
      },
      food,
      mode: "classic",
      gridSize: GRID,
    });

    ["player", "opponent"].forEach((role) => {
      snakes[role] = result.players[role].snake;
      directions[role] = result.players[role].direction;
      scores[role] = result.players[role].score;
    });
    recentHeads.push({ ...snakes[aiRole][0] });
    if (recentHeads.length > 192) recentHeads.shift();
    visitedHeads.push(`${snakes[aiRole][0].x},${snakes[aiRole][0].y}`);
    if (routeSignature.length < 180) routeSignature += selected.name[0];

    if (result.over) {
      const winner = result.winner === aiRole
        ? "ai"
        : result.winner === humanRole
          ? "human"
          : "draw";
      return {
        code,
        aiRole,
        policy,
        steps: step + 1,
        winner,
        aiScore: scores[aiRole],
        humanScore: scores[humanRole],
        avoidableImmediateLosses,
        routeSignature,
        distinctHeads: new Set(visitedHeads).size,
      };
    }
    if (result.foodEatenBy) placeFood();
  }

  return {
    code,
    aiRole,
    policy,
    steps: maxSteps,
    winner: "timeout",
    aiScore: scores[aiRole],
    humanScore: scores[humanRole],
    avoidableImmediateLosses,
    routeSignature,
    distinctHeads: new Set(visitedHeads).size,
  };
}

const tests = [
  ["benchmark policies retain an Autopilot tail when its selected move grows", () => {
    const humanSnake = [
      { x: 5, y: 4 },
      { x: 4, y: 4 },
      { x: 3, y: 4 },
    ];
    const aiSnake = [
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ];
    const food = { x: 7, y: 4 };
    const intoRivalTail = { name: "down", x: 0, y: 1 };
    const growingMoves = legalPolicyMoves({
      humanSnake,
      aiSnake,
      humanDirection: { x: 1, y: 0 },
      aiMove: { x: 1, y: 0 },
      food,
      gridSize: 10,
    });
    const movingMoves = legalPolicyMoves({
      humanSnake,
      aiSnake,
      humanDirection: { x: 1, y: 0 },
      aiMove: { x: 0, y: -1 },
      food,
      gridSize: 10,
    });
    assert.equal(growingMoves.some((move) => move.name === intoRivalTail.name), false);
    assert.equal(movingMoves.some((move) => move.name === intoRivalTail.name), true);
  }],
  ["simultaneous duel resolution is player-order symmetric", () => {
    const size = 10;
    let state = rules.signalState("DUEL42");
    let checked = 0;
    for (let attempt = 0; attempt < 4_000 && checked < 1_200; attempt += 1) {
      const values = [];
      for (let index = 0; index < 7; index += 1) {
        const next = rules.nextSignalRandom(state);
        state = next.state;
        values.push(next.value);
      }
      const playerDirection = DIRECTIONS[Math.floor(values[0] * DIRECTIONS.length)];
      const opponentDirection = DIRECTIONS[Math.floor(values[1] * DIRECTIONS.length)];
      const playerSnake = straightSnake({
        x: Math.floor(values[2] * size),
        y: Math.floor(values[3] * size),
      }, playerDirection);
      const opponentSnake = straightSnake({
        x: Math.floor(values[4] * size),
        y: Math.floor(values[5] * size),
      }, opponentDirection);
      const occupied = [...playerSnake, ...opponentSnake];
      if (
        !occupied.every((point) => inside(point, size))
        || new Set(occupied.map((point) => `${point.x},${point.y}`)).size !== occupied.length
      ) continue;
      const foodIndex = Math.floor(values[6] * size * size);
      const food = { x: foodIndex % size, y: Math.floor(foodIndex / size) };
      if (occupied.some((point) => point.x === food.x && point.y === food.y)) continue;
      assertSymmetricTick({
        player: { snake: playerSnake, direction: playerDirection, score: 2 },
        opponent: { snake: opponentSnake, direction: opponentDirection, score: 3 },
      }, food, size);
      checked += 1;
    }
    assert.equal(checked, 1_200);
  }],
  ["Duel Autopilot stays competitive from both spawns across adversarial policies", () => {
    const codes = Array.from({ length: 6 }, (_, index) => codeFromIndex(index + 96));
    const runs = [];
    for (const code of codes) {
      for (const aiRole of ["player", "opponent"]) {
        for (const policy of ["greedy", "hunter", "evader"]) {
          runs.push(simulateDuel(code, aiRole, policy));
        }
      }
    }
    assert.equal(runs.length, 36);
    assert.equal(
      runs.reduce((sum, run) => sum + run.avoidableImmediateLosses, 0),
      0,
      JSON.stringify(runs),
    );
    const humanWins = runs.filter((run) => run.winner === "human");
    assert.ok(humanWins.length <= 6, JSON.stringify(humanWins));
    for (const aiRole of ["player", "opponent"]) {
      for (const policy of ["greedy", "hunter", "evader"]) {
        const cohort = runs.filter((run) =>
          run.aiRole === aiRole && run.policy === policy);
        assert.ok(
          new Set(cohort.map((run) => run.routeSignature)).size >= 5,
          JSON.stringify(cohort),
        );
      }
    }
    assert.ok(
      runs.filter((run) => run.steps >= 100).every((run) => run.distinctHeads >= 60),
      JSON.stringify(runs.filter((run) => run.steps >= 100)),
    );
    process.stdout.write(
      `Duel matrix: ${runs.filter((run) => run.winner === "ai").length} AI wins, `
      + `${humanWins.length} human wins, `
      + `${runs.filter((run) => run.winner === "draw").length} draws, `
      + `${runs.filter((run) => run.winner === "timeout").length} timeouts\n`,
    );
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic Duel quality tests passed.\n`);
