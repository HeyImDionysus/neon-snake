"use strict";

// Decision DNA compares each step a player takes with the Autopilot planner.
// The planner is too expensive to run on the main thread every tick - it made
// late, fast runs skip cells on phones - so the comparison runs here, from
// snapshots the game posts, and the totals are read back when the run ends.

importScripts(`game-logic.js${self.location.search}`);

const Rules = self.SnakeRules;
let run = 0;
let candidates = [];
let gridSize = 20;
let stats = emptyStats();

function emptyStats() {
  return { decisions: 0, matches: 0, spaceRatioTotal: 0, riskTurns: 0 };
}

self.addEventListener("message", ({ data }) => {
  if (!data || typeof data !== "object") return;
  if (data.type === "reset") {
    run = data.run;
    candidates = data.candidates;
    gridSize = data.gridSize;
    stats = emptyStats();
    return;
  }
  if (data.type === "step") {
    if (data.run !== run) return;
    const evaluations = Rules.evaluateMoves({
      snake: data.snake,
      direction: data.direction,
      food: data.food,
      mode: data.mode,
      gridSize,
      candidates,
      recentHeads: [],
    });
    const comparison = Rules.compareDecision(evaluations, data.choice);
    if (!comparison) return;
    stats.decisions += 1;
    stats.matches += comparison.matched ? 1 : 0;
    stats.spaceRatioTotal += comparison.spaceRatio;
    stats.riskTurns += comparison.risk ? 1 : 0;
    return;
  }
  if (data.type === "report") {
    self.postMessage({ type: "report", run: data.run, stats: data.run === run ? stats : emptyStats() });
  }
});
