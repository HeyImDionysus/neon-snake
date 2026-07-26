(function exposeSnakeRules(root) {
  "use strict";

  function wrapCoordinate(value, size) {
    return (value + size) % size;
  }

  function motionProgress(elapsed, duration) {
    if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return 1;
    return Math.min(1, Math.max(0, elapsed / duration));
  }

  function fluidStepPoint(from, to, progress, gridSize) {
    const point = { x: from.x, y: from.y };
    ["x", "y"].forEach((axis) => {
      const delta = to[axis] - from[axis];
      if (Number.isInteger(gridSize) && gridSize > 1 && Math.abs(delta) > 1) {
        const direction = delta > 0 ? -1 : 1;
        point[axis] = progress < .5
          ? from[axis] + direction * progress
          : to[axis] - direction * (1 - progress);
      } else {
        point[axis] = from[axis] + delta * progress;
      }
    });
    return point;
  }

  function fluidMotionPath(previousSnake, currentSnake, progress, gridSize = 20) {
    if (!Array.isArray(currentSnake) || !currentSnake.length) return [];
    if (!Array.isArray(previousSnake) || !previousSnake.length) {
      return currentSnake.map((point) => ({ x: point.x, y: point.y }));
    }

    const amount = motionProgress(progress, 1);
    const previousHead = previousSnake[0];
    const currentHead = currentSnake[0];
    const moved = previousHead.x !== currentHead.x || previousHead.y !== currentHead.y;
    if (!moved) return currentSnake.map((point) => ({ x: point.x, y: point.y }));

    const path = [
      fluidStepPoint(previousHead, currentHead, amount, gridSize),
      ...previousSnake.map((point) => ({ x: point.x, y: point.y })),
    ];

    const growing = currentSnake.length > previousSnake.length;
    if (!growing && previousSnake.length > 1) {
      path[path.length - 1] = fluidStepPoint(
        previousSnake.at(-1),
        previousSnake.at(-2),
        amount,
        gridSize,
      );
    }
    return path;
  }

  function splitFluidPath(points, gridSize = 20, jump = 1.5) {
    if (!Array.isArray(points) || !points.length) return [];
    const groups = [];
    points.forEach((source) => {
      const point = { x: source.x, y: source.y };
      const current = groups.at(-1);
      const previous = current?.at(-1);
      if (!current) {
        groups.push([point]);
        return;
      }

      const wrapsX = Math.abs(point.x - previous.x) > jump;
      const wrapsY = Math.abs(point.y - previous.y) > jump;
      if (!wrapsX && !wrapsY) {
        current.push(point);
        return;
      }

      if (wrapsX) {
        const previousEdge = previous.x < point.x ? -.5 : gridSize - .5;
        const nextEdge = previous.x < point.x ? gridSize - .5 : -.5;
        current.push({ x: previousEdge, y: previous.y });
        groups.push([{ x: nextEdge, y: point.y }, point]);
      } else {
        const previousEdge = previous.y < point.y ? -.5 : gridSize - .5;
        const nextEdge = previous.y < point.y ? gridSize - .5 : -.5;
        current.push({ x: previous.x, y: previousEdge });
        groups.push([{ x: point.x, y: nextEdge }, point]);
      }
    });
    return groups;
  }

  const SIGNAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

  function normalizeSignalCode(value, length = 6) {
    if (typeof value !== "string" || !Number.isInteger(length) || length <= 0) return null;
    const code = value.trim().toUpperCase();
    if (code.length !== length) return null;
    return [...code].every((character) => SIGNAL_ALPHABET.includes(character)) ? code : null;
  }

  function signalState(code) {
    const normalized = normalizeSignalCode(code);
    if (!normalized) return 0;
    let hash = 2166136261;
    for (const character of normalized) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function nextSignalRandom(state) {
    const nextState = ((Number(state) >>> 0) + 0x6D2B79F5) >>> 0;
    let mixed = nextState;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    const value = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    return { state: nextState, value };
  }

  function signalIndex(state, length) {
    if (!Number.isInteger(length) || length <= 0) {
      throw new RangeError("Signal choice length must be a positive integer.");
    }
    const next = nextSignalRandom(state);
    return { state: next.state, index: Math.floor(next.value * length) };
  }

  function modeWraps(mode) {
    return mode === "portal" || mode === "canvas";
  }

  function nextHead(head, direction, mode, gridSize) {
    const next = { x: head.x + direction.x, y: head.y + direction.y };
    if (modeWraps(mode)) {
      next.x = wrapCoordinate(next.x, gridSize);
      next.y = wrapCoordinate(next.y, gridSize);
    }
    return next;
  }

  function collisionType(head, snake, growing, mode, gridSize) {
    const outside = head.x < 0 || head.x >= gridSize || head.y < 0 || head.y >= gridSize;
    if (!modeWraps(mode) && outside) return "wall";
    if (mode === "canvas") return null;
    const collisionBody = growing ? snake : snake.slice(0, -1);
    return collisionBody.some((segment) => segment.x === head.x && segment.y === head.y) ? "self" : null;
  }

  function samePoint(first, second) {
    return Boolean(first && second && first.x === second.x && first.y === second.y);
  }

  function duelGridSize(baseGridSize = 20) {
    const size = Number(baseGridSize);
    return Number.isFinite(size) && size > 0 ? Math.max(12, Math.round(size * 1.5)) : 30;
  }

  function duelSpawns(gridSize = 30) {
    const size = Math.max(12, Math.floor(Number(gridSize) || 30));
    const playerY = Math.floor(size / 3);
    const opponentY = size - playerY - 1;
    const inset = Math.max(3, Math.floor(size / 4));
    const opponentX = size - inset - 1;
    return {
      player: {
        snake: [
          { x: inset, y: playerY },
          { x: inset - 1, y: playerY },
          { x: inset - 2, y: playerY },
        ],
        direction: { x: 1, y: 0 },
      },
      opponent: {
        snake: [
          { x: opponentX, y: opponentY },
          { x: opponentX + 1, y: opponentY },
          { x: opponentX + 2, y: opponentY },
        ],
        direction: { x: -1, y: 0 },
      },
    };
  }

  function liveRoomPhase(participants) {
    const connected = Array.isArray(participants)
      ? participants.filter((participant) => participant?.connected)
      : [];
    if (connected.length !== 2) return "waiting";
    return connected.every((participant) => participant.ready) ? "countdown" : "ready";
  }

  function duelCollisionType(
    head,
    ownSnake,
    opponentSnake,
    growing,
    opponentGrowing,
    mode,
    gridSize,
  ) {
    const ownCollision = collisionType(head, ownSnake, growing, mode, gridSize);
    if (ownCollision) return ownCollision;
    if (mode === "canvas") return null;
    const opponentBody = opponentGrowing ? opponentSnake : opponentSnake.slice(0, -1);
    return opponentBody.some((segment) => samePoint(segment, head)) ? "opponent" : null;
  }

  function resolveDuelTick({ players, food, mode = "classic", gridSize = 30 }) {
    const player = players?.player;
    const opponent = players?.opponent;
    if (!player?.snake?.length || !opponent?.snake?.length) {
      throw new TypeError("A duel tick requires two snakes.");
    }

    const nextHeads = {
      player: nextHead(player.snake[0], player.direction, mode, gridSize),
      opponent: nextHead(opponent.snake[0], opponent.direction, mode, gridSize),
    };
    const growing = {
      player: samePoint(nextHeads.player, food),
      opponent: samePoint(nextHeads.opponent, food),
    };
    const crashes = { player: null, opponent: null };

    if (samePoint(nextHeads.player, nextHeads.opponent)) {
      crashes.player = "head-on";
      crashes.opponent = "head-on";
    } else if (
      samePoint(nextHeads.player, opponent.snake[0])
      && samePoint(nextHeads.opponent, player.snake[0])
    ) {
      crashes.player = "head-swap";
      crashes.opponent = "head-swap";
    } else {
      crashes.player = duelCollisionType(
        nextHeads.player,
        player.snake,
        opponent.snake,
        growing.player,
        growing.opponent,
        mode,
        gridSize,
      );
      crashes.opponent = duelCollisionType(
        nextHeads.opponent,
        opponent.snake,
        player.snake,
        growing.opponent,
        growing.player,
        mode,
        gridSize,
      );
    }

    const movedPlayers = {};
    ["player", "opponent"].forEach((id) => {
      const source = players[id];
      if (crashes[id]) {
        movedPlayers[id] = {
          ...source,
          snake: source.snake.map((segment) => ({ ...segment })),
          direction: { ...source.direction },
        };
        return;
      }
      const nextSnake = [
        { ...nextHeads[id] },
        ...source.snake.map((segment) => ({ ...segment })),
      ];
      if (!growing[id]) nextSnake.pop();
      movedPlayers[id] = {
        ...source,
        snake: nextSnake,
        direction: { ...source.direction },
        score: Math.max(0, Number(source.score) || 0) + (growing[id] ? 1 : 0),
      };
    });

    const crashedIds = Object.keys(crashes).filter((id) => crashes[id]);
    const over = crashedIds.length > 0;
    const winner = crashedIds.length === 1
      ? (crashedIds[0] === "player" ? "opponent" : "player")
      : null;
    const foodEatenBy = !over || crashedIds.length === 1
      ? (growing.player && !crashes.player
        ? "player"
        : growing.opponent && !crashes.opponent
          ? "opponent"
          : null)
      : null;

    return {
      players: movedPlayers,
      crashes,
      over,
      winner,
      foodEatenBy,
    };
  }

  function pickupScore(kind, combo) {
    const base = kind === "core" ? 50 : 10;
    return base * Math.max(1, Math.min(5, combo));
  }

  function effectiveMode(mode) {
    return mode;
  }

  function mutationScoreMultiplier(mutation) {
    return mutation === "amplify" ? 2 : 1;
  }

  function mutationDelay(delay, mutation) {
    return mutation === "flow" ? Math.round(delay * 1.35) : delay;
  }

  function tickDelay(pace, foodCount) {
    return Math.max(pace.floor, pace.base - foodCount * pace.step);
  }

  function rankForScore(score, mode) {
    const thresholds = mode === "rush"
      ? [1200, 700, 350, 120]
      : [1600, 900, 450, 150];
    if (score >= thresholds[0]) return "S";
    if (score >= thresholds[1]) return "A";
    if (score >= thresholds[2]) return "B";
    if (score >= thresholds[3]) return "C";
    return "D";
  }

  function sortedTopRuns(runs, limit = 5) {
    return [...runs]
      .filter((run) => Number.isFinite(run.score) && run.score >= 0)
      .sort((a, b) => b.score - a.score || String(b.at).localeCompare(String(a.at)))
      .slice(0, limit);
  }

  function normalizeReplay(path, gridSize = 20, limit = 2000) {
    if (!Array.isArray(path)) return [];
    return path
      .filter((point) =>
        Number.isInteger(point?.x) &&
        Number.isInteger(point?.y) &&
        point.x >= 0 &&
        point.x < gridSize &&
        point.y >= 0 &&
        point.y < gridSize)
      .slice(0, limit)
      .map((point) => ({ x: point.x, y: point.y }));
  }

  function ghostWindow(path, step, length) {
    if (!Array.isArray(path) || !path.length || step < 0 || length <= 0) return [];
    const end = Math.min(path.length, step + 1);
    return path.slice(Math.max(0, end - length), end);
  }

  const CARDINAL_DIRECTIONS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  const PLANNER_HORIZON = 6;

  function gridDistance(from, to, mode, gridSize) {
    if (!from || !to) return 0;
    let dx = Math.abs(from.x - to.x);
    let dy = Math.abs(from.y - to.y);
    if (modeWraps(mode)) {
      dx = Math.min(dx, gridSize - dx);
      dy = Math.min(dy, gridSize - dy);
    }
    return dx + dy;
  }

  function reachableArea(start, snake, mode, gridSize) {
    if (!start || !Number.isInteger(gridSize) || gridSize <= 0) return 0;
    const body = mode === "canvas" ? [] : (Array.isArray(snake) ? snake.slice(1) : []);
    const blocked = new Set(body.map((segment) => `${segment.x},${segment.y}`));
    const startKey = `${start.x},${start.y}`;
    const seen = new Set([startKey]);
    const queue = [{ x: start.x, y: start.y }];

    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index];
      CARDINAL_DIRECTIONS.forEach((direction) => {
        const next = nextHead(point, direction, mode, gridSize);
        const outside = next.x < 0 || next.x >= gridSize || next.y < 0 || next.y >= gridSize;
        if (outside) return;
        const key = `${next.x},${next.y}`;
        if (blocked.has(key) || seen.has(key)) return;
        seen.add(key);
        queue.push(next);
      });
    }

    return seen.size;
  }

  function survivalForecast(snake, direction, food, mode, gridSize, depth = PLANNER_HORIZON) {
    if (!Array.isArray(snake) || !snake.length || !direction || !Number.isInteger(gridSize) || gridSize <= 0) return [];
    const remaining = Math.max(0, Math.min(PLANNER_HORIZON, Math.floor(Number(depth) || 0)));
    if (!remaining) return [];

    let best = [];
    let bestDistance = Infinity;
    let bestContinuesStraight = false;
    for (const move of CARDINAL_DIRECTIONS) {
      if (move.x === -direction.x && move.y === -direction.y) continue;
      const head = nextHead(snake[0], move, mode, gridSize);
      const growing = Boolean(food && head.x === food.x && head.y === food.y);
      if (collisionType(head, snake, growing, mode, gridSize)) continue;

      const nextSnake = [head, ...snake.map((segment) => ({ x: segment.x, y: segment.y }))];
      if (!growing) nextSnake.pop();
      const path = [head, ...survivalForecast(
        nextSnake,
        move,
        growing ? null : food,
        mode,
        gridSize,
        remaining - 1,
      )];
      const distance = food ? gridDistance(head, food, mode, gridSize) : Infinity;
      const continuesStraight = move.x === direction.x && move.y === direction.y;
      const isBetter = path.length > best.length
        || (path.length === best.length && distance < bestDistance)
        || (path.length === best.length
          && distance === bestDistance
          && continuesStraight
          && !bestContinuesStraight);
      if (isBetter) {
        best = path;
        bestDistance = distance;
        bestContinuesStraight = continuesStraight;
      }
    }
    return best;
  }

  function survivalHorizon(snake, direction, food, mode, gridSize, depth = PLANNER_HORIZON) {
    return survivalForecast(snake, direction, food, mode, gridSize, depth).length;
  }

  function duelReachableArea(start, ownSnake, opponentSnake, mode, gridSize) {
    if (!start || !Number.isInteger(gridSize) || gridSize <= 0) return 0;
    const bodies = mode === "canvas"
      ? []
      : [
        ...(Array.isArray(ownSnake) ? ownSnake.slice(1) : []),
        ...(Array.isArray(opponentSnake) ? opponentSnake : []),
      ];
    const blocked = new Set(bodies.map((segment) => `${segment.x},${segment.y}`));
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [{ x: start.x, y: start.y }];

    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index];
      CARDINAL_DIRECTIONS.forEach((move) => {
        const next = nextHead(point, move, mode, gridSize);
        const outside = next.x < 0 || next.x >= gridSize || next.y < 0 || next.y >= gridSize;
        if (outside) return;
        const key = `${next.x},${next.y}`;
        if (blocked.has(key) || seen.has(key)) return;
        seen.add(key);
        queue.push(next);
      });
    }
    return seen.size;
  }

  function duelSurvivalForecast(
    snake,
    direction,
    opponentSnake,
    food,
    mode,
    gridSize,
    depth = PLANNER_HORIZON,
  ) {
    const remaining = Math.max(0, Math.min(PLANNER_HORIZON, Math.floor(Number(depth) || 0)));
    if (!Array.isArray(snake) || !snake.length || !remaining) return [];

    let best = [];
    let bestDistance = Infinity;
    let bestContinuesStraight = false;
    for (const move of CARDINAL_DIRECTIONS) {
      if (move.x === -direction.x && move.y === -direction.y) continue;
      const head = nextHead(snake[0], move, mode, gridSize);
      const growing = samePoint(head, food);
      const collision = duelCollisionType(
        head,
        snake,
        opponentSnake,
        growing,
        false,
        mode,
        gridSize,
      );
      if (collision) continue;

      const nextSnake = [head, ...snake.map((segment) => ({ ...segment }))];
      if (!growing) nextSnake.pop();
      const path = [head, ...duelSurvivalForecast(
        nextSnake,
        move,
        opponentSnake,
        growing ? null : food,
        mode,
        gridSize,
        remaining - 1,
      )];
      const distance = food ? gridDistance(head, food, mode, gridSize) : Infinity;
      const continuesStraight = move.x === direction.x && move.y === direction.y;
      const isBetter = path.length > best.length
        || (path.length === best.length && distance < bestDistance)
        || (path.length === best.length
          && distance === bestDistance
          && continuesStraight
          && !bestContinuesStraight);
      if (isBetter) {
        best = path;
        bestDistance = distance;
        bestContinuesStraight = continuesStraight;
      }
    }
    return best;
  }

  function evaluateDuelMoves({
    snake,
    direction,
    opponentSnake,
    food,
    mode,
    gridSize,
    candidates,
  }) {
    if (
      !Array.isArray(snake)
      || !snake.length
      || !Array.isArray(opponentSnake)
      || !opponentSnake.length
      || !direction
      || !Array.isArray(candidates)
    ) return [];

    return candidates.map((candidate, order) => {
      const move = { x: Number(candidate.x) || 0, y: Number(candidate.y) || 0 };
      const name = String(candidate.name || order);
      const head = nextHead(snake[0], move, mode, gridSize);
      const reverse = move.x === -direction.x && move.y === -direction.y;
      if (reverse) {
        return {
          name,
          direction: move,
          order,
          legal: false,
          collision: "reverse",
          head,
          space: 0,
          exits: 0,
          horizon: 0,
          forecast: [],
          distance: null,
          score: -Infinity,
        };
      }

      const growing = samePoint(head, food);
      const collision = duelCollisionType(
        head,
        snake,
        opponentSnake,
        growing,
        false,
        mode,
        gridSize,
      );
      if (collision) {
        return {
          name,
          direction: move,
          order,
          legal: false,
          collision,
          head,
          space: 0,
          exits: 0,
          horizon: 0,
          forecast: [],
          distance: null,
          score: -Infinity,
        };
      }

      const nextSnake = [head, ...snake.map((segment) => ({ ...segment }))];
      if (!growing) nextSnake.pop();
      const futureOpponent = opponentSnake.slice(0, -1);
      const space = duelReachableArea(head, nextSnake, futureOpponent, mode, gridSize);
      const distance = gridDistance(head, food, mode, gridSize);
      const exits = CARDINAL_DIRECTIONS.filter((nextDirection) => {
        if (nextDirection.x === -move.x && nextDirection.y === -move.y) return false;
        const futureHead = nextHead(head, nextDirection, mode, gridSize);
        return !duelCollisionType(
          futureHead,
          nextSnake,
          futureOpponent,
          false,
          false,
          mode,
          gridSize,
        );
      }).length;
      const forecast = [head, ...duelSurvivalForecast(
        nextSnake,
        move,
        futureOpponent,
        growing ? null : food,
        mode,
        gridSize,
        PLANNER_HORIZON - 1,
      )];
      const horizon = forecast.length;
      const score = Math.round(
        space * 8
        + exits * 6
        + horizon * 24
        - distance * 3
        + (growing ? 24 : 0),
      );
      return {
        name,
        direction: move,
        order,
        legal: true,
        collision: null,
        head,
        space,
        exits,
        horizon,
        forecast,
        distance,
        score,
      };
    });
  }

  function evaluateMoves({ snake, direction, food, mode, gridSize, candidates }) {
    if (!Array.isArray(snake) || !snake.length || !direction || !Array.isArray(candidates)) return [];
    return candidates.map((candidate, order) => {
      const move = { x: Number(candidate.x) || 0, y: Number(candidate.y) || 0 };
      const name = String(candidate.name || order);
      const head = nextHead(snake[0], move, mode, gridSize);
      const reverse = move.x === -direction.x && move.y === -direction.y;
      if (reverse) {
        return { name, direction: move, order, legal: false, collision: "reverse", head, space: 0, exits: 0, horizon: 0, forecast: [], distance: null, score: -Infinity };
      }

      const growing = Boolean(food && head.x === food.x && head.y === food.y);
      const collision = collisionType(head, snake, growing, mode, gridSize);
      if (collision) {
        return { name, direction: move, order, legal: false, collision, head, space: 0, exits: 0, horizon: 0, forecast: [], distance: null, score: -Infinity };
      }

      const nextSnake = [head, ...snake.map((segment) => ({ x: segment.x, y: segment.y }))];
      if (!growing) nextSnake.pop();
      const space = reachableArea(head, nextSnake, mode, gridSize);
      const distance = gridDistance(head, food, mode, gridSize);
      const exits = CARDINAL_DIRECTIONS.filter((nextDirection) => {
        if (nextDirection.x === -move.x && nextDirection.y === -move.y) return false;
        const futureHead = nextHead(head, nextDirection, mode, gridSize);
        return !collisionType(futureHead, nextSnake, false, mode, gridSize);
      }).length;
      const forecast = [head, ...survivalForecast(
        nextSnake,
        move,
        growing ? null : food,
        mode,
        gridSize,
        PLANNER_HORIZON - 1,
      )];
      const horizon = forecast.length;
      const score = Math.round(space * 8 + exits * 6 + horizon * 24 - distance * 3 + (growing ? 18 : 0));
      return { name, direction: move, order, legal: true, collision: null, head, space, exits, horizon, forecast, distance, score };
    });
  }

  function chooseBestMove(evaluations) {
    if (!Array.isArray(evaluations)) return null;
    return evaluations
      .filter((evaluation) => evaluation?.legal)
      .reduce((best, evaluation) => {
        if (!best || evaluation.score > best.score) return evaluation;
        if (evaluation.score === best.score && evaluation.space > best.space) return evaluation;
        if (evaluation.score === best.score && evaluation.space === best.space && evaluation.distance < best.distance) return evaluation;
        return best;
      }, null);
  }

  function decisionInsight(evaluations, selected = chooseBestMove(evaluations)) {
    if (!selected || !Array.isArray(evaluations)) {
      return { confidence: "NONE", reason: "NO SAFE MOVE", margin: null, runnerUp: null };
    }

    const legal = evaluations
      .filter((evaluation) => evaluation?.legal)
      .sort((a, b) =>
        b.score - a.score ||
        b.space - a.space ||
        a.distance - b.distance ||
        a.order - b.order);
    const runnerUp = legal.find((evaluation) => evaluation.name !== selected.name);

    if (!runnerUp) {
      return { confidence: "FORCED", reason: "ONLY SAFE MOVE", margin: null, runnerUp: null };
    }

    const margin = Math.max(0, selected.score - runnerUp.score);
    const confidence = margin === 0 ? "TIE" : margin >= 80 ? "CLEAR" : margin >= 20 ? "EDGE" : "CLOSE";
    if (margin === 0) {
      return { confidence, reason: "EQUAL SAFE OPTIONS", margin, runnerUp: runnerUp.name };
    }

    const spaceDifference = selected.space - runnerUp.space;
    const exitDifference = selected.exits - runnerUp.exits;
    const horizonDifference = selected.horizon - runnerUp.horizon;
    const distanceDifference = runnerUp.distance - selected.distance;
    const factors = [
      {
        weight: horizonDifference * 24,
        reason: `${horizonDifference} MORE TURN${horizonDifference === 1 ? "" : "S"} FORESEEN`,
      },
      {
        weight: spaceDifference * 8,
        reason: `${spaceDifference} MORE SAFE CELL${spaceDifference === 1 ? "" : "S"}`,
      },
      {
        weight: exitDifference * 6,
        reason: `${exitDifference} MORE EXIT${exitDifference === 1 ? "" : "S"}`,
      },
      {
        weight: distanceDifference * 3,
        reason: `${distanceDifference} STEP${distanceDifference === 1 ? "" : "S"} CLOSER`,
      },
    ].filter((factor) => factor.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    return {
      confidence,
      reason: factors[0]?.reason || `${margin} POINT SURVIVAL EDGE`,
      margin,
      runnerUp: runnerUp.name,
    };
  }

  function compareDecision(evaluations, chosenDirection) {
    if (!chosenDirection) return null;
    const best = chooseBestMove(evaluations);
    const chosen = Array.isArray(evaluations)
      ? evaluations.find((evaluation) =>
        evaluation?.direction?.x === chosenDirection.x &&
        evaluation?.direction?.y === chosenDirection.y)
      : null;
    if (!best || !chosen) return null;
    if (!chosen.legal) {
      return { matched: false, legal: false, spaceRatio: 0, risk: true, scoreDelta: null };
    }
    const spaceRatio = best.space > 0 ? Math.min(1, chosen.space / best.space) : 1;
    return {
      matched: chosen.name === best.name,
      legal: true,
      spaceRatio,
      risk: chosen.exits <= 1 || spaceRatio < .5,
      scoreDelta: Number.isFinite(best.score) && Number.isFinite(chosen.score)
        ? Math.max(0, best.score - chosen.score)
        : null,
    };
  }

  function decisionProfile(stats = {}) {
    const decisions = Math.max(0, Number(stats.decisions) || 0);
    if (!decisions) {
      return {
        alignment: 0,
        spaceKept: 0,
        riskTurns: 0,
        style: "UNREAD",
        summary: "Complete a run to reveal your decision pattern.",
      };
    }

    const matches = Math.max(0, Number(stats.matches) || 0);
    const riskTurns = Math.max(0, Number(stats.riskTurns) || 0);
    const spaceRatioTotal = Math.max(0, Number(stats.spaceRatioTotal) || 0);
    const alignment = Math.min(100, Math.round((matches / decisions) * 100));
    const spaceKept = Math.min(100, Math.round((spaceRatioTotal / decisions) * 100));
    const riskRate = (riskTurns / decisions) * 100;

    if (alignment >= 70) {
      return { alignment, spaceKept, riskTurns, style: "TACTICIAN", summary: "You repeatedly found the planner's safest line." };
    }
    if (riskRate >= 25) {
      return { alignment, spaceKept, riskTurns, style: "DAREDEVIL", summary: "You traded safe space for sharper, riskier lines." };
    }
    if (spaceKept >= 85) {
      return { alignment, spaceKept, riskTurns, style: "EXPLORER", summary: "You found alternate routes while preserving room to move." };
    }
    return { alignment, spaceKept, riskTurns, style: "HYBRID", summary: "You balanced survival logic with independent choices." };
  }

  const api = {
    chooseBestMove,
    collisionType,
    compareDecision,
    decisionInsight,
    decisionProfile,
    duelGridSize,
    duelSpawns,
    effectiveMode,
    evaluateDuelMoves,
    evaluateMoves,
    fluidMotionPath,
    gridDistance,
    mutationDelay,
    mutationScoreMultiplier,
    motionProgress,
    ghostWindow,
    modeWraps,
    normalizeReplay,
    nextHead,
    pickupScore,
    rankForScore,
    reachableArea,
    survivalHorizon,
    normalizeSignalCode,
    nextSignalRandom,
    signalIndex,
    signalState,
    sortedTopRuns,
    splitFluidPath,
    survivalForecast,
    tickDelay,
    liveRoomPhase,
    resolveDuelTick,
    wrapCoordinate,
  };

  root.SnakeRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
