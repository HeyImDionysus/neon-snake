(function startNeonSnakeWallpaper(root) {
  "use strict";

  const Rules = root.SnakeRules;
  const canvas = document.querySelector("#wallpaperCanvas");
  const signalLabel = document.querySelector("#wallpaperSignal");
  const context = canvas?.getContext("2d", { alpha: false });
  if (!Rules || !canvas || !context) return;

  const GRID = 20;
  const DIRECTIONS = [
    { name: "up", x: 0, y: -1 },
    { name: "right", x: 1, y: 0 },
    { name: "down", x: 0, y: 1 },
    { name: "left", x: -1, y: 0 },
  ];
  const PALETTES = {
    acid: ["#adff66", "#66e3ff", "#a98bff", "#ff7657"],
    aurora: ["#66e3ff", "#8affd1", "#a98bff", "#ffd166"],
    ultraviolet: ["#c797ff", "#ff6ed1", "#7ce7ff", "#adff66"],
  };
  const query = new URLSearchParams(location.search);
  const settings = {
    fps: clampNumber(query.get("fps"), 8, 30, 24),
    pace: clampNumber(query.get("pace"), 70, 260, 132),
    mode: query.get("mode") === "portal" ? "portal" : "classic",
    palette: PALETTES[query.get("palette")] ? query.get("palette") : "acid",
    glow: clampNumber(query.get("glow"), 0, 1, .78),
    mark: query.get("mark") !== "off",
  };

  let width = 1;
  let height = 1;
  let scale = 1;
  let tile = 1;
  let boardSize = 1;
  let boardX = 0;
  let boardY = 0;
  let snake = [];
  let previousSnake = [];
  let direction = { x: 1, y: 0 };
  let food = null;
  let signal = Rules.normalizeSignalCode(query.get("signal")) || createSignal();
  let randomState = Rules.signalState(signal);
  let recentHeads = [];
  let plan = [];
  let planTarget = "";
  let lastStepAt = performance.now();
  let nextStepAt = lastStepAt + settings.pace;
  let lastFrameAt = 0;
  let animationFrame = 0;
  let visible = !document.hidden;

  signalLabel.textContent = `SIGNAL ${signal}`;
  document.querySelector(".wallpaper-mark").hidden = !settings.mark;

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function createSignal() {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let state = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
    let result = "";
    for (let index = 0; index < 6; index += 1) {
      const next = Rules.nextSignalRandom(state);
      state = next.state;
      result += alphabet[Math.floor(next.value * alphabet.length)];
    }
    return result;
  }

  function nextRandom() {
    const next = Rules.nextSignalRandom(randomState);
    randomState = next.state;
    return next.value;
  }

  function reset() {
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    previousSnake = snake.map((segment) => ({ ...segment }));
    direction = { x: 1, y: 0 };
    recentHeads = [];
    plan = [];
    planTarget = "";
    placeFood();
    lastStepAt = performance.now();
    nextStepAt = lastStepAt + settings.pace;
  }

  function placeFood() {
    const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
    const free = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    food = free.length ? free[Math.floor(nextRandom() * free.length)] : null;
  }

  function legalPlannedMove(move) {
    if (!move || Rules.isReverseDirection(move, direction)) return false;
    const head = Rules.nextHead(snake[0], move, settings.mode, GRID);
    const growing = Boolean(food && head.x === food.x && head.y === food.y);
    return !Rules.collisionType(head, snake, growing, settings.mode, GRID);
  }

  function chooseDirection() {
    const target = food ? `${food.x},${food.y}` : "none";
    if (planTarget !== target || !plan.length || !legalPlannedMove(plan[0])) {
      const evaluations = Rules.evaluateMoves({
        snake,
        direction,
        food,
        mode: settings.mode,
        gridSize: GRID,
        candidates: DIRECTIONS,
        recentHeads,
      });
      const choice = Rules.chooseBestMove(evaluations);
      plan = choice?.route?.length
        ? choice.route.map((move) => ({ x: move.x, y: move.y }))
        : choice?.direction ? [{ ...choice.direction }] : [];
      planTarget = target;
    }
    const next = plan.shift();
    return legalPlannedMove(next) ? next : direction;
  }

  function step(now) {
    previousSnake = snake.map((segment) => ({ ...segment }));
    direction = chooseDirection();
    const head = Rules.nextHead(snake[0], direction, settings.mode, GRID);
    const growing = Boolean(food && head.x === food.x && head.y === food.y);
    if (Rules.collisionType(head, snake, growing, settings.mode, GRID)) {
      reset();
      return;
    }
    snake.unshift(head);
    recentHeads.push({ ...head });
    if (recentHeads.length > 192) recentHeads.shift();
    if (growing) {
      placeFood();
      plan = [];
    } else {
      snake.pop();
    }
    if (!food) {
      signal = createSignal();
      randomState = Rules.signalState(signal);
      signalLabel.textContent = `SIGNAL ${signal}`;
      reset();
      return;
    }
    lastStepAt = now;
    nextStepAt = now + settings.pace;
  }

  function resize() {
    width = Math.max(1, innerWidth);
    height = Math.max(1, innerHeight);
    scale = Math.min(2, Math.max(1, devicePixelRatio || 1));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    boardSize = Math.min(width, height) * (width / height > 2 ? .78 : .86);
    tile = boardSize / GRID;
    boardX = (width - boardSize) / 2;
    boardY = (height - boardSize) / 2;
  }

  function drawBackground(now) {
    const palette = PALETTES[settings.palette];
    const gradient = context.createRadialGradient(
      width * (.35 + Math.sin(now * .00008) * .08),
      height * (.28 + Math.cos(now * .00007) * .06),
      0,
      width * .5,
      height * .5,
      Math.max(width, height) * .82,
    );
    gradient.addColorStop(0, "rgba(30, 35, 52, 1)");
    gradient.addColorStop(.46, "rgba(9, 11, 18, 1)");
    gradient.addColorStop(1, "rgba(3, 4, 7, 1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(boardX, boardY);
    context.strokeStyle = `${palette[1]}12`;
    context.lineWidth = 1;
    for (let index = 0; index <= GRID; index += 1) {
      const offset = Math.round(index * tile) + .5;
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset, boardSize);
      context.stroke();
      context.beginPath();
      context.moveTo(0, offset);
      context.lineTo(boardSize, offset);
      context.stroke();
    }
    context.restore();
  }

  function drawFood(now) {
    if (!food) return;
    const palette = PALETTES[settings.palette];
    const pulse = .82 + Math.sin(now * .004) * .18;
    const x = boardX + (food.x + .5) * tile;
    const y = boardY + (food.y + .5) * tile;
    context.save();
    context.shadowBlur = tile * (1.1 + settings.glow);
    context.shadowColor = palette[3];
    context.fillStyle = palette[3];
    context.beginPath();
    context.arc(x, y, Math.max(2.5, tile * .17 * pulse), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = `${palette[0]}9e`;
    context.lineWidth = Math.max(1, tile * .035);
    context.beginPath();
    context.arc(x, y, tile * (.32 + pulse * .08), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function interpolatedSnake(progress) {
    return snake.map((segment, index) => {
      const previous = previousSnake[index] || previousSnake[previousSnake.length - 1] || segment;
      let dx = segment.x - previous.x;
      let dy = segment.y - previous.y;
      if (settings.mode === "portal") {
        if (Math.abs(dx) > 1) dx = dx > 0 ? dx - GRID : dx + GRID;
        if (Math.abs(dy) > 1) dy = dy > 0 ? dy - GRID : dy + GRID;
      }
      return {
        x: previous.x + dx * progress,
        y: previous.y + dy * progress,
      };
    });
  }

  function drawSnake(now) {
    const palette = PALETTES[settings.palette];
    const progress = Math.min(1, Math.max(0, (now - lastStepAt) / settings.pace));
    const points = interpolatedSnake(progress);
    const radius = Math.max(2.5, tile * .23);
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(4, tile * .48);
    context.shadowBlur = tile * settings.glow;
    context.shadowColor = palette[0];
    context.strokeStyle = palette[0];
    context.beginPath();
    points.forEach((point, index) => {
      const x = boardX + (point.x + .5) * tile;
      const y = boardY + (point.y + .5) * tile;
      if (!index) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    points.forEach((point, index) => {
      const x = boardX + (point.x + .5) * tile;
      const y = boardY + (point.y + .5) * tile;
      context.globalAlpha = Math.max(.16, 1 - index / Math.max(points.length, 12));
      context.fillStyle = index ? palette[index % 3] : "#f4ffe9";
      context.beginPath();
      context.arc(x, y, index ? radius * .72 : radius, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  function render(now) {
    animationFrame = requestAnimationFrame(render);
    if (!visible || now - lastFrameAt < 1000 / settings.fps) return;
    lastFrameAt = now;
    let catchUp = 0;
    while (now >= nextStepAt && catchUp < 3) {
      step(nextStepAt);
      catchUp += 1;
    }
    if (catchUp === 3 && now >= nextStepAt) nextStepAt = now + settings.pace;
    drawBackground(now);
    drawFood(now);
    drawSnake(now);
  }

  function setVisibility(nextVisible) {
    const resumed = !visible && nextVisible;
    visible = nextVisible;
    if (resumed) {
      lastStepAt = performance.now();
      nextStepAt = lastStepAt + settings.pace;
    }
  }

  root.livelyPropertyListener = (name, value) => {
    if (name === "fps") settings.fps = clampNumber(value, 8, 30, settings.fps);
    if (name === "pace") settings.pace = clampNumber(value, 70, 260, settings.pace);
    if (name === "glow") settings.glow = clampNumber(Number(value) / 100, 0, 1, settings.glow);
    if (name === "palette" && PALETTES[value]) settings.palette = value;
    if (name === "mode" && ["classic", "portal"].includes(value)) {
      settings.mode = value;
      reset();
    }
    if (name === "mark") {
      settings.mark = Boolean(value);
      document.querySelector(".wallpaper-mark").hidden = !settings.mark;
    }
  };

  root.livelyWallpaperPlaybackChanged = (data) => {
    const state = typeof data === "string" ? Number(data) : Number(data?.state ?? data);
    setVisibility(state !== 0);
  };

  addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => setVisibility(!document.hidden));
  addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });

  resize();
  reset();
  animationFrame = requestAnimationFrame(render);
})(globalThis);
