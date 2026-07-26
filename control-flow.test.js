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
  ["AI play uses the currently selected mode", () => {
    const body = functionBody("prepareDemo");
    assert.match(body, /activeMode = selectedMode\(\)/);
    assert.match(body, /setState\("running", `\$\{activeMode\.toUpperCase\(\)\} AI PLAY`\)/);
  }],
  ["Rush AI initializes its own countdown", () => {
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
  ["backgrounding does not silently stop AI play", () => {
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
  ["AI telemetry distinguishes control from advice", () => {
    const body = functionBody("updateAiTelemetry");
    assert.match(body, /AI CONTROL/);
    assert.match(body, /AI HINT · YOU DRIVE/);
    assert.match(body, /classList\.toggle\("driver", demoMode\)/);
    assert.match(body, /Rules\.decisionInsight\(aiEvaluations, aiChoice\)/);
  }],
  ["mutation selection cannot alter mode boundaries", () => {
    const body = functionBody("activateMutation");
    assert.ok(!body.includes("phase"));
    assert.match(body, /const options = \["flow", "amplify"\]/);
  }],
  ["AI forecast renders beneath the snake without animated dashes", () => {
    const forecast = functionBody("drawAiForecast");
    const board = functionBody("drawBoard");
    assert.match(forecast, /aiChoice\?\.forecast\?\.length/);
    assert.match(forecast, /fluidPixelGroups\(path\)/);
    assert.ok(!forecast.includes("setLineDash"));
    assert.ok(board.indexOf("drawAiForecast(now)") < board.indexOf("drawSnake(now)"));
  }],
  ["mobile AI play exposes a readable stop control", () => {
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
  ["player-only AI Lens control hides while AI drives", () => {
    const body = functionBody("updateActionLabels");
    assert.match(body, /lensButton\.hidden = aiPlaying/);
  }],
  ["post-run choices stay concise and mode-aware", () => {
    const body = functionBody("endGame");
    assert.match(body, /modeLabel\(\)\.toUpperCase\(\).*RUN REPORT/);
    assert.match(body, /demoButtonLabel\.textContent = "Watch AI"/);
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
