"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "public", "game.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "public", "styles.css"), "utf8");

function functionBody(name) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?(?=\\r?\\nfunction |$)`));
  assert.ok(match, `Expected to find function ${name}`);
  return match[0];
}

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function contrastRatio(first, second) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

const tests = [
  ["direction input cannot start or replace a run", () => {
    const body = functionBody("requestDirection");
    assert.ok(!body.includes("prepareRun("));
    assert.match(body, /runState === "ready" \|\| runState === "over"/);
    assert.match(body, /if \(demoMode\)/);
  }],
  ["rapid turns use the bounded deterministic input buffer", () => {
    const request = functionBody("requestDirection");
    assert.equal((request.match(/Rules\.bufferDirection\(directionBuffer, direction, next\)/g) || []).length, 2);
    assert.match(functionBody("tick"), /Rules\.consumeDirectionBuffer\(directionBuffer, direction\)/);
  }],
  ["Autopilot uses the currently selected mode", () => {
    const body = functionBody("prepareDemo");
    assert.match(body, /activeMode = selectedMode\(\)/);
    assert.match(body, /setState\("running", `\$\{activeMode\.toUpperCase\(\)\} AUTOPILOT`\)/);
  }],
  ["Rush Autopilot initializes its own countdown", () => {
    const body = functionBody("prepareDemo");
    assert.match(body, /activeMode === "rush".*rushDeadline = performance\.now\(\) \+ rushRemaining/s);
  }],
  ["keyboard restart preserves the current owner", () => {
    const body = functionBody("handleKeyboard");
    assert.match(body, /if \(demoMode\) restartDemo\(\);\s*else prepareRun\(\);/);
  }],
  ["controller Start cannot bypass the owner choice", () => {
    const body = functionBody("pollGamepad");
    const idleBranch = body.match(/if \(runState === "ready" \|\| runState === "over"\) \{([^]*?)\}\s*else/);
    assert.ok(idleBranch, "Expected an explicit idle controller branch");
    assert.ok(!idleBranch[1].includes("prepareRun("));
    assert.match(idleBranch[1], /Choose Play/);
  }],
  ["backgrounding does not silently stop Autopilot", () => {
    const body = functionBody("handleVisibilityChange");
    assert.match(body, /runState === "running" && !demoMode/);
    assert.ok(!body.includes('runState === "running" && demoMode'));
  }],
  ["player countdown waits while the page is hidden", () => {
    const body = functionBody("handleVisibilityChange");
    assert.match(body, /document\.hidden/);
    assert.match(body, /runState === "countdown"/);
    assert.match(body, /suspendCountdown\(\)/);
    assert.match(body, /countdownSuspended/);
    assert.match(body, /beginCountdown\(countdownStep\)/);
  }],
  ["career runs increment only when movement actually starts", () => {
    const prepare = functionBody("prepareRun");
    const start = functionBody("startRun");
    assert.ok(!prepare.includes("profile.runs"));
    assert.match(start, /profile\.runs \+= 1/);
    assert.match(start, /saveProfile\(\)/);
    assert.match(start, /totalRunsEl\.textContent/);
  }],
  ["the ready overlay exposes both explicit owners", () => {
    const body = functionBody("updateReadyOverlay");
    assert.match(body, /startButton\.hidden = false/);
    assert.match(body, /demoButton\.hidden = false/);
    assert.match(body, /THE RUN STARTS ONLY AFTER YOU CHOOSE/);
  }],
  ["decision telemetry distinguishes Autopilot from advice", () => {
    const body = functionBody("updateAiTelemetry");
    assert.match(body, /AUTOPILOT/);
    assert.match(body, /DECISION LENS · YOU DRIVE/);
    assert.match(body, /classList\.toggle\("driver", demoMode\)/);
    assert.match(body, /Rules\.decisionInsight\(aiEvaluations, aiChoice\)/);
    assert.match(body, /aiEvidence\.textContent/);
  }],
  ["one versioned board decision is reused by Autopilot, Lens, and Decision DNA", () => {
    const evaluate = functionBody("evaluatePlannerState");
    const record = functionBody("recordDecision");
    const choose = functionBody("chooseDemoDirection");
    assert.match(evaluate, /nextKey === aiPlanKey/);
    assert.match(evaluate, /Rules\.evaluateMoves/);
    assert.doesNotMatch(record, /Rules\.evaluateMoves/);
    assert.match(record, /evaluatePlannerState\(effectiveMode\)/);
    assert.match(choose, /planAiMove\(\)/);
  }],
  ["an expired Core is replaced before the next movement decision", () => {
    const body = functionBody("render");
    assert.ok(body.indexOf("expireCore(now)") < body.indexOf("advanceMovement(now)"));
  }],
  ["Canvas paint cost stays constant as permanent strokes accumulate", () => {
    const draw = functionBody("drawCanvasPaint");
    const add = functionBody("addCanvasMark");
    assert.match(draw, /target\.drawImage\(canvasPaintLayer, 0, 0\)/);
    assert.match(draw, /else \{\n    canvasMarks\.forEach/);
    assert.match(add, /strokeCanvasMark\(canvasPaintLayerCtx, canvasMarks\.at\(-1\)\)/);
  }],
  ["Canvas Autopilot alternates an authored motif with signal capture", () => {
    const choose = functionBody("chooseDemoDirection");
    const place = functionBody("placeFood");
    assert.match(choose, /Rules\.canvasCompositionMove/);
    assert.match(choose, /canvasCompositionBudget -= 1/);
    assert.match(place, /canvasCompositionBudget = 14 \+ \(signalRandomState % 12\)/);
  }],
  ["mutation selection cannot alter mode boundaries", () => {
    const body = functionBody("activateMutation");
    assert.ok(!body.includes("phase"));
    assert.match(body, /const options = \["flow", "amplify"\]/);
  }],
  ["Autopilot forecast renders beneath the snake without animated dashes", () => {
    const forecast = functionBody("drawAiForecast");
    const board = functionBody("drawBoard");
    assert.match(forecast, /aiChoice\?\.forecast\?\.length/);
    assert.match(forecast, /fluidPixelGroups\(path\)/);
    assert.ok(!forecast.includes("setLineDash"));
    assert.ok(board.indexOf("drawAiForecast(now)") < board.indexOf("drawSnake(now)"));
  }],
  ["mobile Autopilot exposes a readable stop control", () => {
    const body = functionBody("updateActionLabels");
    assert.match(body, /aiPlaying \? "STOP"/);
    assert.match(body, /classList\.toggle\("stop-ai", aiPlaying\)/);
  }],
  ["pause controls expose only actionable states", () => {
    const body = functionBody("updateActionLabels");
    assert.match(body, /const canPause = runState === "running" \|\| paused/);
    assert.match(body, /pauseButton\.disabled = !canPause/);
    assert.match(body, /mobilePause\.disabled = !canPause/);
  }],
  ["successful share actions announce their outcome", () => {
    const body = functionBody("shareGame");
    assert.match(body, /announcement\.textContent = `Signal \$\{runSignal\} shared\.`/);
    assert.match(body, /announcement\.textContent = `Signal \$\{runSignal\} link copied\.`/);
  }],
  ["player-only Decision Lens control hides while Autopilot drives", () => {
    const body = functionBody("updateActionLabels");
    assert.match(body, /lensButton\.hidden = aiPlaying/);
  }],
  ["post-run choices stay concise and mode-aware", () => {
    const body = functionBody("endGame");
    assert.match(body, /modeLabel\(\)\.toUpperCase\(\).*RUN REPORT/);
    assert.match(body, /demoButtonLabel\.textContent = "Watch Autopilot"/);
  }],
  ["dim interface text meets normal-text contrast across panel surfaces", () => {
    const match = styles.match(/--dim:\s*#([a-f\d]{6})/i);
    assert.ok(match, "Expected a six-digit --dim color token");
    ["070b09", "0b110e", "101813", "142018", "16231b"].forEach((background) => {
      assert.ok(
        contrastRatio(match[1], background) >= 4.5,
        `Expected --dim to meet 4.5:1 on #${background}`,
      );
    });
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic control-flow tests passed.\n`);
