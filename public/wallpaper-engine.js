(function exposeNeonWallpaperEngine(root) {
  "use strict";

  const GRID = 20;

  function createWallpaperEngine({
    rules = root.SnakeRules,
    signal = "NEON42",
    mode = "classic",
  } = {}) {
    if (!rules) throw new TypeError("Snake rules are required.");
    const cycle = rules.hamiltonianCycle(GRID);
    const indexes = new Map(cycle.map((point, index) => [`${point.x},${point.y}`, index]));
    const normalizedSignal = rules.normalizeSignalCode(signal) || "NEON42";
    let randomState = rules.signalState(normalizedSignal);
    let snake = [];
    let direction = { x: 1, y: 0 };
    let food = null;
    let foodsEaten = 0;
    let score = 0;
    let completedBoards = 0;

    function nextRandom() {
      const next = rules.nextSignalRandom(randomState);
      randomState = next.state;
      return next.value;
    }

    function key(point) {
      return `${point.x},${point.y}`;
    }

    function placeFood(initial = false) {
      const occupied = new Set(snake.map(key));
      const headIndex = indexes.get(key(snake[0]));
      const minimum = initial ? 4 : 10;
      const range = initial ? 1 : 24;
      const desired = minimum + Math.floor(nextRandom() * range);
      for (let extra = 0; extra < cycle.length; extra += 1) {
        const point = cycle[(headIndex + desired + extra) % cycle.length];
        if (!occupied.has(key(point))) {
          food = {
            ...point,
            kind: (foodsEaten + 1) % 5 === 0 ? "core" : "signal",
          };
          return;
        }
      }
      food = null;
    }

    function reset({ preserveCareer = true } = {}) {
      if (!preserveCareer) {
        foodsEaten = 0;
        score = 0;
        completedBoards = 0;
      }
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      direction = { x: 1, y: 0 };
      placeFood(true);
    }

    function cycleDirection() {
      const head = snake[0];
      const headIndex = indexes.get(key(head));
      const target = cycle[(headIndex + 1) % cycle.length];
      return {
        x: target.x - head.x,
        y: target.y - head.y,
      };
    }

    function step() {
      direction = cycleDirection();
      const head = rules.nextHead(snake[0], direction, mode, GRID);
      const growing = Boolean(food && head.x === food.x && head.y === food.y);
      const collision = rules.collisionType(head, snake, growing, mode, GRID);
      if (collision) {
        reset();
        return { type: "reset", reason: collision };
      }

      snake.unshift(head);
      if (!growing) {
        snake.pop();
        return { type: "move" };
      }

      foodsEaten += 1;
      const points = food.kind === "core" ? 50 : 10;
      score += points;
      const eaten = { ...food };
      if (snake.length >= cycle.length) {
        completedBoards += 1;
        reset();
        return {
          type: "complete",
          food: eaten,
          points,
          foodsEaten,
          score,
        };
      }
      placeFood();
      return {
        type: "eat",
        food: eaten,
        points,
        foodsEaten,
        score,
      };
    }

    function snapshot() {
      return {
        grid: GRID,
        mode,
        signal: normalizedSignal,
        snake: snake.map((point) => ({ ...point })),
        direction: { ...direction },
        food: food ? { ...food } : null,
        foodsEaten,
        score,
        completedBoards,
      };
    }

    reset({ preserveCareer: false });
    return { reset, snapshot, step };
  }

  const api = { createWallpaperEngine };
  root.NeonWallpaperEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
