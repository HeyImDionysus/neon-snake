"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const rules = require("./public/game-logic.js");

const source = fs.readFileSync(path.join(__dirname, "public", "game.js"), "utf8");
const DIRECTIONS = [
  { name: "up", x: 0, y: -1 },
  { name: "right", x: 1, y: 0 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
];

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

function recordingContext() {
  const calls = [];
  const context = new Proxy({ calls }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push({ operation: property, args });
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  return context;
}

function loadFunctions(names, globals) {
  const sandbox = { ...globals };
  vm.createContext(sandbox);
  vm.runInContext(
    `${names.map(functionSource).join("\n")}\nthis.loaded = { ${names.join(", ")} };`,
    sandbox,
  );
  return { sandbox, ...sandbox.loaded };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * .5)],
    p95: sorted[Math.floor(sorted.length * .95)],
    p99: sorted[Math.floor(sorted.length * .99)],
    max: sorted.at(-1),
  };
}

const tests = [
  ["late-run Canvas compositing is independent of retained mark metadata at 2× density", () => {
    const context = recordingContext();
    const paintLayer = { width: 1440, height: 1440 };
    const { sandbox, drawCanvasPaint } = loadFunctions(["drawCanvasPaint"], {
      canvas: { width: 720, height: 720 },
      canvasPaintLayer: paintLayer,
      canvasMarks: [{}],
      ctx: context,
    });

    drawCanvasPaint(1000, context, 2);
    const earlyOperations = context.calls.map(({ operation }) => operation);
    const earlyDraw = context.calls.find(({ operation }) => operation === "drawImage");
    assert.deepEqual(earlyOperations, ["drawImage", "fillRect"]);
    assert.deepEqual(Array.from(earlyDraw.args.slice(-4)), [0, 0, 1440, 1440]);

    context.calls.length = 0;
    sandbox.canvasMarks = Array.from({ length: 1400 }, () => ({}));
    drawCanvasPaint(1000, context, 2);
    assert.deepEqual(
      context.calls.map(({ operation }) => operation),
      earlyOperations,
      "1,400 retained marks must not add per-frame drawing operations",
    );
  }],
  ["one new Canvas step adds one glow stroke and keeps only bounded route metadata", () => {
    const context = recordingContext();
    const marks = Array.from({ length: 1400 }, () => ({}));
    const loaded = loadFunctions(["strokeCanvasMark", "addCanvasMark"], {
      activeMode: "canvas",
      CANVAS_PALETTES: [{ color: "#adff66", glow: "#adff66" }],
      canvasPaletteIndex: 0,
      canvasMarks: marks,
      canvasStrokeCount: 1400,
      CANVAS_MARK_LIMIT: 1400,
      canvasPaintLayerCtx: context,
      direction: { x: 1, y: 0 },
      combo: 3,
      overdriveUntil: 0,
      TILE: 72,
    });

    loaded.addCanvasMark({ x: 4, y: 5 }, { x: 5, y: 5 }, 1000);
    assert.equal(loaded.sandbox.canvasMarks.length, 1400);
    assert.equal(loaded.sandbox.canvasStrokeCount, 1401);
    assert.equal(
      context.calls.filter(({ operation }) => operation === "stroke").length,
      1,
    );
  }],
  ["expired visual effects are retired instead of accumulating across a long run", () => {
    const particles = Array.from({ length: 1000 }, (_, index) => ({
      x: 0,
      y: 0,
      vx: 1,
      vy: -1,
      life: index % 2 ? 1 : .01,
    }));
    const ripples = Array.from({ length: 1000 }, (_, index) => ({
      radius: 8,
      life: index % 2 ? 1 : .01,
    }));
    const loaded = loadFunctions(["updateEffects"], { particles, ripples });
    loaded.updateEffects(34);
    assert.equal(loaded.sandbox.particles.length, 500);
    assert.equal(loaded.sandbox.ripples.length, 500);
    assert.ok(loaded.sandbox.particles.every((particle) => particle.life > 0));
    assert.ok(loaded.sandbox.ripples.every((ripple) => ripple.life > 0));
  }],
  ["Autopilot consumes a proven route without repeating the full planner", () => {
    let telemetryUpdates = 0;
    const guardedRules = {
      nextHead: rules.nextHead,
      collisionType: rules.collisionType,
      evaluateMoves() {
        throw new Error("A committed route must not invoke the full planner.");
      },
    };
    const loaded = loadFunctions(["consumeAutopilotPlan"], {
      Rules: guardedRules,
      autopilotPlanMode: "canvas",
      autopilotPlanTarget: "15,15,signal",
      autopilotPlan: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 1 }],
      snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
      food: { x: 15, y: 15, kind: "signal" },
      GRID: 20,
      DIRECTION_OPTIONS: DIRECTIONS,
      aiChoice: {
        name: "right",
        strategy: "SAFE FOOD ROUTE",
        horizon: 6,
      },
      aiEvaluations: [],
      updateAiTelemetry() {
        telemetryUpdates += 1;
      },
    });

    const selected = loaded.consumeAutopilotPlan("canvas", "15,15,signal");
    assert.deepEqual({ ...selected }, { x: 1, y: 0 });
    assert.equal(loaded.sandbox.autopilotPlan.length, 2);
    assert.equal(loaded.sandbox.aiEvaluations.length, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(loaded.sandbox.aiChoice.forecast)),
      [{ x: 11, y: 10 }, { x: 11, y: 11 }, { x: 11, y: 12 }],
    );
    assert.equal(telemetryUpdates, 1);

    const choose = functionSource("chooseDemoDirection");
    const tick = functionSource("tick");
    assert.ok(
      choose.indexOf("consumeAutopilotPlan") < choose.indexOf("planAiMove()"),
      "Committed routes must be checked before a new full-board plan",
    );
    assert.match(tick, /followingCommittedRoute = demoMode && autopilotPlan\.length > 0/);
    assert.match(tick, /&& !followingCommittedRoute/);
  }],
  ["worst-shaped Canvas planning retains a reproducible interactive budget", () => {
    const snake = [];
    for (let y = 8; y <= 11; y += 1) {
      const row = Array.from({ length: 5 }, (_, index) => 8 + index);
      if (y % 2) row.reverse();
      row.forEach((x) => snake.push({ x, y }));
    }
    snake.length = 18;

    const samples = [];
    for (let iteration = 0; iteration < 3000; iteration += 1) {
      const startedAt = process.hrtime.bigint();
      rules.evaluateMoves({
        snake,
        direction: { x: 1, y: 0 },
        food: { x: 1, y: 1 },
        mode: "canvas",
        gridSize: 20,
        candidates: DIRECTIONS,
        recentHeads: [],
      });
      samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }
    const timing = summarize(samples);
    assert.ok(timing.mean < 5, JSON.stringify(timing));
    assert.ok(timing.p95 < 12, JSON.stringify(timing));
    process.stdout.write(
      `Canvas planner 3,000 decisions: mean ${timing.mean.toFixed(3)}ms, `
      + `p95 ${timing.p95.toFixed(3)}ms, p99 ${timing.p99.toFixed(3)}ms, `
      + `max ${timing.max.toFixed(3)}ms\n`,
    );
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic Canvas performance tests passed.\n`);
