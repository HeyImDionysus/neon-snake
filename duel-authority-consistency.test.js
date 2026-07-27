"use strict";

const assert = require("node:assert/strict");
const rules = require("./public/game-logic.js");
const {
  DUEL_GRID,
  RoomSimulation,
} = require("./server/realtime-core.cjs");

const DIRECTIONS = [
  { name: "up", x: 0, y: -1 },
  { name: "right", x: 1, y: 0 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
];
const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function codeFromIndex(index) {
  let value = Math.max(0, Number(index) || 0);
  let code = "";
  for (let position = 0; position < 6; position += 1) {
    code = SIGNAL_ALPHABET[value % SIGNAL_ALPHABET.length] + code;
    value = Math.floor(value / SIGNAL_ALPHABET.length);
  }
  return code;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameDirection(first, second) {
  return first.x === second.x && first.y === second.y;
}

function createSimulation(room) {
  return new RoomSimulation({
    publish: async () => {},
    roomAllReady: () => true,
    connectionOwnsSlot: () => true,
    recordMatch: async () => {},
    resetReady: async () => {},
  }, room, "authority");
}

function legalPolicyMoves({
  humanSnake,
  aiSnake,
  humanDirection,
  aiMove,
  food,
}) {
  const aiHead = rules.nextHead(aiSnake[0], aiMove, "classic", DUEL_GRID);
  const aiGrowing = aiHead.x === food.x && aiHead.y === food.y;
  const rivalBody = aiGrowing ? aiSnake : aiSnake.slice(0, -1);
  return DIRECTIONS.filter((move) => {
    if (rules.isReverseDirection(move, humanDirection)) return false;
    const head = rules.nextHead(humanSnake[0], move, "classic", DUEL_GRID);
    const growing = head.x === food.x && head.y === food.y;
    if (rules.collisionType(head, humanSnake, growing, "classic", DUEL_GRID)) return false;
    return !rivalBody.some((segment) => segment.x === head.x && segment.y === head.y);
  });
}

function policyMove(reference, humanRole, aiRole, aiMove) {
  const humanSnake = reference[`${humanRole}Snake`];
  const aiSnake = reference[`${aiRole}Snake`];
  const humanDirection = reference[`${humanRole}Direction`];
  const legal = legalPolicyMoves({
    humanSnake,
    aiSnake,
    humanDirection,
    aiMove,
    food: reference.food,
  });
  if (!legal.length) return { ...humanDirection };
  return legal.map((move, order) => {
    const head = rules.nextHead(humanSnake[0], move, "classic", DUEL_GRID);
    return {
      move,
      order,
      distance: rules.gridDistance(head, reference.food, "classic", DUEL_GRID),
    };
  }).sort((first, second) =>
    first.distance - second.distance || first.order - second.order)[0].move;
}

function placeReferenceFood(reference) {
  let value = reference.signalCursor || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  reference.signalCursor = value >>> 0;
  const occupied = new Set([
    ...reference.playerSnake,
    ...reference.opponentSnake,
  ].map((point) => `${point.x},${point.y}`));
  const free = [];
  for (let y = 0; y < DUEL_GRID; y += 1) {
    for (let x = 0; x < DUEL_GRID; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  reference.food = free.length
    ? free[Math.floor((reference.signalCursor / 4294967296) * free.length)]
    : null;
}

function comparable(game) {
  return {
    playerSnake: game.playerSnake,
    opponentSnake: game.opponentSnake,
    playerDirection: game.playerDirection,
    opponentDirection: game.opponentDirection,
    playerScore: game.playerScore,
    opponentScore: game.opponentScore,
    food: game.food,
    signalCursor: game.signalCursor,
    over: game.over,
  };
}

function runConsistencyMatrix() {
  let totalTicks = 0;
  let totalFood = 0;
  const completed = [];
  for (let run = 0; run < 12; run += 1) {
    const room = codeFromIndex(700 + run);
    const round = 10_000 + run;
    const simulation = createSimulation(room);
    simulation.start({ round, startsAt: Date.now() + 60_000 });
    clearTimeout(simulation.tickTimer);
    simulation.tickTimer = null;

    const spawns = rules.duelSpawns(DUEL_GRID);
    assert.deepEqual(simulation.game.playerSnake, spawns.player.snake);
    assert.deepEqual(simulation.game.opponentSnake, spawns.opponent.snake);
    const reference = clone(simulation.game);
    const aiRole = run % 2 === 0 ? "player" : "opponent";
    const humanRole = aiRole === "player" ? "opponent" : "player";
    const recentHeads = [];
    const sequences = { player: 0, opponent: 0 };
    let ticks = 0;

    for (; ticks < 180 && !reference.over; ticks += 1) {
      const evaluations = rules.evaluateDuelMoves({
        snake: reference[`${aiRole}Snake`],
        direction: reference[`${aiRole}Direction`],
        opponentSnake: reference[`${humanRole}Snake`],
        opponentDirection: reference[`${humanRole}Direction`],
        score: reference[`${aiRole}Score`],
        opponentScore: reference[`${humanRole}Score`],
        food: reference.food,
        mode: "classic",
        gridSize: DUEL_GRID,
        candidates: DIRECTIONS,
        seed: reference.signalCursor,
        recentHeads,
      });
      const selected = rules.chooseBestMove(evaluations);
      assert.ok(selected, `No local AI move for ${room} at tick ${ticks}`);
      const moves = {
        [aiRole]: selected.direction,
        [humanRole]: policyMove(reference, humanRole, aiRole, selected.direction),
      };

      for (const slotRole of ["player", "opponent"]) {
        if (sameDirection(moves[slotRole], reference[`${slotRole}Direction`])) continue;
        sequences[slotRole] += 1;
        simulation.enqueue(slotRole === "player" ? 0 : 1, {
          round,
          sequence: sequences[slotRole],
          direction: moves[slotRole],
        });
        reference[`${slotRole}Direction`] = { ...moves[slotRole] };
      }

      const localResult = rules.resolveDuelTick({
        players: {
          player: {
            snake: reference.playerSnake,
            direction: reference.playerDirection,
            score: reference.playerScore,
          },
          opponent: {
            snake: reference.opponentSnake,
            direction: reference.opponentDirection,
            score: reference.opponentScore,
          },
        },
        food: reference.food,
        mode: "classic",
        gridSize: DUEL_GRID,
      });
      for (const role of ["player", "opponent"]) {
        reference[`${role}Snake`] = localResult.players[role].snake;
        reference[`${role}Direction`] = localResult.players[role].direction;
        reference[`${role}Score`] = localResult.players[role].score;
      }
      reference.over = localResult.over;
      if (localResult.foodEatenBy && !localResult.over) {
        totalFood += 1;
        placeReferenceFood(reference);
      }
      if (!reference.food) reference.over = true;

      const authorityResult = simulation.resolveTick();
      const diagnostic = `${room}/${aiRole}/tick-${ticks + 1}`;
      assert.deepEqual(authorityResult, {
        crashes: localResult.crashes,
        winner: localResult.winner,
      }, diagnostic);
      assert.deepEqual(comparable(simulation.game), comparable(reference), diagnostic);
      recentHeads.push({ ...reference[`${aiRole}Snake`][0] });
      if (recentHeads.length > 192) recentHeads.shift();
      totalTicks += 1;
    }
    completed.push({ room, aiRole, ticks, over: reference.over });
    simulation.stop();
  }
  assert.ok(totalTicks >= 1_200, JSON.stringify(completed));
  process.stdout.write(
    `Authority equivalence: ${totalTicks} identical ticks, ${totalFood} food captures, `
    + `${completed.filter((run) => run.over).length} terminal rounds\n`,
  );
}

function verifyLateInputMonotonicity() {
  const simulation = createSimulation("ABC234");
  simulation.game = {
    round: 9,
    playerSnake: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }],
    opponentSnake: [{ x: 20, y: 20 }, { x: 21, y: 20 }, { x: 22, y: 20 }],
    playerDirection: { x: 1, y: 0 },
    opponentDirection: { x: -1, y: 0 },
    playerInputs: [],
    opponentInputs: [],
    playerInputAck: 0,
    guestInputAck: 0,
    playerScore: 0,
    opponentScore: 0,
    signalCursor: 123,
    food: { x: 15, y: 15 },
    over: false,
  };
  simulation.enqueue(0, {
    round: 9,
    sequence: 5,
    direction: { x: 0, y: -1 },
  });
  simulation.resolveTick();
  assert.equal(simulation.game.playerInputAck, 5);
  assert.deepEqual(simulation.game.playerDirection, { x: 0, y: -1 });

  for (const sequence of [4, 5]) {
    simulation.enqueue(0, {
      round: 9,
      sequence,
      direction: { x: -1, y: 0 },
    });
  }
  assert.equal(simulation.game.playerInputs.length, 0);

  simulation.enqueue(0, {
    round: 9,
    sequence: 6,
    direction: { x: 0, y: 1 },
  });
  simulation.resolveTick();
  assert.equal(simulation.game.playerInputAck, 6);
  assert.deepEqual(simulation.game.playerDirection, { x: 0, y: -1 });
  simulation.enqueue(0, {
    round: 9,
    sequence: 6,
    direction: { x: -1, y: 0 },
  });
  assert.equal(simulation.game.playerInputs.length, 0);

  simulation.enqueue(0, {
    round: 9,
    sequence: 8,
    direction: { x: 1, y: 0 },
  });
  simulation.resolveTick();
  simulation.enqueue(0, {
    round: 9,
    sequence: 7,
    direction: { x: -1, y: 0 },
  });
  assert.equal(simulation.game.playerInputAck, 8);
  assert.equal(simulation.game.playerInputs.length, 0);
}

runConsistencyMatrix();
process.stdout.write("PASS local AI and authoritative live-room simulation remain tick-identical\n");
verifyLateInputMonotonicity();
process.stdout.write("PASS authoritative input acknowledgements reject duplicates, reversals, and late sequences\n");
process.stdout.write("\n2 deterministic authority consistency tests passed.\n");
