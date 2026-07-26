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

  function canvasCompositionMove(state, currentDirection, seed = 0) {
    const currentIndex = CARDINAL_DIRECTIONS.findIndex((move) =>
      move.x === currentDirection?.x && move.y === currentDirection?.y);
    const source = state && typeof state === "object" ? state : {};
    let directionIndex = Number.isInteger(source.directionIndex)
      ? ((source.directionIndex % 4) + 4) % 4
      : Math.max(0, currentIndex);
    let turnSign = source.turnSign === -1 || source.turnSign === 1
      ? source.turnSign
      : (Number(seed) >>> 0) % 2 ? -1 : 1;
    let legLength = Math.max(
      2,
      Math.min(9, Math.floor(Number(source.legLength) || (2 + ((Number(seed) >>> 3) % 3)))),
    );
    let legProgress = Math.max(0, Math.floor(Number(source.legProgress) || 0));
    let pairedLegs = Math.max(0, Math.floor(Number(source.pairedLegs) || 0)) % 2;
    let turns = Math.max(0, Math.floor(Number(source.turns) || 0));
    const maxLeg = 6 + ((Number(seed) >>> 6) % 4);

    if (legProgress >= legLength) {
      directionIndex = (directionIndex + turnSign + 4) % 4;
      legProgress = 0;
      pairedLegs += 1;
      turns += 1;
      if (pairedLegs >= 2) {
        pairedLegs = 0;
        legLength = legLength >= maxLeg
          ? 2 + ((Number(seed) >>> 3) % 3)
          : legLength + 1;
      }
      if (turns % 10 === 0) turnSign *= -1;
    }

    return {
      direction: { ...CARDINAL_DIRECTIONS[directionIndex] },
      name: turnSign > 0 ? "ORBIT WEAVE" : "MIRROR WEAVE",
      state: {
        directionIndex,
        turnSign,
        legLength,
        legProgress: legProgress + 1,
        pairedLegs,
        turns,
      },
    };
  }

  function modeWraps(mode) {
    return mode === "portal" || mode === "canvas";
  }

  function isCardinalDirection(direction) {
    return Number.isInteger(direction?.x)
      && Number.isInteger(direction?.y)
      && Math.abs(direction.x) + Math.abs(direction.y) === 1;
  }

  function sameDirection(first, second) {
    return first?.x === second?.x && first?.y === second?.y;
  }

  function isReverseDirection(nextDirection, currentDirection) {
    return isCardinalDirection(nextDirection)
      && isCardinalDirection(currentDirection)
      && nextDirection.x === -currentDirection.x
      && nextDirection.y === -currentDirection.y;
  }

  function bufferDirection(queue, currentDirection, nextDirection, limit = 2) {
    const capacity = Math.max(1, Math.min(4, Math.floor(Number(limit) || 2)));
    const pending = (Array.isArray(queue) ? queue : [])
      .filter(isCardinalDirection)
      .slice(0, capacity)
      .map((direction) => ({ x: direction.x, y: direction.y }));
    if (!isCardinalDirection(currentDirection)
      || !isCardinalDirection(nextDirection)
      || pending.length >= capacity) return pending;

    const reference = pending.at(-1) || currentDirection;
    const duplicate = sameDirection(nextDirection, reference);
    const reversing = nextDirection.x === -reference.x && nextDirection.y === -reference.y;
    if (duplicate || reversing) return pending;
    return [...pending, { x: nextDirection.x, y: nextDirection.y }];
  }

  function consumeDirectionBuffer(queue, currentDirection) {
    const current = isCardinalDirection(currentDirection)
      ? { x: currentDirection.x, y: currentDirection.y }
      : { x: 1, y: 0 };
    const pending = (Array.isArray(queue) ? queue : [])
      .filter(isCardinalDirection)
      .map((direction) => ({ x: direction.x, y: direction.y }));

    while (pending.length) {
      const next = pending.shift();
      const duplicate = sameDirection(next, current);
      const reversing = next.x === -current.x && next.y === -current.y;
      if (!duplicate && !reversing) return { direction: next, queue: pending };
    }
    return { direction: current, queue: [] };
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

  function mutationTypeAt(mutation, now) {
    if (!mutation?.type || !Number.isFinite(mutation.expiresAt)) return null;
    return now < mutation.expiresAt ? mutation.type : null;
  }

  const PACE_PROFILES = Object.freeze({
    steady: Object.freeze({ base: 180, floor: 88, step: 3 }),
    arcade: Object.freeze({ base: 138, floor: 62, step: 3 }),
    overdrive: Object.freeze({ base: 98, floor: 44, step: 2 }),
  });
  const SOLO_TIMING = Object.freeze({
    coreDuration: 6500,
    mutationDuration: 8000,
    rushDuration: 60_000,
  });

  function paceProfiles() {
    return Object.fromEntries(
      Object.entries(PACE_PROFILES).map(([name, pace]) => [name, { ...pace }]),
    );
  }

  function soloTiming() {
    return { ...SOLO_TIMING };
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
  const HAMILTONIAN_CACHE = new Map();

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

  function hamiltonianCycle(gridSize = 20) {
    const size = Math.floor(Number(gridSize) || 0);
    if (size < 4 || size % 2 !== 0) return [];
    if (HAMILTONIAN_CACHE.has(size)) return HAMILTONIAN_CACHE.get(size).cycle;

    const cycle = [];
    for (let x = 0; x < size; x += 1) cycle.push({ x, y: 0 });
    for (let y = 1; y < size; y += 1) {
      if (y % 2 === 1) {
        for (let x = size - 1; x >= 1; x -= 1) cycle.push({ x, y });
      } else {
        for (let x = 1; x < size; x += 1) cycle.push({ x, y });
      }
    }
    cycle.push({ x: 0, y: size - 1 });
    for (let y = size - 2; y >= 1; y -= 1) cycle.push({ x: 0, y });
    const frozenCycle = Object.freeze(
      cycle.map((point) => Object.freeze({ ...point })),
    );
    HAMILTONIAN_CACHE.set(size, {
      cycle: frozenCycle,
      indexes: new Map(frozenCycle.map((point, index) => [`${point.x},${point.y}`, index])),
    });
    return frozenCycle;
  }

  function cyclePlannerState(snake, food, mode, gridSize) {
    if (mode !== "classic" || !Array.isArray(snake) || snake.length < 2) return null;
    const cycle = hamiltonianCycle(gridSize);
    if (!cycle.length) return null;

    const indexes = HAMILTONIAN_CACHE.get(Math.floor(Number(gridSize) || 0)).indexes;
    const snakeIndexes = snake.map((point) => indexes.get(`${point.x},${point.y}`));
    if (snakeIndexes.some((index) => !Number.isInteger(index))) return null;
    if (new Set(snakeIndexes).size !== snakeIndexes.length) return null;

    const total = cycle.length;
    const forward = (from, to) => (to - from + total) % total;
    let occupiedSpan = 0;
    for (let index = snakeIndexes.length - 1; index > 0; index -= 1) {
      const distance = forward(snakeIndexes[index], snakeIndexes[index - 1]);
      if (!distance) return null;
      occupiedSpan += distance;
      if (occupiedSpan >= total) return null;
    }

    const headIndex = snakeIndexes[0];
    const tailIndex = snakeIndexes.at(-1);
    const freeDistance = forward(headIndex, tailIndex);
    if (!freeDistance || freeDistance + occupiedSpan !== total) return null;

    const foodIndex = food ? indexes.get(`${food.x},${food.y}`) : null;
    const foodDistance = Number.isInteger(foodIndex) ? forward(headIndex, foodIndex) : null;
    return {
      cycle,
      indexes,
      total,
      headIndex,
      tailIndex,
      freeDistance,
      foodDistance,
      forward,
    };
  }

  function cycleMovePlan(state, head, growing) {
    if (!state) return null;
    const nextIndex = state.indexes.get(`${head.x},${head.y}`);
    if (!Number.isInteger(nextIndex)) return null;
    const advance = state.forward(state.headIndex, nextIndex);
    const followsFreeArc = advance > 0 && (
      advance < state.freeDistance
      || (!growing && state.freeDistance === 1 && advance === 1)
    );
    const reachesTowardFood = followsFreeArc
      && Number.isInteger(state.foodDistance)
      && advance <= state.foodDistance;
    return {
      advance,
      safe: followsFreeArc,
      towardFood: reachesTowardFood,
      remainingToFood: Number.isInteger(state.foodDistance)
        ? Math.max(0, state.foodDistance - advance)
        : null,
    };
  }

  function cycleContinuation(snake, direction, food, mode, gridSize, depth) {
    const forecast = [];
    let virtualSnake = snake.map((segment) => ({ ...segment }));
    let virtualDirection = { ...direction };
    let virtualFood = food ? { ...food } : null;

    for (let step = 0; step < depth; step += 1) {
      const state = cyclePlannerState(virtualSnake, virtualFood, mode, gridSize);
      if (!state) break;
      const options = CARDINAL_DIRECTIONS.map((move, order) => {
        const reverse = move.x === -virtualDirection.x && move.y === -virtualDirection.y;
        const head = nextHead(virtualSnake[0], move, mode, gridSize);
        const growing = samePoint(head, virtualFood);
        const collision = reverse
          ? "reverse"
          : collisionType(head, virtualSnake, growing, mode, gridSize);
        const plan = collision ? null : cycleMovePlan(state, head, growing);
        const distance = virtualFood ? gridDistance(head, virtualFood, mode, gridSize) : Infinity;
        return { move, order, head, growing, collision, plan, distance };
      }).filter((option) => !option.collision && option.plan?.safe);
      if (!options.length) break;

      options.sort((first, second) => {
        if (first.plan.towardFood !== second.plan.towardFood) {
          return first.plan.towardFood ? -1 : 1;
        }
        if (first.plan.towardFood) {
          return first.distance - second.distance
            || second.plan.advance - first.plan.advance
            || first.order - second.order;
        }
        return first.plan.advance - second.plan.advance || first.order - second.order;
      });
      const selected = options[0];
      virtualSnake.unshift({ ...selected.head });
      if (selected.growing) {
        virtualFood = null;
      } else {
        virtualSnake.pop();
      }
      virtualDirection = { ...selected.move };
      forecast.push({ ...selected.head });
    }
    return forecast;
  }

  function shortestGridRoute(
    start,
    target,
    blockedPoints,
    mode,
    gridSize,
    initialDirection = null,
  ) {
    if (!start || !target) return null;
    if (samePoint(start, target)) return [];

    const pointKey = (point) => `${point.x},${point.y}`;
    const targetKey = pointKey(target);
    const blocked = new Set((blockedPoints || []).map(pointKey));
    blocked.delete(targetKey);
    const startKey = pointKey(start);
    const queue = [{ ...start }];
    const parents = new Map([[startKey, null]]);

    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index];
      for (const move of CARDINAL_DIRECTIONS) {
        if (
          index === 0
          && initialDirection
          && move.x === -initialDirection.x
          && move.y === -initialDirection.y
        ) continue;
        const next = nextHead(point, move, mode, gridSize);
        const outside = next.x < 0 || next.x >= gridSize || next.y < 0 || next.y >= gridSize;
        if (outside) continue;
        const key = pointKey(next);
        if (blocked.has(key) || parents.has(key)) continue;
        parents.set(key, { previous: pointKey(point), direction: { ...move }, point: { ...next } });
        if (key === targetKey) {
          const route = [];
          let cursor = key;
          while (cursor !== startKey) {
            const entry = parents.get(cursor);
            route.unshift({ ...entry.point, direction: { ...entry.direction } });
            cursor = entry.previous;
          }
          return route;
        }
        queue.push(next);
      }
    }
    return null;
  }

  function simulateRoute(snake, direction, food, route, mode, gridSize) {
    let virtualSnake = snake.map((segment) => ({ ...segment }));
    let virtualDirection = { ...direction };
    let virtualFood = food ? { ...food } : null;

    for (const step of route) {
      const move = step.direction;
      if (move.x === -virtualDirection.x && move.y === -virtualDirection.y) return null;
      const head = nextHead(virtualSnake[0], move, mode, gridSize);
      if (!samePoint(head, step)) return null;
      const growing = samePoint(head, virtualFood);
      if (collisionType(head, virtualSnake, growing, mode, gridSize)) return null;
      virtualSnake.unshift(head);
      if (growing) {
        virtualFood = null;
      } else {
        virtualSnake.pop();
      }
      virtualDirection = { ...move };
    }
    return { snake: virtualSnake, direction: virtualDirection, food: virtualFood };
  }

  function routePreservesEscape(result, mode, gridSize) {
    if (!result || result.food) return false;
    if (mode === "canvas") return true;
    const tail = result.snake.at(-1);
    const escape = shortestGridRoute(
      result.snake[0],
      tail,
      result.snake.slice(1, -1),
      mode,
      gridSize,
      result.direction,
    );
    if (!escape?.length) return false;
    const escapeSpace = reachableArea(result.snake[0], result.snake, mode, gridSize);
    const remainsCycleOrdered = Boolean(
      cyclePlannerState(result.snake, null, mode, gridSize),
    );
    return escapeSpace >= result.snake.length || remainsCycleOrdered;
  }

  function dynamicSafeFoodRoute(
    snake,
    direction,
    food,
    mode,
    gridSize,
    { beamWidth = 16, maxDepth = Math.min(48, gridSize * 3) } = {},
  ) {
    let frontier = [{
      snake: snake.map((segment) => ({ ...segment })),
      direction: { ...direction },
      path: [],
      rank: gridDistance(snake[0], food, mode, gridSize) * 100,
    }];
    const seen = new Set();

    for (let depth = 0; depth < maxDepth; depth += 1) {
      const nextFrontier = [];
      for (const state of frontier) {
        for (const move of CARDINAL_DIRECTIONS) {
          if (move.x === -state.direction.x && move.y === -state.direction.y) continue;
          const head = nextHead(state.snake[0], move, mode, gridSize);
          const growing = samePoint(head, food);
          if (collisionType(head, state.snake, growing, mode, gridSize)) continue;

          const nextSnake = [head, ...state.snake.map((segment) => ({ ...segment }))];
          if (!growing) nextSnake.pop();
          const path = [...state.path, { ...head, direction: { ...move } }];
          if (growing) {
            const result = { snake: nextSnake, direction: { ...move }, food: null };
            if (routePreservesEscape(result, mode, gridSize)) return path;
            continue;
          }

          const stateKey = `${move.x},${move.y}|${nextSnake
            .map((segment) => `${segment.x},${segment.y}`)
            .join(";")}`;
          if (seen.has(stateKey)) continue;
          seen.add(stateKey);
          const exits = CARDINAL_DIRECTIONS.filter((nextMove) => {
            if (nextMove.x === -move.x && nextMove.y === -move.y) return false;
            const nextHeadPoint = nextHead(head, nextMove, mode, gridSize);
            return !collisionType(nextHeadPoint, nextSnake, false, mode, gridSize);
          }).length;
          const turnCost = move.x === state.direction.x && move.y === state.direction.y ? 0 : 1;
          nextFrontier.push({
            snake: nextSnake,
            direction: { ...move },
            path,
            rank: gridDistance(head, food, mode, gridSize) * 100
              + path.length * 3
              + turnCost
              - exits * 8,
          });
        }
      }
      if (!nextFrontier.length) return null;
      nextFrontier.sort((first, second) => first.rank - second.rank);
      frontier = nextFrontier.slice(0, beamWidth);
    }
    return null;
  }

  function safeFoodRoute(snake, direction, food, mode, gridSize) {
    if (!food) return null;
    const blocked = mode === "canvas" ? [] : snake.slice(1, -1);
    const route = shortestGridRoute(
      snake[0],
      food,
      blocked,
      mode,
      gridSize,
      direction,
    );
    if (route?.length) {
      const result = simulateRoute(snake, direction, food, route, mode, gridSize);
      if (routePreservesEscape(result, mode, gridSize)) return route;
    }
    return dynamicSafeFoodRoute(snake, direction, food, mode, gridSize);
  }

  function tailChaseRoute(snake, direction, mode, gridSize) {
    if (mode === "canvas" || snake.length < 2) return null;
    const route = shortestGridRoute(
      snake[0],
      snake.at(-1),
      snake.slice(1, -1),
      mode,
      gridSize,
      direction,
    );
    return route?.length ? route : null;
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
    const cellCount = gridSize * gridSize;
    const blocked = new Uint8Array(cellCount);
    const seen = new Uint8Array(cellCount);
    const queue = new Int32Array(cellCount);
    bodies.forEach((segment) => {
      if (
        segment.x >= 0
        && segment.x < gridSize
        && segment.y >= 0
        && segment.y < gridSize
      ) blocked[segment.y * gridSize + segment.x] = 1;
    });

    const startIndex = start.y * gridSize + start.x;
    blocked[startIndex] = 0;
    seen[startIndex] = 1;
    queue[0] = startIndex;
    let cursor = 0;
    let end = 1;
    while (cursor < end) {
      const index = queue[cursor];
      cursor += 1;
      const x = index % gridSize;
      const y = Math.floor(index / gridSize);
      for (const move of CARDINAL_DIRECTIONS) {
        let nextX = x + move.x;
        let nextY = y + move.y;
        if (modeWraps(mode)) {
          nextX = wrapCoordinate(nextX, gridSize);
          nextY = wrapCoordinate(nextY, gridSize);
        }
        if (nextX < 0 || nextX >= gridSize || nextY < 0 || nextY >= gridSize) continue;
        const nextIndex = nextY * gridSize + nextX;
        if (blocked[nextIndex] || seen[nextIndex]) continue;
        seen[nextIndex] = 1;
        queue[end] = nextIndex;
        end += 1;
      }
    }
    return end;
  }

  function duelTerritoryBalance(snake, opponentSnake, mode, gridSize) {
    const cellCount = gridSize * gridSize;
    const blocked = new Uint8Array(cellCount);
    if (mode !== "canvas") {
      [...snake.slice(1), ...opponentSnake.slice(1)].forEach((segment) => {
        if (
          segment.x >= 0
          && segment.x < gridSize
          && segment.y >= 0
          && segment.y < gridSize
        ) blocked[segment.y * gridSize + segment.x] = 1;
      });
    }

    function distancesFrom(start) {
      const distances = new Int16Array(cellCount);
      distances.fill(-1);
      const queue = new Int32Array(cellCount);
      const startIndex = start.y * gridSize + start.x;
      distances[startIndex] = 0;
      queue[0] = startIndex;
      let cursor = 0;
      let end = 1;
      while (cursor < end) {
        const index = queue[cursor];
        cursor += 1;
        const x = index % gridSize;
        const y = Math.floor(index / gridSize);
        const distance = distances[index] + 1;
        for (const move of CARDINAL_DIRECTIONS) {
          let nextX = x + move.x;
          let nextY = y + move.y;
          if (modeWraps(mode)) {
            nextX = wrapCoordinate(nextX, gridSize);
            nextY = wrapCoordinate(nextY, gridSize);
          }
          if (nextX < 0 || nextX >= gridSize || nextY < 0 || nextY >= gridSize) continue;
          const nextIndex = nextY * gridSize + nextX;
          if (blocked[nextIndex] || distances[nextIndex] !== -1) continue;
          distances[nextIndex] = distance;
          queue[end] = nextIndex;
          end += 1;
        }
      }
      return distances;
    }

    const ownDistances = distancesFrom(snake[0]);
    const rivalDistances = distancesFrom(opponentSnake[0]);
    let own = 0;
    let rival = 0;
    let contested = 0;
    for (let index = 0; index < cellCount; index += 1) {
      if (blocked[index]) continue;
      const ownDistance = ownDistances[index];
      const rivalDistance = rivalDistances[index];
      if (ownDistance < 0 && rivalDistance < 0) continue;
      if (rivalDistance < 0 || (ownDistance >= 0 && ownDistance < rivalDistance)) {
        own += 1;
      } else if (ownDistance < 0 || rivalDistance < ownDistance) {
        rival += 1;
      } else {
        contested += 1;
      }
    }
    return { own, rival, contested };
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

  function legalDuelDirections(direction) {
    return CARDINAL_DIRECTIONS.filter((move) =>
      move.x !== -direction.x || move.y !== -direction.y);
  }

  function duelSearchHeuristic({
    snake,
    direction,
    opponentSnake,
    opponentDirection,
    food,
    mode,
    gridSize,
    score = 0,
    opponentScore = 0,
  }) {
    const territory = duelTerritoryBalance(snake, opponentSnake, mode, gridSize);
    const ownExits = legalDuelDirections(direction).filter((move) => {
      const head = nextHead(snake[0], move, mode, gridSize);
      return !duelCollisionType(head, snake, opponentSnake, samePoint(head, food), false, mode, gridSize);
    }).length;
    const rivalExits = legalDuelDirections(opponentDirection).filter((move) => {
      const head = nextHead(opponentSnake[0], move, mode, gridSize);
      return !duelCollisionType(head, opponentSnake, snake, samePoint(head, food), false, mode, gridSize);
    }).length;
    const ownDistance = food ? gridDistance(snake[0], food, mode, gridSize) : 0;
    const rivalDistance = food ? gridDistance(opponentSnake[0], food, mode, gridSize) : 0;
    const scoreDeficit = Math.max(-4, Math.min(4, opponentScore - score));
    const foodPressure = 80 + scoreDeficit * 10;
    return (
      (territory.own - territory.rival) * 2
      + (ownExits - rivalExits) * 120
      + (rivalDistance - ownDistance) * foodPressure
      + (score - opponentScore) * 1_200
      + (snake.length - opponentSnake.length) * 90
    );
  }

  function duelTerminalValue(result, depth) {
    if (!result.over) return null;
    if (result.winner === "player") return 1_000_000 + depth * 10_000;
    if (result.winner === "opponent") return -1_000_000 - depth * 10_000;
    return -15_000;
  }

  function duelSearchKey(state, depth) {
    const snakeKey = state.snake.map((point) => `${point.x},${point.y}`).join(";");
    const opponentKey = state.opponentSnake.map((point) => `${point.x},${point.y}`).join(";");
    const foodKey = state.food ? `${state.food.x},${state.food.y}` : "-";
    return `${depth}|${state.score || 0},${state.opponentScore || 0}|${state.direction.x},${state.direction.y}|${state.opponentDirection.x},${state.opponentDirection.y}|${foodKey}|${snakeKey}|${opponentKey}`;
  }

  function duelSearchValue(state, depth, cache, stats, alpha = -Infinity) {
    if (depth <= 0) return duelSearchHeuristic(state);
    const key = duelSearchKey(state, depth);
    if (cache.has(key)) {
      stats.cacheHits += 1;
      return cache.get(key);
    }

    let best = -Infinity;
    let fullyEvaluated = true;
    for (const move of legalDuelDirections(state.direction)) {
      let worstReply = Infinity;
      for (const reply of legalDuelDirections(state.opponentDirection)) {
        const result = resolveDuelTick({
          players: {
            player: { snake: state.snake, direction: move, score: state.score || 0 },
            opponent: {
              snake: state.opponentSnake,
              direction: reply,
              score: state.opponentScore || 0,
            },
          },
          food: state.food,
          mode: state.mode,
          gridSize: state.gridSize,
        });
        stats.nodes += 1;
        const terminal = duelTerminalValue(result, depth);
        const value = terminal ?? duelSearchValue({
          snake: result.players.player.snake,
          direction: result.players.player.direction,
          opponentSnake: result.players.opponent.snake,
          opponentDirection: result.players.opponent.direction,
          food: result.foodEatenBy ? null : state.food,
          mode: state.mode,
          gridSize: state.gridSize,
          score: result.players.player.score,
          opponentScore: result.players.opponent.score,
        }, depth - 1, cache, stats, alpha);
        worstReply = Math.min(worstReply, value);
        if (worstReply <= alpha) {
          fullyEvaluated = false;
          break;
        }
      }
      best = Math.max(best, worstReply);
      alpha = Math.max(alpha, best);
    }
    if (fullyEvaluated) cache.set(key, best);
    return best;
  }

  function evaluateDuelContinuation(state, move, depth = 2, context = null) {
    const cache = context?.cache || new Map();
    const stats = context?.stats || { nodes: 0, cacheHits: 0 };
    const startingNodes = stats.nodes;
    const startingCacheHits = stats.cacheHits;
    let worstReply = Infinity;
    for (const reply of legalDuelDirections(state.opponentDirection)) {
      const result = resolveDuelTick({
        players: {
          player: { snake: state.snake, direction: move, score: state.score || 0 },
          opponent: {
            snake: state.opponentSnake,
            direction: reply,
            score: state.opponentScore || 0,
          },
        },
        food: state.food,
        mode: state.mode,
        gridSize: state.gridSize,
      });
      stats.nodes += 1;
      const terminal = duelTerminalValue(result, depth);
      const value = terminal ?? duelSearchValue({
        snake: result.players.player.snake,
        direction: result.players.player.direction,
        opponentSnake: result.players.opponent.snake,
        opponentDirection: result.players.opponent.direction,
        food: result.foodEatenBy ? null : state.food,
        mode: state.mode,
        gridSize: state.gridSize,
        score: result.players.player.score,
        opponentScore: result.players.opponent.score,
      }, depth - 1, cache, stats);
      worstReply = Math.min(worstReply, value);
    }
    return {
      value: worstReply,
      depth,
      nodes: stats.nodes - startingNodes,
      cacheHits: stats.cacheHits - startingCacheHits,
    };
  }

  function evaluateDuelMoves({
    snake,
    direction,
    opponentSnake,
    opponentDirection,
    food,
    mode,
    gridSize,
    candidates,
    seed = 0,
    recentHeads = [],
  }) {
    if (
      !Array.isArray(snake)
      || !snake.length
      || !Array.isArray(opponentSnake)
      || !opponentSnake.length
      || !direction
      || !Array.isArray(candidates)
    ) return [];

    const inferredOpponentDirection = opponentDirection || (
      opponentSnake.length > 1
        ? {
          x: opponentSnake[0].x - opponentSnake[1].x,
          y: opponentSnake[0].y - opponentSnake[1].y,
        }
        : { x: 0, y: 0 }
    );
    const opponentReplies = CARDINAL_DIRECTIONS.filter((reply) =>
      reply.x !== -inferredOpponentDirection.x || reply.y !== -inferredOpponentDirection.y);
    const historyWindow = (Array.isArray(recentHeads) ? recentHeads : []).slice(-160);

    const searchContext = { cache: new Map(), stats: { nodes: 0, cacheHits: 0 } };
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
      const tacticalReplies = opponentReplies.map((reply) => resolveDuelTick({
        players: {
          player: { snake, direction: move, score: 0 },
          opponent: { snake: opponentSnake, direction: reply, score: 0 },
        },
        food,
        mode,
        gridSize,
      }));
      const losingReplies = tacticalReplies.filter((result) =>
        result.over && result.winner === "opponent").length;
      const drawingReplies = tacticalReplies.filter((result) =>
        result.over && result.winner === null).length;
      const winningReplies = tacticalReplies.filter((result) =>
        result.over && result.winner === "player").length;
      const openReplies = tacticalReplies.filter((result) => !result.over).length;
      const forcedWin = winningReplies > 0
        && winningReplies === tacticalReplies.length;
      const tacticalScore = losingReplies
        ? -80_000
        : drawingReplies
          ? -12_000
          : forcedWin ? 40_000 : 0;
      const search = evaluateDuelContinuation({
        snake,
        direction,
        opponentSnake,
        opponentDirection: inferredOpponentDirection,
        food,
        mode,
        gridSize,
      }, move, 2, searchContext);
      const seedBias = (
        Math.imul((Number(seed) >>> 0) ^ ((head.x + 1) * 73856093), 16777619)
        ^ Math.imul((head.y + 1) * 19349663, order + 1)
      ) >>> 30;
      const revisitCount = historyWindow.reduce(
        (count, previous) => count + Number(samePoint(previous, head)),
        0,
      );
      const loopPenalty = revisitCount * (160 + snake.length * 6);
      const score = Math.round(
        space
        + exits * 12
        + horizon * 30
        - distance * 30
        + (growing ? 200 : 0)
        + tacticalScore
        + search.value
        + seedBias
        - loopPenalty,
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
        losingReplies,
        drawingReplies,
        winningReplies,
        openReplies,
        forcedWin,
        searchDepth: search.depth,
        searchNodes: search.nodes,
        searchCacheHits: search.cacheHits,
        searchValue: search.value,
        seedBias,
        revisitCount,
        loopPenalty,
        strategy: losingReplies
          ? "THREATENED"
          : drawingReplies
            ? "CONTESTED"
            : forcedWin
              ? "TACTICAL WIN"
              : "CLEAR ROUTE",
        score,
      };
    });
  }

  function evaluateMoves({
    snake,
    direction,
    food,
    mode,
    gridSize,
    candidates,
    recentHeads = [],
  }) {
    if (!Array.isArray(snake) || !snake.length || !direction || !Array.isArray(candidates)) return [];
    const cycleState = cyclePlannerState(snake, food, mode, gridSize);
    const historyWindow = (Array.isArray(recentHeads) ? recentHeads : []).slice(-192);
    const distinctHistoryCells = new Set(
      historyWindow
        .filter((point) => point && Number.isInteger(point.x) && Number.isInteger(point.y))
        .map((point) => `${point.x},${point.y}`),
    ).size;
    const repeatedSteps = historyWindow.length - distinctHistoryCells;
    const stagnating = !cycleState && historyWindow.length >= 128 && repeatedSteps >= 12;
    let foodRoute = cycleState
      ? null
      : safeFoodRoute(snake, direction, food, mode, gridSize);
    let recoveryRoute = false;
    if (!foodRoute && stagnating) {
      foodRoute = dynamicSafeFoodRoute(snake, direction, food, mode, gridSize, {
        beamWidth: 48,
        maxDepth: Math.min(160, gridSize * 8),
      });
      recoveryRoute = Boolean(foodRoute);
    }
    const tailRoute = foodRoute || cycleState
      ? null
      : tailChaseRoute(snake, direction, mode, gridSize);
    const recentVisits = new Map();
    (Array.isArray(recentHeads) ? recentHeads : []).slice(-256).forEach((point) => {
      if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) return;
      const key = `${point.x},${point.y}`;
      recentVisits.set(key, (recentVisits.get(key) || 0) + 1);
    });
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
      const cyclePlan = cycleMovePlan(cycleState, head, growing);
      const space = cyclePlan?.safe
        ? Math.max(1, gridSize * gridSize - nextSnake.length + 1)
        : reachableArea(head, nextSnake, mode, gridSize);
      const distance = gridDistance(head, food, mode, gridSize);
      const exits = CARDINAL_DIRECTIONS.filter((nextDirection) => {
        if (nextDirection.x === -move.x && nextDirection.y === -move.y) return false;
        const futureHead = nextHead(head, nextDirection, mode, gridSize);
        return !collisionType(futureHead, nextSnake, false, mode, gridSize);
      }).length;
      const followsFoodRoute = Boolean(
        foodRoute?.length
        && move.x === foodRoute[0].direction.x
        && move.y === foodRoute[0].direction.y
      );
      const followsTailRoute = Boolean(
        !growing
        && tailRoute?.length
        && move.x === tailRoute[0].direction.x
        && move.y === tailRoute[0].direction.y
      );
      let forecast;
      if (followsFoodRoute) {
        forecast = foodRoute.slice(0, PLANNER_HORIZON).map(({ x, y }) => ({ x, y }));
      } else if (followsTailRoute) {
        forecast = tailRoute.slice(0, PLANNER_HORIZON).map(({ x, y }) => ({ x, y }));
      } else if (cycleState && cyclePlan?.safe) {
        forecast = [
          head,
          ...cycleContinuation(
            nextSnake,
            move,
            growing ? null : food,
            mode,
            gridSize,
            PLANNER_HORIZON - 1,
          ),
        ];
      } else {
        forecast = [head, ...survivalForecast(
          nextSnake,
          move,
          growing ? null : food,
          mode,
          gridSize,
          PLANNER_HORIZON - 1,
        )];
      }
      const horizon = forecast.length;
      const revisitCount = recentVisits.get(`${head.x},${head.y}`) || 0;
      const loopPenalty = revisitCount * 12;
      const localScore = Math.round(
        space * 8
        + exits * 6
        + horizon * 24
        - distance * 3
        + (growing ? 18 : 0)
        - loopPenalty,
      );
      let score = localScore;
      let strategy = "SURVIVAL SEARCH";
      if (followsFoodRoute) {
        score = 3_000_000 - foodRoute.length * 1_000 + localScore;
        strategy = recoveryRoute ? "LOOP BREAK ROUTE" : "SAFE FOOD ROUTE";
      } else if (followsTailRoute) {
        score = 2_000_000 - tailRoute.length * 100 + localScore;
        strategy = "TAIL CHASE";
      } else if (cyclePlan?.safe) {
        score = 1_000_000
          + (cyclePlan.towardFood ? 500_000 : 0)
          + (cyclePlan.towardFood ? -distance * 10_000 + cyclePlan.advance : -cyclePlan.advance)
          + localScore;
        strategy = cyclePlan.towardFood ? "SAFE SHORTCUT" : "CYCLE GUARD";
      } else if (cycleState) {
        score = localScore - 1_000_000;
        strategy = "BREAKS SAFE CYCLE";
      }
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
        cycleAdvance: cyclePlan?.advance ?? null,
        cycleSafe: cyclePlan?.safe ?? null,
        cycleFoodDistance: cyclePlan?.remainingToFood ?? null,
        revisitCount,
        loopPenalty,
        routeDistance: followsFoodRoute
          ? foodRoute.length
          : followsTailRoute ? tailRoute.length : null,
        route: followsFoodRoute
          ? foodRoute.map((step) => ({ ...step.direction }))
          : [],
        stagnating,
        repeatedSteps,
        strategy,
        score,
      };
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

    if (selected.strategy === "SAFE FOOD ROUTE") {
      const remaining = Math.max(0, Number(selected.routeDistance) || 0);
      return {
        confidence: "ROUTE",
        reason: remaining === 1 ? "SIGNAL CAPTURE · EXIT PROVEN" : `SAFE PATH · ${remaining} TO SIGNAL`,
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (selected.strategy === "LOOP BREAK ROUTE") {
      const remaining = Math.max(0, Number(selected.routeDistance) || 0);
      return {
        confidence: "RECOVER",
        reason: `REPEAT DETECTED · ${remaining} TO SIGNAL`,
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (selected.strategy === "TAIL CHASE") {
      return {
        confidence: "RESET",
        reason: "FOOD UNSAFE · FOLLOWING TAIL",
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (selected.strategy === "SAFE SHORTCUT") {
      const remaining = Math.max(0, Number(selected.cycleFoodDistance) || 0);
      return {
        confidence: "ROUTE",
        reason: remaining ? `SAFE ARC · ${remaining} TO SIGNAL` : "SIGNAL CAPTURE · TAIL SAFE",
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (selected.strategy === "CYCLE GUARD") {
      return {
        confidence: "GUARD",
        reason: "TAIL ARC PRESERVED",
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (
      Number(selected.losingReplies) === 0
      && Number(runnerUp.losingReplies) > 0
    ) {
      return {
        confidence: "EVADE",
        reason: "COUNTER-MOVE AVOIDED",
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (
      Number(selected.drawingReplies) === 0
      && Number(runnerUp.drawingReplies) > 0
    ) {
      return {
        confidence: "EVADE",
        reason: "CONTESTED CELL AVOIDED",
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
    }
    if (selected.forcedWin && !runnerUp.forcedWin) {
      return {
        confidence: "ATTACK",
        reason: "FORCED CRASH FOUND",
        margin: Math.max(0, selected.score - runnerUp.score),
        runnerUp: runnerUp.name,
      };
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
    bufferDirection,
    canvasCompositionMove,
    chooseBestMove,
    collisionType,
    compareDecision,
    consumeDirectionBuffer,
    decisionInsight,
    decisionProfile,
    duelGridSize,
    duelSpawns,
    effectiveMode,
    evaluateDuelMoves,
    evaluateMoves,
    fluidMotionPath,
    gridDistance,
    isReverseDirection,
    mutationDelay,
    mutationScoreMultiplier,
    mutationTypeAt,
    motionProgress,
    ghostWindow,
    hamiltonianCycle,
    modeWraps,
    normalizeReplay,
    nextHead,
    pickupScore,
    rankForScore,
    reachableArea,
    survivalHorizon,
    normalizeSignalCode,
    nextSignalRandom,
    paceProfiles,
    signalIndex,
    signalState,
    soloTiming,
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
