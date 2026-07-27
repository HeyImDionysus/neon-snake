(function startNeonSnakeWallpaper(root) {
  "use strict";

  const Rules = root.SnakeRules;
  const Engine = root.NeonWallpaperEngine;
  const surface = document.querySelector(".wallpaper-surface");
  const canvas = document.querySelector("#wallpaperCanvas");
  const signalLabel = document.querySelector("#wallpaperSignal");
  const scoreLabel = document.querySelector("#wallpaperScore");
  const chainLabel = document.querySelector("#wallpaperChain");
  const pickup = document.querySelector("#wallpaperPickup");
  const pickupName = document.querySelector("#wallpaperPickupName");
  const pickupPoints = document.querySelector("#wallpaperPickupPoints");
  const context = canvas?.getContext("2d", { alpha: false });
  if (!Rules || !Engine || !surface || !canvas || !context) return;

  const PALETTES = {
    acid: {
      body: "#8ddd55",
      bodyDark: "#294b2c",
      bodyLight: "#d4ffa8",
      secondary: "#66e3ff",
      field: "#adff66",
      food: "#ff7657",
      core: "#ffd166",
      atmosphere: "35, 78, 45",
    },
    aurora: {
      body: "#69e5c0",
      bodyDark: "#214c46",
      bodyLight: "#d8fff4",
      secondary: "#66e3ff",
      field: "#8affd1",
      food: "#ff8870",
      core: "#ffd166",
      atmosphere: "31, 77, 73",
    },
    ultraviolet: {
      body: "#c797ff",
      bodyDark: "#4c3266",
      bodyLight: "#f2e6ff",
      secondary: "#ff6ed1",
      field: "#a98bff",
      food: "#ff7657",
      core: "#ffd166",
      atmosphere: "64, 42, 91",
    },
  };
  const PALETTE_CHOICES = ["acid", "aurora", "ultraviolet"];
  const MODE_CHOICES = ["classic", "portal"];
  const query = new URLSearchParams(location.search);
  const signal = Rules.normalizeSignalCode(query.get("signal")) || createSignal();
  const settings = {
    fps: clampNumber(query.get("fps"), 8, 30, 24),
    pace: clampNumber(query.get("pace"), 70, 260, 112),
    mode: query.get("mode") === "portal" ? "portal" : "classic",
    palette: PALETTES[query.get("palette")] ? query.get("palette") : "acid",
    glow: clampNumber(query.get("glow"), 0, 1, .78),
    mark: query.get("mark") !== "off",
  };
  let engine = Engine.createWallpaperEngine({ rules: Rules, signal, mode: settings.mode });
  let state = engine.snapshot();
  let previousSnake = state.snake.map((point) => ({ ...point }));
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let tile = 1;
  let boardSize = 1;
  let boardX = 0;
  let boardY = 0;
  let lastStepAt = performance.now();
  let nextStepAt = lastStepAt + settings.pace;
  let lastFrameAt = 0;
  let animationFrame = 0;
  let visible = !document.hidden;
  let pickupTimer = 0;
  let pickupEffects = [];

  signalLabel.textContent = `SIGNAL ${signal}`;
  document.querySelector(".wallpaper-mark").hidden = !settings.mark;

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function resolveLivelyChoice(value, choices) {
    if (typeof value === "string" && choices.includes(value)) return value;
    const index = typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
    return Number.isInteger(index) ? choices[index] : undefined;
  }

  function createSignal() {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let seed = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
    let result = "";
    for (let index = 0; index < 6; index += 1) {
      const next = Rules.nextSignalRandom(seed);
      seed = next.state;
      result += alphabet[Math.floor(next.value * alphabet.length)];
    }
    return result;
  }

  function rebuildEngine() {
    engine = Engine.createWallpaperEngine({ rules: Rules, signal, mode: settings.mode });
    state = engine.snapshot();
    previousSnake = state.snake.map((point) => ({ ...point }));
    lastStepAt = performance.now();
    nextStepAt = lastStepAt + settings.pace;
    updateHud();
  }

  function updateHud() {
    scoreLabel.textContent = String(state.score).padStart(5, "0");
    chainLabel.textContent = String(state.snake.length).padStart(3, "0");
  }

  function boardPoint(point) {
    return {
      x: boardX + (point.x + .5) * tile,
      y: boardY + (point.y + .5) * tile,
    };
  }

  function resize() {
    const bounds = surface.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    pixelRatio = Math.min(2, Math.max(1, devicePixelRatio || 1));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const landscape = width / height > 1.18;
    boardSize = Math.min(width * (landscape ? .72 : .9), height * (landscape ? .84 : .72));
    tile = boardSize / 20;
    boardX = (width - boardSize) / 2;
    boardY = (height - boardSize) / 2 + (landscape ? height * .025 : height * .055);
  }

  function spawnPickupEffects(event) {
    const origin = boardPoint(event.food);
    const palette = PALETTES[settings.palette];
    const color = event.food.kind === "core" ? palette.core : palette.food;
    pickupEffects.push({
      x: origin.x,
      y: origin.y,
      born: performance.now(),
      color,
      points: event.points,
    });
    pickupName.textContent = event.food.kind === "core" ? "CORE ACQUIRED" : "SIGNAL ACQUIRED";
    pickupPoints.textContent = `+${event.points}`;
    pickup.classList.add("is-visible");
    clearTimeout(pickupTimer);
    pickupTimer = setTimeout(() => pickup.classList.remove("is-visible"), 850);
  }

  function step(now) {
    previousSnake = state.snake.map((point) => ({ ...point }));
    const event = engine.step();
    state = engine.snapshot();
    if (event?.type === "eat" || event?.type === "complete") spawnPickupEffects(event);
    updateHud();
    lastStepAt = now;
    nextStepAt = now + settings.pace;
  }

  function drawBackground(now) {
    const palette = PALETTES[settings.palette];
    const driftX = width * (.3 + Math.sin(now * .00008) * .08);
    const driftY = height * (.22 + Math.cos(now * .00007) * .07);
    const gradient = context.createRadialGradient(
      driftX,
      driftY,
      0,
      width * .5,
      height * .5,
      Math.max(width, height) * .86,
    );
    gradient.addColorStop(0, `rgba(${palette.atmosphere}, .48)`);
    gradient.addColorStop(.4, "rgba(7, 15, 9, 1)");
    gradient.addColorStop(1, "rgba(2, 5, 3, 1)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.save();
    context.globalCompositeOperation = "lighter";
    for (let index = 0; index < 34; index += 1) {
      const x = ((index * 223 + 91) % 997) / 997 * width;
      const baseY = ((index * 167 + 47) % 991) / 991 * height;
      const y = (baseY + Math.sin(now * .0004 + index) * 8 + height) % height;
      context.globalAlpha = .04 + (index % 5 === 0 ? .05 : 0);
      context.fillStyle = index % 6 === 0 ? palette.secondary : palette.field;
      context.beginPath();
      context.arc(x, y, index % 7 === 0 ? 1.5 : .8, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    const boardGlow = context.createRadialGradient(
      boardX + boardSize * .5,
      boardY + boardSize * .45,
      boardSize * .08,
      boardX + boardSize * .5,
      boardY + boardSize * .5,
      boardSize * .72,
    );
    boardGlow.addColorStop(0, `rgba(${palette.atmosphere}, .12)`);
    boardGlow.addColorStop(1, "rgba(2, 7, 4, .04)");
    context.fillStyle = boardGlow;
    context.fillRect(boardX, boardY, boardSize, boardSize);
    context.strokeStyle = `${palette.field}20`;
    context.lineWidth = 1;
    context.strokeRect(boardX + .5, boardY + .5, boardSize - 1, boardSize - 1);

    const corner = Math.max(12, tile * .8);
    context.strokeStyle = `${palette.field}66`;
    context.lineWidth = 2;
    [
      [boardX, boardY, 1, 1],
      [boardX + boardSize, boardY, -1, 1],
      [boardX, boardY + boardSize, 1, -1],
      [boardX + boardSize, boardY + boardSize, -1, -1],
    ].forEach(([x, y, sx, sy]) => {
      context.beginPath();
      context.moveTo(x, y + sy * corner);
      context.lineTo(x, y);
      context.lineTo(x + sx * corner, y);
      context.stroke();
    });
  }

  function drawFood(now) {
    if (!state.food) return;
    const palette = PALETTES[settings.palette];
    const point = boardPoint(state.food);
    const core = state.food.kind === "core";
    const color = core ? palette.core : palette.food;
    const pulse = 1 + Math.sin(now / 150) * .1;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(core ? now / 650 : 0);
    context.shadowColor = color;
    context.shadowBlur = tile * (core ? 1.1 : .8) * settings.glow;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.5, tile * .055);
    context.globalAlpha = .34;
    context.beginPath();
    context.arc(0, 0, tile * .42 * pulse, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = color;
    if (core) {
      const size = tile * .26 * pulse;
      context.beginPath();
      context.moveTo(0, -size);
      context.lineTo(size, 0);
      context.lineTo(0, size);
      context.lineTo(-size, 0);
      context.closePath();
      context.fill();
    } else {
      const radius = tile * .27 * pulse;
      context.fillStyle = color;
      context.beginPath();
      context.arc(-radius * .38, radius * .08, radius * .72, 0, Math.PI * 2);
      context.arc(radius * .38, radius * .08, radius * .72, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = palette.bodyDark;
      context.lineWidth = Math.max(1.5, tile * .075);
      context.beginPath();
      context.moveTo(0, -radius * .48);
      context.quadraticCurveTo(radius * .04, -radius * 1.05, radius * .34, -radius * 1.18);
      context.stroke();
      context.fillStyle = palette.body;
      context.beginPath();
      context.ellipse(
        radius * .58,
        -radius * .88,
        radius * .42,
        radius * .2,
        -.45,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.restore();
  }

  function interpolatedSnake(now) {
    const progress = Math.min(1, Math.max(0, (now - lastStepAt) / settings.pace));
    return Rules.fluidMotionPath(previousSnake, state.snake, progress, 20);
  }

  function strokeSnakeGroups(points, color, widthRatio, alpha = 1) {
    const groups = Rules.splitFluidPath(points, 20);
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = Math.max(2, tile * widthRatio);
    groups.forEach((group) => {
      if (!group.length) return;
      context.beginPath();
      group.forEach((point, index) => {
        const pixel = boardPoint(point);
        if (!index) context.moveTo(pixel.x, pixel.y);
        else context.lineTo(pixel.x, pixel.y);
      });
      context.stroke();
    });
  }

  function drawSnakeHead(point, now) {
    const palette = PALETTES[settings.palette];
    const head = boardPoint(point);
    const angle = Math.atan2(state.direction.y, state.direction.x);
    context.save();
    context.translate(head.x, head.y);
    context.rotate(angle);
    context.globalAlpha = .18;
    context.fillStyle = palette.field;
    context.beginPath();
    context.arc(0, 0, tile * .52, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.shadowColor = palette.field;
    context.shadowBlur = tile * settings.glow * .62;
    context.fillStyle = palette.bodyLight;
    context.beginPath();
    context.arc(0, 0, tile * .39, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "#122015";
    [-1, 1].forEach((side) => {
      context.beginPath();
      context.arc(tile * .16, side * tile * .12, Math.max(1.5, tile * .055), 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  function drawSnake(now) {
    const palette = PALETTES[settings.palette];
    const points = interpolatedSnake(now);
    if (!points.length) return;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = palette.field;
    context.shadowBlur = tile * settings.glow * .34;
    strokeSnakeGroups(points, palette.field, 1.08, .13);
    context.shadowBlur = 0;
    strokeSnakeGroups(points, palette.bodyDark, .82);
    strokeSnakeGroups(points, palette.body, .64);
    strokeSnakeGroups(points, palette.bodyLight, .08, .22);
    context.restore();
    drawSnakeHead(points[0], now);
  }

  function drawPickupEffects(now) {
    pickupEffects = pickupEffects.filter((effect) => now - effect.born < 900);
    pickupEffects.forEach((effect) => {
      const progress = Math.min(1, (now - effect.born) / 900);
      context.save();
      context.globalAlpha = (1 - progress) * .8;
      context.strokeStyle = effect.color;
      context.lineWidth = Math.max(1, tile * .05);
      context.shadowColor = effect.color;
      context.shadowBlur = tile * .5;
      context.beginPath();
      context.arc(effect.x, effect.y, tile * (.2 + progress * 1.4), 0, Math.PI * 2);
      context.stroke();
      for (let index = 0; index < 8; index += 1) {
        const angle = index / 8 * Math.PI * 2;
        const distance = tile * progress * 1.8;
        context.fillStyle = effect.color;
        context.beginPath();
        context.arc(
          effect.x + Math.cos(angle) * distance,
          effect.y + Math.sin(angle) * distance,
          Math.max(1, tile * .06 * (1 - progress)),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      context.restore();
    });
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
    drawPickupEffects(now);
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
    const palette = name === "palette" ? resolveLivelyChoice(value, PALETTE_CHOICES) : undefined;
    if (palette && PALETTES[palette]) settings.palette = palette;
    const mode = name === "mode" ? resolveLivelyChoice(value, MODE_CHOICES) : undefined;
    if (mode) {
      settings.mode = mode;
      rebuildEngine();
    }
    if (name === "mark") {
      settings.mark = Boolean(value);
      document.querySelector(".wallpaper-mark").hidden = !settings.mark;
    }
  };

  root.livelyWallpaperPlaybackChanged = (data) => {
    const playbackState = typeof data === "string" ? Number(data) : Number(data?.state ?? data);
    setVisibility(playbackState !== 0);
  };

  addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => setVisibility(!document.hidden));
  addEventListener("pagehide", () => {
    cancelAnimationFrame(animationFrame);
    clearTimeout(pickupTimer);
  }, { once: true });

  resize();
  updateHud();
  animationFrame = requestAnimationFrame(render);
})(globalThis);
