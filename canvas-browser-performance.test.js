"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = __dirname;
const gameSource = fs.readFileSync(path.join(root, "public", "game.js"), "utf8");
const rulesSource = fs.readFileSync(path.join(root, "public", "game-logic.js"), "utf8");

function functionSource(name) {
  const start = gameSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const bodyStart = gameSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < gameSource.length; index += 1) {
    if (gameSource[index] === "{") depth += 1;
    if (gameSource[index] === "}") depth -= 1;
    if (depth === 0) return gameSource.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

function executable(name) {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], {
    encoding: "utf8",
  });
  return found.status === 0 ? found.stdout.trim() : "";
}

function chromeExecutable() {
  const configured = process.env.CHROME_BIN;
  if (configured && fs.existsSync(configured)) return configured;
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .map(executable)
    .find(Boolean);
}

function browserProgram() {
  const productionFunctions = [
    "strokeCanvasMark",
    "drawCanvasPaint",
    "drawBoardAtmosphere",
    "drawEffects",
  ].map(functionSource).join("\n");
  return `
${rulesSource}
"use strict";
const Rules = globalThis.SnakeRules;
const GRID = 20;
const canvas = document.createElement("canvas");
canvas.width = 1440;
canvas.height = 1440;
const ctx = canvas.getContext("2d", { alpha: false });
const canvasPaintLayer = document.createElement("canvas");
canvasPaintLayer.width = 1440;
canvasPaintLayer.height = 1440;
const canvasPaintLayerCtx = canvasPaintLayer.getContext("2d");
let TILE = canvas.width / GRID;
let canvasMarks = [];
let particles = Array.from({ length: 252 }, (_, index) => ({
  x: (index * 67) % canvas.width,
  y: (index * 97) % canvas.height,
  size: 3 + index % 3,
  life: .35 + (index % 5) * .12,
  color: index % 3 ? "#ff7657" : "#adff66",
}));
let ripples = Array.from({ length: 14 }, (_, index) => ({
  x: (index * 181) % canvas.width,
  y: (index * 223) % canvas.height,
  radius: 8 + index * 5,
  life: .4 + (index % 4) * .13,
  color: index % 2 ? "#ffd166" : "#ff7657",
}));
${productionFunctions}

const candidates = [
  { name: "up", x: 0, y: -1 },
  { name: "right", x: 1, y: 0 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
];
const snake = [];
for (let y = 8; y <= 11; y += 1) {
  const row = Array.from({ length: 5 }, (_, index) => 8 + index);
  if (y % 2) row.reverse();
  row.forEach((x) => snake.push({ x, y }));
}
snake.length = 18;

function mark(index) {
  const x = (index * 7) % GRID;
  const y = (index * 11) % GRID;
  return {
    from: { x, y },
    to: { x: (x + 1) % GRID, y },
    direction: { x: 1, y: 0 },
    color: ["#adff66", "#74e1ff", "#a98bff", "#ff7657", "#ffd166"][index % 5],
    glow: ["#adff66", "#58d6ff", "#a98bff", "#ff7657", "#ffd166"][index % 5],
    wraps: x === GRID - 1,
    energy: .65,
  };
}

function summarize(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return {
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * .5)],
    p95: sorted[Math.floor(sorted.length * .95)],
    p99: sorted[Math.floor(sorted.length * .99)],
    max: sorted.at(-1),
  };
}

function sampleCombinedPass(firstMark, count = 80, warmup = 10) {
  const samples = [];
  for (let sample = 0; sample < count + warmup; sample += 1) {
    const startedAt = performance.now();
    strokeCanvasMark(canvasPaintLayerCtx, mark(firstMark + sample));
    ctx.fillStyle = "#040806";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBoardAtmosphere(startedAt);
    drawCanvasPaint(startedAt);
    drawEffects();
    Rules.evaluateMoves({
      snake,
      direction: { x: 1, y: 0 },
      food: { x: 1, y: 1 },
      mode: "canvas",
      gridSize: GRID,
      candidates,
      recentHeads: [],
    });
    ctx.getImageData(0, 0, 1, 1);
    if (sample >= warmup) samples.push(performance.now() - startedAt);
  }
  return summarize(samples);
}

canvasMarks.push(mark(0));
strokeCanvasMark(canvasPaintLayerCtx, canvasMarks[0]);
canvasPaintLayerCtx.getImageData(0, 0, 1, 1);
const early = sampleCombinedPass(1);
for (let index = 1; index < 1400; index += 1) {
  const nextMark = mark(index);
  canvasMarks.push(nextMark);
  strokeCanvasMark(canvasPaintLayerCtx, nextMark);
}
canvasPaintLayerCtx.getImageData(0, 0, 1, 1);
const late = sampleCombinedPass(1400);
const result = {
  width: canvas.width,
  height: canvas.height,
  retainedMarks: canvasMarks.length,
  particles: particles.length,
  ripples: ripples.length,
  early,
  late,
  userAgent: navigator.userAgent,
};
document.querySelector("#result").dataset.json = encodeURIComponent(JSON.stringify(result));
document.querySelector("#result").textContent = "complete";
`;
}

const chrome = chromeExecutable();
if (!chrome) {
  if (process.env.CANVAS_BROWSER_REQUIRED === "1") {
    throw new Error("A Chromium executable is required for the Canvas browser performance gate.");
  }
  process.stdout.write("SKIP real Canvas raster gate (Chromium unavailable)\n");
} else {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "neon-canvas-"));
  const htmlPath = path.join(temporaryDirectory, "canvas-performance.html");
  const program = browserProgram().replace(/<\/script/gi, "<\\/script");
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><canvas hidden></canvas>`
    + `<pre id="result" data-json=""></pre><script>${program}</script>`,
  );

  try {
    const browser = spawnSync(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    assert.equal(
      browser.status,
      0,
      `Chromium failed (${browser.status}): ${browser.stderr.slice(-2000)}`,
    );
    const encoded = browser.stdout.match(/id="result" data-json="([^"]+)"/)?.[1];
    assert.ok(encoded, `Missing browser benchmark result: ${browser.stdout.slice(-2000)}`);
    const result = JSON.parse(decodeURIComponent(encoded));
    assert.deepEqual(
      { width: result.width, height: result.height },
      { width: 1440, height: 1440 },
    );
    assert.ok(result.retainedMarks >= 1400, JSON.stringify(result));
    assert.equal(result.particles, 252);
    assert.equal(result.ripples, 14);
    assert.ok(result.late.p50 < 20, JSON.stringify(result));
    assert.ok(result.late.p95 < 44, JSON.stringify(result));
    assert.ok(
      result.late.p95 <= result.early.p95 * 2.5 + 6,
      `Late raster cost grew with retained history: ${JSON.stringify(result)}`,
    );
    process.stdout.write(
      `PASS real 1440px combined Canvas gate: early p95 ${result.early.p95.toFixed(3)}ms, `
      + `late mean ${result.late.mean.toFixed(3)}ms, late p95 ${result.late.p95.toFixed(3)}ms, `
      + `late p99 ${result.late.p99.toFixed(3)}ms\n`,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
