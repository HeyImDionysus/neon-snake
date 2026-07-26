"use strict";

const assert = require("node:assert/strict");
const rules = require("./public/game-logic.js");

const tests = [
  ["portal wraps every edge", () => {
    assert.deepEqual(rules.nextHead({ x: 0, y: 5 }, { x: -1, y: 0 }, "portal", 20), { x: 19, y: 5 });
    assert.deepEqual(rules.nextHead({ x: 19, y: 4 }, { x: 1, y: 0 }, "portal", 20), { x: 0, y: 4 });
    assert.equal(rules.gridDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, "portal", 5), 1);
  }],
  ["rapid corner inputs buffer in order without allowing reversals", () => {
    const right = { x: 1, y: 0 };
    const up = { x: 0, y: -1 };
    const left = { x: -1, y: 0 };
    const down = { x: 0, y: 1 };
    let queue = rules.bufferDirection([], right, up);
    queue = rules.bufferDirection(queue, right, left);
    assert.deepEqual(queue, [up, left]);
    assert.deepEqual(rules.bufferDirection(queue, right, down), queue, "the two-turn buffer stays bounded");
    assert.deepEqual(rules.bufferDirection([], right, left), [], "an immediate reversal is rejected");
    assert.equal(rules.isReverseDirection(left, right), true);
    assert.equal(rules.isReverseDirection(up, right), false);
  }],
  ["buffered turns are consumed one per logic step", () => {
    const right = { x: 1, y: 0 };
    const up = { x: 0, y: -1 };
    const left = { x: -1, y: 0 };
    const first = rules.consumeDirectionBuffer([up, left], right);
    assert.deepEqual(first, { direction: up, queue: [left] });
    const second = rules.consumeDirectionBuffer(first.queue, first.direction);
    assert.deepEqual(second, { direction: left, queue: [] });
    assert.deepEqual(rules.consumeDirectionBuffer([], left), { direction: left, queue: [] });
  }],
  ["render motion advances linearly without per-tick braking", () => {
    assert.equal(rules.motionProgress(-10, 100), 0);
    assert.equal(rules.motionProgress(25, 100), .25);
    assert.equal(rules.motionProgress(50, 100), .5);
    assert.equal(rules.motionProgress(125, 100), 1);
  }],
  ["fluid motion keeps corners orthogonal and retracts only the tail", () => {
    const previous = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const current = [{ x: 10, y: 9 }, { x: 10, y: 10 }, { x: 9, y: 10 }];
    assert.deepEqual(rules.fluidMotionPath(previous, current, .5, 20), [
      { x: 10, y: 9.5 },
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8.5, y: 10 },
    ]);
  }],
  ["fluid motion preserves the tail while growing", () => {
    const previous = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const current = [{ x: 11, y: 10 }, { x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    assert.deepEqual(rules.fluidMotionPath(previous, current, .5, 20), [
      { x: 10.5, y: 10 },
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ]);
  }],
  ["fluid motion stays still when no logic step has occurred", () => {
    const snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    assert.deepEqual(rules.fluidMotionPath(snake, snake, .5, 20), snake);
  }],
  ["fluid motion keeps constant velocity at common display refresh rates", () => {
    const previous = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const current = [{ x: 11, y: 10 }, { x: 10, y: 10 }, { x: 9, y: 10 }];
    const duration = 138;

    [60, 120, 144].forEach((refreshRate) => {
      const frameDuration = 1000 / refreshRate;
      const positions = [];
      for (let elapsed = 0; elapsed < duration; elapsed += frameDuration) {
        const progress = rules.motionProgress(elapsed, duration);
        positions.push(rules.fluidMotionPath(previous, current, progress, 20)[0].x);
      }
      const expectedDelta = frameDuration / duration;
      positions.slice(1).forEach((position, index) => {
        const delta = position - positions[index];
        assert.ok(Math.abs(delta - expectedDelta) < 1e-12, `${refreshRate} Hz delta ${delta}`);
      });
    });
  }],
  ["fluid motion never cuts diagonally through a turn", () => {
    const previous = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const current = [{ x: 10, y: 9 }, { x: 10, y: 10 }, { x: 9, y: 10 }];

    for (let frame = 0; frame <= 24; frame += 1) {
      const path = rules.fluidMotionPath(previous, current, frame / 24, 20);
      path.slice(1).forEach((point, index) => {
        const prior = path[index];
        assert.ok(point.x === prior.x || point.y === prior.y);
      });
    }
  }],
  ["fluid motion enters and exits a portal through the board edges", () => {
    const previous = [{ x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17, y: 10 }];
    const current = [{ x: 0, y: 10 }, { x: 19, y: 10 }, { x: 18, y: 10 }];
    assert.deepEqual(rules.fluidMotionPath(previous, current, .25, 20)[0], { x: 19.25, y: 10 });
    const entering = rules.fluidMotionPath(previous, current, .75, 20);
    assert.deepEqual(entering[0], { x: -0.25, y: 10 });
    assert.deepEqual(rules.splitFluidPath(entering, 20), [
      [{ x: -0.25, y: 10 }, { x: -0.5, y: 10 }],
      [{ x: 19.5, y: 10 }, { x: 19, y: 10 }, { x: 18, y: 10 }, { x: 17.75, y: 10 }],
    ]);
  }],
  ["canvas wraps and allows self-crossing", () => {
    const snake = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 }];
    assert.deepEqual(rules.nextHead({ x: 0, y: 5 }, { x: -1, y: 0 }, "canvas", 20), { x: 19, y: 5 });
    assert.equal(rules.collisionType({ x: 0, y: 1 }, snake, true, "canvas", 20), null);
    assert.equal(rules.modeWraps("canvas"), true);
  }],
  ["Canvas composition is deterministic, seed-specific, and never reverses", () => {
    function trace(seed) {
      let state = null;
      let direction = { x: 1, y: 0 };
      const moves = [];
      for (let step = 0; step < 80; step += 1) {
        const result = rules.canvasCompositionMove(state, direction, seed);
        assert.equal(Math.abs(result.direction.x) + Math.abs(result.direction.y), 1);
        assert.ok(
          result.direction.x !== -direction.x || result.direction.y !== -direction.y,
          `reversal at ${step}`,
        );
        moves.push(`${result.direction.x},${result.direction.y}`);
        direction = result.direction;
        state = result.state;
      }
      return moves.join("|");
    }
    assert.equal(trace(42), trace(42));
    assert.notEqual(trace(42), trace(314159));
  }],
  ["classic detects walls", () => {
    assert.equal(rules.collisionType({ x: -1, y: 5 }, [{ x: 0, y: 5 }], false, "classic", 20), "wall");
  }],
  ["departing tail is a legal move", () => {
    const snake = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 }];
    assert.equal(rules.collisionType({ x: 0, y: 1 }, snake, false, "classic", 20), null);
    assert.equal(rules.collisionType({ x: 0, y: 1 }, snake, true, "classic", 20), "self");
  }],
  ["combo scoring is capped and cores are valuable", () => {
    assert.equal(rules.pickupScore("signal", 3), 30);
    assert.equal(rules.pickupScore("signal", 99), 50);
    assert.equal(rules.pickupScore("core", 2), 100);
  }],
  ["pace accelerates but respects its floor", () => {
    const pace = { base: 138, floor: 62, step: 3 };
    assert.equal(rules.tickDelay(pace, 0), 138);
    assert.equal(rules.tickDelay(pace, 10), 108);
    assert.equal(rules.tickDelay(pace, 100), 62);
  }],
  ["ranks and leaderboard ordering are deterministic", () => {
    assert.equal(rules.rankForScore(1600, "classic"), "S");
    assert.equal(rules.rankForScore(700, "rush"), "A");
    const result = rules.sortedTopRuns([{ score: 20 }, { score: 90 }, { score: 40 }], 2);
    assert.deepEqual(result.map((run) => run.score), [90, 40]);
  }],
  ["mutations never override mode boundaries", () => {
    assert.equal(rules.effectiveMode("classic", "phase"), "classic");
    assert.equal(rules.effectiveMode("rush", "phase"), "rush");
    assert.equal(rules.effectiveMode("portal", "phase"), "portal");
    assert.equal(rules.effectiveMode("canvas", "phase"), "canvas");
    assert.equal(rules.effectiveMode("classic", "flow"), "classic");
    assert.equal(rules.mutationScoreMultiplier("amplify"), 2);
    assert.equal(rules.mutationDelay(100, "flow"), 135);
    assert.equal(rules.mutationDelay(100, "amplify"), 100);

    ["classic", "rush"].forEach((mode) => {
      const effectiveMode = rules.effectiveMode(mode, "phase");
      [
        { x: -1, y: 10 },
        { x: 20, y: 10 },
        { x: 10, y: -1 },
        { x: 10, y: 20 },
      ].forEach((head) => {
        assert.equal(rules.collisionType(head, [{ x: 10, y: 10 }], false, effectiveMode, 20), "wall");
      });
    });
  }],
  ["echo replay input is bounded and windowed", () => {
    const dirty = [{ x: 1, y: 1 }, { x: -1, y: 2 }, { x: 3.5, y: 4 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    assert.deepEqual(rules.normalizeReplay(dirty, 20, 2), [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    const path = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }];
    assert.deepEqual(rules.ghostWindow(path, 2, 2), [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
    assert.deepEqual(rules.ghostWindow(path, 99, 3), [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  }],
  ["reachable space counts connected safe cells", () => {
    const snake = [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
    assert.equal(rules.reachableArea({ x: 1, y: 1 }, snake, "classic", 3), 7);
  }],
  ["survival horizon is deterministic and bounded to six turns", () => {
    const snake = [{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    const direction = { x: 1, y: 0 };
    assert.equal(rules.survivalHorizon(snake, direction, null, "classic", 5, 0), 0);
    assert.equal(rules.survivalHorizon(snake, direction, null, "classic", 5, 3), 3);
    assert.equal(rules.survivalHorizon(snake, direction, null, "classic", 5, 99), 6);
    assert.equal(rules.survivalHorizon(snake, direction, null, "classic", 5, 99), 6);
    const forecast = [
      { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 1 },
      { x: 4, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 0 },
    ];
    assert.deepEqual(rules.survivalForecast(snake, direction, null, "classic", 5, 99), forecast);
    assert.deepEqual(rules.survivalForecast(snake, direction, null, "classic", 5, 99), forecast);
  }],
  ["AI forecast follows the signal instead of cardinal-order bias", () => {
    const snake = [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
    const direction = { x: 1, y: 0 };

    assert.deepEqual(
      rules.survivalForecast(snake, direction, { x: 5, y: 3 }, "classic", 7, 6)[0],
      { x: 4, y: 3 },
    );
    assert.deepEqual(
      rules.survivalForecast(snake, direction, { x: 3, y: 5 }, "classic", 7, 6)[0],
      { x: 3, y: 4 },
    );
    assert.deepEqual(
      rules.survivalForecast(snake, direction, null, "classic", 7, 6)[0],
      { x: 4, y: 3 },
    );
    assert.deepEqual(
      rules.survivalForecast(
        [{ x: 0, y: 3 }, { x: 0, y: 4 }, { x: 1, y: 4 }],
        { x: 0, y: -1 },
        { x: 6, y: 3 },
        "portal",
        7,
        6,
      )[0],
      { x: 6, y: 3 },
    );
  }],
  ["AI planner favors survivable space over a trapped pickup", () => {
    const candidates = [
      { name: "up", x: 0, y: -1 },
      { name: "right", x: 1, y: 0 },
      { name: "down", x: 0, y: 1 },
      { name: "left", x: -1, y: 0 },
    ];
    const evaluations = rules.evaluateMoves({
      snake: [
        { x: 2, y: 2 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 3 },
      ],
      direction: { x: 0, y: -1 },
      food: { x: 1, y: 2 },
      mode: "classic",
      gridSize: 5,
      candidates,
    });
    const left = evaluations.find((move) => move.name === "left");
    const right = evaluations.find((move) => move.name === "right");
    assert.equal(evaluations.find((move) => move.name === "down").collision, "reverse");
    assert.ok(left.space < right.space);
    assert.equal(rules.chooseBestMove(evaluations).name, "right");
    assert.deepEqual(rules.evaluateMoves({
      snake: [
        { x: 2, y: 2 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 3 },
      ],
      direction: { x: 0, y: -1 },
      food: { x: 1, y: 2 },
      mode: "classic",
      gridSize: 5,
      candidates,
    }), evaluations);
  }],
  ["AI lookahead rejects the locally tempting route that dies sooner", () => {
    const candidates = [
      { name: "up", x: 0, y: -1 },
      { name: "right", x: 1, y: 0 },
      { name: "down", x: 0, y: 1 },
      { name: "left", x: -1, y: 0 },
    ];
    const evaluations = rules.evaluateMoves({
      snake: [
        { x: 0, y: 4 }, { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 },
        { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 0 },
        { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 },
        { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 },
        { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 4, y: 4 },
      ],
      direction: { x: 0, y: 1 },
      food: { x: 4, y: 1 },
      mode: "classic",
      gridSize: 6,
      candidates,
    });
    const right = evaluations.find((move) => move.name === "right");
    const down = evaluations.find((move) => move.name === "down");
    const rightLocalScore = right.score - right.horizon * 24;
    const downLocalScore = down.score - down.horizon * 24;

    assert.ok(rightLocalScore > downLocalScore);
    assert.equal(right.horizon, 5);
    assert.equal(down.horizon, 6);
    assert.equal(right.forecast.length, 5);
    assert.equal(down.forecast.length, 6);
    assert.deepEqual(down.forecast[0], down.head);
    assert.equal(rules.chooseBestMove(evaluations).name, "down");
    assert.deepEqual(rules.decisionInsight(evaluations), {
      confidence: "CLOSE",
      reason: "1 MORE TURN FORESEEN",
      margin: 12,
      runnerUp: "right",
    });
  }],
  ["AI decision insight explains forced, tied, close, edge, and clear choices", () => {
    const forced = [
      { name: "up", legal: true, score: 100, space: 10, exits: 2, distance: 4, order: 0 },
      { name: "left", legal: false, score: -Infinity, space: 0, exits: 0, distance: null, order: 1 },
    ];
    assert.deepEqual(rules.decisionInsight(forced), {
      confidence: "FORCED", reason: "ONLY SAFE MOVE", margin: null, runnerUp: null,
    });

    const tied = [
      { name: "up", legal: true, score: 100, space: 10, exits: 2, distance: 4, order: 0 },
      { name: "right", legal: true, score: 100, space: 10, exits: 2, distance: 4, order: 1 },
    ];
    assert.deepEqual(rules.decisionInsight(tied), {
      confidence: "TIE", reason: "EQUAL SAFE OPTIONS", margin: 0, runnerUp: "right",
    });

    const close = [
      { name: "up", legal: true, score: 106, space: 10, exits: 2, distance: 2, order: 0 },
      { name: "right", legal: true, score: 100, space: 10, exits: 2, distance: 4, order: 1 },
    ];
    assert.deepEqual(rules.decisionInsight(close), {
      confidence: "CLOSE", reason: "2 STEPS CLOSER", margin: 6, runnerUp: "right",
    });

    const edge = [
      { name: "up", legal: true, score: 126, space: 10, exits: 3, distance: 2, order: 0 },
      { name: "right", legal: true, score: 100, space: 10, exits: 1, distance: 2, order: 1 },
    ];
    assert.deepEqual(rules.decisionInsight(edge), {
      confidence: "EDGE", reason: "2 MORE EXITS", margin: 26, runnerUp: "right",
    });

    const clear = [
      { name: "up", legal: true, score: 200, space: 25, exits: 2, distance: 4, order: 0 },
      { name: "right", legal: true, score: 100, space: 10, exits: 2, distance: 4, order: 1 },
    ];
    assert.deepEqual(rules.decisionInsight(clear), {
      confidence: "CLEAR", reason: "15 MORE SAFE CELLS", margin: 100, runnerUp: "right",
    });
  }],
  ["AI planner candidates obey the selected mode boundary", () => {
    const candidates = [
      { name: "up", x: 0, y: -1 },
      { name: "right", x: 1, y: 0 },
      { name: "down", x: 0, y: 1 },
      { name: "left", x: -1, y: 0 },
    ];
    const setup = {
      snake: [{ x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 }],
      direction: { x: 0, y: -1 },
      food: { x: 19, y: 8 },
      gridSize: 20,
      candidates,
    };
    const classicLeft = rules.evaluateMoves({ ...setup, mode: "classic" }).find((move) => move.name === "left");
    const rushLeft = rules.evaluateMoves({ ...setup, mode: "rush" }).find((move) => move.name === "left");
    const stalePhaseClassicLeft = rules.evaluateMoves({
      ...setup,
      mode: rules.effectiveMode("classic", "phase"),
    }).find((move) => move.name === "left");
    const stalePhaseRushLeft = rules.evaluateMoves({
      ...setup,
      mode: rules.effectiveMode("rush", "phase"),
    }).find((move) => move.name === "left");
    const portalLeft = rules.evaluateMoves({ ...setup, mode: "portal" }).find((move) => move.name === "left");
    [classicLeft, rushLeft, stalePhaseClassicLeft, stalePhaseRushLeft].forEach((move) => {
      assert.equal(move.legal, false);
      assert.equal(move.collision, "wall");
      assert.equal(move.horizon, 0);
    });
    assert.equal(portalLeft.legal, true);
    assert.equal(portalLeft.horizon, 1);
    assert.deepEqual(portalLeft.head, { x: 19, y: 8 });
    assert.deepEqual(portalLeft.forecast, [{ x: 19, y: 8 }]);
    const forecastGroups = rules.splitFluidPath([setup.snake[0], ...portalLeft.forecast], setup.gridSize);
    assert.deepEqual(forecastGroups[0], [{ x: 0, y: 8 }, { x: -.5, y: 8 }]);
    assert.deepEqual(forecastGroups[1].slice(0, 2), [{ x: 19.5, y: 8 }, { x: 19, y: 8 }]);
  }],
  ["signal codes normalize only the public six-character alphabet", () => {
    assert.equal(rules.normalizeSignalCode(" abc234 "), "ABC234");
    assert.equal(rules.normalizeSignalCode("O0I1LZ"), null);
    assert.equal(rules.normalizeSignalCode("ABC23"), null);
    assert.equal(rules.normalizeSignalCode("<script>"), null);
    assert.equal(rules.normalizeSignalCode(null), null);
  }],
  ["signal codes produce deterministic bounded choices", () => {
    const firstState = rules.signalState("ABC234");
    const repeatedState = rules.signalState("ABC234");
    const otherState = rules.signalState("XYZ789");
    assert.equal(firstState, repeatedState);
    assert.notEqual(firstState, otherState);

    const firstSequence = [];
    const repeatedSequence = [];
    let firstCursor = firstState;
    let repeatedCursor = repeatedState;
    for (let index = 0; index < 8; index += 1) {
      const first = rules.nextSignalRandom(firstCursor);
      const repeated = rules.nextSignalRandom(repeatedCursor);
      firstSequence.push(first.value);
      repeatedSequence.push(repeated.value);
      firstCursor = first.state;
      repeatedCursor = repeated.state;
    }

    assert.deepEqual(firstSequence, repeatedSequence);
    assert.ok(firstSequence.every((value) => value >= 0 && value < 1));
    assert.equal(new Set(firstSequence).size, firstSequence.length);
    assert.equal(firstState, 1642794020);

    const choice = rules.signalIndex(rules.signalState("ABC234"), 397);
    assert.equal(choice.index, 2);
    assert.ok(Number.isInteger(choice.index));
    assert.ok(choice.index >= 0 && choice.index < 397);
    assert.throws(() => rules.signalIndex(firstState, 0), /positive integer/);
  }],
  ["duels expand the logical arena without enlarging the canvas", () => {
    assert.equal(rules.duelGridSize(20), 30);
    assert.equal(rules.duelGridSize(30), 45);
    assert.deepEqual(rules.duelSpawns(30), {
      player: {
        snake: [{ x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }],
        direction: { x: 1, y: 0 },
      },
      opponent: {
        snake: [{ x: 22, y: 19 }, { x: 23, y: 19 }, { x: 24, y: 19 }],
        direction: { x: -1, y: 0 },
      },
    });
    const spawns = rules.duelSpawns(30);
    spawns.player.snake.forEach((segment, index) => {
      assert.deepEqual(spawns.opponent.snake[index], {
        x: 29 - segment.x,
        y: 29 - segment.y,
      });
    });
    assert.notEqual(spawns.player.snake[0].y, spawns.opponent.snake[0].y);
  }],
  ["a live room cannot count down until both connected players are ready", () => {
    assert.equal(rules.liveRoomPhase([]), "waiting");
    assert.equal(rules.liveRoomPhase([{ connected: true, ready: true }]), "waiting");
    assert.equal(rules.liveRoomPhase([
      { connected: true, ready: true },
      { connected: false, ready: true },
    ]), "waiting");
    assert.equal(rules.liveRoomPhase([
      { connected: true, ready: true },
      { connected: true, ready: false },
    ]), "ready");
    assert.equal(rules.liveRoomPhase([
      { connected: true, ready: true },
      { connected: true, ready: true },
    ]), "countdown");
  }],
  ["staggered duel spawns do not force an opening collision", () => {
    const spawns = rules.duelSpawns(30);
    let players = {
      player: { ...spawns.player, score: 0 },
      opponent: { ...spawns.opponent, score: 0 },
    };
    for (let tick = 0; tick < 20; tick += 1) {
      const result = rules.resolveDuelTick({
        players,
        food: null,
        mode: "classic",
        gridSize: 30,
      });
      assert.equal(result.over, false, `Opening became forced on tick ${tick + 1}`);
      players = result.players;
    }
  }],
  ["duel movement resolves both snakes on the same tick", () => {
    const result = rules.resolveDuelTick({
      players: {
        player: {
          snake: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
          direction: { x: 1, y: 0 },
          score: 0,
        },
        opponent: {
          snake: [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }],
          direction: { x: -1, y: 0 },
          score: 0,
        },
      },
      food: { x: 5, y: 5 },
      mode: "classic",
      gridSize: 12,
    });

    assert.deepEqual(result.players.player.snake, [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
    ]);
    assert.deepEqual(result.players.opponent.snake, [
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
    ]);
    assert.equal(result.players.player.score, 1);
    assert.equal(result.foodEatenBy, "player");
    assert.equal(result.over, false);
  }],
  ["head-on and head-swap duel collisions produce a draw", () => {
    const headOn = rules.resolveDuelTick({
      players: {
        player: {
          snake: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
          direction: { x: 1, y: 0 },
          score: 0,
        },
        opponent: {
          snake: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
          direction: { x: -1, y: 0 },
          score: 0,
        },
      },
      food: { x: 1, y: 1 },
      mode: "classic",
      gridSize: 12,
    });
    assert.equal(headOn.over, true);
    assert.equal(headOn.winner, null);
    assert.deepEqual(headOn.crashes, { player: "head-on", opponent: "head-on" });

    const headSwap = rules.resolveDuelTick({
      players: {
        player: {
          snake: [{ x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }],
          direction: { x: 1, y: 0 },
          score: 0,
        },
        opponent: {
          snake: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }],
          direction: { x: -1, y: 0 },
          score: 0,
        },
      },
      food: { x: 1, y: 1 },
      mode: "classic",
      gridSize: 12,
    });
    assert.equal(headSwap.over, true);
    assert.equal(headSwap.winner, null);
    assert.deepEqual(headSwap.crashes, { player: "head-swap", opponent: "head-swap" });
  }],
  ["duel collisions distinguish the opponent from walls and self", () => {
    const opponentHit = rules.resolveDuelTick({
      players: {
        player: {
          snake: [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }],
          direction: { x: 1, y: 0 },
          score: 0,
        },
        opponent: {
          snake: [{ x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }],
          direction: { x: 0, y: -1 },
          score: 0,
        },
      },
      food: { x: 9, y: 9 },
      mode: "classic",
      gridSize: 12,
    });
    assert.equal(opponentHit.over, true);
    assert.equal(opponentHit.winner, "opponent");
    assert.equal(opponentHit.crashes.player, "opponent");

    const wallHit = rules.resolveDuelTick({
      players: {
        player: {
          snake: [{ x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }],
          direction: { x: -1, y: 0 },
          score: 0,
        },
        opponent: {
          snake: [{ x: 7, y: 4 }, { x: 8, y: 4 }, { x: 9, y: 4 }],
          direction: { x: 0, y: -1 },
          score: 0,
        },
      },
      food: { x: 5, y: 5 },
      mode: "classic",
      gridSize: 12,
    });
    assert.equal(wallHit.crashes.player, "wall");
    assert.equal(wallHit.winner, "opponent");
  }],
  ["duel AI treats the rival body as occupied space", () => {
    const evaluations = rules.evaluateDuelMoves({
      snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }],
      direction: { x: 0, y: -1 },
      opponentSnake: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
      food: { x: 9, y: 5 },
      mode: "classic",
      gridSize: 12,
      candidates: [
        { name: "up", x: 0, y: -1 },
        { name: "right", x: 1, y: 0 },
        { name: "left", x: -1, y: 0 },
      ],
    });
    const right = evaluations.find((move) => move.name === "right");
    assert.equal(right.legal, false);
    assert.equal(right.collision, "opponent");
    assert.notEqual(rules.chooseBestMove(evaluations)?.name, "right");
  }],
  ["decision comparison measures agreement, retained space, and risk", () => {
    const evaluations = [
      { name: "up", direction: { x: 0, y: -1 }, legal: true, score: 85, space: 17, exits: 2 },
      { name: "right", direction: { x: 1, y: 0 }, legal: true, score: 100, space: 20, exits: 3 },
      { name: "down", direction: { x: 0, y: 1 }, legal: false, score: -Infinity, space: 0, exits: 0 },
      { name: "left", direction: { x: -1, y: 0 }, legal: true, score: 40, space: 5, exits: 1 },
    ];
    assert.deepEqual(rules.compareDecision(evaluations, { x: 1, y: 0 }), {
      matched: true, legal: true, spaceRatio: 1, risk: false, scoreDelta: 0,
    });
    assert.deepEqual(rules.compareDecision(evaluations, { x: 0, y: -1 }), {
      matched: false, legal: true, spaceRatio: .85, risk: false, scoreDelta: 15,
    });
    assert.equal(rules.compareDecision(evaluations, { x: -1, y: 0 }).risk, true);
    assert.deepEqual(rules.compareDecision(evaluations, { x: 0, y: 1 }), {
      matched: false, legal: false, spaceRatio: 0, risk: true, scoreDelta: null,
    });
  }],
  ["decision DNA translates aggregates into plain-language styles", () => {
    assert.deepEqual(rules.decisionProfile({ decisions: 0 }), {
      alignment: 0,
      spaceKept: 0,
      riskTurns: 0,
      style: "UNREAD",
      summary: "Complete a run to reveal your decision pattern.",
    });
    assert.equal(rules.decisionProfile({ decisions: 10, matches: 8, spaceRatioTotal: 9, riskTurns: 1 }).style, "TACTICIAN");
    assert.equal(rules.decisionProfile({ decisions: 10, matches: 2, spaceRatioTotal: 7, riskTurns: 4 }).style, "DAREDEVIL");
    assert.equal(rules.decisionProfile({ decisions: 10, matches: 2, spaceRatioTotal: 9, riskTurns: 1 }).style, "EXPLORER");
    assert.equal(rules.decisionProfile({ decisions: 10, matches: 4, spaceRatioTotal: 7, riskTurns: 1 }).style, "HYBRID");
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic rule tests passed.\n`);
