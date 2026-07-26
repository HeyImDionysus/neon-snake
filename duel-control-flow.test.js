"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "public", "duel.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public", "duel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "duel.css"), "utf8");

function functionBody(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected function ${name}`);
  const brace = script.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < script.length; index += 1) {
    if (script[index] === "{") depth += 1;
    if (script[index] === "}") depth -= 1;
    if (depth === 0) return script.slice(brace + 1, index);
  }
  throw new Error(`Unclosed function ${name}`);
}

const tests = [
  ["duel page IDs are unique", () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, new Set(ids).size);
  }],
  ["both duel types share the expanded logical arena", () => {
    assert.match(script, /const DUEL_GRID = Rules\.duelGridSize\(20\)/);
    assert.match(script, /tileSize = canvas\.width \/ DUEL_GRID/);
    assert.match(html, /30 × 30/);
    assert.match(styles, /\.duel-board/);
  }],
  ["AI duel starts only from an explicit player action", () => {
    assert.match(script, /aiButton\.addEventListener\("click", prepareAiDuel\)/);
    assert.ok(!script.slice(script.lastIndexOf("hydrateRoomCode()")).includes("prepareAiDuel()"));
    assert.match(functionBody("prepareAiDuel"), /beginCountdown/);
  }],
  ["AI decisions account for both snakes", () => {
    const body = functionBody("chooseAiDirection");
    assert.match(body, /Rules\.evaluateDuelMoves/);
    assert.match(body, /opponentSnake: playerSnake/);
  }],
  ["the renderer draws both fluid snakes", () => {
    const body = functionBody("render");
    assert.match(body, /drawFluidSnake\(playerSnake/);
    assert.match(body, /drawFluidSnake\(opponentSnake/);
    assert.match(functionBody("drawFluidSnake"), /Rules\.fluidMotionPath/);
  }],
  ["live rooms remain waiting until two connected players are ready", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /Rules\.liveRoomPhase\(participants\)/);
    assert.match(body, /phase === "waiting"/);
    assert.match(body, /phase === "ready"/);
    assert.match(body, /phase === "countdown"/);
    assert.match(body, /beginLiveCountdown/);
  }],
  ["live-room transport is explicitly identified as a local canary", () => {
    assert.match(html, /SAME-BROWSER CANARY/);
    assert.match(html, /room-transport\.js/);
    assert.match(script, /Transports\.createBroadcastRoomTransport/);
    assert.ok(!script.includes("new BroadcastChannel"));
  }],
  ["live countdown aborts if either player disconnects", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /abortLiveCountdown/);
    assert.match(body, /liveCountdownActive/);
  }],
  ["presence heartbeats do not create a reply loop", () => {
    const body = functionBody("handleRoomMessage");
    const branch = body.match(/if \(message\.type === "presence" \|\| message\.type === "ready"\) \{([^]*?)\n  \}/);
    assert.ok(branch, "Expected a presence/ready branch");
    assert.ok(!branch[1].includes("announcePresence()"));
  }],
  ["connected live players get an accurate ready-gate overlay", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /BOTH CONNECTED/);
    assert.match(body, /READY WHEN<br><em>YOU ARE/);
    assert.match(body, /runState === "ready"/);
  }],
  ["an active live duel replaces the stale countdown room label", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(
      body,
      /phase === "countdown"\) \{\n    roomState\.textContent = runState === "running"\n      \? "LIVE DUEL ACTIVE"/,
    );
    assert.match(functionBody("startLiveDuel"), /roomState\.textContent = "LIVE DUEL ACTIVE"/);
  }],
  ["AI duels expose visible desktop pause and restart controls", () => {
    assert.match(html, /id="duelPauseDesktop"/);
    assert.match(html, /id="duelRestartButton"/);
    const state = functionBody("setRunState");
    assert.match(state, /pauseButton\.disabled = !pausable/);
    assert.match(state, /pauseDesktop\.disabled = !pausable/);
    assert.match(script, /pauseDesktop\.addEventListener\("click", togglePause\)/);
    assert.match(script, /restartButton\.addEventListener\("click", prepareAiDuel\)/);
  }],
  ["a connected room locks its Signal Code", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /roomCodeInput\.disabled = roomConnected/);
  }],
  ["a third participant is explicitly treated as a spectator", () => {
    const body = functionBody("syncLiveRoom");
    assert.match(body, /ROOM FULL · SPECTATING/);
    assert.match(body, /roomFull/);
    assert.match(body, /SPECTATOR/);
    const hud = functionBody("updateHud");
    assert.match(hud, /PLAYER 1/);
    assert.match(hud, /PLAYER 2/);
  }],
  ["duel tabs support standard arrow-key navigation", () => {
    const body = functionBody("handleTabKey");
    assert.match(body, /ArrowLeft/);
    assert.match(body, /ArrowRight/);
    assert.match(body, /Home/);
    assert.match(body, /End/);
    assert.match(script, /aiTab\.addEventListener\("keydown", handleTabKey\)/);
    assert.match(script, /liveTab\.addEventListener\("keydown", handleTabKey\)/);
  }],
];

for (const [name, test] of tests) {
  test();
  process.stdout.write(`PASS ${name}\n`);
}

process.stdout.write(`\n${tests.length} deterministic duel control-flow tests passed.\n`);
